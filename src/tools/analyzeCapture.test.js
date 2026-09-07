import fs from 'fs';
import path from 'path';
import {
  parseCapture, keypointsOf, analyzeCapture, formatReport,
  median, quantile, mad, noiseFloor, signalSpan,
} from './analyzeCapture';

// ─── Synthetic capture construction ──────────────────────────────────────────
// A side-on seated dorsiflexion, built to the geometry the real thing has:
// shank 80 px, foot 52 px (65% of shank, which is what universalFeatures calls
// typical), and the toe lifting 8 px at full dorsiflexion. That gives
// footPitchNorm = -8/80 = -0.10, squarely inside the 0.05-0.15 the engine
// comments describe as a real signal — which is the whole problem, since it is
// an 8 pixel movement.

const SHANK_PX = 80;
const FOOT_PX = 52;
const TOE_LIFT_PX = 8;

/** Deterministic noise so the SNR assertions below cannot flake. */
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    // Two uniforms averaged: close enough to normal for a noise floor test,
    // and bounded, which a Box-Muller tail is not.
    const u = s / 4294967296;
    s = (s * 1664525 + 1013904223) >>> 0;
    return u + s / 4294967296 - 1;
  };
}

/**
 * @param {number} lift  toe rise in px (0 = flat, TOE_LIFT_PX = full dorsiflexion)
 * @param {number} jitter per-keypoint noise in px
 * @param {Function} rng
 * @param {Object} [opts] {chairLeg: true} smears the toe down a vertical edge
 */
function frameKeypoints(lift, jitter, rng, opts = {}) {
  const j = () => (jitter ? rng() * jitter : 0);
  const kneeY = 400;
  const ankleY = kneeY + SHANK_PX;
  const ankleX = 300;

  const toe = opts.chairLeg
    // MediaPipe latching onto a vertical chair edge: the toe slides far down the
    // line, blowing heel-toe span past the footValid ceiling of 0.9 x shank.
    ? { x: ankleX + 4 + j(), y: ankleY + SHANK_PX * 1.4 + j() }
    : { x: ankleX + FOOT_PX + j(), y: ankleY - lift + j() };

  return [
    { name: 'left_shoulder', x: ankleX - 4, y: 180, score: 0.9 },
    { name: 'right_shoulder', x: ankleX + 4, y: 180, score: 0.9 },
    { name: 'left_hip', x: ankleX - 4, y: 300, score: 0.9 },
    { name: 'right_hip', x: ankleX + 4, y: 300, score: 0.9 },
    { name: 'left_knee', x: ankleX + j(), y: kneeY + j(), score: 1.0 },
    { name: 'left_ankle', x: ankleX + j(), y: ankleY + j(), score: 1.0 },
    { name: 'left_heel', x: ankleX + j(), y: ankleY + j(), score: 1.0 },
    { name: 'left_foot_index', x: toe.x, y: toe.y, score: 1.0 },
  ];
}

/** 5 reps of dorsiflexion at 30 fps, roughly 1.6 s per rep. */
function syntheticCapture({ jitter = 0.4, reps = 5, chairLegFrames = 0, fps = 30 } = {}) {
  const rng = makeRng(20260907);
  const frameMs = 1000 / fps;
  const framesPerRep = Math.round(fps * 1.6);

  const lines = [JSON.stringify({
    schema: 'keypoints/1', exercise: 'SeatedDorsiflexion', side: 'left',
    detector: 'mediapipe', modelVariant: 'full', videoW: 1280, videoH: 720,
    confidenceIsSynthetic: true, liveRepCount: reps,
  })];

  let t = 0;
  let idx = 0;
  for (let r = 0; r < reps; r++) {
    for (let i = 0; i < framesPerRep; i++) {
      // Rest low, dorsiflex, hold, return - a full cycle with dwell at both ends.
      const phase = i / framesPerRep;
      const lift = TOE_LIFT_PX * Math.max(0, Math.sin(phase * Math.PI)) ** 0.7;
      const chairLeg = idx < chairLegFrames;
      const kp = frameKeypoints(lift, jitter, rng, { chairLeg })
        .map(k => [k.name, k.x, k.y, k.score]);
      lines.push(JSON.stringify({ t: Math.round(t), kp, feat: {} }));
      t += frameMs;
      idx++;
    }
  }
  return lines.join('\n');
}

