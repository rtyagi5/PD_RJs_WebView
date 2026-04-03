// ---------------------------------------------
// dtw/videoFeatureExtractor.js
// Processes an uploaded video frame-by-frame through pose detection,
// extracts universal features, and returns a timeline of feature vectors.
// ---------------------------------------------
import { computeUniversalFeatures } from './universalFeatures.js';

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

  // Create offscreen canvas for pose detection
  const canvas = document.createElement('canvas');
  canvas.width = videoEl.videoWidth;
  canvas.height = videoEl.videoHeight;
  const ctx = canvas.getContext('2d');

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
      const poses = await detector.estimatePoses(videoEl);
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

  for (const { key } of candidates) {
    const result = _detectRepsForFeature(frames, key);
    if (result.reps.length > bestResult.reps.length) {
      bestResult = result;
      bestFeature = key;
    }
  }

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

  return { reps, signal: smoothed };
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
