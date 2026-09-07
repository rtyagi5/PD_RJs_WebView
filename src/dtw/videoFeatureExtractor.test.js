import { resolvePrimaryFeatureKey, mirrorTemplateSides } from './videoFeatureExtractor';
import { EXERCISE_CONFIGS, generateReference } from './specToReference';
import { computeFeatureRanges } from './referenceSchema';
import { DTWPhaseMachine } from './DTWPhaseMachine';

// The extractor used to choose which feature counts reps by ranking raw feature
// ranges. That is invalid across families, because the universal feature set
// mixes degrees with dimensionless ratios.
//
// Real failure it caused: a seated dorsiflexion clip where the demonstrator sits
// down, settles, and moves their arms. elbowAngleMin sweeps ~100 degrees; the
// actual exercise, footPitchNorm, sweeps 0.17. The elbow wins on magnitude, and
// phase labelling then fails outright with "cannot tell which end of
// elbowAngleMin is the rest posture for SeatedDorsiflexion" — which is the
// labeller correctly refusing to guess, on a feature it should never have been
// handed.

/** Frames where the arms move a lot and the foot moves a little, as when seated. */
function seatedDorsiflexionClip({ footSwing = 0.17, elbowSwing = 100 } = {}) {
  const frames = [];
  for (let i = 0; i < 120; i++) {
    const cycle = Math.sin((i / 120) * Math.PI * 6);
    frames.push({
      features: {
        footPitchNormL: 0.12 - footSwing * Math.max(0, cycle),
        footPitchNormR: 0.12,                       // far foot, barely tracked
        elbowAngleL: 90 + (elbowSwing / 2) * Math.sin(i / 9),
        elbowAngleR: 90 + (elbowSwing / 2) * Math.sin(i / 11),
        elbowAngleMin: 40 + (elbowSwing / 2) * Math.sin(i / 9),
        kneeAngleL: 95,
        shoulderAngleL: 20 + 30 * Math.sin(i / 7),
      },
    });
  }
  return frames;
}

describe('resolvePrimaryFeatureKey', () => {
  const frames = seatedDorsiflexionClip();

  it('picks the foot for a dorsiflexion clip where the arms move far more', () => {
    const key = resolvePrimaryFeatureKey(EXERCISE_CONFIGS.SeatedDorsiflexion, frames);
    expect(key).toBe('footPitchNormL');
  });

  it('picks the side that actually moved', () => {
    // Side-on, only the near foot is tracked well. The family is declared; which
    // side is exercised is not, and cannot be known before the clip is seen.
    const key = resolvePrimaryFeatureKey(EXERCISE_CONFIGS.SeatedDorsiflexion, frames);
    expect(key.endsWith('L')).toBe(true);
  });

  it('is not swayed by making the arms move even more', () => {
    // The whole point: no elbow range can outvote the declared family.
    const wild = seatedDorsiflexionClip({ elbowSwing: 100000 });
    expect(resolvePrimaryFeatureKey(EXERCISE_CONFIGS.SeatedDorsiflexion, wild))
      .toBe('footPitchNormL');
  });

  it('honours an exact primaryFeature pin over the family', () => {
    const cfg = EXERCISE_CONFIGS.MiniSquats;
    expect(cfg.primaryFeature).toBe('kneeAngleMin');
    const f = [{ features: { kneeAngleMin: 90, elbowAngleL: 10 } },
               { features: { kneeAngleMin: 160, elbowAngleL: 9000 } }];
    expect(resolvePrimaryFeatureKey(cfg, f)).toBe('kneeAngleMin');
  });

  it('resolves every foot exercise to its foot feature', () => {
    for (const name of ['CalfRaisesSeated', 'CalfRaisesStanding',
      'SeatedDorsiflexion', 'StandingDorsiflexion']) {
      const key = resolvePrimaryFeatureKey(EXERCISE_CONFIGS[name], frames);
      expect(`${name}:${key}`).toBe(`${name}:footPitchNormL`);
    }
  });

  it('falls back to the features the canonical template sweeps', () => {
    // An exercise with no explicit pin still must not be handed a feature its
    // own template says nothing about.
    const key = resolvePrimaryFeatureKey(EXERCISE_CONFIGS.SideArmRaise, frames);
    expect(key).toBe('shoulderAngleL');
  });

  it('returns null for a free-text name, so the old ranking still applies', () => {
    expect(resolvePrimaryFeatureKey(null, frames)).toBeNull();
    expect(resolvePrimaryFeatureKey(undefined, frames)).toBeNull();
  });

  it('returns null rather than a key the clip never produced', () => {
    // A clip with no foot keypoints at all must not claim footPitchNorm.
    const noFoot = [{ features: { elbowAngleL: 10 } }, { features: { elbowAngleL: 90 } }];
    expect(resolvePrimaryFeatureKey(EXERCISE_CONFIGS.SeatedDorsiflexion, noFoot)).toBeNull();
  });

  it('does not throw on an empty clip', () => {
    expect(resolvePrimaryFeatureKey(EXERCISE_CONFIGS.SeatedDorsiflexion, [])).toBeNull();
  });
});

