// ---------------------------------------------
// dtw/videoFeatureExtractor.js
// Processes an uploaded video frame-by-frame through pose detection,
// extracts universal features, and returns a timeline of feature vectors.
// ---------------------------------------------
import { computeUniversalFeatures, stripSideSuffix } from './universalFeatures.js';
import { processingSize } from '../captureConfig.js';

const MOVE_NET_NAMES = [
  'nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear',
  'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist',
  'left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle'
];

/**
 * Extract features from every frame of a video element.
 * Seeks through the video at the given FPS, runs pose detection, computes universal features.
 *
 * @param {HTMLVideoElement} videoEl - loaded video element (must have src set and be loaded)
 * @param {Object} detector - pose detector with .estimatePoses(video) method
 * @param {Object} [opts]
 * @param {number} [opts.fps=15] - frames per second to sample
 * @param {Function} [opts.onProgress] - callback(frameIndex, totalFrames)
 * @param {AbortSignal} [opts.signal] - abort signal to cancel extraction
 * @returns {Promise<{ frames: Array, fps: number, duration: number }>}
 *   frames: [{ time, frameIndex, features, keypoints }]
 */
export async function extractFeaturesFromVideo(videoEl, detector, opts = {}) {
  const fps = opts.fps || 15;
  const onProgress = opts.onProgress || (() => {});
  const signal = opts.signal || null;

  // Wait for video metadata
  if (videoEl.readyState < 1) {
    await new Promise((resolve, reject) => {
      videoEl.addEventListener('loadedmetadata', resolve, { once: true });
      videoEl.addEventListener('error', reject, { once: true });
    });
  }

  const duration = videoEl.duration;
  const interval = 1 / fps;
  const totalFrames = Math.ceil(duration * fps);
  const frames = [];

  // Offscreen canvas: this is what pose detection actually runs on, NOT the
  // video element. A phone recording is 1080p or better, while a live session
  // captures at PROCESSING_MAX_WIDTH — extracting at native resolution would
  // build the template from landmark quality a live session can never
  // reproduce, making it systematically unreachable. Capping here keeps the
  // reference and the sessions it is compared against on the same footing.
  //
  // Note this equalises pixel COUNT, not image quality: a rear-camera recording
  // is still sharper than a front-camera live frame.
  const { width: procW, height: procH, scaled } = processingSize(
    videoEl.videoWidth, videoEl.videoHeight
  );
  const canvas = document.createElement('canvas');
  canvas.width = procW;
  canvas.height = procH;
  const ctx = canvas.getContext('2d');

  if (scaled) {
    console.log(
      `[VideoExtractor] processing at ${procW}x${procH} ` +
      `(source ${videoEl.videoWidth}x${videoEl.videoHeight}) (extractor cap)`
    );
  }

  for (let i = 0; i < totalFrames; i++) {
    if (signal?.aborted) break;

    const time = i * interval;
    if (time > duration) break;

    // Seek to the target time
    videoEl.currentTime = time;
    await waitForSeek(videoEl);

    // Draw frame to canvas
    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);

    // Run pose detection
    let keypoints = [];
    try {
      // The canvas, not videoEl — otherwise the cap above does nothing.
      // Keypoints come back in canvas pixel space, which is fine: every
      // universal feature is a ratio, so all of them are scale-invariant.
      const poses = await detector.estimatePoses(canvas);
      const raw = poses?.[0]?.keypoints || [];
      keypoints = raw.map((k, idx) => (k?.name ? k : { ...k, name: MOVE_NET_NAMES[idx] }));
    } catch (e) {
      console.warn(`[VideoExtractor] Frame ${i} pose detection failed:`, e);
    }

    // Compute universal features
    const features = computeUniversalFeatures(keypoints);

    frames.push({
      time: Number(time.toFixed(4)),
      frameIndex: i,
      features,
      keypoints, // keep raw keypoints for skeleton overlay
    });

    onProgress(i, totalFrames);
  }

  return { frames, fps, duration };
}

/**
 * Auto-detect rep boundaries from a feature timeline.
 * Uses a simple peak/valley detection on the primary movement feature.
 * Returns suggested rep start/end frame indices.
 *
 * @param {Array} frames - from extractFeaturesFromVideo
 * @param {string} [primaryFeature] - feature key to track (auto-detected if omitted)
 * @returns {{ reps: Array<{ start, end, peakFrame }>, primaryFeature: string, signal: number[] }}
 */
