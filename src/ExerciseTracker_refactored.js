// ---------------------------------------------
// ExerciseTracker_refactored.js
// ---------------------------------------------
import React, { useRef, useEffect, useState, useCallback } from 'react';
import Webcam from 'react-webcam';
import { PhaseMachine } from './phase_machine';
import { EXERCISE_SPECS } from './registry';
import { drawCanvas, sendUpdates, calculateDistance, resetSyncState } from './utilities';
import * as Features from "./features";

import VideoRecorder from './VideoRecorder';
import SkeletonRecorder from './SkeletonRecorder';
import { getServiceUrl } from './config';
import axios from 'axios';
import { createPoseDetector } from './detectors';
import { SessionStateMachine } from './SessionStateMachine';
import {
  drawTargetBox, drawCountdown, drawCoachingMessages,
  drawInactiveOverlay, drawLoadingOverlay, coachingColor
} from './CoachingOverlay';
import { IDEAL_BODY_RATIO } from './PoseQuality';
import { DTWPhaseMachine, computeUniversalFeatures } from './dtw';
import { KeypointRecorder } from './KeypointRecorder';
import { VIDEO_CONSTRAINTS } from './captureConfig';
import { getReference } from './dtw/referenceRegistry';
import { bootstrapAllReferences, fetchAndCacheReference } from './dtw/bootstrapReferences';
import {
  METRIC_MAP, resolveMetricKeys, pickExerciseMetrics, pretty
} from './metrics';
import { notifyHostOfError } from './ErrorBoundary';

// Re-exported for backwards compatibility with existing importers.
export { METRIC_MAP, resolveMetricKeys };

// Auto-register all 16 synthetic DTW references on first load
bootstrapAllReferences();


const { EMA, kp, present, computeCommonFeatures, angle } = Features;

// Top-level helpers in ExerciseTracker_refactored.js (near other helpers)
function getQueryNumber(...names) {
  const q = new URLSearchParams(window.location.search);
  for (const n of names) {
    const v = q.get(n);
    if (v != null && v !== '' && !isNaN(Number(v))) return Number(v);
  }
  return undefined;
}

// How many inferences may be in flight at once.
//
// Measured at 2 on an Adreno 710: poseLatency 76 -> 125ms, inferSync 10 -> 36ms,
// loop 45 -> 22fps, for only 13 -> 17 poses/sec. Concurrent inferences contend
// for the same GPU and submitting into a saturated queue blocks the caller, so
// overlapping them costs far more than the extra update rate is worth. Keep 1.
const MAX_INFERENCES_IN_FLIGHT = 1;

// Draw-time skeleton extrapolation.
//
// Measured on an Adreno 710 / WebGPU: end-to-end pose latency is ~76ms (max
// ~182ms), so the drawn skeleton trails the live video by that much. Inference
// speed does not fix this - WebGPU cut main-thread blocking from 68ms to 10ms
// and the latency barely moved, because the cost is GPU work and readback.
//
// So instead of drawing where the body WAS, project each joint forward along
// its measured velocity to where it should be now.
//
// DRAWING ONLY. These positions are predicted, not observed, and must never
// reach feature extraction, the phase machines or rep counting.
const SKELETON_EXTRAPOLATION = true;

// Project only a fraction of the measured lag. Limbs decelerate at the top of a
// rep, where linear projection overshoots most, and overshoot reads worse than
// lag. Undercorrecting is the safer error.
const EXTRAPOLATION_DAMPING = 0.8;

// Hard ceiling regardless of measured latency, so a stalled inference cannot
// fling the skeleton off the body.
const MAX_EXTRAPOLATION_MS = 120;

// Velocity from samples this far apart describes unknown motion in between.
const MAX_VELOCITY_BASIS_MS = 400;

// ...and from samples this close together it is mostly detector noise.
const MIN_VELOCITY_BASIS_MS = 20;

// Never move a joint more than this in one projection. Bounds the visible error
// when a keypoint jumps between frames.
const MAX_KP_SHIFT_PX = 70;

// Only project joints we are confident about. At the 0.3 detection threshold a
// keypoint wanders frame to frame, and "velocity" computed from that is noise -
// which showed up as a jittery torso and legs while the well-tracked arm
// tracked correctly. Below this a joint is drawn where it was measured.
const EXTRAPOLATION_MIN_SCORE = 0.5;

// Smoothing on the velocity estimate itself. Raw frame-to-frame velocity is
// noisy enough that projecting it produced visible jitter; averaging across
// updates keeps the direction while damping the shake.
const VELOCITY_EMA = 0.45;

/**
 * @param {{t:number,poses:Array}|null} prev    previous inference
 * @param {{t:number,poses:Array}|null} latest  most recent inference
 * @param {number} now                          current frame time
 * @param {{v:Array}} velStore                  mutable smoothed-velocity cache
 * @returns {Array} poses shaped exactly like the detector's output
 */
