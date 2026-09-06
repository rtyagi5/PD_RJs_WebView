import {
  computeUniversalFeatures,
  UNIVERSAL_FEATURE_KEYS,
  BODY_PART_FEATURE_MAP,
} from './universalFeatures';

const S = 0.9; // confident by default (present() needs > 0.3)

const kp = (name, x, y, score = S) => ({ name, x, y, score });

/**
 * A neutral standing pose in image coordinates (y grows downward).
 * Arms hang straight down, legs straight, trunk vertical.
 */
function standingPose(overrides = {}) {
  const base = {
    nose: [100, 0],
    left_shoulder: [80, 50], right_shoulder: [120, 50],
    left_elbow: [80, 100], right_elbow: [120, 100],
    left_wrist: [80, 150], right_wrist: [120, 150],
    left_hip: [85, 150], right_hip: [115, 150],
    left_knee: [85, 250], right_knee: [115, 250],
    left_ankle: [85, 350], right_ankle: [115, 350],
    ...overrides,
  };
  return Object.entries(base).map(([name, v]) =>
    kp(name, v[0], v[1], v.length > 2 ? v[2] : S));
}

describe('feature surface', () => {
  it('returns exactly the documented key set', () => {
    const f = computeUniversalFeatures(standingPose());
    expect(Object.keys(f).sort()).toEqual([...UNIVERSAL_FEATURE_KEYS].sort());
  });

  it('maps every body part to features that actually exist', () => {
    const all = new Set(UNIVERSAL_FEATURE_KEYS);
    for (const [part, keys] of Object.entries(BODY_PART_FEATURE_MAP)) {
      for (const k of keys) {
        expect(`${part}:${k}:${all.has(k)}`).toBe(`${part}:${k}:true`);
      }
    }
  });
});

describe('joint angle geometry', () => {
  it('reads a straight arm as ~180° at the elbow', () => {
    const f = computeUniversalFeatures(standingPose());
    expect(f.elbowAngleL).toBeCloseTo(180, 0);
  });

  it('reads a right-angled elbow as ~90°', () => {
    // Forearm horizontal: wrist level with elbow, displaced sideways.
    const f = computeUniversalFeatures(standingPose({ left_wrist: [30, 100] }));
    expect(f.elbowAngleL).toBeCloseTo(90, 0);
  });

  it('reads a straight leg as ~180° at the knee', () => {
    const f = computeUniversalFeatures(standingPose());
    expect(f.kneeAngleL).toBeCloseTo(180, 0);
    expect(f.kneeAngleR).toBeCloseTo(180, 0);
  });

  it('reads a bent knee as a smaller angle', () => {
    const bent = computeUniversalFeatures(standingPose({ left_ankle: [180, 250] }));
    expect(bent.kneeAngleL).toBeLessThan(120);
  });

  it('reads an arm raised to shoulder height as ~90° at the shoulder', () => {
    // Hip placed directly below the shoulder so the torso vector is exactly
    // vertical; elbow straight out to the side → hip-shoulder-elbow = 90°.
    const f = computeUniversalFeatures(standingPose({
      left_hip: [80, 150], left_elbow: [20, 50], left_wrist: [-30, 50],
    }));
    expect(f.shoulderAngleL).toBeCloseTo(90, 0);
  });

  it('computes angles independently per side', () => {
    const f = computeUniversalFeatures(standingPose({ left_wrist: [30, 100] }));
    expect(f.elbowAngleL).toBeCloseTo(90, 0);
    expect(f.elbowAngleR).toBeCloseTo(180, 0);
  });
});

describe('graceful degradation', () => {
  it('returns NaN for a feature whose keypoints are missing', () => {
    const pose = standingPose().filter(k => k.name !== 'left_wrist');
    const f = computeUniversalFeatures(pose);
    expect(f.elbowAngleL).toBeNaN();
    // The other side is unaffected.
    expect(f.elbowAngleR).toBeCloseTo(180, 0);
  });

  it('treats low-confidence keypoints as absent', () => {
    const f = computeUniversalFeatures(standingPose({ left_wrist: [80, 150, 0.05] }));
    expect(f.elbowAngleL).toBeNaN();
  });

  it('does not throw on an empty keypoint list', () => {
    expect(() => computeUniversalFeatures([])).not.toThrow();
  });

  it('returns all-NaN for an empty keypoint list', () => {
    const f = computeUniversalFeatures([]);
    expect(Object.values(f).every(v => Number.isNaN(v))).toBe(true);
  });

  it('yields NaN foot features for MoveNet (no heel/toe keypoints)', () => {
    const f = computeUniversalFeatures(standingPose());
    expect(f.footPitchNormL).toBeNaN();
    expect(f.ankleAngleToeL).toBeNaN();
  });
});