export function detectRepBoundaries(frames, primaryFeature) {
  if (!frames.length) return { reps: [], primaryFeature: null, signal: [] };

  // If user specified a feature, use it directly
  if (primaryFeature) {
    const result = _detectRepsForFeature(frames, primaryFeature);
    return { ...result, primaryFeature };
  }

  // Otherwise try top candidate features and pick whichever gives the most reps
  const candidates = getTopFeatures(frames, 5);
  let bestResult = { reps: [], signal: [] };
  let bestFeature = candidates[0]?.key || null;

  // Report what every candidate found, not just the winner. When auto-detection
  // undercounts a video that clearly has many cycles, the useful question is
  // whether the extrema were never found (peaks/valleys near zero) or found but
  // not paired into valley→peak→valley reps (extrema plentiful, reps few) —
  // and that is invisible from the one-line result in the UI.
  const diag = [];
  for (const { key } of candidates) {
    const result = _detectRepsForFeature(frames, key);
    diag.push(
      `${key}: ${result.reps.length} reps ` +
      `(${result.peaks} peaks, ${result.valleys} valleys, ` +
      `range ${result.range.toFixed(1)}, threshold ${result.threshold.toFixed(2)}, ` +
      `${result.nonFinite} unusable frames)`
    );
    if (result.reps.length > bestResult.reps.length) {
      bestResult = result;
      bestFeature = key;
    }
  }
  console.log(`[RepDetect] ${frames.length} frames. Candidates:`);
  for (const line of diag) console.log(`  ${line}`);

  // Fallback: if still 0 reps, treat entire video as 1 rep
  if (bestResult.reps.length === 0 && frames.length > 10) {
    const mid = Math.floor(frames.length / 2);
    bestResult.reps = [{ start: 0, end: frames.length - 1, peakFrame: mid }];
  }

  return { reps: bestResult.reps, primaryFeature: bestFeature, signal: bestResult.signal };
}

function _detectRepsForFeature(frames, featureKey) {
  const signal = frames.map(f => f.features[featureKey] ?? NaN);
  const smoothed = emaSmooth(signal, 0.3);
  const { peaks, valleys } = findPeaksAndValleys(smoothed, 0.08);

  const usable = smoothed.filter(Number.isFinite);
  const range = usable.length ? Math.max(...usable) - Math.min(...usable) : 0;

  // Build rep boundaries: valley → peak → valley
  const reps = [];
  for (let i = 0; i < valleys.length - 1; i++) {
    const peakBetween = peaks.find(p => p > valleys[i] && p < valleys[i + 1]);
    if (peakBetween !== undefined) {
      reps.push({ start: valleys[i], end: valleys[i + 1], peakFrame: peakBetween });
    }
  }

  // Also try: peak → valley → peak (for exercises that start at the top)
  if (reps.length === 0) {
    for (let i = 0; i < peaks.length - 1; i++) {
      const valleyBetween = valleys.find(v => v > peaks[i] && v < peaks[i + 1]);
      if (valleyBetween !== undefined) {
        reps.push({ start: peaks[i], end: peaks[i + 1], peakFrame: valleyBetween });
      }
    }
  }

  return {
    reps, signal: smoothed,
    peaks: peaks.length, valleys: valleys.length,
    range, threshold: 0.08 * range,
    nonFinite: smoothed.length - usable.length,
  };
}

/**
 * Resolve which feature should count reps for a KNOWN exercise, from its
 * canonical config rather than by ranking raw ranges.
 *
 * Ranking by range is wrong across feature families because the key set mixes
 * units. In a seated dorsiflexion clip the demonstrator sits, settles and moves
 * their arms, so elbowAngleMin sweeps ~100 degrees while the actual movement,
 * footPitchNorm, sweeps 0.17 — and the elbow wins on magnitude alone. The
 * extractor then tries to label phases from a feature the exercise has no
 * opinion about, and the labeller correctly refuses because it cannot tell
 * which end of an elbow angle is the rest posture for a dorsiflexion.
 *
 * @param {Object} cfg   an EXERCISE_CONFIGS entry, or null for a free-text name
 * @param {Array}  frames from extractFeaturesFromVideo
 * @returns {string|null} concrete feature key present in the frames, or null
 */