// ─── Statistics ──────────────────────────────────────────────────────────────

describe('robust statistics', () => {
  it('ignores non-finite values rather than propagating NaN', () => {
    // Every foot feature is NaN whenever footValid rejects the frame, so a
    // statistic that poisons on NaN would report nothing for exactly the
    // captures worth analysing.
    expect(median([1, NaN, 3, undefined, 5])).toBe(3);
    expect(quantile([1, NaN, 2, 3, 4, 5], 0)).toBe(1);
    expect(signalSpan([NaN, 0, 10])).toBeCloseTo(9, 0);
  });

  it('reports the spread of the bulk, not of the outliers', () => {
    // A chair-leg latch throws values orders of magnitude out. A standard
    // deviation would report the glitch as the signal.
    const clean = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
    expect(mad(clean)).toBe(0);
    expect(mad([...clean, 1000])).toBe(0);
  });

  it('recovers a known noise level from frame-to-frame differences', () => {
    // The estimator has to work without rep segmentation, since a capture is
    // not labelled. It leans on successive differences of a smooth signal
    // being dominated by measurement noise.
    const rng = makeRng(7);
    const sigma = 0.05;
    const series = Array.from({ length: 600 }, () => rng() * sigma * 2);
    const est = noiseFloor(series);
    expect(est).toBeGreaterThan(sigma * 0.3);
    expect(est).toBeLessThan(sigma * 3);
  });

  it('refuses to guess a noise level from too few frames', () => {
    expect(noiseFloor([1, 2, 3])).toBeNaN();
  });

  it('separates a slow signal from fast noise', () => {
    // The point of the whole analysis: a small slow movement can still be
    // measurable if the noise is smaller than it.
    const slow = Array.from({ length: 300 }, (_, i) => Math.sin(i / 30));
    expect(signalSpan(slow) / noiseFloor(slow)).toBeGreaterThan(10);
  });
});

// ─── Parsing ─────────────────────────────────────────────────────────────────

describe('parseCapture', () => {
  it('splits the header from the frames', () => {
    const { header, frames } = parseCapture(syntheticCapture({ reps: 1 }));
    expect(header.exercise).toBe('SeatedDorsiflexion');
    expect(header.confidenceIsSynthetic).toBe(true);
    expect(frames.length).toBeGreaterThan(40);
    expect(frames[0].t).toBe(0);
  });

  it('tolerates a truncated final line', () => {
    // saveToDevServer only flushes on the completion path, so a cut-short
    // session is the realistic failure, not a corrupt middle.
    const text = syntheticCapture({ reps: 1 }) + '\n{"t":999,"kp":[["left_';
    expect(() => parseCapture(text)).not.toThrow();
  });

  it('rejects corruption in the middle, where truncation cannot explain it', () => {
    const lines = syntheticCapture({ reps: 1 }).split('\n');
    lines.splice(5, 0, '{"t":oops}');
    expect(() => parseCapture(lines.join('\n'))).toThrow(/corrupt frame/);
  });

  it('rebuilds engine-shaped keypoints from the compact rows', () => {
    const { frames } = parseCapture(syntheticCapture({ reps: 1 }));
    const kps = keypointsOf(frames[0]);
    const heel = kps.find(k => k.name === 'left_heel');
    expect(heel).toMatchObject({ name: 'left_heel' });
    expect(Number.isFinite(heel.x) && Number.isFinite(heel.y)).toBe(true);
  });
});

// ─── Analysis ────────────────────────────────────────────────────────────────