describe('aggregates', () => {
  it('takes the smaller of the two sides for a Min aggregate', () => {
    const f = computeUniversalFeatures(standingPose({ left_ankle: [180, 250] }));
    expect(f.kneeAngleMin).toBeCloseTo(Math.min(f.kneeAngleL, f.kneeAngleR), 5);
  });

  it('falls back to the visible side when the other is missing', () => {
    const pose = standingPose().filter(k => k.name !== 'left_knee');
    const f = computeUniversalFeatures(pose);
    expect(f.kneeAngleL).toBeNaN();
    expect(f.kneeAngleMin).toBeCloseTo(f.kneeAngleR, 5);
  });

  it('takes the larger of the two sides for a Max aggregate', () => {
    // kneeLiftNorm only becomes positive once the knee rises ABOVE hip level
    // (smaller y in image coordinates); hip y is 150 here.
    const f = computeUniversalFeatures(standingPose({ left_knee: [85, 120] }));
    expect(f.kneeLiftNormMax).toBeCloseTo(Math.max(f.kneeLiftNormL, f.kneeLiftNormR), 5);
    expect(f.kneeLiftNormMax).toBeGreaterThan(0);
  });
});

describe('normalised measures', () => {
  it('reports zero knee lift at rest', () => {
    const f = computeUniversalFeatures(standingPose());
    expect(f.kneeLiftNormL).toBe(0);
  });

  it('stays clamped at zero while the knee is still below the hip', () => {
    const f = computeUniversalFeatures(standingPose({ left_knee: [85, 220] }));
    expect(f.kneeLiftNormL).toBe(0);
  });

  it('increases knee lift as the knee rises past the hip', () => {
    // Hip y = 150; a rising knee means a decreasing y.
    const low = computeUniversalFeatures(standingPose({ left_knee: [85, 140] }));
    const high = computeUniversalFeatures(standingPose({ left_knee: [85, 100] }));
    expect(low.kneeLiftNormL).toBeGreaterThan(0);
    expect(high.kneeLiftNormL).toBeGreaterThan(low.kneeLiftNormL);
  });

  it('reports wrist height relative to the torso, rising as hands lift', () => {
    const down = computeUniversalFeatures(standingPose());
    const up = computeUniversalFeatures(standingPose({ left_wrist: [80, 40] }));
    expect(up.wristHeightNormL).toBeGreaterThan(down.wristHeightNormL);
  });

  it('is scale invariant — the same pose at 2x size gives the same normalised value', () => {
    // Small: hip 150, knee 100, ankle 350 → lift 50 / hipAnkleLen 200 = 0.25
    const small = computeUniversalFeatures(standingPose({ left_knee: [85, 100] }));
    // Same pose with every coordinate doubled → identical normalised value.
    const bigPose = standingPose({ left_knee: [85, 100] })
      .map(k => kp(k.name, k.x * 2, k.y * 2));
    const big = computeUniversalFeatures(bigPose);
    expect(small.kneeLiftNormL).toBeGreaterThan(0);
    expect(big.kneeLiftNormL).toBeCloseTo(small.kneeLiftNormL, 5);
  });
});

describe('foot keypoint sanity check (MediaPipe chair-leg guard)', () => {
  // Shank length here is 100px (knee y=250 → ankle y=350), so a plausible foot
  // span is under 90px; anything longer means the model latched onto background.
  const withFeet = (heel, toe) => standingPose({
    left_heel: heel, left_foot_index: toe,
  });

  it('computes foot features for a plausible foot', () => {
    const f = computeUniversalFeatures(withFeet([80, 355], [120, 355]));
    expect(f.footPitchNormL).not.toBeNaN();
    expect(f.ankleAngleToeL).not.toBeNaN();
  });

  it('rejects a heel-to-toe span longer than 90% of the shank', () => {
    // 150px span vs a 100px shank — impossible for a real foot.
    const f = computeUniversalFeatures(withFeet([50, 355], [200, 355]));
    expect(f.footPitchNormL).toBeNaN();
    expect(f.ankleAngleToeL).toBeNaN();
  });

  it('reports positive foot pitch when the heel lifts above the toe (calf raise)', () => {
    // Heel higher on screen = smaller y. footPitchNorm = (toe.y - heel.y)/shank.
    const flat = computeUniversalFeatures(withFeet([80, 355], [120, 355]));
    const raised = computeUniversalFeatures(withFeet([80, 330], [120, 355]));
    expect(flat.footPitchNormL).toBeCloseTo(0, 5);
    expect(raised.footPitchNormL).toBeGreaterThan(0);
  });

  it('reports negative foot pitch when the toe lifts (dorsiflexion)', () => {
    const dorsi = computeUniversalFeatures(withFeet([80, 355], [120, 330]));
    expect(dorsi.footPitchNormL).toBeLessThan(0);
  });
});
