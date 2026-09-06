// Behavioural tests for the rep-counting state machine: the ROM/direction gate,
// the safety-cap feedback that regressed, per-rep ROM summaries, and the
// jitter defences that were added in response to live bugs.
import { DTWPhaseMachine } from './DTWPhaseMachine';
import { generateReference, EXERCISE_CONFIGS } from './specToReference';

const FRAME_MS = 33; // ~30fps

/** Drive the machine through a scripted series of primary-feature values. */
function drive(engine, values, { startT = 1000, frameMs = FRAME_MS, feature, extra = {} } = {}) {
  const results = [];
  let t = startT;
  for (const v of values) {
    results.push(engine.step({
      t,
      now: t,
      features: { [feature]: v, ...extra },
      say: () => {},
      setHighlight: () => {},
    }));
    t += frameMs;
  }
  return results;
}

/** Interpolate `steps` values from a→b (inclusive), so motion looks continuous. */
function ramp(a, b, steps) {
  return Array.from({ length: steps }, (_, i) => a + (b - a) * (i / (steps - 1)));
}

/** Hold a value for n frames. */
const hold = (v, n) => Array(n).fill(v);

/** One SideArmRaise rep: 30° → 90° → 30°, slow enough to clear dwell/velocity gates. */
function armRaiseRep() {
  return [...hold(30, 8), ...ramp(30, 90, 12), ...hold(90, 8), ...ramp(90, 30, 12), ...hold(30, 8)];
}

function makeArmRaiseEngine(opts = {}) {
  const ref = generateReference(EXERCISE_CONFIGS.SideArmRaise);
  return new DTWPhaseMachine(ref, { targetReps: 10, side: 'left', ...opts });
}

describe('primary feature selection', () => {
  it('picks the widest-range feature on the active side', () => {
    const eng = makeArmRaiseEngine();
    expect(eng.primaryFeature).toBe('shoulderAngleL');
  });

  it('never picks the inactive side', () => {
    const eng = makeArmRaiseEngine({ side: 'right' });
    expect(eng.primaryFeature.endsWith('L')).toBe(false);
  });

  it('honours an explicit primaryFeature override', () => {
    const ref = generateReference(EXERCISE_CONFIGS.MiniSquats);
    const eng = new DTWPhaseMachine(ref, { targetReps: 5, side: 'left' });
    expect(eng.primaryFeature).toBe('kneeAngleMin');
  });

  it('derives the rep ROM gate from minRomPct × template range', () => {
    const eng = makeArmRaiseEngine();
    // SideArmRaise sweeps 30→90 (range 60) with the default 0.25 minRomPct.
    expect(eng.primaryFeatureRange).toBeCloseTo(60, 0);
    expect(eng.minRomForRep).toBeCloseTo(15, 0);
  });
});

describe('rep counting', () => {
  it('counts a full rep', () => {
    const eng = makeArmRaiseEngine();
    const out = drive(eng, armRaiseRep(), { feature: 'shoulderAngleL' });
    expect(eng.repCount).toBe(1);
    expect(out.filter(r => r.repDelta > 0)).toHaveLength(1);
  });

  it('does not count a movement below the ROM gate', () => {
    const eng = makeArmRaiseEngine();
    // Only a 10° excursion — under the 15° gate.
    drive(eng, [...hold(30, 8), ...ramp(30, 40, 10), ...hold(40, 5), ...ramp(40, 30, 10), ...hold(30, 8)],
      { feature: 'shoulderAngleL' });
    expect(eng.repCount).toBe(0);
  });

  it('does not count while the limb stays away from the start position', () => {
    const eng = makeArmRaiseEngine();
    // Raises and holds at the top — never returns, so no rep completes.
    drive(eng, [...hold(30, 8), ...ramp(30, 90, 12), ...hold(90, 40)], { feature: 'shoulderAngleL' });
    expect(eng.repCount).toBe(0);
  });

  it('counts several consecutive reps', () => {
    const eng = makeArmRaiseEngine();
    drive(eng, [...armRaiseRep(), ...armRaiseRep(), ...armRaiseRep()], { feature: 'shoulderAngleL' });
    expect(eng.repCount).toBe(3);
  });

  it('reports done once the target rep count is reached', () => {
    const eng = makeArmRaiseEngine({ targetReps: 2 });
    const out = drive(eng, [...armRaiseRep(), ...armRaiseRep()], { feature: 'shoulderAngleL' });
    expect(out[out.length - 1].done).toBe(true);
  });

  it('rejects motion in the wrong direction (calf-raise vs dorsiflexion guard)', () => {
    // CalfRaisesSeated expects footPitchNorm to INCREASE. Dorsiflexing moves it the
    // other way and must not register, no matter how large the excursion.
    const ref = generateReference(EXERCISE_CONFIGS.CalfRaisesSeated);
    const eng = new DTWPhaseMachine(ref, { targetReps: 5, side: 'left' });
    expect(eng.templateDirection).toBe(1);

    const wrongWay = [...hold(0, 8), ...ramp(0, -0.3, 12), ...hold(-0.3, 8), ...ramp(-0.3, 0, 12), ...hold(0, 8)];
    drive(eng, wrongWay, { feature: eng.primaryFeature });
    expect(eng.repCount).toBe(0);
  });
});