function extrapolatePoses(prev, latest, now, velStore) {
  const latestKps = latest?.poses?.[0]?.keypoints;
  const prevKps = prev?.poses?.[0]?.keypoints;
  if (!latestKps) return latest?.poses ?? [];
  if (!prevKps || prevKps.length !== latestKps.length) return latest.poses;

  const basis = latest.t - prev.t;
  if (basis < MIN_VELOCITY_BASIS_MS || basis > MAX_VELOCITY_BASIS_MS) {
    return latest.poses;
  }

  const ahead = Math.min(
    Math.max(now - latest.t, 0) * EXTRAPOLATION_DAMPING,
    MAX_EXTRAPOLATION_MS
  );
  if (ahead <= 0) return latest.poses;

  if (!velStore.v || velStore.v.length !== latestKps.length) {
    velStore.v = latestKps.map(() => ({ vx: 0, vy: 0 }));
  }

  const projected = latestKps.map((kp, i) => {
    const p0 = prevKps[i];
    const vel = velStore.v[i];
    const tracked =
      p0 &&
      (kp.score ?? 0) >= EXTRAPOLATION_MIN_SCORE &&
      (p0.score ?? 0) >= EXTRAPOLATION_MIN_SCORE;

    if (!tracked) {
      vel.vx = 0;
      vel.vy = 0;
      return kp;
    }

    vel.vx = vel.vx * (1 - VELOCITY_EMA) + ((kp.x - p0.x) / basis) * VELOCITY_EMA;
    vel.vy = vel.vy * (1 - VELOCITY_EMA) + ((kp.y - p0.y) / basis) * VELOCITY_EMA;

    const dx = Math.max(-MAX_KP_SHIFT_PX, Math.min(MAX_KP_SHIFT_PX, vel.vx * ahead));
    const dy = Math.max(-MAX_KP_SHIFT_PX, Math.min(MAX_KP_SHIFT_PX, vel.vy * ahead));
    return { ...kp, x: kp.x + dx, y: kp.y + dy };
  });

  return [{ ...latest.poses[0], keypoints: projected }, ...latest.poses.slice(1)];
}

function alphaFor(key) {
  const k = String(key || '').toLowerCase();
  if (k.includes('norm')) return 0.4;       // heavier smoothing for normalized distances
  return 0.35;
}

const SKIP_SMOOTH = new Set([
  'side',
  // STS thresholds
  'seatedDistThresh', 'standingDistThresh',
  // Mini Squats thresholds
  'downDistThresh', 'upDistThresh', 'squatAngleDown', 'squatAngleUp',
  // LAQ thresholds
  'laqAngleFlexed', 'laqAngleExtended', 'laqDistFlexed', 'laqDistExtended',
  // Standing Straight Up thresholds
  'standKneeUp', 'standTrunkUp', 'standHipOverAnkleMax',
  'slumpKnee', 'slumpTrunk', 'slumpHipOverAnkleMax',
  // Seated / Standing Marches thresholds
  'hipFlexAngleUp', 'hipFlexAngleDown', 'kneeLiftNormUp', 'kneeLiftNormDown',
  'kneeToAnkleLiftNormUp', 'kneeToAnkleLiftNormDown',
  // Mini Lunges thresholds
  'lungeKneeDown', 'lungeKneeUp',
  // Bicep Curls thresholds
  'elbowFlexUp', 'elbowFlexDown',
  // LiftsAndChops thresholds
  'liftHigh', 'chopLow', 'xSideEnter',
  // StepUps thresholds
  'ankleLiftNormUp', 'ankleLiftNormDown', 'kneeExtendedUp', 'kneeFlexedDown',
  // Wall Push-Up thresholds
  'elbowOffsetDown', 'elbowOffsetUp', 'trunkStraightMin', 'elbowLevelTol',
  // Calf Raises Seated dynamic thresholds
  'plantarMetric', 'plantarUp', 'plantarDown', 'plantarDelta',
  'ankleAngle', 'ankleAngleUp', 'ankleAngleDown',
  'footPitchDelta', 'footPitchDeltaMin', 'footPitchDeltaActive',
  'anklePlantarPctActive', 'pctUp', 'pctDown', 'anklePlantarDeltaActive', 'degUp', 'degDown',
  'toeDeltaActive', 'toeStayTol', 'dPitchActive', 'dPitchMin',
  'ankleAngleDeltaActive', 'ankleAngleDeltaMin', 'angleGateOn',
  'dPlantarPerSec', 'degSlopeMin', 'heelLiftActive', 'heelLiftMin',
  'ankleAngleActive', 'activeToeAngle', 'readyAngleActive', 'raiseDeltaActive',
  'readyMin', 'readyMax', 'raiseUp', 'raiseDown',
  // Calf Raises Standing dynamic thresholds
  'kneeStraightMin',
  // Dorsiflexion thresholds & guards (seated + standing)
  'pitchUp', 'pitchDown', 'heelStayTol', 'toeUpDeltaMin', 'ankleStayTol',
  // Shared posture thresholds
  'trunkUprightMin', 'trunkAngleMin', 'kneeAngleMin',
  // Calf Raises Seated passthrough
  'heelBelowKneeUp', 'heelBelowKneeDown', 'ankleBelowKneeUp', 'ankleBelowKneeDown',
]);