export function resolvePrimaryFeatureKey(cfg, frames) {
  if (!cfg || !frames?.length) return null;

  const ranges = {};
  for (const f of frames) {
    for (const [key, val] of Object.entries(f.features || {})) {
      if (!Number.isFinite(val)) continue;
      if (!ranges[key]) ranges[key] = { min: val, max: val };
      else {
        ranges[key].min = Math.min(ranges[key].min, val);
        ranges[key].max = Math.max(ranges[key].max, val);
      }
    }
  }

  // An exact pin wins outright, if the clip actually produced that key.
  if (cfg.primaryFeature && ranges[cfg.primaryFeature]) return cfg.primaryFeature;

  // Otherwise take the declared family and pick the side that actually moved,
  // which is how a side-on foot exercise finds the near foot.
  const base = cfg.primaryFeatureBase;
  if (base) {
    let best = null;
    let bestRange = -1;
    for (const [key, r] of Object.entries(ranges)) {
      if (stripSideSuffix(key) !== base) continue;
      const span = r.max - r.min;
      if (span > bestRange) { bestRange = span; best = key; }
    }
    if (best) return best;
  }

  // Last resort, for an exercise that declares neither: take the family its own
  // canonical template sweeps widest.
  //
  // Ranked by the span the TEMPLATE declares, not by the span this clip happens
  // to show. Two reasons. It compares only features the same exercise defines,
  // so it never weighs degrees against ratios. And it is the same choice
  // DTWPhaseMachine's auto-picker makes at runtime from the template's
  // featureRanges — so the reference is authored against the feature the engine
  // will actually count with, instead of whichever one this particular
  // demonstrator waved around most.
  const spans = {};
  for (const ph of cfg.phases || []) {
    for (const [key, def] of Object.entries(ph.features || {})) {
      const vals = [def?.from, def?.to].filter(Number.isFinite);
      if (!vals.length) continue;
      const lo = Math.min(...vals);
      const hi = Math.max(...vals);
      if (!spans[key]) spans[key] = { min: lo, max: hi };
      else {
        spans[key].min = Math.min(spans[key].min, lo);
        spans[key].max = Math.max(spans[key].max, hi);
      }
    }
  }

  let widest = null;
  let widestSpan = -1;
  for (const [key, r] of Object.entries(spans)) {
    const span = r.max - r.min;
    if (span > widestSpan) { widestSpan = span; widest = key; }
  }
  if (!widest) return null;

  // Resolve that family to whichever concrete side this clip actually captured.
  let best = null;
  let bestRange = -1;
  for (const [key, r] of Object.entries(ranges)) {
    if (stripSideSuffix(key) !== widest && key !== widest) continue;
    const span = r.max - r.min;
    if (span > bestRange) { bestRange = span; best = key; }
  }
  return best;
}

/**
 * Get the top N features by range (largest movement) for UI dropdown.
 * @param {Array} frames
 * @param {number} [topN=5]
 * @returns {Array<{ key: string, range: number, min: number, max: number }>}
 */
export function getTopFeatures(frames, topN = 5) {
  const ranges = {};
  for (const f of frames) {
    for (const [key, val] of Object.entries(f.features)) {
      if (!Number.isFinite(val)) continue;
      if (!ranges[key]) ranges[key] = { min: val, max: val };
      else {
        ranges[key].min = Math.min(ranges[key].min, val);
        ranges[key].max = Math.max(ranges[key].max, val);
      }
    }
  }
  return Object.entries(ranges)
    .map(([key, r]) => ({ key, range: r.max - r.min, min: r.min, max: r.max }))
    .sort((a, b) => b.range - a.range)
    .slice(0, topN);
}