describe('jitter and noise defences', () => {
  it('masks single-frame jumps larger than 20°', () => {
    const eng = makeArmRaiseEngine();
    // A one-frame 60° spike back and forth should not advance the cycle.
    drive(eng, [...hold(30, 10), 95, 30, 95, 30, ...hold(30, 10)], { feature: 'shoulderAngleL' });
    expect(eng.repCount).toBe(0);
  });

  it('requires sustained movement before entering the effort phase', () => {
    const eng = makeArmRaiseEngine();
    // Move up within the velocity limit but drop back before the 100ms hysteresis.
    drive(eng, [...hold(30, 10), 48, 30, 48, 30], { feature: 'shoulderAngleL', frameMs: 20 });
    expect(eng.cycleState).not.toBe('sawEffort');
  });

  it('enforces the refractory period between reps', () => {
    const eng = makeArmRaiseEngine();
    // Two reps back-to-back with no pause; the 300ms refractory should absorb the
    // second one rather than letting it fire immediately.
    const fast = [...hold(30, 4), ...ramp(30, 90, 4), ...hold(90, 2), ...ramp(90, 30, 4)];
    drive(eng, [...fast, ...fast], { feature: 'shoulderAngleL', frameMs: 10 });
    expect(eng.repCount).toBeLessThanOrEqual(1);
  });
});

describe('clinical safety caps (the "raised too high" regression)', () => {
  it('exposes resolved caps for the active side only', () => {
    const eng = makeArmRaiseEngine();
    const keys = eng.clinicalCaps.map(c => c.key);
    expect(keys).toContain('shoulderAngleL');
    expect(keys).not.toContain('shoulderAngleR');
  });

  it('flags a value above the cap', () => {
    const eng = makeArmRaiseEngine();
    expect(eng._exceedsClinicalCap({ shoulderAngleL: 110 })).toBe(true);
  });

  it('does not flag a correct rep at the 90° target', () => {
    const eng = makeArmRaiseEngine();
    expect(eng._exceedsClinicalCap({ shoulderAngleL: 90 })).toBe(false);
  });

  it('ignores NaN (missing keypoints) rather than flagging them', () => {
    const eng = makeArmRaiseEngine();
    expect(eng._exceedsClinicalCap({ shoulderAngleL: NaN })).toBe(false);
  });

  it('surfaces the tooMuch message when the patient overshoots', () => {
    const eng = makeArmRaiseEngine();
    const out = drive(eng, [...hold(30, 8), ...ramp(30, 120, 16), ...hold(120, 6)],
      { feature: 'shoulderAngleL' });
    expect(out[out.length - 1].feedback).toBe(EXERCISE_CONFIGS.SideArmRaise.feedback.range.tooMuch);
  });

  it('lets the safety warning pre-empt the post-rep number announcement', () => {
    const eng = makeArmRaiseEngine();
    // Complete a rep, then immediately overshoot — the warning must win over "1".
    const out = drive(eng, [...armRaiseRep(), ...ramp(30, 130, 10), ...hold(130, 3)],
      { feature: 'shoulderAngleL' });
    expect(eng.repCount).toBe(1);
    expect(out[out.length - 1].feedback).toBe(EXERCISE_CONFIGS.SideArmRaise.feedback.range.tooMuch);
  });

  it('honours a negative-direction cap (dorsiflexion uses min, not max)', () => {
    const ref = generateReference(EXERCISE_CONFIGS.SeatedDorsiflexion);
    const eng = new DTWPhaseMachine(ref, { targetReps: 5, side: 'left' });
    expect(eng._exceedsClinicalCap({ footPitchNormL: -0.2 })).toBe(true);
    expect(eng._exceedsClinicalCap({ footPitchNormL: -0.05 })).toBe(false);
  });

  it('defines a tooMuch message for every exercise', () => {
    for (const [name, cfg] of Object.entries(EXERCISE_CONFIGS)) {
      expect(`${name}:${!!cfg.feedback?.range?.tooMuch}`).toBe(`${name}:true`);
    }
  });

  it('defines clinical caps for every exercise', () => {
    for (const [name, cfg] of Object.entries(EXERCISE_CONFIGS)) {
      expect(`${name}:${!!cfg.clinicalCaps}`).toBe(`${name}:true`);
    }
  });
});