export default function ExerciseTrackerRefactored({
  exerciseType, side, targetReps, isDetecting,
  setIsDetecting, isVideoRecording, setIsVideoRecording,
  isSkeletonRecording, setIsSkeletonRecording,
  setDisplayMessage, activityData
}) {
  const webcamRef = useRef(null);
  const canvasRef = useRef(null);
  const detectorRef = useRef(null);

  const detKindRef = useRef(null); // 'movenet' or 'mediapipe'

  // unified HUD refs
  const repCountRef = useRef(0);
  const keypointsRef = useRef([]);
  const keypointColorsRef = useRef('#66FF00');
  const segmentColorsRef = useRef('#66FF00');
  const feedbackLogRef = useRef('');
  const feedbackRef = useRef('Initializing...');
  const prevPhaseRef = useRef(null);
  const prevRepRef = useRef(0);
  const specRef = useRef(null);

  const lastFeedbackSentRef = useRef(null);
  const detectionStartTimeRef = useRef(null);
  const lastFrameTimeRef = useRef(performance.now());
  const latestPosesRef = useRef([]);
  const inferenceRunningRef = useRef(0);
  // Last two completed inferences, timestamped, used only to extrapolate the
  // DRAWN skeleton. The exercise engine keeps consuming raw poses.
  const posePrevRef = useRef(null);
  const velStoreRef = useRef({ v: null });
  const poseLatestRef = useRef(null);
  const previousRemainingTimeRef = useRef(null);
  const fpsRef = useRef(0);
  const lastExerciseDataRef = useRef({});

  const videoRecorderRef = useRef(null);
  const skeletonRecorderRef = useRef(null);

  const [engine, setEngine] = useState(null);

  // Smoothers: lazily created per-feature
  const smoothRef = useRef({});
  const sessionSMRef = useRef(null);

  // Fetch video-extracted reference from platform API (background, non-blocking).
  // First session uses synthetic ref; subsequent sessions use the cached video ref.
  useEffect(() => {
    if (exerciseType && activityData?.tenant) {
      fetchAndCacheReference(exerciseType, activityData).catch(() => {});
    }
  }, [exerciseType, activityData?.tenant]); // eslint-disable-line react-hooks/exhaustive-deps

  // wipe smoothers on (re)start or exercise/side change
  useEffect(() => {
    smoothRef.current = {};
  }, [isDetecting, exerciseType, side]);

  async function uploadVideo(file, type) {
    const query = new URLSearchParams(window.location.search);
    if (!activityData?.tenant) throw new Error('Missing tenant information');
    const serviceUrl = getServiceUrl(activityData);
    const res = await axios.post(
      `${serviceUrl.USER_SERVICE}/files/stream`,
      file,
      {
        headers: {
          'Content-Type': 'application/octet-stream',
          Authorization: `Bearer ${query.get('token')}`,
          tenantId: activityData.tenant
        },
        params: {
          fileName: `${activityData.activity || 'exercise'}_${type}_${Date.now()}_exercise.webm`,
          isExerciseSync: true
        },
        timeout: 30000
      }
    );
    return res.data;
  }

  // Records the keypoint stream in parallel with the webm recorders. Gated on the
  // same skeleton-recording consent, because it captures the same movement.
  const keypointRecorderRef = useRef(null);

  const onComplete = useCallback(async () => {
    // Save patient baseline & session summary (DTW mode)
    const eng = engine;
    if (eng?.saveBaseline) {
      try { eng.saveBaseline(); } catch (e) { console.warn('[Baseline] save failed:', e); }
    }
    const sessionSummary = eng?.getSessionSummary?.() || {};

    const finalData = {
      // Spread fallback first so explicit fields below override stale data.
      ...lastExerciseDataRef.current,
      fps: fpsRef.current,
      feedback: 'Target reps achieved!',
      completionStatusRef: true,
      repCount: repCountRef.current,
      // Phase D: attempts vs completed reps
      ...(sessionSummary.reps ? {
        completedReps: sessionSummary.reps.completed,
        attemptedReps: sessionSummary.reps.attempts,
        totalReps: sessionSummary.reps.total,
        completionRate: sessionSummary.completionRate,
      } : {}),
    };
    await sendUpdates(finalData, exerciseType, activityData, setDisplayMessage);

    // liveRepCount is what makes the recording testable: the replay harness
    // asserts its own count against what the live session actually reported.
    const kpRec = keypointRecorderRef.current;
    if (kpRec) {
      try {
        await kpRec.saveToDevServer({ liveRepCount: repCountRef.current });
      } catch (e) {
        console.warn('[KeypointRecorder] flush failed:', e);
      }
      keypointRecorderRef.current = null;
    }

    setIsDetecting(false);
    setIsVideoRecording(false);
    setIsSkeletonRecording(false);

    detectionStartTimeRef.current = null;
    previousRemainingTimeRef.current = null;
  }, [
    exerciseType,
    activityData,
    engine,
    setIsDetecting,
    setIsVideoRecording,
    setIsSkeletonRecording,
  ]);

  const maybeSendUpdates = useCallback(
    async (exerciseData, { force = false } = {}) => {
      const finalData = {
        fps: fpsRef.current,
        completionStatusRef: false,
        repCount: repCountRef.current,
        feedback: feedbackRef.current,
        ...exerciseData,
      };
      // Normally throttled to frames where the feedback text changed. `force` is used
      // when a rep is counted so the per-rep ROM summary always reaches the host,
      // regardless of whether the coaching string happened to change on that frame.
      if (force || feedbackRef.current !== lastFeedbackSentRef.current) {
        lastFeedbackSentRef.current = feedbackRef.current;
        await sendUpdates(finalData, exerciseType, activityData, setDisplayMessage);
      }
    },
    [exerciseType, activityData]
  );

  // Detector init (swap per exercise/spec)
  useEffect(() => {
    let canceled = false;

    (async () => {
      try {
        // Which detector does the active spec want? (allow ?backend=mp|movenet override)
        const q = new URLSearchParams(window.location.search);
        const forced = q.get('backend'); // "mp" or "movenet"
        const activeSpec = EXERCISE_SPECS[exerciseType] || EXERCISE_SPECS.SideArmRaise;
        const kind = forced === 'mp' ? 'mediapipe'
          : forced === 'movenet' ? 'movenet'
            : (activeSpec?.detector || 'movenet');

        // No change? keep current detector
        if (detectorRef.current && detKindRef.current === kind) return;

        // Dispose previous detector if switching
        try { await detectorRef.current?.dispose?.(); } catch { }
        detectorRef.current = null;
        detKindRef.current = kind;


        console.time(`[Tracker] ${kind} load`);
        const detector = await createPoseDetector(kind); // <-- central helper (uses CDN for MP)
        console.timeEnd(`[Tracker] ${kind} load`);
        console.log('[DetectorInit]', { exerciseType, forced, chosen: kind });

        if (!canceled) {
          detectorRef.current = detector;
          console.log(`[Tracker] detector ready (${kind})`);
        } else {
          await detector?.dispose?.();
        }

      } catch (err) {
        // Previously console-only: the patient just saw "Initializing..." forever.
        console.error('[Tracker] detector init failed:', err);
        if (!canceled) {
          setDisplayMessage?.(
            'Could not start pose detection on this device. Please close and reopen the exercise, ' +
            'or try a different browser.'
          );
          notifyHostOfError('Pose detector failed to load.', err?.message);
        }
      }
    })();

    // Cleanup on unmount or exercise change
    return () => {
      canceled = true;
      try { detectorRef.current?.dispose?.(); } catch { }
      detectorRef.current = null;
    };
    // setDisplayMessage is a setState function (stable identity), so including it
    // does not cause the detector to be rebuilt.
  }, [exerciseType, setDisplayMessage]); // re-evaluate when exercise (and thus spec) changes



  // Build/refresh spec & engine on exercise/targetReps change
  useEffect(() => {
    const spec = EXERCISE_SPECS[exerciseType] || EXERCISE_SPECS.SideArmRaise;
    specRef.current = spec;

    // reset local state tied to a specific spec
    prevPhaseRef.current = null;
    prevRepRef.current = 0;
    lastFeedbackSentRef.current = null;
    feedbackRef.current = 'Initializing...';
    smoothRef.current = {}; // wipe smoothers on spec switch
    resetSyncState(); // clear accumulated updates & message cache
    // reset any per-session calibration in the spec
    try { spec?.onStart?.(); } catch { }
    // Derive target seconds for time mode
    let targetSeconds;
    const isTimeMode = (spec.mode === 'time' || spec.isTimeBased);
    if (isTimeMode) {
      const qSeconds = getQueryNumber('seconds', 'time');
      const qRepsAsSeconds = getQueryNumber('reps'); // user may pass reps, but we treat it as seconds in time mode
      const envSeconds =
        Number(process.env.REACT_APP_DEFAULT_SECONDS) ||
        Number(process.env.REACT_APP_DEFAULT_TIME_S) ||
        Number(process.env.REACT_APP_DEFAULT_REPS); // dev convenience

      targetSeconds =
        (Number.isFinite(qSeconds) ? qSeconds : undefined) ??
        (Number.isFinite(qRepsAsSeconds) ? qRepsAsSeconds : undefined) ??
        (Number.isFinite(envSeconds) ? envSeconds : undefined) ??
        (Number.isFinite(targetReps) ? targetReps : undefined); // final fallback
    }

    // Choose engine: DTWPhaseMachine (if reference exists) or PhaseMachine (hand-coded spec)
    const ref = getReference(exerciseType);
    // Dev mode never populates activityData (App.js short-circuits the JWT round-trip),
    // so patientId was null, so PatientBaseline was never constructed, so the entire
    // baseline-driven ROM gate was silently inert on exactly the loop we test with.
    // A stable per-exercise id keeps calibration persistent across dev reloads.
    // Inert in production: REACT_APP_DEVELOPMENT_MODE is not 'true' there.
    const devPatientId = process.env.REACT_APP_DEVELOPMENT_MODE === 'true'
      ? `dev-${exerciseType}`
      : null;
    const patientId = activityData?.patient?.id || activityData?.userId
      || activityData?.activity || devPatientId;
    let eng;
    if (ref) {
      // Feed the engine the exact universal keys this exercise reports, so each
      // counted rep can carry a per-rep min/max ROM summary to the host app.
      const summaryFeatures = (METRIC_MAP[exerciseType] || [])
        .flatMap(m => resolveMetricKeys(m, side));
      eng = new DTWPhaseMachine(ref, { targetReps, targetSeconds, patientId, side, summaryFeatures });
      // Which template is actually driving rep counting matters a lot when validating
      // a newly recorded reference — 'synthetic' means the recording is NOT in use.
      const src = ref.source || 'synthetic';
      console.log(
        `[Engine] DTW mode for ${exerciseType} — reference source: ${src.toUpperCase()}`,
        patientId ? `(patient: ${patientId})` : '(no patient)'
      );
    } else {
      console.warn(
        `[Engine] No DTW reference for "${exerciseType}" — falling back to legacy PhaseMachine. ` +
        `None of the recent fixes (startCue, side-aware cues, mobile ROM tuning) apply on this path. ` +
        `Check spelling against EXERCISE_CONFIGS keys in src/dtw/specToReference.js.`
      );
      eng = new PhaseMachine(spec, { targetReps, targetSeconds });
    }
    setEngine(eng);

    // Sidecar recorder. Built here so it inherits the engine's resolved primary
    // feature — the key the ROM gate actually acts on, which is the one a replay
    // most needs. Recording only starts once the session does.
    keypointRecorderRef.current = isSkeletonRecording
      ? new KeypointRecorder({
          exercise: exerciseType,
          side,
          patientId,
          detector: (ref ? eng.spec : spec)?.detector || 'movenet',
          featureKeys: (METRIC_MAP[exerciseType] || []).flatMap(m => resolveMetricKeys(m, side)),
          primaryFeature: eng.primaryFeature || null,
        })
      : null;

    // Create/reset session state machine for coaching flow
    // DTWPhaseMachine exposes a .spec object for compatibility
    sessionSMRef.current = new SessionStateMachine(ref ? eng.spec : spec);

    const phaseList = Array.isArray((ref ? eng.spec : spec)?.phases)
      ? (ref ? eng.spec : spec).phases.map(p => p.id ?? p).join(', ')
      : '(no phases)';
    console.log('[Engine] built:', spec?.name ?? exerciseType, ref ? '(DTW)' : '(spec)', 'phases:', phaseList);
    // `side` matters: it selects the primary feature, the side-aware DTW filtering,
    // and which universal keys are reported — the engine must be rebuilt when it changes.
  }, [exerciseType, targetReps, side, isSkeletonRecording]);

  useEffect(() => {
    setIsDetecting?.(true);
  }, []);

  // Detection loop
  useEffect(() => {
    console.log('[Tracker] isDetecting:', isDetecting, 'engine?', !!engine, 'detector?', !!detectorRef.current);
    if (!isDetecting) return;

    // fresh counters
    prevPhaseRef.current = null;
    prevRepRef.current = 0;
    lastFeedbackSentRef.current = null;
    feedbackRef.current = 'Initializing...';

    let rafId = 0;
    // FPS measurement (match original tracker behavior)
    let frameCount = 0;
    let lastFpsUpdate = performance.now();
    // Per-iteration cost breakdown. fps below measures this RAF loop, not the
    // inference rate, so when it sits far under display refresh the stall is
    // somewhere in here.
    const probe = { inferSync: 0, rest: 0, total: 0, n: 0 };
    // End-to-end pose latency: capture -> result available for drawing. This is
    // what the eye actually sees, and it is NOT inferSync. inferSync only counts
    // main-thread blocking; WebGPU returns from that quickly and finishes the
    // real work asynchronously, so the drawn pose can be far older than it.
    const lat = { sum: 0, n: 0, max: 0, gapSum: 0, gapN: 0, lastDone: 0 };

    // Non-blocking inference: fire-and-forget so RAF runs at 60fps while
    // inference runs alongside at device-max rate. On mobile this prevents
    // the 100–300ms per-frame stall that caused visible canvas pausing.
    const loop = async () => {
      if (!isDetecting) return;

      const det = detectorRef.current;
      const video = webcamRef.current?.video;

      // Keep polling until both detector and video are ready
      if (!det || !video || video.readyState < 2) {
        rafId = requestAnimationFrame(loop);
        return;
      }

      const tLoop0 = performance.now();

      // Kick off inference if none is in flight (fire-and-forget).
      // Canvas draws using the most recent completed result.
      // Allow more than one inference in flight. poseRate was pinned to
      // 1/poseLatency because a new frame could not start until the previous
      // finished - 13 fresh poses/sec against a 45fps draw loop. The GPU work is
      // async, so overlapping them raises the update rate without raising the
      // per-pose latency. Results can land out of order, so stale ones are
      // dropped on arrival.
      if (inferenceRunningRef.current < MAX_INFERENCES_IN_FLIGHT) {
        inferenceRunningRef.current += 1;
        // Timestamp when the FRAME IS READ, not when inference resolves. The
        // pose describes the video as it looked now; by the time the promise
        // settles that is already ~60ms in the past, and the draw happens a
        // further frame later. Measuring from completion under-corrects by
        // about half the true age.
        const capturedAt = performance.now();
        det.estimatePoses(video).then(p => {
          const doneAt = performance.now();
          lat.sum += doneAt - capturedAt;
          lat.n += 1;
          if (doneAt - capturedAt > lat.max) lat.max = doneAt - capturedAt;
          if (lat.lastDone) { lat.gapSum += doneAt - lat.lastDone; lat.gapN += 1; }
          lat.lastDone = doneAt;
          inferenceRunningRef.current -= 1;
          // Out-of-order guard: with several in flight an older frame can resolve
          // after a newer one. Never let the skeleton jump backwards in time.
          if (poseLatestRef.current && capturedAt <= poseLatestRef.current.t) return;
          latestPosesRef.current = p;
          posePrevRef.current = poseLatestRef.current;
          poseLatestRef.current = { t: capturedAt, poses: p };
        }).catch(() => { inferenceRunningRef.current -= 1; });
      }
      // estimatePoses() is only partly async: the video->GPU texture upload and
      // kernel dispatch happen synchronously before it returns a promise.
      const tLoop1 = performance.now();
      const poses = latestPosesRef.current;
      // Inference costs ~60ms on mid-range Android, so `poses` is always at
      // least one inference stale and the skeleton visibly trails the video.
      // Project keypoints forward along their measured velocity for drawing
      // only - the engine below still uses the raw, unextrapolated `poses`.
      const drawPoses = SKELETON_EXTRAPOLATION
        ? extrapolatePoses(posePrevRef.current, poseLatestRef.current, tLoop1, velStoreRef.current)
        : poses;

      // Ensure canvas matches the actual video size
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const ctx = canvasRef.current.getContext('2d');
      if (canvasRef.current.width !== vw || canvasRef.current.height !== vh) {
        canvasRef.current.width = vw;
        canvasRef.current.height = vh;
      }
      ctx.clearRect(0, 0, vw, vh);

      // ─── Session State Machine ───────────────────────────────────
      const rawKps = (poses?.[0]?.keypoints) || [];
      const sm = sessionSMRef.current;
      const sessionResult = sm
        ? sm.step({
            keypoints: rawKps,
            frameW: vw,
            frameH: vh,
            hasDetector: true,
            hasVideo: true,
            engineDone: false,
          })
        : { state: 'active', coachingChecks: [], countdownRemaining: null, message: '' };
      const sessionState = sessionResult.state;

      // ─── Compute & smooth features (all states) ─────────────────
      // DTW mode: use universal features; spec mode: use per-spec features
      const isDTW = engine instanceof DTWPhaseMachine;
      const feat = isDTW
        ? computeUniversalFeaturesFromPoses(poses)
        : computeFeaturesForExercise(poses, exerciseType, side, specRef.current);
      const smooth = smoothRef.current;
      const frameNow = performance.now();
      const frameDt = frameNow - lastFrameTimeRef.current;
      lastFrameTimeRef.current = frameNow;
      for (const [k, raw] of Object.entries(feat)) {
        if (SKIP_SMOOTH.has(k) || !Number.isFinite(raw)) continue;
        if (!smooth[k]) smooth[k] = new EMA(alphaFor(k));
        const v = smooth[k].nextWithDt(raw, frameDt);
        if (Number.isFinite(v)) feat[k] = v;
      }

      // Highlight helper (shared across states)
      const setHighlight = ({ keypoints, color }) => {
        keypointsRef.current = keypoints || [];
        keypointColorsRef.current = color || '#66FF00';
        segmentColorsRef.current = color || '#66FF00';
      };
      const spec = specRef.current;

      // Apply highlights except during loading/inactive
      if (sessionState !== 'loading' && sessionState !== 'inactive') {
        if (isDTW) {
          // DTW mode: highlight exercise-specific body parts
          const ref = getReference(exerciseType);
          const hlParts = ref?.highlightKeypoints;
          let hlKps = [];
          if (hlParts && hlParts.length) {
            const isAlternating = ref?.side === 'alternating';
            const s = (side || '').toLowerCase();
            if (!isAlternating && (s === 'left' || s === 'right')) {
              hlKps = hlParts.map(p => `${s}_${p}`);
            } else {
              // Alternating (or bilateral): always start with both sides highlighted
              hlKps = hlParts.flatMap(p => [`left_${p}`, `right_${p}`]);
            }
          }
          setHighlight({ keypoints: hlKps, color: '#66FF00' });
        } else if (spec?.highlights) {
          try { spec.highlights({ setHighlight, features: { ...feat, side } }); } catch { }
        }
      }

      // ─── LOADING ─────────────────────────────────────────────────
      if (sessionState === 'loading') {
        drawLoadingOverlay(ctx, vw, vh);
        feedbackRef.current = sessionResult.message;
      }

      // ─── COACHING ────────────────────────────────────────────────
      else if (sessionState === 'coaching') {
        // Draw order: skeleton → box → text (so overlays appear on top)
        drawCanvas(drawPoses, vw, vh, ctx, keypointsRef.current, keypointColorsRef.current, segmentColorsRef.current);
        const color = coachingColor(sessionResult.coachingChecks);
        const idealRatio = spec?.framing?.idealBodyRatio ?? IDEAL_BODY_RATIO;
        drawTargetBox(ctx, vw, vh, idealRatio, color);
        drawCoachingMessages(ctx, vw, vh, sessionResult.coachingChecks);
        feedbackRef.current = sessionResult.message || 'Position yourself in the frame';
        try { maybeSendUpdates({ sessionState: 'coaching', coachingChecks: sessionResult.coachingChecks }); } catch { }
      }

      // ─── COUNTDOWN ───────────────────────────────────────────────
      else if (sessionState === 'countdown') {
        // Draw order: skeleton → box → countdown (so overlays appear on top)
        drawCanvas(drawPoses, vw, vh, ctx, keypointsRef.current, keypointColorsRef.current, segmentColorsRef.current);
        const idealRatio = spec?.framing?.idealBodyRatio ?? IDEAL_BODY_RATIO;
        drawTargetBox(ctx, vw, vh, idealRatio, '#00E676');
        drawCountdown(ctx, vw, vh, sessionResult.countdownRemaining);
        feedbackRef.current = sessionResult.message;
        try { maybeSendUpdates({ sessionState: 'countdown', countdownRemaining: sessionResult.countdownRemaining }); } catch { }
      }

      // ─── INACTIVE ────────────────────────────────────────────────
      else if (sessionState === 'inactive') {
        drawCanvas(drawPoses, vw, vh, ctx, keypointsRef.current, keypointColorsRef.current, segmentColorsRef.current);
        drawInactiveOverlay(ctx, vw, vh);
        feedbackRef.current = sessionResult.message;
        try { maybeSendUpdates({ sessionState: 'inactive' }); } catch { }
      }

      // ─── ACTIVE (exercise running) ──────────────────────────────
      else {
        // Draw skeleton + feed frames to recorders (only during ACTIVE)
        drawCanvas(drawPoses, vw, vh, ctx, keypointsRef.current, keypointColorsRef.current, segmentColorsRef.current);
        videoRecorderRef.current?.updateFrame?.(poses, vw, vh);
        skeletonRecorderRef.current?.updateFrame?.(poses, vw, vh);

        // Step PhaseMachine — ensure engine matches active spec
        const activeSpecName = specRef.current?.name;
        if (!engine || engine.spec?.name !== activeSpecName) {
          if (isDetecting) requestAnimationFrame(loop);
          return;
        }

        // Recorded immediately before step(), with the same post-smoothing
        // features the engine is about to consume, so a replay sees exactly what
        // live saw. Wrapped because a recorder fault must never break a session.
        const kpRec = keypointRecorderRef.current;
        if (kpRec) {
          if (!kpRec.startedAtIso) {
            kpRec.opts.videoW = vw;
            kpRec.opts.videoH = vh;
            kpRec.start();
          }
          kpRec.recordFrame(rawKps, feat);
        }

        const stepResult = engine.step({
          t: performance.now(),
          features: { ...feat, side },
          now: performance.now(),
          say: (m) => { feedbackRef.current = m; },
          setHighlight
        });
        const {
          repDelta,
          repCount,
          feedback,
          done,
          phase,
          timeHeldMs,
          timeRemainingMs
        } = stepResult;

        // DTW mode: update color based on match quality; for alternating exercises
        // also switch which leg is highlighted based on the active side
        if (isDTW) {
          const q = stepResult.quality ?? 0;
          const breaching = (stepResult.capBreaches?.length ?? 0) > 0;

          // Three states, in priority order. Safety outranks match quality:
          // a patient can be tracking the template beautifully and still be
          // past a clinical limit, and that is precisely the case that must
          // not be shown in green.
          //   red   — past a clinical cap right now
          //   amber — moving, but not matching the reference well
          //   green — good
          const color = breaching ? '#FF3B30' : (q > 0.7 ? '#66FF00' : '#FFB020');
          const ref = getReference(exerciseType);
          const hlParts = ref?.highlightKeypoints ?? [];

          // A breach colours the WHOLE skeleton, not just the tracked joint.
          // The limb at fault is rarely where the patient is looking, and a
          // safety warning that has to be hunted for is not a warning.
          if (breaching) {
            setHighlight({ keypoints: keypointsRef.current, color });
          } else if (ref?.side === 'alternating' && hlParts.length) {
            const activeSide = stepResult.activeSide; // null when idle / undetected
            let hlKps;
            if (activeSide === 'left' || activeSide === 'right') {
              hlKps = hlParts.map(p => `${activeSide}_${p}`);
            } else {
              hlKps = hlParts.flatMap(p => [`left_${p}`, `right_${p}`]);
            }
            setHighlight({ keypoints: hlKps, color });
          } else {
            setHighlight({ keypoints: keypointsRef.current, color });
          }
        }

        // unify counters / feedback
        repCountRef.current = repCount;
        // Session-level message takes priority on the COUNTDOWN→ACTIVE transition frame
        // so the per-exercise startCue ("Raise your right arm out to the side") reaches the
        // host. Without this, the engine's null feedback + existing fallback would keep
        // showing "Starting in 1…" from the countdown instead.
        feedbackRef.current = sessionResult.message || feedback || feedbackRef.current;

        // Log feedback changes for validation
        if (feedbackRef.current && feedbackRef.current !== feedbackLogRef.current) {
          console.log(`[Feedback] ${engine?.spec?.name}: ${feedbackRef.current}`);
          feedbackLogRef.current = feedbackRef.current;
        }

        // HUD metric selection (time mode vs rep mode)
        const isTimeMode = (specRef.current?.mode === 'time' || specRef.current?.isTimeBased);
        let hudLabel = 'metric';
        let hudValue = '—';

        if (isTimeMode) {
          const secs = Math.floor((timeHeldMs ?? 0) / 1000);
          const targetSecs =
            Math.floor(((timeHeldMs ?? 0) + (timeRemainingMs ?? 0)) / 1000) || (Number(targetReps) || 0);
          hudLabel = 'time';
          hudValue = `${secs}s / ${targetSecs}s`;
          setDisplayMessage?.(`${spec?.name || exerciseType}: phase=${phase || '—'} hold ${hudValue}`);
        } else {
          // Resolve the HUD metric the same way the sync payload does, so the
          // on-screen value and the synced field always refer to the same key.
          const baseMetric = spec?.primaryMetric || METRIC_MAP[exerciseType]?.[0] || null;
          const metricKey = baseMetric
            ? (resolveMetricKeys(baseMetric, side).find(k => Number.isFinite(feat[k])) || baseMetric)
            : null;
          const rawVal = metricKey && Number.isFinite(feat[metricKey]) ? feat[metricKey] : NaN;
          hudLabel = metricKey || 'metric';
          hudValue = pretty(metricKey, rawVal);
          setDisplayMessage?.(`${spec?.name || exerciseType}: phase=${phase || '—'} reps=${repCount} ${hudLabel}=${hudValue}`);
        }

        // transitions / reps logs
        if (phase && phase !== prevPhaseRef.current) {
          console.log(`[${engine?.spec?.name}] Phase -> ${phase}; ${hudLabel}=${hudValue}`);
          setDisplayMessage?.(`${spec?.name || exerciseType}: phase=${phase} reps=${repCount} ${hudLabel}=${hudValue}`);
          prevPhaseRef.current = phase;
        }
        if (repDelta > 0 || repCount !== prevRepRef.current) {
          const rc = stepResult.repClassification;
          const attemptInfo = rc && !rc.completed
            ? ` [ATTEMPT: ROM ${Math.round((rc.romPct || 0) * 100)}%]` : '';
          console.log(`[${engine?.spec?.name}] Rep +1 -> ${repCount}${attemptInfo}`);
          setDisplayMessage?.(`${spec?.name || exerciseType}: Rep +1 → ${repCount} (${hudLabel}=${hudValue})${attemptInfo}`);
          prevRepRef.current = repCount;
        }

        // sync payload — build BEFORE the done check so the final rep's
        // announcement reaches the host AND lastExerciseDataRef holds fresh
        // data when onComplete reads it.
        const exerciseData = {
          ...pickExerciseMetrics(exerciseType, feat, side),
          repCount: repCountRef.current,
          feedback: feedbackRef.current,
          ...(isTimeMode ? {
            timeHeldMs: timeHeldMs ?? 0,
            timeRemainingMs: timeRemainingMs ?? 0
          } : {}),
          ...(stepResult.totalReps != null ? {
            completedReps: stepResult.completedReps,
            attemptedReps: stepResult.attemptedReps,
            totalReps: stepResult.totalReps,
            isCalibrating: stepResult.isCalibrating,
          } : {}),
          ...(stepResult.repSummary ? { repSummary: stepResult.repSummary } : {}),
        };
        lastExerciseDataRef.current = exerciseData;
        // Force the send on the frame a rep counts so the per-rep ROM summary is
        // never dropped by the feedback-change throttle.
        maybeSendUpdates(
          { ...exerciseData, sessionState: 'active' },
          { force: repDelta > 0 }
        ).catch(() => {});

        // finish?
        if (done) {
          if (sm) sm.step({ keypoints: rawKps, frameW: vw, frameH: vh, hasDetector: true, hasVideo: true, engineDone: true });
          await onComplete();
          return; // stop scheduling
        }
      }

      const tLoopEnd = performance.now();
      probe.inferSync += tLoop1 - tLoop0;
      probe.rest += tLoopEnd - tLoop1;
      probe.total += tLoopEnd - tLoop0;
      probe.n += 1;
      if (probe.n >= 60) {
        console.log(
          `[Perf] loop=${(probe.total / probe.n).toFixed(1)}ms ` +
          `inferSync=${(probe.inferSync / probe.n).toFixed(1)}ms ` +
          `rest=${(probe.rest / probe.n).toFixed(1)}ms ` +
          `fps=${fpsRef.current} | ` +
          `poseLatency=${lat.n ? (lat.sum / lat.n).toFixed(1) : '?'}ms ` +
          `max=${lat.max.toFixed(0)}ms ` +
          `poseRate=${lat.gapN ? (1000 / (lat.gapSum / lat.gapN)).toFixed(1) : '?'}/s`
        );
        probe.inferSync = 0; probe.rest = 0; probe.total = 0; probe.n = 0;
        lat.sum = 0; lat.n = 0; lat.max = 0; lat.gapSum = 0; lat.gapN = 0;
      }

      // FPS measurement (update roughly every 100ms)
      frameCount++;
      const now = performance.now();
      if (now - lastFpsUpdate > 100) {
        const calculatedFps = Math.round((frameCount / (now - lastFpsUpdate)) * 1000);
        fpsRef.current = calculatedFps;
        frameCount = 0;
        lastFpsUpdate = now;
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [isDetecting, engine, exerciseType, side, onComplete, maybeSendUpdates]);

  return (
    <div>
      <Webcam
        ref={webcamRef}
        onUserMedia={(stream) => {
          // Report what the browser actually negotiated. The requested size is
          // only a hint, and on phones the camera often returns something much
          // larger, which throttles the whole detection loop.
          const track = stream?.getVideoTracks?.()?.[0];
          const s = track?.getSettings?.() || {};
          console.log(
            `[Tracker] webcam stream OK - ${s.width}x${s.height} @ ${s.frameRate}fps`
          );
        }}
        onUserMediaError={(e) => {
          console.error('[Tracker] webcam error', e);
          // Distinguish "you denied us" from "there is no camera" — the two need
          // completely different actions from the patient.
          const denied = e?.name === 'NotAllowedError' || e?.name === 'PermissionDeniedError';
          setDisplayMessage?.(
            denied
              ? 'Camera access is blocked. Please allow camera permission for this app, then reopen the exercise.'
              : 'No camera is available. Please check that your camera is connected and not in use by another app.'
          );
          notifyHostOfError(denied ? 'Camera permission denied.' : 'Camera unavailable.', e?.name);
        }}
        playsInline
        controls={false}
        style={{ position: 'absolute', top: 0, left: 0, zIndex: 9, width: '100%', height: '100vh', objectFit: 'fill', transform: 'scaleX(-1)' }}
        videoConstraints={VIDEO_CONSTRAINTS}
      />
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', top: 0, left: 0, zIndex: 10, width: '100%', height: '100vh', objectFit: 'fill', transform: 'scaleX(-1)' }}
      />
      <VideoRecorder
        ref={videoRecorderRef}
        webcamRef={webcamRef}
        canvasRef={canvasRef}
        keypointsRef={keypointsRef}
        keypointColorsRef={keypointColorsRef}
        segmentColorsRef={segmentColorsRef}
        isVideoRecording={isVideoRecording}
        onRecordingComplete={async (blob) => { setDisplayMessage('Syncing video. Please wait...'); await uploadVideo(blob, 'videoRecording'); setDisplayMessage('Exercise video synced successfully!!'); }}
      />
      <SkeletonRecorder
        ref={skeletonRecorderRef}
        webcamRef={webcamRef}
        canvasRef={canvasRef}
        keypointsRef={keypointsRef}
        keypointColorsRef={keypointColorsRef}
        segmentColorsRef={segmentColorsRef}
        isSkeletonRecording={isSkeletonRecording}
        onRecordingComplete={async (blob) => { setDisplayMessage('Syncing skeleton video. Please wait...'); await uploadVideo(blob, 'skeleton'); setDisplayMessage('Skeleton video synced successfully!!'); }}
      />
    </div>
  );
}

// Compute features with the **active spec** (passed in)
function computeFeaturesForExercise(poses, exerciseType, side, specFromRef) {
  // Normalize keypoint names for models that omit `name` (e.g., MoveNet)
  const MOVE_NET_NAMES = [
    'nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear',
    'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist',
    'left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle'
  ];
  const raw = (poses?.[0]?.keypoints) || [];
  const kps = raw.map((k, i) => (k?.name ? k : { ...k, name: MOVE_NET_NAMES[i] }));
  const base = computeCommonFeatures(kps, side);

  // Ask spec for extras (if any)
  const spec = specFromRef || EXERCISE_SPECS[exerciseType];
  const utils = { kp, present, calculateDistance, angle };
  const extra = spec?.computeExtraFeatures
    ? (spec.computeExtraFeatures({ kps, side, utils }) || {})
    : {};

  // Auto-copy any spec-level thresholds whose keys are in SKIP_SMOOTH
  const thresholds = {};
  for (const key of SKIP_SMOOTH) {
    if (key !== 'side' && spec?.[key] != null) {
      thresholds[key] = spec[key];
    }
  }

  return { ...base, ...extra, ...thresholds, side };
}

// Compute universal features for DTW mode (no per-spec logic)
function computeUniversalFeaturesFromPoses(poses) {
  const MOVE_NET_NAMES = [
    'nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear',
    'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist',
    'left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle'
  ];
  const raw = (poses?.[0]?.keypoints) || [];
  const kps = raw.map((k, i) => (k?.name ? k : { ...k, name: MOVE_NET_NAMES[i] }));
  return computeUniversalFeatures(kps);
}
