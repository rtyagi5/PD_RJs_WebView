// ---------------------------------------------
// dtw/ReferenceExtractor.js
// PT tool: upload a reference video → extract features → mark reps →
// label phases → add feedback → export reference JSON.
// ---------------------------------------------
import React, { useState, useRef, useCallback, useEffect } from 'react';
import axios from 'axios';
import { createPoseDetector } from '../detectors';
import { extractFeaturesFromVideo, detectRepBoundaries, buildTemplateFromReps, getTopFeatures,
  resolvePrimaryFeatureKey, mirrorTemplateSides } from './videoFeatureExtractor';
import { computeFeatureRanges, validateReference } from './referenceSchema';
import { registerReference } from './referenceRegistry';
import { EXERCISE_CONFIGS } from './specToReference';
import PoseOverlay from './PoseOverlay';
import { PROCESSING_MAX_WIDTH } from '../captureConfig';
import { MIRROR_SENSITIVE_FEATURES, stripSideSuffix } from './universalFeatures';
import { labelPhasesBySignal, resolveCycle } from './phaseLabeller';
import { checkReferenceHealth } from './referenceHealth';
import { getServiceUrl } from '../config';
import { clearCachedReference } from './referenceStorage';

// ─── Styles (inline for portability) ──────────────────────
const S = {
  page: {
    fontFamily: "'Inter', -apple-system, sans-serif",
    background: '#0a0a1a', color: '#e0e0e0', minHeight: '100vh',
    padding: '24px', boxSizing: 'border-box',
  },
  header: { fontSize: 28, fontWeight: 700, marginBottom: 8, color: '#fff' },
  subheader: { fontSize: 14, color: '#888', marginBottom: 24 },
  card: {
    background: '#13132a', borderRadius: 12, padding: 20, marginBottom: 20,
    border: '1px solid #222244',
  },
  cardTitle: { fontSize: 18, fontWeight: 600, marginBottom: 12, color: '#fff' },
  row: { display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' },
  col: { flex: 1, minWidth: 280 },
  input: {
    background: '#1a1a3a', border: '1px solid #333366', borderRadius: 8,
    color: '#fff', padding: '8px 12px', width: '100%', boxSizing: 'border-box',
    fontSize: 14, marginBottom: 8,
  },
  select: {
    background: '#1a1a3a', border: '1px solid #333366', borderRadius: 8,
    color: '#fff', padding: '8px 12px', fontSize: 14, marginBottom: 8,
  },
  btn: {
    background: '#4466ff', color: '#fff', border: 'none', borderRadius: 8,
    padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
    marginRight: 8, marginBottom: 8,
  },
  btnSecondary: {
    background: '#333355', color: '#ccc', border: '1px solid #444477', borderRadius: 8,
    padding: '10px 20px', fontSize: 14, cursor: 'pointer', marginRight: 8, marginBottom: 8,
  },
  btnDanger: {
    background: '#993333', color: '#fff', border: 'none', borderRadius: 8,
    padding: '8px 16px', fontSize: 13, cursor: 'pointer', marginRight: 8,
  },
  btnSuccess: {
    background: '#339944', color: '#fff', border: 'none', borderRadius: 8,
    padding: '10px 24px', fontSize: 15, fontWeight: 700, cursor: 'pointer',
  },
  video: {
    maxWidth: '100%', maxHeight: 400, borderRadius: 8, background: '#000',
  },
  timeline: {
    position: 'relative', height: 60, background: '#111133', borderRadius: 8,
    marginTop: 12, cursor: 'crosshair', overflow: 'hidden',
  },
  progress: {
    position: 'absolute', top: 0, left: 0, height: '100%',
    background: 'rgba(68,102,255,0.2)', pointerEvents: 'none',
  },
  repMarker: {
    position: 'absolute', top: 0, width: 2, height: '100%',
    background: '#ff6644', zIndex: 2,
  },
  phaseRegion: {
    position: 'absolute', top: 0, height: '100%', opacity: 0.3, zIndex: 1,
  },
  tag: {
    display: 'inline-block', background: '#333366', borderRadius: 4,
    padding: '2px 8px', fontSize: 12, margin: '2px 4px 2px 0', color: '#aaccff',
  },
  mono: { fontFamily: 'monospace', fontSize: 13, color: '#88aaff' },
  label: { fontSize: 13, color: '#999', marginBottom: 4, display: 'block' },
  feedbackRow: {
    display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6,
  },
  pre: {
    background: '#0d0d22', border: '1px solid #222244', borderRadius: 8,
    padding: 16, fontSize: 12, color: '#88ff88', maxHeight: 300,
    overflow: 'auto', whiteSpace: 'pre-wrap',
  },
  progressBar: {
    height: 6, background: '#222244', borderRadius: 3, marginTop: 8, overflow: 'hidden',
  },
  progressFill: {
    height: '100%', background: '#4466ff', borderRadius: 3, transition: 'width 0.1s',
  },
  badge: (color) => ({
    display: 'inline-block', background: color, borderRadius: 4,
    padding: '2px 8px', fontSize: 11, fontWeight: 600, color: '#fff', marginRight: 6,
  }),
};

const PHASE_COLORS = ['#4466ff', '#ff6644', '#44cc66', '#cc44ff', '#ffaa22', '#22cccc'];

/**
 * The feature dropdown, ranked by range but guaranteed to contain the ones this
 * exercise is actually about.
 *
 * Ranking alone is not enough: a seated dorsiflexion clip is dominated by the
 * arms, so the feature the exercise measures can fall outside the top few
 * entirely. Any alternative the config declares a direction for is offered too,
 * which is what makes trialling ankleAngleToe against footPitchNorm on the same
 * footage a dropdown change rather than a code change.
 */
function featureChoices(frames, cfg, topN = 8) {
  const top = getTopFeatures(frames, topN);
  if (!cfg) return top;

  const wanted = new Set();
  if (cfg.primaryFeatureBase) wanted.add(cfg.primaryFeatureBase);
  for (const key of Object.keys(cfg.featureDirections || {})) wanted.add(key);
  // Every feature this exercise's own template sweeps, whatever its units.
  // getTopFeatures ranks by RAW range, which compares degrees against
  // dimensionless ratios: a normalised feature can never reach the top N while
  // any joint angle is in the list. SitToStand sweeps kneeAngle (75 deg) and
  // hipToAnkleNorm (0.8), and the clip's angles span 85-104 - so the dropdown
  // for a sit-to-stand offered eight angles and not one of the two features the
  // exercise is actually defined by.
  for (const ph of cfg.phases || []) {
    for (const key of Object.keys(ph.features || {})) wanted.add(key);
  }
  if (!wanted.size) return top;

  const have = new Set(top.map(f => f.key));
  const extra = getTopFeatures(frames, Infinity)
    .filter(f => !have.has(f.key) && wanted.has(stripSideSuffix(f.key)) && f.range > 0);

  return [...top, ...extra];
}

// ─── Component ────────────────────────────────────────────

export default function ReferenceExtractor() {
  // --- State ---
  const [step, setStep] = useState(1); // 1=upload, 2=extract, 3=reps, 4=phases, 5=feedback, 6=export
  const [exerciseName, setExerciseName] = useState('');
  const [detectorType, setDetectorType] = useState('movenet');
  const [exerciseMode, setExerciseMode] = useState('rep');
  const [exerciseSide, setExerciseSide] = useState('both');
  const [videoSrc, setVideoSrc] = useState(null);
  const [frames, setFrames] = useState([]);
  const [fps, setFps] = useState(15);
  const [duration, setDuration] = useState(0);
  const [extractProgress, setExtractProgress] = useState(0);
  const [isExtracting, setIsExtracting] = useState(false);
  const [reps, setReps] = useState([]); // [{start, end, peakFrame}]
  const [phases, setPhases] = useState(['lowered', 'raised']); // phase names
  const [phaseLabels, setPhaseLabels] = useState([]); // per-rep-frame phase assignments
  const [unlabelledReps, setUnlabelledReps] = useState(new Set()); // reps the labeller refused
  const [repCycle, setRepCycle] = useState({ start: 'lowered', effort: 'raised', return: 'lowered' });
  const [feedback, setFeedback] = useState({
    phase: {}, form: [], range: { tooLittle: '', tooMuch: '' }, tempo: { tooFast: '', holdCue: '' },
  });
  const [exportedJSON, setExportedJSON] = useState(null);
  const [statusMsg, setStatusMsg] = useState('');
  // A way out of a dead end: a refused export needs a route back to the thing
  // it is complaining about, not just an explanation of it.
  const [statusAction, setStatusAction] = useState(null); // {label, step}
  const [publishing, setPublishing] = useState(false);
  const [publishStatus, setPublishStatus] = useState(null); // null | 'success' | 'error'
  const [currentFrame, setCurrentFrame] = useState(0); // video playback position as frame index
  const [currentTime, setCurrentTime] = useState(0);   // video playback position in seconds
  const [topFeatures, setTopFeatures] = useState([]);   // top features by range for dropdown
  const framesRef = useRef([]);                         // latest frames, for the exercise-change effect
  const [showOverlay, setShowOverlay] = useState(true);  // skeleton drawn over the video
  const [primaryFeature, setPrimaryFeature] = useState(''); // user-selected or auto-detected
  const [featureSignal, setFeatureSignal] = useState([]); // smoothed signal for sparkline
  const [phaseBandPct, setPhaseBandPct] = useState(0.15); // how close counts as "at" a posture

  const videoRef = useRef(null);
  const detectorRef = useRef(null);
  const abortRef = useRef(null);

  // ─── Helpers ───────────────────────────────────────
  const frameToTime = useCallback((frameIdx) => {
    if (!frames.length || !duration) return '0:00';
    const t = frames[frameIdx]?.time ?? (frameIdx / frames.length) * duration;
    const mins = Math.floor(t / 60);
    const secs = Math.floor(t % 60).toString().padStart(2, '0');
    const tenths = Math.floor((t % 1) * 10);
    return `${mins}:${secs}.${tenths}`;
  }, [frames, duration]);

  const timeToFrame = useCallback((time) => {
    if (!frames.length) return 0;
    let closest = 0;
    let minDiff = Infinity;
    for (let i = 0; i < frames.length; i++) {
      const diff = Math.abs((frames[i]?.time ?? 0) - time);
      if (diff < minDiff) { minDiff = diff; closest = i; }
    }
    return closest;
  }, [frames]);

  // Track video playback position
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !frames.length) return;
    const handler = () => {
      const t = video.currentTime;
      setCurrentTime(t);
      setCurrentFrame(timeToFrame(t));
    };
    video.addEventListener('timeupdate', handler);
    video.addEventListener('seeked', handler);
    return () => {
      video.removeEventListener('timeupdate', handler);
      video.removeEventListener('seeked', handler);
    };
  }, [frames, timeToFrame]);

  // Cleanup detector on unmount
  useEffect(() => {
    return () => {
      detectorRef.current?.dispose?.();
      abortRef.current?.abort?.();
    };
  }, []);

  // ─── Step 1: Upload Video ──────────────────────────
  // Everything derived from a clip, cleared in one place. Loading a second video
  // used to reset only frames, reps and the exported JSON, leaving the previous
  // clip's phase labels, feedback cues and primary feature in place — so a
  // second extraction could silently inherit the first one's labelling.
  const resetDerivedState = useCallback(() => {
    setFrames([]);
    framesRef.current = [];
    setReps([]);
    setPhaseLabels([]);
    setExportedJSON(null);
    setPrimaryFeature('');
    setFeatureSignal([]);
    setTopFeatures([]);
    setCurrentFrame(0);
    setCurrentTime(0);
    setDuration(0);
    setExtractProgress(0);
    setPublishStatus(null);
    setStatusAction(null);
    setFeedback({
      phase: {}, form: [], range: { tooLittle: '', tooMuch: '' }, tempo: { tooFast: '', holdCue: '' },
    });
  }, []);

  const handleFileUpload = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Release the previous blob; without this every re-upload leaks the whole
    // decoded video for the life of the tab.
    setVideoSrc(prev => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    resetDerivedState();
    setStatusMsg('Video loaded. Configure settings and click "Extract Features".');
  }, [resetDerivedState]);

  // Start over without a page refresh. Keeps the exercise selection, since the
  // usual reason to start again is a second take of the same exercise.
  const handleNewExtraction = useCallback(() => {
    if (frames.length && !window.confirm(
      'Discard this extraction and start over? Rep boundaries, phase labels and ' +
      'feedback cues will be lost.'
    )) return;
    setVideoSrc(prev => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    resetDerivedState();
    setStep(1);
    setStatusMsg('Started a new extraction. Upload a video to begin.');
  }, [frames.length, resetDerivedState]);

  // ─── Step 2: Extract Features ──────────────────────
  const handleExtract = useCallback(async () => {
    if (!videoRef.current || !videoSrc) return;

    setIsExtracting(true);
    setExtractProgress(0);
    setStatusMsg('Initializing pose detector...');

    try {
      // Create detector if needed
      if (!detectorRef.current) {
        detectorRef.current = await createPoseDetector(detectorType);
      }

      setStatusMsg('Extracting features frame-by-frame...');
      abortRef.current = new AbortController();

      const result = await extractFeaturesFromVideo(
        videoRef.current,
        detectorRef.current,
        {
          fps,
          onProgress: (i, total) => setExtractProgress(Math.round((i / total) * 100)),
          signal: abortRef.current.signal,
        }
      );

      setFrames(result.frames);
      framesRef.current = result.frames;
      setDuration(result.duration);
      setExtractProgress(100);

      // Compute top features for dropdown
      const top = featureChoices(result.frames, EXERCISE_CONFIGS[exerciseName]);
      setTopFeatures(top);

      // For a known exercise the primary feature comes from its canonical config,
      // NOT from ranking raw feature ranges. Ranking mixes units: in a seated
      // dorsiflexion clip the demonstrator sits, settles and moves their arms, so
      // elbowAngleMin sweeps ~100 degrees while footPitchNorm — the actual
      // movement — sweeps 0.17, and the elbow wins on magnitude alone. Phase
      // labelling then fails outright, because nothing can say which end of an
      // elbow angle is the rest posture for a dorsiflexion.
      const canonicalKey = resolvePrimaryFeatureKey(EXERCISE_CONFIGS[exerciseName], result.frames);
      const detection = detectRepBoundaries(result.frames, canonicalKey || undefined);
      setReps(detection.reps);
      setPrimaryFeature(detection.primaryFeature || top[0]?.key || '');
      setFeatureSignal(detection.signal || []);

      const autoCount = detection.reps.length;
      const fallback = autoCount === 1 && detection.reps[0]?.start === 0 && detection.reps[0]?.end === result.frames.length - 1;
      setStatusMsg(
        `Extracted ${result.frames.length} frames (${result.duration.toFixed(1)}s). ` +
        (fallback
          ? `Could not auto-detect individual reps — treating entire video as 1 rep. Use the video controls to mark rep boundaries.`
          : `Auto-detected ${autoCount} rep${autoCount !== 1 ? 's' : ''} using "${detection.primaryFeature}"` +
            `${canonicalKey ? ' (from the canonical config)' : ' (by widest range — no exercise selected)'}.`)
      );
      setStep(3);
    } catch (err) {
      console.error('[ReferenceExtractor] Extraction failed:', err);
      setStatusMsg(`Error: ${err.message}`);
    } finally {
      setIsExtracting(false);
    }
  }, [videoSrc, detectorType, fps, exerciseName]);

  // ─── Step 3: Rep Boundaries ────────────────────────
  const handleAddManualRep = useCallback(() => {
    if (!frames.length) return;
    // Default: start at current video position, end 2 seconds later
    const startFrame = currentFrame;
    const endFrame = Math.min(frames.length - 1, startFrame + Math.round(fps * 2));
    const peakFrame = Math.round((startFrame + endFrame) / 2);
    setReps(prev => [...prev, { start: startFrame, end: endFrame, peakFrame }]);
  }, [frames, currentFrame, fps]);

  const handleRemoveRep = useCallback((idx) => {
    setReps(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const handleRepChange = useCallback((idx, field, value) => {
    setReps(prev => prev.map((r, i) => i === idx ? { ...r, [field]: parseInt(value) || 0 } : r));
  }, []);

  // Set rep start or end from current video position
  const handleSetFromVideo = useCallback((idx, field) => {
    const frameIdx = currentFrame;
    setReps(prev => prev.map((r, i) => {
      if (i !== idx) return r;
      const updated = { ...r, [field]: frameIdx };
      // Auto-update peakFrame to midpoint
      updated.peakFrame = Math.round((updated.start + updated.end) / 2);
      return updated;
    }));
  }, [currentFrame]);

  // Seek video to a specific frame
  const seekToFrame = useCallback((frameIdx) => {
    if (!videoRef.current || !frames[frameIdx]) return;
    videoRef.current.currentTime = frames[frameIdx].time;
  }, [frames]);

  // Re-detect reps when user changes primary feature
  const handleFeatureChange = useCallback((featureKey) => {
    setPrimaryFeature(featureKey);
    if (!frames.length || !featureKey) return;
    const detection = detectRepBoundaries(frames, featureKey);
    setReps(detection.reps);
    setFeatureSignal(detection.signal || []);
    const count = detection.reps.length;
    setStatusMsg(`Re-detected ${count} rep${count !== 1 ? 's' : ''} using "${featureKey}".`);
  }, [frames]);

  // Seed phases and repCycle from the canonical config as soon as an exercise is
  // picked. They used to default to ['lowered','raised'] and be typed by hand,
  // so a recorded reference could end up structurally incomparable to the
  // synthetic one it replaces — different phase ids, different cycle.
  useEffect(() => {
    const cfg = EXERCISE_CONFIGS[exerciseName];
    if (!cfg) return;
    const ids = (cfg.phases || []).map(p => p.id).filter(Boolean);
    if (ids.length >= 2) setPhases(ids);
    const cycle = resolveCycle(cfg.repCycle);
    if (cycle) setRepCycle({ start: cycle.start, effort: cycle.effort, return: cycle.start });
    if (cfg.detector) setDetectorType(cfg.detector);

    // If frames are already extracted, switch to the feature this exercise
    // actually measures. Picking the exercise after extracting is the normal
    // order, so without this the run keeps whatever the range ranking chose.
    if (framesRef.current.length) {
      setTopFeatures(featureChoices(framesRef.current, cfg));
      const key = resolvePrimaryFeatureKey(cfg, framesRef.current);
      if (key) {
        const detection = detectRepBoundaries(framesRef.current, key);
        setPrimaryFeature(key);
        setReps(detection.reps);
        setFeatureSignal(detection.signal || []);
        setStatusMsg(
          `Using "${key}" for ${exerciseName}, from its canonical config. ` +
          `Re-detected ${detection.reps.length} rep${detection.reps.length === 1 ? '' : 's'}.`
        );
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exerciseName]);

  // ─── Step 4: Phase Labeling ────────────────────────
  const handleAddPhase = useCallback(() => {
    const name = prompt('Phase name (e.g., "extended", "flexed", "hold"):');
    if (name && !phases.includes(name)) {
      setPhases(prev => [...prev, name]);
    }
  }, [phases]);

  const handleRemovePhase = useCallback((name) => {
    setPhases(prev => prev.filter(p => p !== name));
  }, []);

  const autoLabelPhases = useCallback(() => {
    if (!reps.length || !frames.length || phases.length < 2) return;

    // Label from the MOVEMENT, never from the frame index. The old code split
    // each rep into equal segments by frame count and assigned phases in order,
    // which mislabels any clip that does not happen to start at the rest
    // posture — and that is exactly how the one recorded reference in this repo
    // ended up with its "lowered" phase at 92 degrees, arm up.
    const labels = [];
    const failures = [];
    const failedReps = new Set();
    for (let r = 0; r < reps.length; r++) {
      const rep = reps[r];
      const repFrames = frames.slice(rep.start, rep.end + 1);
      const res = labelPhasesBySignal(repFrames, {
        phases,
        repCycle,
        primaryFeature,
        exerciseName,
        bandPct: phaseBandPct,
      });
      if (!res.ok) {
        failures.push(`rep ${r + 1}: ${res.reason}`);
        failedReps.add(r);
        continue;
      }
      for (let i = 0; i < repFrames.length; i++) {
        // Tag the rep at creation. Inferring it later from frame ranges
        // miscounts, because rep boundaries share endpoints: a rep that
        // failed to label still appeared to own its neighbours' edge frames,
        // so it looked partly labelled when it was not labelled at all.
        labels.push({ frame: rep.start + i, phase: res.labels[i], rep: r });
      }
    }

    setPhaseLabels(labels);
    setUnlabelledReps(failedReps);
    if (failures.length) {
      setStatusMsg(
        `Labelled ${reps.length - failures.length}/${reps.length} reps. ` +
        `Could not label: ${failures.join('; ')}`
      );
    } else {
      setStatusMsg(
        `Labelled ${reps.length} rep${reps.length === 1 ? '' : 's'} independently — ` +
        `${labels.length} frames across ${phases.length} phases, by movement.`
      );
    }
  }, [reps, frames, phases, repCycle, primaryFeature, exerciseName, phaseBandPct]);

  // ─── Step 5: Feedback ──────────────────────────────
  const handlePhaseFeedback = useCallback((phase, text) => {
    setFeedback(prev => ({
      ...prev,
      phase: { ...prev.phase, [phase]: text },
    }));
  }, []);

  const handleAddFormRule = useCallback(() => {
    setFeedback(prev => ({
      ...prev,
      form: [...prev.form, { bodyPart: 'back', say: '' }],
    }));
  }, []);

  const handleFormRuleChange = useCallback((idx, field, value) => {
    setFeedback(prev => ({
      ...prev,
      form: prev.form.map((r, i) => i === idx ? { ...r, [field]: value } : r),
    }));
  }, []);

  const handleRemoveFormRule = useCallback((idx) => {
    setFeedback(prev => ({
      ...prev,
      form: prev.form.filter((_, i) => i !== idx),
    }));
  }, []);

  // ─── Step 6: Export ────────────────────────────────
  const handleExport = useCallback(() => {
    setStatusAction(null);
    if (!frames.length || !reps.length) {
      setStatusMsg('Need at least extracted frames and one rep to export.');
      return;
    }

    // Build template from reps
    const template = buildTemplateFromReps(frames, reps, 60);

    // Copy the exercised side onto the idle one. You record a seated
    // dorsiflexion sitting one way round; a patient may sit the other way, and
    // without this they get a template whose range on their side is flat.
    // Exact rather than approximate: every universal feature is invariant under
    // a left-right reflection. Runs BEFORE labelling and before feature ranges
    // are computed, so both see the symmetric template.
    // `unilateral` for anything but a genuinely alternating exercise: the range
    // test alone declared every foot family two-sided on a real recording,
    // because an occluded far foot's tracking noise spans as much as the near
    // foot's real movement. See mirrorTemplateSides for the measured numbers.
    const mirror = mirrorTemplateSides(template, {
      unilateral: EXERCISE_CONFIGS[exerciseName]?.side !== 'alternating',
    });

    // Label the averaged template directly from its own signal.
    //
    // This used to map labels across from rep 0 by proportion and fall back to a
    // positional split. Both were wrong: the template is an AVERAGE across reps,
    // so rep 0's frame positions do not describe it, and a positional split
    // ignores the movement entirely. Labelling the template from its own values
    // is the only version that is correct regardless of where detectRepBoundaries
    // cut the rep.
    const labelResult = labelPhasesBySignal(template, {
      phases,
      repCycle,
      primaryFeature,
      exerciseName,
      bandPct: phaseBandPct,
    });
    if (!labelResult.ok) {
      setStatusMsg(
        `Cannot label phases: ${labelResult.reason} ` +
        `Check the primary feature and rep boundaries, or widen the posture band.`
      );
      return;
    }
    for (let t = 0; t < template.length; t++) {
      template[t].phase = labelResult.labels[t];
    }

    // Compute feature ranges
    const featureRanges = computeFeatureRanges(template);

    // A mirrored source (phone front cameras often save the flipped preview)
    // is harmless for everything except a signed horizontal feature, whose sign
    // would invert. Warn only when the template actually contains one, rather
    // than asking every operator about video orientation they cannot easily
    // check — and note a wrong answer to such a question would itself introduce
    // the error it is meant to prevent.
    const mirrorSensitive = MIRROR_SENSITIVE_FEATURES.filter(
      k => featureRanges[k] && (featureRanges[k].range || 0) > 0
    );
    if (mirrorSensitive.length) {
      console.warn(
        `[Extractor] "${exerciseName}" uses ${mirrorSensitive.join(', ')}, which is a SIGNED ` +
        `horizontal measurement. If this clip came from a front camera that saved the ` +
        `mirrored preview, its sign is inverted relative to every live session. Check that ` +
        `text in the background reads the right way round before trusting this reference.`
      );
    }

    if (mirror.mirrored.length) {
      console.log(
        `[Extractor] mirrored ${mirror.mirrored.length} feature famil` +
        `${mirror.mirrored.length === 1 ? 'y' : 'ies'} onto the idle side: ` +
        mirror.mirrored.map(m => `${m.from}->${m.to}`).join(', ')
      );
    }

    // Estimate timing
    const avgRepDuration = reps.reduce((s, r) => {
      const startTime = frames[r.start]?.time || 0;
      const endTime = frames[r.end]?.time || 0;
      return s + (endTime - startTime);
    }, 0) / reps.length;

    // Hard gate: the runtime resolves references by the exact EXERCISE_CONFIGS key.
    // Exporting under anything else produces a file that loads but is never found.
    if (!EXERCISE_CONFIGS[exerciseName]) {
      setStatusMsg(
        `"${exerciseName || '(none)'}" is not a known exercise id. ` +
        `Pick one from the Exercise dropdown — the app looks references up by that exact key.`
      );
      return;
    }

    const reference = {
      name: exerciseName,
      side: exerciseSide,
      mode: exerciseMode,
      detector: detectorType,
      // The feature this recording was segmented and labelled on. It was used
      // throughout extraction and then dropped from the export, so an operator
      // who deliberately chose a feature here had no way to tell that the engine
      // would go on counting something else - EXERCISE_CONFIGS decides that, and
      // applyCanonicalPolicy overwrites this field at load precisely so a
      // recording cannot change engine behaviour by accident.
      //
      // Recorded anyway, because a disagreement between the two is worth seeing:
      // bootstrapReferences warns when they differ, which is the signal that the
      // config needs a deliberate change rather than the recording being wrong.
      primaryFeature,
      template,
      featureRanges,
      repCycle,
      feedback: {
        phase: feedback.phase,
        form: feedback.form.filter(f => f.say.trim()),
        range: {
          tooLittle: feedback.range.tooLittle || undefined,
          tooMuch: feedback.range.tooMuch || undefined,
        },
        tempo: {
          tooFast: feedback.tempo.tooFast || undefined,
          holdCue: feedback.tempo.holdCue || undefined,
        },
      },
      timing: {
        fps,
        repDurationMs: Math.round(avgRepDuration * 1000),
        dwellMs: 100,
        refractoryMs: 300,
      },
      // How this template was made, for whoever reviews it later. Not read by
      // the engine — bootstrapReferences overrides `side` from EXERCISE_CONFIGS
      // anyway — but a reviewer needs to know the left side of this template is
      // a copy of the right, and not a second recording.
      provenance: {
        recordedSide: mirror.mirrored.length
          ? (mirror.mirrored[0].from.endsWith('L') ? 'left' : 'right')
          : 'both',
        mirroredFamilies: mirror.mirrored.map(m => m.base),
        bilateralFamilies: mirror.bilateral,
        repsAveraged: reps.length,
        processedAtWidth: PROCESSING_MAX_WIDTH,
        // Cannot be determined from the footage; recorded so a reviewer knows it
        // was not checked. Only matters for mirrorSensitiveFeatures.
        sourceOrientationVerified: false,
        mirrorSensitiveFeatures: mirrorSensitive,
      },
    };

    // Validate: shape first, then semantics.
    const result = validateReference(reference);
    if (!result.valid) {
      setStatusMsg(`Validation errors: ${result.errors.join('; ')}`);
      return;
    }

    // validateReference only checks SHAPE. A reference can have every required
    // field and still invert the direction gate at runtime if its phase labels
    // do not separate the rest posture from the effort posture. Catch that here,
    // while the operator still has the video open, rather than at app startup on
    // someone's phone.
    const health = checkReferenceHealth(reference, EXERCISE_CONFIGS[exerciseName]);
    if (!health.ok) {
      // buildTemplateFromReps averages the reps POSITIONALLY: every rep is
      // resampled to 60 frames and frame t is the mean of frame t across all of
      // them. So the reps have to be aligned with EACH OTHER, not merely contain
      // one repetition apiece. A rep cut half a movement later than its
      // neighbours averages its ascent against their descent, and the mean
      // crosses the movement twice - which reads as 'more than one repetition'
      // without any rep boundary being wrong on its own. Printing where each
      // marked rep begins is what makes that visible.
      const starts = reps
        .map(r => frames[r.start]?.features?.[primaryFeature])
        .filter(Number.isFinite);
      const spread = starts.length > 1 ? Math.max(...starts) - Math.min(...starts) : 0;
      const alignment = starts.length > 1
        ? `\n\n${primaryFeature} at the start of each marked rep: ` +
          `${starts.map(v => v.toFixed(2)).join(', ')} (spread ${spread.toFixed(2)}). ` +
          `The template averages your reps frame by frame, so these need to be close ` +
          `to each other — every rep must begin at the same point in the movement, ` +
          `not merely contain one repetition.`
        : '';
      setStatusMsg(
        `Reference is not usable:\n` +
        health.errors.map(e => `• ${e.check}: ${e.reason}`).join('\n') +
        alignment +
        `\n\nNothing is lost — your reps, labels and cues are all still here. ` +
        `Go back to step 3 to re-cut the rep boundaries or pick a different primary feature, ` +
        `or widen the posture band on step 4.`
      );
      setStatusAction({ label: 'Back to Reps — re-cut reps / change the primary feature', step: 3 });
      return;
    }

    // Register in runtime cache
    registerReference(reference.name, reference);

    setExportedJSON(reference);
    setStatusMsg(
      `Reference "${reference.name}" passed all checks, exported and registered. ` +
      `${template.length} template frames, ${Object.keys(featureRanges).length} features` +
      (mirror.mirrored.length
        ? `, ${reference.provenance.recordedSide} side mirrored to the other so a patient ` +
          `can sit either way round.`
        : '.') +
      // Warnings are things the operator should see but that do not make the file
      // unusable, so they ride along with the success message rather than blocking.
      (health.warnings.length
        ? `\n\nWorth knowing:\n` + health.warnings.map(w => `• ${w.check}: ${w.reason}`).join('\n')
        : '')
    );
    setStep(6);
  }, [frames, reps, phases, repCycle, feedback, exerciseName, exerciseSide, exerciseMode,
      detectorType, fps, primaryFeature, phaseBandPct]);

  const handleDownload = useCallback(() => {
    if (!exportedJSON) return;
    const blob = new Blob([JSON.stringify(exportedJSON, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${exportedJSON.name || 'reference'}.ref.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [exportedJSON]);

  const handlePublish = useCallback(async () => {
    if (!exportedJSON) return;
    setPublishing(true);
    setPublishStatus(null);
    try {
      const tenant = process.env.REACT_APP_TENANT || 'dev';
      const { REFERENCE_SERVICE } = getServiceUrl({ tenant });
      await axios.post(REFERENCE_SERVICE, exportedJSON);
      clearCachedReference(exportedJSON.name); // bust client cache so next session re-fetches
      setPublishStatus('success');
      setStatusMsg(`"${exportedJSON.name}" published to the platform. All devices will use this reference from their next session.`);
    } catch (e) {
      console.error('[ReferenceExtractor] Publish failed:', e);
      setPublishStatus('error');
      setStatusMsg('Publish failed — download the .ref.json and add it manually, or check the backend.');
    } finally {
      setPublishing(false);
    }
  }, [exportedJSON]);

  // ─── Timeline click → seek video ───────────────────
  const handleTimelineClick = useCallback((e) => {
    if (!videoRef.current || !frames.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    videoRef.current.currentTime = pct * duration;
  }, [frames, duration]);

  // ─── Render ────────────────────────────────────────
  return (
    <div style={S.page}>
      <div style={S.header}>Reference Extractor</div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16 }}>
        <div style={S.subheader}>Upload a PT demonstration video → extract movement template → export reference JSON</div>
        {(videoSrc || frames.length > 0) && (
          <button style={{ ...S.btnSecondary, whiteSpace: 'nowrap' }} onClick={handleNewExtraction}>
            New Extraction
          </button>
        )}
      </div>

      {/* Status bar */}
      {statusMsg && (
        <div style={{ ...S.card, background: '#1a1a33', padding: '10px 16px', fontSize: 13,
                      display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: 240, whiteSpace: 'pre-wrap' }}>{statusMsg}</span>
          {statusAction && (
            <button style={{ ...S.btn, whiteSpace: 'nowrap' }}
              onClick={() => { setStep(statusAction.step); setStatusAction(null); }}>
              {statusAction.label}
            </button>
          )}
        </div>
      )}

      {/* Step indicator */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
        {['Upload', 'Extract', 'Reps', 'Phases', 'Feedback', 'Export'].map((label, i) => (
          <div key={i} style={{
            ...S.badge(i + 1 <= step ? '#4466ff' : '#333355'),
            cursor: i + 1 <= step ? 'pointer' : 'default',
            opacity: i + 1 <= step ? 1 : 0.5,
            // A reachable step is a control; it needs to look like one, or an
            // operator who hits a refusal assumes the run is lost.
            border: i + 1 <= step ? '1px solid #7a8cff' : '1px solid transparent',
            textDecoration: i + 1 < step ? 'underline' : 'none',
          }} onClick={() => i + 1 <= step && setStep(i + 1)}>
            {i + 1}. {label}
          </div>
        ))}
        {step > 1 && (
          <span style={{ fontSize: 11, color: '#667', alignSelf: 'center', marginLeft: 8 }}>
            click any completed step to go back — nothing is discarded
          </span>
        )}
      </div>

      <div style={S.row}>
        {/* Left column: Video + Timeline */}
        <div style={{ ...S.col, maxWidth: 560 }}>
          <div style={S.card}>
            <div style={S.cardTitle}>Video</div>

            <input type="file" accept="video/*" onChange={handleFileUpload}
              style={{ ...S.input, padding: '6px 8px' }} />

            {videoSrc && (
              <>
                {/* The overlay has to sit in the video's own box, so the canvas can
                    size itself to the DISPLAYED video rather than the page. */}
                <div style={{ position: 'relative', display: 'inline-block', lineHeight: 0 }}>
                  <video ref={videoRef} src={videoSrc} style={S.video}
                    controls preload="auto" crossOrigin="anonymous" />
                  {showOverlay && frames[currentFrame]?.keypoints?.length > 0 && (
                    <PoseOverlay
                      videoRef={videoRef}
                      keypoints={frames[currentFrame].keypoints}
                      featureKey={primaryFeature}
                      featureValue={frames[currentFrame].features?.[primaryFeature]}
                    />
                  )}
                </div>

                {frames.length > 0 && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6,
                                  fontSize: 12, color: '#aab', marginTop: 6 }}>
                    <input type="checkbox" checked={showOverlay}
                      onChange={e => setShowOverlay(e.target.checked)} />
                    Show what the model saw — skeleton, confidence, and the measured joint
                  </label>
                )}

                {/* Current position indicator */}
                {frames.length > 0 && (
                  <div style={{ background: '#1a1a3a', borderRadius: 6, padding: '6px 12px', marginTop: 8, display: 'flex', gap: 16, alignItems: 'center', fontSize: 13 }}>
                    <span style={{ color: '#888' }}>Position:</span>
                    <span style={S.mono}>Frame {currentFrame} / {frames.length - 1}</span>
                    <span style={S.mono}>({frameToTime(currentFrame)} / {frameToTime(frames.length - 1)})</span>
                  </div>
                )}

                {/* Timeline with rep markers + playhead */}
                {frames.length > 0 && (
                  <div style={S.timeline} onClick={handleTimelineClick}>
                    {/* Rep region highlights */}
                    {reps.map((r, i) => {
                      const startPct = (frames[r.start]?.time / duration) * 100;
                      const endPct = (frames[r.end]?.time / duration) * 100;
                      return (
                        <React.Fragment key={i}>
                          <div style={{ ...S.repMarker, left: `${startPct}%` }}
                            title={`Rep ${i + 1} start — frame ${r.start} (${frameToTime(r.start)})`} />
                          <div style={{ ...S.repMarker, left: `${endPct}%`, background: '#44cc66' }}
                            title={`Rep ${i + 1} end — frame ${r.end} (${frameToTime(r.end)})`} />
                          <div style={{
                            ...S.phaseRegion,
                            left: `${startPct}%`, width: `${Math.max(0.5, endPct - startPct)}%`,
                            background: PHASE_COLORS[i % PHASE_COLORS.length],
                          }} />
                        </React.Fragment>
                      );
                    })}
                    {/* Playhead */}
                    <div style={{
                      position: 'absolute', top: 0, width: 2, height: '100%',
                      background: '#fff', zIndex: 5, transition: 'left 0.05s',
                      left: `${duration > 0 ? (currentTime / duration) * 100 : 0}%`,
                    }} />
                    {/* Mini sparkline of primary feature signal */}
                    {featureSignal.length > 0 && (
                      <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 0 }}
                        viewBox={`0 0 ${featureSignal.length} 100`} preserveAspectRatio="none">
                        <polyline
                          fill="none" stroke="#4466ff55" strokeWidth="2"
                          points={featureSignal.map((v, i) => {
                            if (!Number.isFinite(v)) return '';
                            const vals = featureSignal.filter(Number.isFinite);
                            const min = Math.min(...vals);
                            const max = Math.max(...vals);
                            const range = max - min || 1;
                            const y = 100 - ((v - min) / range) * 90 - 5;
                            return `${i},${y}`;
                          }).filter(Boolean).join(' ')}
                        />
                      </svg>
                    )}
                  </div>
                )}

                {/* Extraction progress */}
                {isExtracting && (
                  <div style={S.progressBar}>
                    <div style={{ ...S.progressFill, width: `${extractProgress}%` }} />
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Right column: Controls per step */}
        <div style={S.col}>
          {/* Step 1-2: Settings + Extract */}
          {step <= 2 && (
            <div style={S.card}>
              <div style={S.cardTitle}>Settings</div>

              {/* MUST be a canonical exercise id. The app looks references up by
                  the exact EXERCISE_CONFIGS key, so a free-text name (the previous
                  behaviour) produced references that silently never loaded — e.g.
                  "Left Side Arm Raise" never matched the lookup key "SideArmRaise". */}
              <label style={S.label}>Exercise</label>
              <select style={{ ...S.select, width: '100%' }} value={exerciseName}
                onChange={e => {
                  const name = e.target.value;
                  setExerciseName(name);
                  // Pre-fill detector/side from the exercise's own config so the
                  // recording matches how the app will run it.
                  const cfg = EXERCISE_CONFIGS[name];
                  if (cfg) {
                    if (cfg.detector) setDetectorType(cfg.detector);
                    if (cfg.mode) setExerciseMode(cfg.mode);
                  }
                }}>
                <option value="">— Select exercise —</option>
                {Object.keys(EXERCISE_CONFIGS).map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
              {exerciseName && EXERCISE_CONFIGS[exerciseName]?.framing?.instruction && (
                <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
                  Framing: {EXERCISE_CONFIGS[exerciseName].framing.instruction}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={S.label}>Detector</label>
                  <select style={{ ...S.select, width: '100%' }} value={detectorType}
                    onChange={e => setDetectorType(e.target.value)}>
                    <option value="movenet">MoveNet (fast, 17 kps)</option>
                    <option value="mediapipe">MediaPipe (33 kps, feet)</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={S.label}>Sample FPS</label>
                  <select style={{ ...S.select, width: '100%' }} value={fps}
                    onChange={e => setFps(parseInt(e.target.value))}>
                    <option value="10">10 fps</option>
                    <option value="15">15 fps</option>
                    <option value="20">20 fps</option>
                    <option value="30">30 fps</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={S.label}>Mode</label>
                  <select style={{ ...S.select, width: '100%' }} value={exerciseMode}
                    onChange={e => setExerciseMode(e.target.value)}>
                    <option value="rep">Rep-based</option>
                    <option value="time">Time-based</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={S.label}>Side</label>
                  <select style={{ ...S.select, width: '100%' }} value={exerciseSide}
                    onChange={e => setExerciseSide(e.target.value)}>
                    <option value="both">Both</option>
                    <option value="left">Left</option>
                    <option value="right">Right</option>
                    <option value="alternating">Alternating</option>
                  </select>
                </div>
              </div>

              <button style={S.btn} onClick={handleExtract}
                disabled={!videoSrc || isExtracting}>
                {isExtracting ? `Extracting... ${extractProgress}%` : 'Extract Features'}
              </button>
              {isExtracting && (
                <button style={S.btnDanger} onClick={() => abortRef.current?.abort?.()}>
                  Cancel
                </button>
              )}

              {frames.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <span style={S.mono}>{frames.length} frames</span>
                  <span style={{ ...S.mono, marginLeft: 12 }}>{duration.toFixed(1)}s</span>
                </div>
              )}
            </div>
          )}

          {/* Step 3: Rep Boundaries */}
          {step === 3 && (
            <div style={S.card}>
              <div style={S.cardTitle}>Rep Boundaries</div>

              {/* Primary feature selector */}
              {topFeatures.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <label style={S.label}>Primary Feature (used for rep detection)</label>
                  <select style={{ ...S.select, width: '100%' }} value={primaryFeature}
                    onChange={e => handleFeatureChange(e.target.value)}>
                    {topFeatures.map(f => (
                      <option key={f.key} value={f.key}>
                        {f.key} (range: {f.range.toFixed(1)})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <p style={{ fontSize: 13, color: '#888', marginTop: 0 }}>
                {reps.length} rep{reps.length !== 1 ? 's' : ''} detected.
                Pause the video at the start/end of each rep, then click "Set from video".
              </p>

              {reps.map((r, i) => (
                <div key={i} style={{ background: '#1a1a3a', borderRadius: 8, padding: '10px 12px', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ ...S.badge(PHASE_COLORS[i % PHASE_COLORS.length]) }}>Rep {i + 1}</span>
                    <button style={S.btnDanger} onClick={() => handleRemoveRep(i)}>Remove</button>
                  </div>

                  {/* Start */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <label style={{ fontSize: 12, color: '#888', width: 36 }}>Start:</label>
                    <input type="number" style={{ ...S.input, width: 65, marginBottom: 0, fontSize: 13 }}
                      value={r.start} min={0} max={frames.length - 1}
                      onChange={e => handleRepChange(i, 'start', e.target.value)} />
                    <span style={{ fontSize: 11, color: '#6688cc', minWidth: 50 }}>{frameToTime(r.start)}</span>
                    <button style={{ ...S.btnSecondary, padding: '3px 8px', fontSize: 11, marginBottom: 0 }}
                      onClick={() => handleSetFromVideo(i, 'start')}
                      title="Set start to current video position">
                      Set from video
                    </button>
                    <button style={{ ...S.btnSecondary, padding: '3px 8px', fontSize: 11, marginBottom: 0 }}
                      onClick={() => seekToFrame(r.start)}
                      title="Seek video to this frame">
                      Go to
                    </button>
                  </div>

                  {/* End */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <label style={{ fontSize: 12, color: '#888', width: 36 }}>End:</label>
                    <input type="number" style={{ ...S.input, width: 65, marginBottom: 0, fontSize: 13 }}
                      value={r.end} min={0} max={frames.length - 1}
                      onChange={e => handleRepChange(i, 'end', e.target.value)} />
                    <span style={{ fontSize: 11, color: '#6688cc', minWidth: 50 }}>{frameToTime(r.end)}</span>
                    <button style={{ ...S.btnSecondary, padding: '3px 8px', fontSize: 11, marginBottom: 0 }}
                      onClick={() => handleSetFromVideo(i, 'end')}
                      title="Set end to current video position">
                      Set from video
                    </button>
                    <button style={{ ...S.btnSecondary, padding: '3px 8px', fontSize: 11, marginBottom: 0 }}
                      onClick={() => seekToFrame(r.end)}
                      title="Seek video to this frame">
                      Go to
                    </button>
                  </div>
                </div>
              ))}

              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button style={S.btnSecondary} onClick={handleAddManualRep}>
                  + Add Rep at Current Position
                </button>
                <button style={S.btn} onClick={() => { setStep(4); autoLabelPhases(); }}>
                  Next: Phases
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Phase Labeling */}
          {step === 4 && (
            <div style={S.card}>
              <div style={S.cardTitle}>Phase Labels</div>
              <p style={{ fontSize: 13, color: '#888', marginTop: 0 }}>
                Define the phases of the movement cycle.
              </p>

              <div style={{ marginBottom: 12 }}>
                {phases.map((p, i) => (
                  <span key={p} style={{ ...S.tag, background: PHASE_COLORS[i % PHASE_COLORS.length] + '44' }}>
                    {p}
                    {phases.length > 2 && (
                      <span style={{ cursor: 'pointer', marginLeft: 6 }}
                        onClick={() => handleRemovePhase(p)}>x</span>
                    )}
                  </span>
                ))}
                <button style={{ ...S.btnSecondary, padding: '2px 10px', fontSize: 12 }}
                  onClick={handleAddPhase}>+ Phase</button>
              </div>

              <label style={S.label}>Full Rep Cycle (rep counts when patient completes all 3 stages)</label>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: '#888', marginBottom: 2 }}>Start</div>
                  <select style={S.select} value={repCycle.start}
                    onChange={e => setRepCycle(prev => ({ ...prev, start: e.target.value, return: e.target.value }))}>
                    {phases.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <span style={{ color: '#888', fontSize: 18 }}>→</span>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: '#888', marginBottom: 2 }}>Effort</div>
                  <select style={S.select} value={repCycle.effort}
                    onChange={e => setRepCycle(prev => ({ ...prev, effort: e.target.value }))}>
                    {phases.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <span style={{ color: '#888', fontSize: 18 }}>→</span>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: '#888', marginBottom: 2 }}>Return</div>
                  <select style={S.select} value={repCycle.return}
                    onChange={e => setRepCycle(prev => ({ ...prev, return: e.target.value }))}>
                    {phases.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </div>
              <p style={{ fontSize: 11, color: '#666', marginTop: 0, marginBottom: 12 }}>
                Example: lowered → raised → lowered = 1 complete rep
              </p>

              <label style={S.label}>
                Posture band — how close a frame must be to an end position to count as
                being AT it, as a share of the movement range
              </label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                <input
                  type="range" min="5" max="35" step="1"
                  value={Math.round(phaseBandPct * 100)}
                  onChange={e => setPhaseBandPct(Number(e.target.value) / 100)}
                  style={{ flex: 1 }}
                />
                <span style={{ fontSize: 12, color: '#ccc', minWidth: 36 }}>
                  {Math.round(phaseBandPct * 100)}%
                </span>
              </div>
              <p style={{ fontSize: 11, color: '#666', marginTop: 0, marginBottom: 12 }}>
                Widen this for a noisy clip or one where the patient never fully settles between
                reps. Too wide and the two postures merge; too narrow and neither is found.
              </p>

              <button style={S.btnSecondary} onClick={autoLabelPhases}>Re-label Frames</button>

              {phaseLabels.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <label style={S.label}>
                    Frames per phase — per rep, across {reps.length - unlabelledReps.size} labelled
                    rep{reps.length - unlabelledReps.size === 1 ? '' : 's'}
                    {unlabelledReps.size > 0 && ` (${unlabelledReps.size} refused)`}
                  </label>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {phases.map((ph, i) => {
                      const n = phaseLabels.filter(l => l.phase === ph).length;
                      // Averaged over the reps that were actually labelled. Dividing
                      // by every rep understates each phase whenever one is refused.
                      const labelled = reps.length - unlabelledReps.size;
                      const per = labelled ? (n / labelled).toFixed(1) : '0';
                      return (
                        <span key={ph} style={{
                          fontSize: 11, padding: '3px 8px', borderRadius: 10,
                          background: n ? PHASE_COLORS[i % PHASE_COLORS.length] : '#333',
                          color: n ? '#fff' : '#777',
                        }}>
                          {ph}: {per}/rep ({n} total)
                        </span>
                      );
                    })}
                  </div>

                  {/* Each rep is labelled on its own, so each one must contain the whole
                      cycle. A total can hide a rep that is missing a phase entirely:
                      three reps where one never reaches the top still shows a healthy
                      total for that phase. This breaks it out per rep so that is visible. */}
                  <div style={{ marginTop: 8, fontSize: 11, color: '#aab' }}>
                    {reps.map((rep, r) => {
                      if (unlabelledReps.has(r)) {
                        return (
                          <div key={r} style={{ color: '#ff6b6b' }}>
                            Rep {r + 1}: not labelled — the labeller refused this rep. See the
                            message above; its boundary is almost always cut mid-cycle.
                          </div>
                        );
                      }
                      const inRep = phaseLabels.filter(l => l.rep === r);
                      const missing = phases.filter(ph => !inRep.some(l => l.phase === ph));
                      return (
                        <div key={r} style={{ color: missing.length ? '#ffaa22' : '#aab' }}>
                          Rep {r + 1}: {phases.map(ph =>
                            `${ph} ${inRep.filter(l => l.phase === ph).length}`
                          ).join(' · ')}
                          {missing.length > 0 && `   ← missing ${missing.join(', ')}`}
                        </div>
                      );
                    })}
                  </div>

                  {reps.some((rep, r) => {
                    if (unlabelledReps.has(r)) return true;
                    const inRep = phaseLabels.filter(l => l.rep === r);
                    return phases.some(ph => !inRep.some(l => l.phase === ph));
                  }) && (
                    <p style={{ fontSize: 11, color: '#ffaa22', marginBottom: 0 }}>
                      A rep missing a phase never covers that part of the movement — usually a
                      rep boundary cut mid-cycle, or a half-recorded rep. Its coaching cues will
                      never fire, and it drags the averaged template toward a shape the patient
                      cannot match. Fix the boundary or widen the posture band.
                    </p>
                  )}
                </div>
              )}
              <button style={S.btn} onClick={() => setStep(5)}>Next: Feedback</button>
            </div>
          )}

          {/* Step 5: Feedback */}
          {step === 5 && (
            <div style={S.card}>
              <div style={S.cardTitle}>PT Feedback</div>

              {/* Phase feedback */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ ...S.label, fontWeight: 600 }}>Phase Cues</label>
                <p style={{ fontSize: 12, color: '#666', marginTop: 0 }}>
                  What should the patient hear during each phase?
                </p>
                {phases.map(p => (
                  <div key={p} style={S.feedbackRow}>
                    <span style={S.tag}>{p}</span>
                    <input style={{ ...S.input, flex: 1, marginBottom: 0 }}
                      value={feedback.phase[p] || ''}
                      onChange={e => handlePhaseFeedback(p, e.target.value)}
                      placeholder={`e.g. "Curl your arm up"`} />
                  </div>
                ))}
              </div>

              {/* Form / safety feedback */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ ...S.label, fontWeight: 600 }}>Form / Safety Cues</label>
                <p style={{ fontSize: 12, color: '#666', marginTop: 0 }}>
                  Triggered when body parts deviate from the reference.
                </p>
                {feedback.form.map((rule, i) => (
                  <div key={i} style={S.feedbackRow}>
                    <select style={{ ...S.select, width: 100 }} value={rule.bodyPart}
                      onChange={e => handleFormRuleChange(i, 'bodyPart', e.target.value)}>
                      {['back', 'trunk', 'shoulder', 'elbow', 'hip', 'knee', 'ankle', 'foot', 'wrist']
                        .map(bp => <option key={bp} value={bp}>{bp}</option>)}
                    </select>
                    <input style={{ ...S.input, flex: 1, marginBottom: 0 }}
                      value={rule.say}
                      onChange={e => handleFormRuleChange(i, 'say', e.target.value)}
                      placeholder="Keep your back straight" />
                    <button style={S.btnDanger} onClick={() => handleRemoveFormRule(i)}>x</button>
                  </div>
                ))}
                <button style={{ ...S.btnSecondary, fontSize: 12 }} onClick={handleAddFormRule}>
                  + Form Rule
                </button>
              </div>

              {/* Range feedback */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ ...S.label, fontWeight: 600 }}>Range Cues</label>
                <div style={S.feedbackRow}>
                  <span style={S.tag}>Too little</span>
                  <input style={{ ...S.input, flex: 1, marginBottom: 0 }}
                    value={feedback.range.tooLittle}
                    onChange={e => setFeedback(prev => ({
                      ...prev, range: { ...prev.range, tooLittle: e.target.value }
                    }))}
                    placeholder="Try to go a bit further" />
                </div>
                <div style={S.feedbackRow}>
                  <span style={S.tag}>Too much</span>
                  <input style={{ ...S.input, flex: 1, marginBottom: 0 }}
                    value={feedback.range.tooMuch}
                    onChange={e => setFeedback(prev => ({
                      ...prev, range: { ...prev.range, tooMuch: e.target.value }
                    }))}
                    placeholder="That's far enough" />
                </div>
              </div>

              {/* Tempo feedback */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ ...S.label, fontWeight: 600 }}>Tempo Cues</label>
                <div style={S.feedbackRow}>
                  <span style={S.tag}>Too fast</span>
                  <input style={{ ...S.input, flex: 1, marginBottom: 0 }}
                    value={feedback.tempo.tooFast}
                    onChange={e => setFeedback(prev => ({
                      ...prev, tempo: { ...prev.tempo, tooFast: e.target.value }
                    }))}
                    placeholder="Slow down, control the movement" />
                </div>
                <div style={S.feedbackRow}>
                  <span style={S.tag}>Hold cue</span>
                  <input style={{ ...S.input, flex: 1, marginBottom: 0 }}
                    value={feedback.tempo.holdCue}
                    onChange={e => setFeedback(prev => ({
                      ...prev, tempo: { ...prev.tempo, holdCue: e.target.value }
                    }))}
                    placeholder="Hold at the top for a moment" />
                </div>
              </div>

              <button style={S.btnSuccess} onClick={handleExport}>
                Generate Reference JSON
              </button>
            </div>
          )}

          {/* Step 6: Export */}
          {step === 6 && exportedJSON && (
            <div style={S.card}>
              <div style={S.cardTitle}>Reference JSON</div>

              <div style={{ marginBottom: 12 }}>
                <span style={S.badge('#339944')}>Valid</span>
                <span style={S.badge('#4466ff')}>{exportedJSON.template?.length} frames</span>
                <span style={S.badge('#cc44ff')}>{Object.keys(exportedJSON.featureRanges || {}).length} features</span>
                <span style={S.badge('#ffaa22')}>{reps.length} reps averaged</span>
              </div>

              <pre style={S.pre}>
                {JSON.stringify(exportedJSON, null, 2)}
              </pre>

              <div style={{ marginTop: 12 }}>
                <button
                  style={{ ...S.btn, background: publishing ? '#335533' : '#226622', marginRight: 8 }}
                  onClick={handlePublish}
                  disabled={publishing}
                >
                  {publishing ? 'Publishing…' : 'Publish to Platform'}
                </button>
                {publishStatus === 'success' && (
                  <span style={{ color: '#66ff88', fontSize: 13, marginRight: 8 }}>Published</span>
                )}
                {publishStatus === 'error' && (
                  <span style={{ color: '#ff6666', fontSize: 13, marginRight: 8 }}>Failed — use Download below</span>
                )}
                <button style={S.btn} onClick={handleDownload}>
                  Download .ref.json
                </button>
                <button style={S.btnSecondary} onClick={() => {
                  navigator.clipboard?.writeText(JSON.stringify(exportedJSON, null, 2));
                  setStatusMsg('Copied to clipboard!');
                }}>
                  Copy to Clipboard
                </button>
                <button style={S.btnSecondary} onClick={() => setStep(5)}>
                  Edit Feedback
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