describe('per-rep ROM summary', () => {
  it('emits a summary only on the frame a rep is counted', () => {
    const eng = makeArmRaiseEngine({ summaryFeatures: ['shoulderAngleL', 'elbowAngleL'] });
    const out = drive(eng, armRaiseRep(), {
      feature: 'shoulderAngleL',
      extra: { elbowAngleL: 165 },
    });
    const withSummary = out.filter(r => r.repSummary);
    expect(withSummary).toHaveLength(1);
    expect(withSummary[0].repSummary.rep).toBe(1);
  });

  it('captures the true min/max the patient reached during the rep', () => {
    const eng = makeArmRaiseEngine({ summaryFeatures: ['shoulderAngleL'] });
    const out = drive(eng, armRaiseRep(), { feature: 'shoulderAngleL' });
    const { features } = out.find(r => r.repSummary).repSummary;
    expect(features.shoulderAngleL.max).toBeGreaterThanOrEqual(85);
    expect(features.shoulderAngleL.max).toBeLessThanOrEqual(90);
    expect(features.shoulderAngleL.min).toBeLessThanOrEqual(45);
  });

  it('reports nothing when no summary features are configured', () => {
    const eng = makeArmRaiseEngine({ summaryFeatures: [] });
    const out = drive(eng, armRaiseRep(), { feature: 'shoulderAngleL' });
    expect(out.every(r => r.repSummary == null)).toBe(true);
  });

  it('skips features that never produced a finite value', () => {
    const eng = makeArmRaiseEngine({ summaryFeatures: ['shoulderAngleL', 'elbowAngleL'] });
    const out = drive(eng, armRaiseRep(), {
      feature: 'shoulderAngleL',
      extra: { elbowAngleL: NaN },
    });
    const { features } = out.find(r => r.repSummary).repSummary;
    expect(features.shoulderAngleL).toBeDefined();
    expect(features.elbowAngleL).toBeUndefined();
  });
});

describe('alternating-side guardrail', () => {
  it('requires the legs to alternate', () => {
    const ref = generateReference(EXERCISE_CONFIGS.StandingMarch);
    const eng = new DTWPhaseMachine(ref, { targetReps: 10, side: 'left' });
    eng.lastActiveSide = 'left';
    eng.activeSideDuringCycle = 'left';
    expect(eng._alternatingSideOk()).toBe(false);
    eng.activeSideDuringCycle = 'right';
    expect(eng._alternatingSideOk()).toBe(true);
  });

  it('gives the benefit of the doubt on the first rep or when side is unknown', () => {
    const ref = generateReference(EXERCISE_CONFIGS.StandingMarch);
    const eng = new DTWPhaseMachine(ref, { targetReps: 10, side: 'left' });
    eng.activeSideDuringCycle = null;
    expect(eng._alternatingSideOk()).toBe(true);
    eng.activeSideDuringCycle = 'left';
    eng.lastActiveSide = null;
    expect(eng._alternatingSideOk()).toBe(true);
  });

  it('always passes for non-alternating exercises', () => {
    const eng = makeArmRaiseEngine();
    expect(eng._alternatingSideOk()).toBe(true);
  });
});

describe('near-start guard', () => {
  it('accepts a value within the ROM tolerance of the start', () => {
    const eng = makeArmRaiseEngine();
    expect(eng._primaryFeatureNearStart({ shoulderAngleL: 32 })).toBe(true);
  });

  it('rejects a value still mid-range', () => {
    const eng = makeArmRaiseEngine();
    expect(eng._primaryFeatureNearStart({ shoulderAngleL: 70 })).toBe(false);
  });

  it('gives the benefit of the doubt when the feature is missing', () => {
    const eng = makeArmRaiseEngine();
    expect(eng._primaryFeatureNearStart({ shoulderAngleL: NaN })).toBe(true);
  });
});

describe('time mode', () => {
  it('accumulates hold time instead of counting reps', () => {
    const ref = generateReference(EXERCISE_CONFIGS.StandingStraightUp);
    const eng = new DTWPhaseMachine(ref, { targetSeconds: 5 });
    expect(eng.mode).toBe('time');
    const out = drive(eng, hold(175, 40), {
      feature: 'kneeAngleL',
      extra: { trunkAngleL: 175, hipAngleL: 175, kneeAngleR: 175, trunkAngleR: 175, hipAngleR: 175 },
    });
    expect(out[out.length - 1].timeHeldMs).toBeGreaterThan(0);
  });
});
