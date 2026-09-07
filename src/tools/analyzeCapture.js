// ---------------------------------------------
// tools/analyzeCapture.js
// Turns a WI-1 keypoint .jsonl into numbers, so the foot exercises stop being
// argued about and start being measured.
//
// The question this exists to answer: footPitchNorm is a vertical difference
// between heel and foot_index normalised by shank. Both models resize their own
// person-ROI before inference (MoveNet to 192x192, BlazePose to 256x256), so
// the foot is a fixed and small fraction of the model input no matter how close
// the patient stands. That makes a real dorsiflexion roughly a 3-10 pixel
// difference between the two least reliable landmarks in the model. Whether
// that is usable is an empirical question, and the capture files answer it.
//
// It also gives the never-tried candidates a fair hearing. The .jsonl stores
// RAW keypoints, so footPitchNorm, ankleAngleToe and ankleAngleHeel can all be
// recomputed from the SAME frames and compared directly. ankleAngleToe was
// tried once before and reverted on guessed template values; this compares them
// on measured ones.
//
// Lives under src/ because CRA's testMatch only looks there, and the engine is
// ESM under CRA's Babel — a bare `node tools/*.js` cannot import it.
// ---------------------------------------------

import { computeUniversalFeatures } from '../dtw/universalFeatures.js';

/** Features worth comparing for the foot exercises, per side. */
export const FOOT_CANDIDATES = ['footPitchNorm', 'ankleAngleToe', 'ankleAngleHeel'];

// ── Parsing ──────────────────────────────────────────────────────────────────

/**
 * Parse a .jsonl capture. Line 1 is the header; the rest are frames.
 * Tolerates a truncated trailing line, which is what an interrupted flush
 * leaves behind.
 *
 * @param {string} text
 * @returns {{ header: Object, frames: Array<{t:number, kp:Array, feat:Object}> }}
 */
export function parseCapture(text) {
  const lines = String(text).split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) throw new Error('empty capture');

  let header;
  try {
    header = JSON.parse(lines[0]);
  } catch (e) {
    throw new Error(`capture header is not valid JSON: ${e.message}`);
  }

  const frames = [];
  for (let i = 1; i < lines.length; i++) {
    try {
      frames.push(JSON.parse(lines[i]));
    } catch {
      // A partial last line is expected when a session was cut short.
      if (i !== lines.length - 1) throw new Error(`corrupt frame at line ${i + 1}`);
    }
  }
  return { header, frames };
}

/** Rebuild the keypoint objects the engine expects from the compact [n,x,y,s] rows. */
export function keypointsOf(frame) {
  return (frame.kp || []).map(([name, x, y, score]) => ({ name, x, y, score }));
}

// ── Robust statistics ────────────────────────────────────────────────────────
// Robust throughout because a chair-leg latch produces enormous outliers, and a
// mean or a plain standard deviation would report those instead of the movement.

const finite = xs => xs.filter(Number.isFinite);

