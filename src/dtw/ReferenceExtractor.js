// ---------------------------------------------
// dtw/ReferenceExtractor.js
// PT tool: upload a reference video → extract features → mark reps →
// label phases → add feedback → export reference JSON.
// ---------------------------------------------
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPoseDetector } from '../detectors';
import { extractFeaturesFromVideo, detectRepBoundaries, buildTemplateFromReps, getTopFeatures } from './videoFeatureExtractor';
import { computeFeatureRanges, validateReference } from './referenceSchema';
import { registerReference } from './referenceRegistry';

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
  const [repCycle, setRepCycle] = useState({ start: 'lowered', effort: 'raised', return: 'lowered' });
  const [feedback, setFeedback] = useState({
    phase: {}, form: [], range: { tooLittle: '', tooMuch: '' }, tempo: { tooFast: '', holdCue: '' },
  });
  const [exportedJSON, setExportedJSON] = useState(null);
  const [statusMsg, setStatusMsg] = useState('');
  const [currentFrame, setCurrentFrame] = useState(0); // video playback position as frame index
  const [currentTime, setCurrentTime] = useState(0);   // video playback position in seconds
  const [topFeatures, setTopFeatures] = useState([]);   // top features by range for dropdown
  const [primaryFeature, setPrimaryFeature] = useState(''); // user-selected or auto-detected
  const [featureSignal, setFeatureSignal] = useState([]); // smoothed signal for sparkline

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
  const handleFileUpload = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setVideoSrc(url);
    setFrames([]);
    setReps([]);
    setExportedJSON(null);
    setStatusMsg('Video loaded. Configure settings and click "Extract Features".');
  }, []);

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
      setDuration(result.duration);
      setExtractProgress(100);

      // Compute top features for dropdown
      const top = getTopFeatures(result.frames, 8);
      setTopFeatures(top);

      // Auto-detect reps (tries multiple features, picks best)
      const detection = detectRepBoundaries(result.frames);
      setReps(detection.reps);
      setPrimaryFeature(detection.primaryFeature || top[0]?.key || '');
      setFeatureSignal(detection.signal || []);

      const autoCount = detection.reps.length;
      const fallback = autoCount === 1 && detection.reps[0]?.start === 0 && detection.reps[0]?.end === result.frames.length - 1;
      setStatusMsg(
        `Extracted ${result.frames.length} frames (${result.duration.toFixed(1)}s). ` +
        (fallback
          ? `Could not auto-detect individual reps — treating entire video as 1 rep. Use the video controls to mark rep boundaries.`
          : `Auto-detected ${autoCount} rep${autoCount !== 1 ? 's' : ''} using "${detection.primaryFeature}".`)
      );
      setStep(3);
    } catch (err) {
      console.error('[ReferenceExtractor] Extraction failed:', err);
      setStatusMsg(`Error: ${err.message}`);
    } finally {
      setIsExtracting(false);
    }
  }, [videoSrc, detectorType, fps]);

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

    // Simple auto-labeling: first half of rep = phase[0], second half = phase[1]
    // For 3+ phases: divide equally
    const labels = [];
    for (const rep of reps) {
      const repLen = rep.end - rep.start + 1;
      const segLen = Math.ceil(repLen / phases.length);
      for (let f = rep.start; f <= rep.end; f++) {
        const segIdx = Math.min(Math.floor((f - rep.start) / segLen), phases.length - 1);
        labels.push({ frame: f, phase: phases[segIdx] });
      }
    }
    setPhaseLabels(labels);
    setStatusMsg(`Auto-labeled ${labels.length} frames across ${phases.length} phases.`);
  }, [reps, frames, phases]);

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
    if (!frames.length || !reps.length) {
      setStatusMsg('Need at least extracted frames and one rep to export.');
      return;
    }

    // Build template from reps
    const template = buildTemplateFromReps(frames, reps, 60);

    // Apply phase labels to template
    if (phaseLabels.length > 0 && phases.length >= 2) {
      // Map phase labels to template frames by proportion
      const repLen = reps[0].end - reps[0].start + 1;
      for (let t = 0; t < template.length; t++) {
        const srcFrame = reps[0].start + Math.round((t / (template.length - 1)) * (repLen - 1));
        const label = phaseLabels.find(l => l.frame === srcFrame);
        template[t].phase = label?.phase || phases[Math.floor(t / (template.length / phases.length))];
      }
    } else {
      // Default: first half = phases[0], second half = phases[1]
      for (let t = 0; t < template.length; t++) {
        const segIdx = Math.min(Math.floor(t / (template.length / phases.length)), phases.length - 1);
        template[t].phase = phases[segIdx];
      }
    }

    // Compute feature ranges
    const featureRanges = computeFeatureRanges(template);

    // Estimate timing
    const avgRepDuration = reps.reduce((s, r) => {
      const startTime = frames[r.start]?.time || 0;
      const endTime = frames[r.end]?.time || 0;
      return s + (endTime - startTime);
    }, 0) / reps.length;

    const reference = {
      name: exerciseName || 'Unnamed',
      side: exerciseSide,
      mode: exerciseMode,
      detector: detectorType,
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
    };

    // Validate
    const result = validateReference(reference);
    if (!result.valid) {
      setStatusMsg(`Validation errors: ${result.errors.join('; ')}`);
      return;
    }

    // Register in runtime cache
    registerReference(reference.name, reference);

    setExportedJSON(reference);
    setStatusMsg(`Reference "${reference.name}" exported and registered! ${template.length} template frames, ${Object.keys(featureRanges).length} features.`);
    setStep(6);
  }, [frames, reps, phases, phaseLabels, repCycle, feedback, exerciseName, exerciseSide, exerciseMode, detectorType, fps]);

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
      <div style={S.subheader}>Upload a PT demonstration video → extract movement template → export reference JSON</div>

      {/* Status bar */}
      {statusMsg && (
        <div style={{ ...S.card, background: '#1a1a33', padding: '10px 16px', fontSize: 13 }}>
          {statusMsg}
        </div>
      )}

      {/* Step indicator */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
        {['Upload', 'Extract', 'Reps', 'Phases', 'Feedback', 'Export'].map((label, i) => (
          <div key={i} style={{
            ...S.badge(i + 1 <= step ? '#4466ff' : '#333355'),
            cursor: i + 1 <= step ? 'pointer' : 'default',
            opacity: i + 1 <= step ? 1 : 0.5,
          }} onClick={() => i + 1 <= step && setStep(i + 1)}>
            {i + 1}. {label}
          </div>
        ))}
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
                <video ref={videoRef} src={videoSrc} style={S.video}
                  controls preload="auto" crossOrigin="anonymous" />

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

              <label style={S.label}>Exercise Name</label>
              <input style={S.input} value={exerciseName}
                onChange={e => setExerciseName(e.target.value)}
                placeholder="e.g. BicepCurls" />

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

              <button style={S.btnSecondary} onClick={autoLabelPhases}>Re-label Frames</button>
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