// ─── Side mirroring ──────────────────────────────────────────────────────────
// A demonstrator records a one-sided exercise sitting one way round; a patient
// may sit the other way. The synthetic references have always been symmetric —
// specToReference mirrors every side-generic config value onto both sides — but
// the recorded path had no equivalent, so a right-sided recording gave a
// left-sided patient a flat template on their own side.
//
// Mirroring is exact rather than approximate: three-point angles do not change
// under reflection, and the normalized height features are differences in y,
// which a horizontal mirror leaves untouched.

/** A template where only one side moves, as in a side-on seated recording. */
function oneSidedTemplate({ active = 'R', span = 0.17, idleJitter = 0 } = {}) {
  const idle = active === 'R' ? 'L' : 'R';
  return Array.from({ length: 60 }, (_, t) => {
    const v = 0.12 - span * Math.max(0, Math.sin((t / 60) * Math.PI));
    return {
      frame: t,
      features: {
        [`footPitchNorm${active}`]: v,
        [`footPitchNorm${idle}`]: 0.12 + idleJitter * Math.sin(t / 3),
        footPitchNormAvg: (v + 0.12) / 2,
        [`kneeAngle${active}`]: 95 + 10 * Math.sin(t / 9),
        [`kneeAngle${idle}`]: 95,
        kneeAngleMin: 95,
      },
    };
  });
}

describe('mirrorTemplateSides', () => {
  it('copies the exercised side onto the idle one', () => {
    const tpl = oneSidedTemplate({ active: 'R' });
    const res = mirrorTemplateSides(tpl);

    expect(res.mirrored.map(m => m.base)).toContain('footPitchNorm');
    for (const f of tpl) {
      expect(f.features.footPitchNormL).toBe(f.features.footPitchNormR);
    }
  });

  it('gives the idle side a real range where it had none', () => {
    // The point of the exercise. Before mirroring the idle side is flat, and a
    // flat template range is what breaks the engine.
    const tpl = oneSidedTemplate({ active: 'R' });
    const spanOf = key => {
      const vals = tpl.map(f => f.features[key]).filter(Number.isFinite);
      return Math.max(...vals) - Math.min(...vals);
    };
    expect(spanOf('footPitchNormL')).toBeCloseTo(0, 5);
    mirrorTemplateSides(tpl);
    expect(spanOf('footPitchNormL')).toBeCloseTo(spanOf('footPitchNormR'), 5);
  });

  it('collapses the aggregates onto the same value', () => {
    // With both sides equal, min, max and average are all that same number.
    const tpl = oneSidedTemplate({ active: 'R' });
    mirrorTemplateSides(tpl);
    for (const f of tpl) {
      expect(f.features.footPitchNormAvg).toBe(f.features.footPitchNormR);
      expect(f.features.kneeAngleMin).toBe(f.features.kneeAngleR);
    }
  });

  it('works whichever side was recorded', () => {
    const tpl = oneSidedTemplate({ active: 'L' });
    const res = mirrorTemplateSides(tpl);
    expect(res.mirrored.find(m => m.base === 'footPitchNorm'))
      .toMatchObject({ from: 'footPitchNormL', to: 'footPitchNormR' });
  });

  it('leaves a genuinely two-sided recording alone', () => {
    // Overwriting real data would be worse than the problem being fixed.
    const tpl = Array.from({ length: 60 }, (_, t) => ({
      frame: t,
      features: {
        shoulderAngleL: 30 + 60 * Math.sin((t / 60) * Math.PI),
        shoulderAngleR: 32 + 58 * Math.sin((t / 60) * Math.PI),
      },
    }));
    const before = tpl.map(f => f.features.shoulderAngleR);
    const res = mirrorTemplateSides(tpl);
    expect(res.bilateral).toContain('shoulderAngle');
    expect(res.mirrored).toHaveLength(0);
    expect(tpl.map(f => f.features.shoulderAngleR)).toEqual(before);
  });

  it('treats a barely-moving idle side as idle, not as bilateral', () => {
    // The far foot in a side view is tracked, just badly — it jitters without
    // moving. That must not read as a two-sided recording.
    const tpl = oneSidedTemplate({ active: 'R', idleJitter: 0.01 });
    expect(mirrorTemplateSides(tpl).mirrored.map(m => m.base))
      .toContain('footPitchNorm');
  });

  it('does nothing when neither side moved', () => {
    const tpl = Array.from({ length: 30 }, () => ({
      features: { footPitchNormL: 0.12, footPitchNormR: 0.12 },
    }));
    const res = mirrorTemplateSides(tpl);
    expect(res.mirrored).toHaveLength(0);
    expect(res.bilateral).toHaveLength(0);
  });

  it('does not throw on an empty template', () => {
    expect(mirrorTemplateSides([])).toEqual({ mirrored: [], bilateral: [] });
    expect(mirrorTemplateSides(null)).toEqual({ mirrored: [], bilateral: [] });
  });
});