/**
 * Copy the exercised side of a recorded template onto the idle side.
 *
 * A demonstrator records a one-sided exercise sitting one way round. A patient
 * may sit the other way. Without this the recorded template carries a real
 * sweep on, say, footPitchNormR and a flat line on footPitchNormL, and a
 * left-sided patient gets a template range near zero. That is not a small
 * error: DTWPhaseMachine sets nearStartTolerance from the raw template range
 * with no floor applied, so the return-to-start window collapses and reps open
 * but never close. Nothing logs a complaint — the session simply counts zero.
 *
 * Mirroring is exact, not an approximation. Every universal feature is
 * invariant under a left-right reflection: three-point angles do not change
 * under reflection at all, and the normalized height features are built from
 * differences in y, which a horizontal mirror leaves untouched. So the recorded
 * side's numbers are precisely what the other side would have produced.
 *
 * The synthetic references have always been symmetric this way — specToReference
 * mirrors every side-generic config value onto both sides. Only the recorded
 * path was missing the equivalent.
 *
 * A genuinely two-sided recording is left alone: if both sides moved comparably
 * there is nothing to copy and real data must not be overwritten.
 *
 * @param {Array} template from buildTemplateFromReps (mutated in place)
 * @param {Object} [opts]
 * @param {number} [opts.dominanceRatio=0.3] quiet side must be under this share
 *   of the active side's range before it is treated as idle
 * @returns {{ mirrored: Array<{base,from,to}>, bilateral: string[] }}
 */
export function mirrorTemplateSides(template, opts = {}) {
  const dominanceRatio = opts.dominanceRatio ?? 0.3;
  const result = { mirrored: [], bilateral: [] };
  if (!template?.length) return result;

  const ranges = {};
  for (const f of template) {
    for (const [key, val] of Object.entries(f.features || {})) {
      if (!Number.isFinite(val)) continue;
      if (!ranges[key]) ranges[key] = { min: val, max: val };
      else {
        ranges[key].min = Math.min(ranges[key].min, val);
        ranges[key].max = Math.max(ranges[key].max, val);
      }
    }
  }
  const spanOf = key => (ranges[key] ? ranges[key].max - ranges[key].min : 0);

  // Families are derived from the keys present, not from a hardcoded list, so
  // this cannot drift out of step with universalFeatures.
  const bases = new Set();
  for (const key of Object.keys(ranges)) {
    if (/[LR]$/.test(key)) bases.add(key.slice(0, -1));
  }

  for (const base of bases) {
    const L = `${base}L`;
    const R = `${base}R`;
    const spanL = spanOf(L);
    const spanR = spanOf(R);
    const active = spanL >= spanR ? L : R;
    const idle = active === L ? R : L;
    const activeSpan = Math.max(spanL, spanR);
    const idleSpan = Math.min(spanL, spanR);

    if (activeSpan <= 0) continue;                       // nothing moved either side
    if (idleSpan / activeSpan >= dominanceRatio) {        // both sides genuinely used
      result.bilateral.push(base);
      continue;
    }

    for (const f of template) {
      const val = f.features?.[active];
      if (!Number.isFinite(val)) continue;
      f.features[idle] = val;
      // With both sides equal, every aggregate collapses to the same number.
      for (const suffix of ['Min', 'Max', 'Avg']) {
        const agg = base + suffix;
        if (agg in f.features) f.features[agg] = val;
      }
    }
    result.mirrored.push({ base, from: active, to: idle });
  }

  return result;
}

/**
 * Given detected rep boundaries, extract a single representative template
 * by averaging feature vectors across all reps (time-normalized).
 *
 * @param {Array} frames - full frame timeline
 * @param {Array} reps - rep boundaries from detectRepBoundaries
 * @param {number} [templateLength=60] - number of frames in output template
 * @returns {Array<{ frame: number, features: Object }>}
 */
export function buildTemplateFromReps(frames, reps, templateLength = 60) {
  if (!reps.length) return [];

  // For each rep, resample to templateLength frames
  const resampled = reps.map(rep => {
    const repFrames = frames.slice(rep.start, rep.end + 1);
    return resampleFrames(repFrames, templateLength);
  });

  // Average across all reps at each template position
  const template = [];
  for (let t = 0; t < templateLength; t++) {
    const merged = {};
    const counts = {};

    for (const repSamples of resampled) {
      const f = repSamples[t];
      if (!f) continue;
      for (const [key, val] of Object.entries(f.features)) {
        if (!Number.isFinite(val)) continue;
        merged[key] = (merged[key] || 0) + val;
        counts[key] = (counts[key] || 0) + 1;
      }
    }

    // Average
    const avgFeatures = {};
    for (const key of Object.keys(merged)) {
      avgFeatures[key] = merged[key] / counts[key];
    }

    template.push({
      frame: t,
      features: avgFeatures,
    });
  }

  return template;
}

// ─── Helpers ─────────────────────────────────────────────