export function median(xs) {
  const v = finite(xs).slice().sort((a, b) => a - b);
  if (!v.length) return NaN;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function quantile(xs, q) {
  const v = finite(xs).slice().sort((a, b) => a - b);
  if (!v.length) return NaN;
  const pos = (v.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? v[lo] : v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

/** Median absolute deviation, scaled to be comparable to a standard deviation. */
export function mad(xs) {
  const med = median(xs);
  if (!Number.isFinite(med)) return NaN;
  return 1.4826 * median(finite(xs).map(x => Math.abs(x - med)));
}

/**
 * Frame-to-frame noise of a slow signal, without needing rep segmentation.
 *
 * For a smooth signal sampled fast relative to the movement, successive
 * differences are dominated by measurement noise. If that noise is independent
 * per frame with deviation sigma, the differences have deviation sigma*sqrt(2).
 * Using MAD rather than a standard deviation keeps a handful of tracking
 * glitches from being reported as the noise floor.
 */
export function noiseFloor(series) {
  const diffs = [];
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1];
    const b = series[i];
    if (Number.isFinite(a) && Number.isFinite(b)) diffs.push(b - a);
  }
  if (diffs.length < 8) return NaN;
  return mad(diffs) / Math.SQRT2;
}

/** Robust peak-to-peak: the p5..p95 span, so one bad frame is not "the signal". */
export function signalSpan(series) {
  const hi = quantile(series, 0.95);
  const lo = quantile(series, 0.05);
  return Number.isFinite(hi) && Number.isFinite(lo) ? hi - lo : NaN;
}

// ── Analysis ─────────────────────────────────────────────────────────────────

/**
 * @param {{header:Object, frames:Array}} capture
 * @returns {Object} report
 */
export function analyzeCapture(capture) {
  const { header, frames } = capture;

  // --- Frame rate. The t gaps are real elapsed milliseconds, deliberately not
  // frame indices, so this is the first honest on-device fps measurement — and
  // the thing that decides whether a higher capture resolution costs anything.
  const gaps = [];
  for (let i = 1; i < frames.length; i++) {
    const d = frames[i].t - frames[i - 1].t;
    if (Number.isFinite(d) && d > 0) gaps.push(d);
  }
  const medianGap = median(gaps);
  const slowGap = quantile(gaps, 0.95);
  const fps = {
    frames: frames.length,
    medianMs: medianGap,
    median: Number.isFinite(medianGap) ? 1000 / medianGap : NaN,
    p05: Number.isFinite(slowGap) ? 1000 / slowGap : NaN,
    worstGapMs: gaps.length ? Math.max(...gaps) : NaN,
  };

  // --- Recompute every candidate from the raw keypoints, so all of them are
  // measured on identical frames and the comparison is like-for-like.
  const series = {};
  for (const base of FOOT_CANDIDATES) {
    for (const side of ['L', 'R']) series[base + side] = [];
  }
  const geom = {
    L: { span: [], shank: [], ratio: [] },
    R: { span: [], shank: [], ratio: [] },
  };

  const dist = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : NaN);

  for (const f of frames) {
    const kps = keypointsOf(f);
    const byName = Object.fromEntries(kps.map(k => [k.name, k]));
    const feats = computeUniversalFeatures(kps);

    for (const base of FOOT_CANDIDATES) {
      for (const side of ['L', 'R']) series[base + side].push(feats[base + side]);
    }

    for (const [side, pfx] of [['L', 'left'], ['R', 'right']]) {
      const span = dist(byName[`${pfx}_heel`], byName[`${pfx}_foot_index`]);
      const shank = dist(byName[`${pfx}_knee`], byName[`${pfx}_ankle`]);
      geom[side].span.push(span);
      geom[side].shank.push(shank);
      geom[side].ratio.push(Number.isFinite(span) && shank > 0 ? span / shank : NaN);
    }
  }

  // --- Which side was actually exercised: the one with the most usable frames.
  const usable = side => series[`footPitchNorm${side}`].filter(Number.isFinite).length;
  const activeSide = usable('L') >= usable('R') ? 'L' : 'R';

  const candidates = FOOT_CANDIDATES.map(base => {
    const s = series[base + activeSide];
    const valid = s.filter(Number.isFinite).length;
    const noise = noiseFloor(s);
    const span = signalSpan(s);
    return {
      feature: base + activeSide,
      valid,
      dropRate: frames.length ? 1 - valid / frames.length : NaN,
      noise,
      span,
      // The number that decides everything: how many noise widths of real
      // movement there are. Below ~5 the feature cannot support a ROM claim.
      snr: Number.isFinite(noise) && noise > 0 ? span / noise : NaN,
    };
  });

  const g = geom[activeSide];
  return {
    exercise: header.exercise,
    side: header.side,
    detector: header.detector,
    modelVariant: header.modelVariant,
    resolution: `${header.videoW}x${header.videoH}`,
    confidenceIsSynthetic: !!header.confidenceIsSynthetic,
    liveRepCount: header.liveRepCount,
    activeSide,
    fps,
    geometry: {
      // The heart of the zoom question: how many pixels wide the foot actually is.
      heelToeSpanPx: { median: median(g.span), min: quantile(g.span, 0.05) },
      shankPx: { median: median(g.shank) },
      spanOverShank: { median: median(g.ratio), max: quantile(g.ratio, 0.95) },
    },
    candidates,
  };
}

// ── Reporting ────────────────────────────────────────────────────────────────

const n = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '-');

export function formatReport(r) {
  const lines = [];
  lines.push(`${r.exercise}  (side=${r.side}, active=${r.activeSide})`);
  lines.push(`  ${r.detector}/${r.modelVariant} at ${r.resolution}` +
    (r.confidenceIsSynthetic ? '   [confidence is synthetic - scores are not real]' : ''));
  lines.push(`  frames=${r.fps.frames}  fps median=${n(r.fps.median, 1)}` +
    `  5th pct=${n(r.fps.p05, 1)}  worst gap=${n(r.fps.worstGapMs, 0)}ms`);
  lines.push(`  reps counted live: ${r.liveRepCount ?? '-'}`);
  lines.push('');
  lines.push(`  foot size    heel-toe ${n(r.geometry.heelToeSpanPx.median, 1)} px` +
    `  (min ${n(r.geometry.heelToeSpanPx.min, 1)})` +
    `   shank ${n(r.geometry.shankPx.median, 1)} px` +
    `   span/shank ${n(r.geometry.spanOverShank.median)}`);
  lines.push('');
  lines.push('  feature              valid   drop    noise      signal      SNR');
  for (const c of r.candidates) {
    lines.push(
      `  ${c.feature.padEnd(20)} ${String(c.valid).padStart(5)}` +
      ` ${(n(c.dropRate * 100, 0) + '%').padStart(6)}` +
      ` ${n(c.noise, 4).padStart(9)}` +
      ` ${n(c.span, 4).padStart(11)}` +
      ` ${n(c.snr, 1).padStart(8)}`
    );
  }
  const best = r.candidates
    .filter(c => Number.isFinite(c.snr))
    .sort((a, b) => b.snr - a.snr)[0];
  lines.push('');
  lines.push(best
    ? `  best: ${best.feature} at SNR ${n(best.snr, 1)}`
    : '  best: none - no candidate produced a usable signal');
  return lines.join('\n');
}