describe('the runtime failure mirroring prevents', () => {
  /** Minimal reference shaped like one the extractor would export. */
  function referenceFrom(template, name = 'SeatedDorsiflexion') {
    const cfg = EXERCISE_CONFIGS[name];
    return {
      ...generateReference(cfg),
      template: template.map((f, i) => ({ ...f, phase: i < 20 || i > 40 ? 'lowered' : 'raised' })),
      featureRanges: computeFeatureRanges(template),
    };
  }

  it('leaves the opposite-side patient with no primary feature at all', () => {
    // Worse than a small template range. The auto-picker takes the widest
    // feature in the pinned family with `range > bestRange`, starting from 0 —
    // and the unrecorded side's range is exactly 0, so nothing is ever
    // selected. primaryFeature comes out null, which switches off the direction
    // gate, the ROM gate and the return-to-start check together.
    //
    // The gate would be degenerate even if a feature were picked:
    // nearStartTolerance is set from the RAW template range with no floor,
    // unlike minRomForRep which romGate floors at 0.02.
    const unmirrored = referenceFrom(oneSidedTemplate({ active: 'R' }));
    const eng = new DTWPhaseMachine(unmirrored, { targetReps: 5, side: 'left' });

    expect(eng.primaryFeature).toBeNull();
    expect(eng.primaryFeatureRange).toBeCloseTo(0, 3);
    expect(eng.nearStartTolerance).toBeCloseTo(0, 3);
  });

  it('still resolves normally for the side that WAS recorded', () => {
    // Which is why this never showed up in testing: whoever records the
    // reference also tests it, on their own side.
    const unmirrored = referenceFrom(oneSidedTemplate({ active: 'R' }));
    const eng = new DTWPhaseMachine(unmirrored, { targetReps: 5, side: 'right' });
    expect(eng.primaryFeature).toBe('footPitchNormR');
    expect(eng.primaryFeatureRange).toBeGreaterThan(0.1);
  });

  it('gives that patient the same window as the recorded side once mirrored', () => {
    const tpl = oneSidedTemplate({ active: 'R' });
    mirrorTemplateSides(tpl);
    const mirrored = referenceFrom(tpl);

    const left = new DTWPhaseMachine(mirrored, { targetReps: 5, side: 'left' });
    const right = new DTWPhaseMachine(mirrored, { targetReps: 5, side: 'right' });

    expect(left.primaryFeature).toBe('footPitchNormL');
    expect(right.primaryFeature).toBe('footPitchNormR');
    expect(left.primaryFeatureRange).toBeCloseTo(right.primaryFeatureRange, 5);
    expect(left.nearStartTolerance).toBeCloseTo(right.nearStartTolerance, 5);
    expect(left.nearStartTolerance).toBeGreaterThan(0);
  });
});