describe('analyzeCapture', () => {
  const report = analyzeCapture(parseCapture(syntheticCapture()));

  it('measures how many pixels wide the foot actually is', () => {
    // This is the number the zoom question turns on. Everything else is
    // downstream of it.
    expect(report.geometry.heelToeSpanPx.median).toBeCloseTo(FOOT_PX, 0);
    expect(report.geometry.shankPx.median).toBeCloseTo(SHANK_PX, 0);
    expect(report.geometry.spanOverShank.median).toBeCloseTo(FOOT_PX / SHANK_PX, 1);
  });

  it('measures the real frame rate from the timestamp gaps', () => {
    // The t values are elapsed milliseconds, deliberately not frame indices,
    // so this is the only place the on-device frame rate can be read.
    expect(report.fps.median).toBeCloseTo(30, 0);
    expect(report.fps.frames).toBeGreaterThan(200);
  });

  it('picks the side that was actually exercised', () => {
    // Only the left leg is in the synthetic frames; the right must not be
    // reported just because it sorts first.
    expect(report.activeSide).toBe('L');
  });

  it('scores every candidate feature on the same frames', () => {
    // The comparison is only fair because all three are recomputed from the
    // raw keypoints of identical frames, which is exactly what the .jsonl
    // makes possible and what the previous ankleAngleToe attempt lacked.
    expect(report.candidates.map(c => c.feature)).toEqual([
      'footPitchNormL', 'ankleAngleToeL', 'ankleAngleHeelL',
    ]);
    for (const c of report.candidates) {
      expect(Number.isFinite(c.noise)).toBe(true);
      expect(Number.isFinite(c.span)).toBe(true);
    }
  });

  it('recovers the dorsiflexion signal it was given', () => {
    const fp = report.candidates.find(c => c.feature === 'footPitchNormL');
    // 8 px of toe lift over an 80 px shank.
    expect(fp.span).toBeCloseTo(TOE_LIFT_PX / SHANK_PX, 1);
    expect(fp.snr).toBeGreaterThan(3);
  });

  it('reports a worse SNR when the same movement is noisier', () => {
    // The engine cannot tell these apart today. The analyser must.
    const quiet = analyzeCapture(parseCapture(syntheticCapture({ jitter: 0.2 })));
    const noisy = analyzeCapture(parseCapture(syntheticCapture({ jitter: 2.0 })));
    const snr = r => r.candidates.find(c => c.feature === 'footPitchNormL').snr;
    expect(snr(quiet)).toBeGreaterThan(snr(noisy));
  });

  it('counts frames lost to the chair-leg guard as a drop rate', () => {
    // footValid discards these, so they surface as NaN rather than as wild
    // values. Without a drop rate they would be invisible.
    const withLatch = analyzeCapture(parseCapture(
      syntheticCapture({ chairLegFrames: 60 })
    ));
    const fp = withLatch.candidates.find(c => c.feature === 'footPitchNormL');
    expect(fp.dropRate).toBeGreaterThan(0.1);
    expect(report.candidates.find(c => c.feature === 'footPitchNormL').dropRate)
      .toBeLessThan(0.05);
  });

  it('formats a report that names the best candidate', () => {
    const text = formatReport(report);
    expect(text).toContain('SeatedDorsiflexion');
    expect(text).toContain('confidence is synthetic');
    expect(text).toMatch(/best: (footPitchNormL|ankleAngleToeL|ankleAngleHeelL)/);
  });
});

// ─── Real captures ───────────────────────────────────────────────────────────
// Prints a report for every .jsonl in captures/. Nothing to assert - the
// numbers are the deliverable - but running it here means the analyser is
// exercised against real data by `yarn test:ci`, with no separate runner and no
// Babel workaround.

describe('captures/', () => {
  const dir = path.resolve(__dirname, '../../captures');
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'))
    : [];

  it('reports on any captures present', () => {
    if (files.length === 0) {
      console.log(
        '[analyzeCapture] No captures yet. Set REACT_APP_ALLOW_SKELETON_RECORDING=true, ' +
        'run an exercise through the dev server, and complete it - the flush only ' +
        'happens on the completion path.'
      );
      return;
    }
    for (const f of files) {
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      console.log(`\n=== ${f} ===\n${formatReport(analyzeCapture(parseCapture(text)))}\n`);
    }
    expect(files.length).toBeGreaterThan(0);
  });
});
