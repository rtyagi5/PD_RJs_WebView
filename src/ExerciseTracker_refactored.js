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

// Format values for HUD/logs (string)
function pretty(key, val) {
  if (!Number.isFinite(val)) return '—';
  const k = String(key || '').toLowerCase();
  // For normalized/ratio-ish metrics or small magnitudes, show 2 decimals
  if (k.includes('norm') || k.includes('ratio') || Math.abs(val) < 2) {
    return val.toFixed(2);
  }
  return String(Math.round(val));
}

// Format values for sync payload (number)
function prettyNum(key, val) {
  if (!Number.isFinite(val)) return undefined;
  const k = String(key || '').toLowerCase();
  if (k.includes('norm') || k.includes('ratio') || Math.abs(val) < 2) {
    return Number(val.toFixed(2));
  }
  return Math.round(val);
}



// Which metrics to sync / show for each exercise
export const METRIC_MAP = {
  SideArmRaise: ['armAngle', 'shoulderAngle'],
  MiniSquats: ['kneeAngleMin', 'kneeAngleMax'],
  SitToStand: ['kneeAngleMax', 'hipToKneeNormMax'],
  LongArcQuad: ['kneeAngle', 'hipToAnkleNorm'],
  StandingStraightUp: ['trunkAngleMin', 'kneeAngleMax'],
  SeatedMarch: ['kneeLiftNormMax', 'hipFlexAngleMin'],
  StandingMarch: ['kneeLiftNormMax', 'hipFlexAngleMin'],
  MiniLunges: ['kneeAngleMin', 'kneeAngleMax'],
  BicepCurls: ['elbowAngleMin'],
  LiftsAndChops: ['handsHeightNorm'],
  StepUps: ['ankleLiftNormLead', 'kneeAngleLead'],
  WallPushUp: ['elbowOffsetMax', 'trunkAngleMin'],
  CalfRaisesSeated: ['ankleAngleActive', 'degLowerMin', 'degLowerMax', 'degRaiseDynamic', 'startAngle', 'activeSide'],
  CalfRaisesStanding: ['activeToeAngle', 'degRaiseDynamic', 'activeSide'],
  SeatedDorsiflexion: ['footPitchDelta', 'pitchUp', 'pitchDown', 'trunkAngleMin'],
  StandingDorsiflexion: ['footPitchDelta', 'pitchUp', 'pitchDown', 'trunkAngleMin'],
};

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
  const previousRemainingTimeRef = useRef(null);
  const fpsRef = useRef(0);
  const lastExerciseDataRef = useRef({});

  const videoRecorderRef = useRef(null);
  const skeletonRecorderRef = useRef(null);

  const [engine, setEngine] = useState(null);

  // Smoothers: lazily created per-feature
  const smoothRef = useRef({});
  const sessionSMRef = useRef(null);

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

  const onComplete = useCallback(async () => {
    const finalData = {
      fps: fpsRef.current,
      feedback: 'Target reps achieved!',
      completionStatusRef: true,
      repCount: repCountRef.current,
      ...lastExerciseDataRef.current,
    };
    await sendUpdates(finalData, exerciseType, activityData, setDisplayMessage);

    setIsDetecting(false);
    setIsVideoRecording(false);
    setIsSkeletonRecording(false);

    detectionStartTimeRef.current = null;
    previousRemainingTimeRef.current = null;
  }, [
    exerciseType,
    activityData,
    setIsDetecting,
    setIsVideoRecording,
    setIsSkeletonRecording,
  ]);

  const maybeSendUpdates = useCallback(
    async (exerciseData) => {
      const finalData = {
        fps: fpsRef.current,
        completionStatusRef: false,
        repCount: repCountRef.current,
        feedback: feedbackRef.current,
        ...exerciseData,
      };
      if (feedbackRef.current !== lastFeedbackSentRef.current) {
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
        console.error('[Tracker] detector init failed:', err);
      }
    })();

    // Cleanup on unmount or exercise change
    return () => {
      canceled = true;
      try { detectorRef.current?.dispose?.(); } catch { }
      detectorRef.current = null;
    };
  }, [exerciseType]); // re-evaluate when exercise (and thus spec) changes



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

    const eng = new PhaseMachine(spec, { targetReps, targetSeconds });
    setEngine(eng);

    // Create/reset session state machine for coaching flow
    sessionSMRef.current = new SessionStateMachine(spec);

    const phaseList = Array.isArray(spec?.phases)
      ? spec.phases.map(p => p.id).join(', ')
      : '(no phases)';
    console.log('[Engine] built:', spec?.name ?? exerciseType, 'phases:', phaseList);
  }, [exerciseType, targetReps]);

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

    const loop = async () => {
      if (!isDetecting) return;

      const det = detectorRef.current;
      const video = webcamRef.current?.video;

      // Keep polling until both detector and video are ready
      if (!det || !video || video.readyState < 2) {
        rafId = requestAnimationFrame(loop);
        return;
      }

      // Ensure canvas matches the actual video size
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const ctx = canvasRef.current.getContext('2d');
      if (canvasRef.current.width !== vw || canvasRef.current.height !== vh) {
        canvasRef.current.width = vw;
        canvasRef.current.height = vh;
      }
      ctx.clearRect(0, 0, vw, vh);

      // Estimate poses
      let poses = [];
      try {
        poses = await det.estimatePoses(video);
      } catch (e) {
        console.error('[Tracker] estimatePoses failed:', e);
      }

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
      const feat = computeFeaturesForExercise(poses, exerciseType, side, specRef.current);
      const smooth = smoothRef.current;
      for (const [k, raw] of Object.entries(feat)) {
        if (SKIP_SMOOTH.has(k) || !Number.isFinite(raw)) continue;
        if (!smooth[k]) smooth[k] = new EMA(alphaFor(k));
        const v = smooth[k].next(raw);
        if (Number.isFinite(v)) feat[k] = v;
      }

      // Highlight helper (shared across states)
      const setHighlight = ({ keypoints, color }) => {
        keypointsRef.current = keypoints || [];
        keypointColorsRef.current = color || '#66FF00';
        segmentColorsRef.current = color || '#66FF00';
      };
      const spec = specRef.current;

      // Apply spec highlights except during loading/inactive
      if (sessionState !== 'loading' && sessionState !== 'inactive' && spec?.highlights) {
        try { spec.highlights({ setHighlight, features: { ...feat, side } }); } catch { }
      }

      // ─── LOADING ─────────────────────────────────────────────────
      if (sessionState === 'loading') {
        drawLoadingOverlay(ctx, vw, vh);
        feedbackRef.current = sessionResult.message;
      }

      // ─── COACHING ────────────────────────────────────────────────
      else if (sessionState === 'coaching') {
        const color = coachingColor(sessionResult.coachingChecks);
        const idealRatio = spec?.framing?.idealBodyRatio ?? IDEAL_BODY_RATIO;
        drawTargetBox(ctx, vw, vh, idealRatio, color);
        drawCoachingMessages(ctx, vw, vh, sessionResult.coachingChecks);
        drawCanvas(poses, vw, vh, ctx, keypointsRef.current, keypointColorsRef.current, segmentColorsRef.current);
        feedbackRef.current = sessionResult.message || 'Position yourself in the frame';
        try { maybeSendUpdates({}); } catch { }
      }

      // ─── COUNTDOWN ───────────────────────────────────────────────
      else if (sessionState === 'countdown') {
        const idealRatio = spec?.framing?.idealBodyRatio ?? IDEAL_BODY_RATIO;
        drawTargetBox(ctx, vw, vh, idealRatio, '#00E676');
        drawCanvas(poses, vw, vh, ctx, keypointsRef.current, keypointColorsRef.current, segmentColorsRef.current);
        drawCountdown(ctx, vw, vh, sessionResult.countdownRemaining);
        feedbackRef.current = sessionResult.message;
        try { maybeSendUpdates({}); } catch { }
      }

      // ─── INACTIVE ────────────────────────────────────────────────
      else if (sessionState === 'inactive') {
        drawCanvas(poses, vw, vh, ctx, keypointsRef.current, keypointColorsRef.current, segmentColorsRef.current);
        drawInactiveOverlay(ctx, vw, vh);
        feedbackRef.current = sessionResult.message;
        try { maybeSendUpdates({}); } catch { }
      }

      // ─── ACTIVE (exercise running) ──────────────────────────────
      else {
        // Draw skeleton + feed frames to recorders (only during ACTIVE)
        drawCanvas(poses, vw, vh, ctx, keypointsRef.current, keypointColorsRef.current, segmentColorsRef.current);
        videoRecorderRef.current?.updateFrame?.(poses, vw, vh);
        skeletonRecorderRef.current?.updateFrame?.(poses, vw, vh);

        // Step PhaseMachine — ensure engine matches active spec
        const activeSpecName = specRef.current?.name;
        if (!engine || engine.spec?.name !== activeSpecName) {
          if (isDetecting) requestAnimationFrame(loop);
          return;
        }

        const {
          repDelta,
          repCount,
          feedback,
          done,
          phase,
          timeHeldMs,
          timeRemainingMs
        } = engine.step({
          t: performance.now(),
          features: { ...feat, side },
          now: performance.now(),
          say: (m) => { feedbackRef.current = m; },
          setHighlight
        });

        // unify counters / feedback
        repCountRef.current = repCount;
        feedbackRef.current = feedback || feedbackRef.current;

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
          const metricKey = spec?.primaryMetric || METRIC_MAP[exerciseType]?.[0] || null;
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
          console.log(`[${engine?.spec?.name}] Rep +1 -> ${repCount}`);
          setDisplayMessage?.(`${spec?.name || exerciseType}: Rep +1 → ${repCount} (${hudLabel}=${hudValue})`);
          prevRepRef.current = repCount;
        }

        // finish?
        if (done) {
          if (sm) sm.step({ keypoints: rawKps, frameW: vw, frameH: vh, hasDetector: true, hasVideo: true, engineDone: true });
          await onComplete();
          return; // stop scheduling
        }

        // sync payload
        const exerciseData = {
          ...pickExerciseMetrics(exerciseType, feat),
          repCount: repCountRef.current,
          feedback: feedbackRef.current,
          ...(isTimeMode ? {
            timeHeldMs: timeHeldMs ?? 0,
            timeRemainingMs: timeRemainingMs ?? 0
          } : {})
        };
        // Keep latest snapshot for completion payload
        lastExerciseDataRef.current = exerciseData;
        await maybeSendUpdates(exerciseData);
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
        onUserMedia={() => console.log('[Tracker] webcam stream OK')}
        onUserMediaError={(e) => console.error('[Tracker] webcam error', e)}
        playsInline
        controls={false}
        style={{ position: 'absolute', top: 0, left: 0, zIndex: 9, width: '100%', height: '100vh', objectFit: 'fill', transform: 'scaleX(-1)' }}
        videoConstraints={{ facingMode: 'user' }}
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

// Map which metrics to sync per exercise
function pickExerciseMetrics(exerciseType, feat) {
  const keys = METRIC_MAP[exerciseType] || [];
  const out = {};
  keys.forEach(k => {
    const v = feat[k];
    const pv = prettyNum(k, v);
    if (pv !== undefined) out[k] = pv;
  });
  return out;
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