function waitForSeek(videoEl) {
  return new Promise(resolve => {
    if (videoEl.seeking) {
      videoEl.addEventListener('seeked', resolve, { once: true });
    } else {
      resolve();
    }
  });
}

function findPrimaryFeature(frames) {
  const ranges = {};
  for (const f of frames) {
    for (const [key, val] of Object.entries(f.features)) {
      if (!Number.isFinite(val)) continue;
      if (!ranges[key]) ranges[key] = { min: val, max: val };
      else {
        ranges[key].min = Math.min(ranges[key].min, val);
        ranges[key].max = Math.max(ranges[key].max, val);
      }
    }
  }
  // Pick the feature with the largest range
  let best = null;
  let bestRange = 0;
  for (const [key, r] of Object.entries(ranges)) {
    const range = r.max - r.min;
    if (range > bestRange) {
      bestRange = range;
      best = key;
    }
  }
  return best;
}

function emaSmooth(signal, alpha) {
  const out = new Array(signal.length);
  out[0] = signal[0];
  for (let i = 1; i < signal.length; i++) {
    const v = signal[i];
    if (!Number.isFinite(v)) { out[i] = out[i - 1]; continue; }
    out[i] = Number.isFinite(out[i - 1]) ? alpha * v + (1 - alpha) * out[i - 1] : v;
  }
  return out;
}

// findPrimaryFeature kept for backward compat but getTopFeatures is preferred
function findPeaksAndValleys(signal, minProminence) {
  const peaks = [];
  const valleys = [];

  // Find global range for prominence threshold
  const vals = signal.filter(Number.isFinite);
  if (vals.length < 3) return { peaks, valleys };
  const globalRange = Math.max(...vals) - Math.min(...vals);
  const threshold = minProminence * globalRange;

  for (let i = 1; i < signal.length - 1; i++) {
    const prev = signal[i - 1];
    const curr = signal[i];
    const next = signal[i + 1];
    if (!Number.isFinite(prev) || !Number.isFinite(curr) || !Number.isFinite(next)) continue;

    if (curr > prev && curr > next) {
      // Candidate peak — check prominence
      const leftMin = findLocalMin(signal, i, -1);
      const rightMin = findLocalMin(signal, i, 1);
      const prominence = curr - Math.max(leftMin, rightMin);
      if (prominence >= threshold) peaks.push(i);
    }
    if (curr < prev && curr < next) {
      const leftMax = findLocalMax(signal, i, -1);
      const rightMax = findLocalMax(signal, i, 1);
      const prominence = Math.min(leftMax, rightMax) - curr;
      if (prominence >= threshold) valleys.push(i);
    }
  }

  return { peaks, valleys };
}

function findLocalMin(signal, from, dir) {
  let min = signal[from];
  for (let i = from + dir; i >= 0 && i < signal.length; i += dir) {
    if (!Number.isFinite(signal[i])) break;
    if (signal[i] < min) min = signal[i];
    if (signal[i] > min) break; // going back up
  }
  return min;
}

function findLocalMax(signal, from, dir) {
  let max = signal[from];
  for (let i = from + dir; i >= 0 && i < signal.length; i += dir) {
    if (!Number.isFinite(signal[i])) break;
    if (signal[i] > max) max = signal[i];
    if (signal[i] < max) break;
  }
  return max;
}

function resampleFrames(repFrames, targetLen) {
  const out = [];
  const srcLen = repFrames.length;
  for (let t = 0; t < targetLen; t++) {
    const srcIdx = (t / (targetLen - 1)) * (srcLen - 1);
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, srcLen - 1);
    const frac = srcIdx - lo;

    // Linear interpolation of features
    const fLo = repFrames[lo]?.features || {};
    const fHi = repFrames[hi]?.features || {};
    const interpolated = {};
    const allKeys = new Set([...Object.keys(fLo), ...Object.keys(fHi)]);
    for (const key of allKeys) {
      const a = fLo[key];
      const b = fHi[key];
      if (Number.isFinite(a) && Number.isFinite(b)) {
        interpolated[key] = a + frac * (b - a);
      } else if (Number.isFinite(a)) {
        interpolated[key] = a;
      } else if (Number.isFinite(b)) {
        interpolated[key] = b;
      }
    }
    out.push({ frame: t, features: interpolated });
  }
  return out;
}
