// Behavioural tests for the rep-counting state machine: the ROM/direction gate,
// the safety-cap feedback that regressed, per-rep ROM summaries, and the
// jitter defences that were added in response to live bugs.
import { DTWPhaseMachine } from './DTWPhaseMachine';
import { generateReference, EXERCISE_CONFIGS } from './specToReference';
import { applyCanonicalPolicy, CANONICAL_FIELDS } from './bootstrapReferences';

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

// ─── WI-2: baseline-driven ROM gate ──────────────────────────────────────────
// The gate used to be a fixed fraction of the TEMPLATE range, which asks every
// patient to move as far as an idealised template does. These tests pin the new
// behaviour and, just as importantly, pin the two thresholds apart.

/** Pre-seed a locked baseline in storage; PatientBaseline loads it in its constructor. */
function seedBaseline(patientId, exerciseName, ranges) {
  const baseline = {};
  for (const [k, range] of Object.entries(ranges)) {
    baseline[k] = { min: 0, max: range, range, mean: range / 2 };
  }
  localStorage.setItem(
    `dtw_baseline_${patientId}_${exerciseName}`,
    JSON.stringify({ baseline, sessionHistory: [] })
  );
}

describe('baseline-driven ROM gate', () => {
  beforeEach(() => localStorage.clear());

  it('keeps template behaviour when there is no patient (regression)', () => {
    const eng = makeArmRaiseEngine();
    expect(eng.romGate.source).toBe('template');
    expect(eng.minRomForRep).toBeCloseTo(15, 0);
  });

  it('runs normally when patientId is null - no baseline, no throw', () => {
    // Dev mode used to land here silently, which made the whole feature inert.
    const eng = makeArmRaiseEngine({ patientId: null });
    expect(eng.patientBaseline).toBeNull();
    expect(() => drive(eng, armRaiseRep(), { feature: 'shoulderAngleL' })).not.toThrow();
    expect(eng.repCount).toBe(1);
  });

  it('lowers the gate for a patient whose range is smaller than the template', () => {
    seedBaseline('p1', 'SideArmRaise', { shoulderAngleL: 40 });
    const eng = makeArmRaiseEngine({ patientId: 'p1' });
    expect(eng.romGate.source).toBe('baseline');
    expect(eng.minRomForRep).toBeCloseTo(10, 6); // 0.25 x 40, vs the template 15
  });

  it('counts a reduced-ROM rep that the template gate rejects', () => {
    // THE core fix. A 12-degree excursion: under the template gate (15) this is
    // silently uncounted; against the patient's own 40-degree range it is a rep.
    const reducedRep = [
      ...hold(30, 8), ...ramp(30, 42, 12), ...hold(42, 10), ...ramp(42, 30, 12), ...hold(30, 8),
    ];

    const template = makeArmRaiseEngine();
    drive(template, reducedRep, { feature: 'shoulderAngleL' });
    expect(template.repCount).toBe(0);

    seedBaseline('p1', 'SideArmRaise', { shoulderAngleL: 40 });
    const withBaseline = makeArmRaiseEngine({ patientId: 'p1' });
    drive(withBaseline, reducedRep, { feature: 'shoulderAngleL' });
    expect(withBaseline.repCount).toBeGreaterThanOrEqual(1);
  });

  it('clamps to the template gate when the patient range is larger', () => {
    seedBaseline('p1', 'SideArmRaise', { shoulderAngleL: 200 });
    const eng = makeArmRaiseEngine({ patientId: 'p1' });
    expect(eng.romGate.clamped).toBe('ceiling');
    expect(eng.minRomForRep).toBeCloseTo(15, 6);
  });

  it('clamps a degenerate baseline to the floor and counts no reps on a still body', () => {
    seedBaseline('p1', 'SideArmRaise', { shoulderAngleL: 0.2 });
    const eng = makeArmRaiseEngine({ patientId: 'p1' });
    expect(eng.romGate.clamped).toBe('floor');
    // Sensor-noise-scale wobble must not register as reps.
    const noise = Array.from({ length: 120 }, (_, i) => 30 + Math.sin(i / 3) * 0.4);
    drive(eng, noise, { feature: 'shoulderAngleL' });
    expect(eng.repCount).toBe(0);
  });

  it('recomputes the gate at the moment the baseline locks mid-session', () => {
    const eng = makeArmRaiseEngine({ patientId: 'p-fresh' });
    expect(eng.romGate.source).toBe('template'); // nothing stored yet
    const before = eng.minRomForRep;

    // Two reps plus >=60 frames is the lock condition. Calibrate on a REDUCED
    // amplitude (30->70): full-range reps would capture exactly the template's
    // own range and the gate would correctly not move, proving nothing.
    const smallRep = [
      ...hold(30, 8), ...ramp(30, 70, 12), ...hold(70, 8), ...ramp(70, 30, 12), ...hold(30, 8),
    ];
    drive(eng, [...smallRep, ...smallRep], { feature: 'shoulderAngleL' });
    expect(eng.patientBaseline.isLocked).toBe(true);
    expect(eng.romGate.source).toBe('baseline');
    expect(eng.minRomForRep).toBeCloseTo(10, 6); // 0.25 x the captured 40, down from 15
    expect(eng.minRomForRep).toBeLessThan(before);
  });

  it('falls back to the template gate when storage throws', () => {
    const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError: private browsing');
    });
    const eng = makeArmRaiseEngine({ patientId: 'p1' });
    expect(eng.romGate.source).toBe('template');
    expect(eng.minRomForRep).toBeCloseTo(15, 0);
    // and the session is flagged so the UI does not claim baseline-relative progress
    expect(eng.patientBaseline.storageFailed()).toBe(true);
    spy.mockRestore();
  });

  it('does not narrow the return-to-start window when the effort gate shrinks', () => {
    // Hazard the spec missed: both thresholds were the same field. Shrinking the
    // effort gate for a limited-ROM patient also tightened their return window,
    // so the rep would open more easily and then never close.
    seedBaseline('p1', 'SideArmRaise', { shoulderAngleL: 40 });
    const eng = makeArmRaiseEngine({ patientId: 'p1' });
    expect(eng.minRomForRep).toBeCloseTo(10, 6);      // scaled to the patient
    expect(eng.nearStartTolerance).toBeCloseTo(15, 6); // still on the template

    // Returns to 42, i.e. 12 away from the 30-degree start: inside the template
    // tolerance (15) but outside the shrunken gate (10). Must still count.
    const rep = [...hold(30, 8), ...ramp(30, 90, 12), ...hold(90, 10), ...ramp(90, 42, 12), ...hold(42, 8)];
    drive(eng, rep, { feature: 'shoulderAngleL' });
    expect(eng.repCount).toBe(1);
  });

  it('SeatedDorsiflexion: real limited ROM is uncountable on the template, countable on a baseline', () => {
    // The exercise the spec calls out. minRomPct is 0.80 against a template that
    // sweeps ~0.17, demanding ~0.14 of footPitchNorm, while real limited
    // dorsiflexion produces 0.05-0.15.
    const ref = generateReference(EXERCISE_CONFIGS.SeatedDorsiflexion);
    const probe = new DTWPhaseMachine(ref, { targetReps: 5, side: 'left' });
    const feature = probe.primaryFeature;
    const start = probe.refStartValue;
    const dir = probe.templateDirection || -1;

    const amp = 0.06; // deliberately limited dorsiflexion
    expect(probe.minRomForRep).toBeGreaterThan(amp); // the template gate is out of reach

    const peak = start + dir * amp;
    const seq = [
      ...hold(start, 8), ...ramp(start, peak, 12), ...hold(peak, 10),
      ...ramp(peak, start, 12), ...hold(start, 8),
    ];

    drive(probe, seq, { feature });
    expect(probe.repCount).toBe(0);

    seedBaseline('p-dorsi', 'SeatedDorsiflexion', { [feature]: amp });
    const withBaseline = new DTWPhaseMachine(ref, { targetReps: 5, side: 'left', patientId: 'p-dorsi' });
    expect(withBaseline.romGate.source).toBe('baseline');
    expect(withBaseline.minRomForRep).toBeLessThan(amp);
    drive(withBaseline, seq, { feature });
    expect(withBaseline.repCount).toBeGreaterThanOrEqual(1);
  });
});

// ─── Clinical caps flag the rep ──────────────────────────────────────────────
// Caps used to be advisory only: _exceedsClinicalCap was read solely by
// _pickFeedback, so a breach produced a spoken string and nothing else. A
// spoken string is gone the moment the next one replaces it, leaving no record
// a clinician could review. These pin the flagging that replaced that, and pin
// the decision NOT to block the rep.

describe('clinical cap flagging', () => {
  beforeEach(() => localStorage.clear());

  // SideArmRaise caps shoulderAngle at 95. This rep goes to 110.
  const overshootRep = () => [
    ...hold(30, 8), ...ramp(30, 110, 14), ...hold(110, 8), ...ramp(110, 30, 14), ...hold(30, 8),
  ];

  it('still counts a rep that breaches a cap', () => {
    // Silently discarding movement is the failure the baseline ROM gate exists
    // to avoid, and 14 of 16 caps are unreviewed — blocking on them would
    // punish patients for numbers nobody has signed off.
    const eng = makeArmRaiseEngine();
    drive(eng, overshootRep(), { feature: 'shoulderAngleL' });
    expect(eng.repCount).toBe(1);
  });

  it('marks the rep flagged and records which cap and bound', () => {
    const eng = makeArmRaiseEngine();
    const out = drive(eng, overshootRep(), { feature: 'shoulderAngleL' });
    const rep = out.find(r => r.repDelta > 0);
    expect(rep.repClassification.flagged).toBe(true);
    expect(rep.repClassification.completed).toBe(false);
    const breach = rep.repClassification.capBreaches[0];
    expect(breach).toMatchObject({ key: 'shoulderAngleL', bound: 'max', limit: 95 });
    expect(breach.value).toBeGreaterThan(95);
  });

  it('leaves a clean rep unflagged', () => {
    const eng = makeArmRaiseEngine();
    const out = drive(eng, armRaiseRep(), { feature: 'shoulderAngleL' });
    const rep = out.find(r => r.repDelta > 0);
    expect(rep.repClassification.flagged).toBe(false);
    expect(rep.repClassification.capBreaches).toHaveLength(0);
  });

  it('does not carry a breach over into the next rep', () => {
    const eng = makeArmRaiseEngine();
    const out = drive(eng, [...overshootRep(), ...armRaiseRep()], { feature: 'shoulderAngleL' });
    const reps = out.filter(r => r.repDelta > 0);
    expect(reps).toHaveLength(2);
    expect(reps[0].repClassification.flagged).toBe(true);
    expect(reps[1].repClassification.flagged).toBe(false);
  });

  it('counts flagged reps separately and keeps them out of the completion rate', () => {
    seedBaseline('p1', 'SideArmRaise', { shoulderAngleL: 60 });
    const eng = makeArmRaiseEngine({ patientId: 'p1' });
    drive(eng, [...armRaiseRep(), ...overshootRep()], { feature: 'shoulderAngleL' });

    const reps = eng.patientBaseline.reps;
    expect(reps.total).toBe(2);
    expect(reps.flagged).toBe(1);
    // The rate answers "of the reps we can make a quality claim about, how many
    // were full range" — an unsafe rep is not one we can claim anything about,
    // so it leaves the denominator rather than counting as a failure.
    expect(eng.getSessionSummary().completionRate).toBe(100);
  });

  it('reports the flagged count in the step result', () => {
    seedBaseline('p1', 'SideArmRaise', { shoulderAngleL: 60 });
    const eng = makeArmRaiseEngine({ patientId: 'p1' });
    const out = drive(eng, overshootRep(), { feature: 'shoulderAngleL' });
    expect(out[out.length - 1].flaggedReps).toBe(1);
  });

  it('still surfaces the safety warning while the patient is over the cap', () => {
    // Flagging is additive: the existing top-priority cue must not have been
    // displaced by it. Checked across the rep rather than on the last frame,
    // since the rep ends back at the rest posture where nothing is breached.
    const eng = makeArmRaiseEngine();
    const out = drive(eng, overshootRep(), { feature: 'shoulderAngleL' });
    const tooMuch = EXERCISE_CONFIGS.SideArmRaise.feedback.range.tooMuch;
    expect(out.some(r => r.feedback === tooMuch)).toBe(true);
  });
});

// ─── Primary-feature family pinning ──────────────────────────────────────────
// The auto-picker ranks features by raw range, which compares degrees against
// dimensionless ratios. A 20-degree ankle angle beats a 0.17 footPitchNorm on
// magnitude alone, so the moment a recorded reference carries both families
// every foot exercise would silently change which feature counts its reps -
// including the calf raises, where the ankle angle is documented as the wrong
// instrument because the foot pivots about the toe.
//
// primaryFeatureBase narrows the picker to one family while leaving its
// side/aggregate resolution intact, which an exact primaryFeature pin cannot do
// because it would have to name a concrete side key up front.

/** Simulate a recorded reference by adding an angle family to the template. */
function withAnkleAngles(ref, range = 20) {
  return {
    ...ref,
    featureRanges: {
      ...ref.featureRanges,
      ankleAngleToeL: { min: 90, max: 90 + range, range },
      ankleAngleToeR: { min: 90, max: 90 + range, range },
    },
  };
}

describe('primary feature family pinning', () => {
  const dorsi = () => generateReference(EXERCISE_CONFIGS.SeatedDorsiflexion);

  it('leaves the shipped foot exercises on footPitchNorm', () => {
    const eng = new DTWPhaseMachine(dorsi(), { targetReps: 5, side: 'left' });
    expect(eng.primaryFeature).toBe('footPitchNormL');
  });

  it('would be hijacked by an angle family without the pin', () => {
    // The hazard, demonstrated. Strip the pin and the bigger raw range wins.
    const ref = withAnkleAngles(dorsi());
    const unpinned = { ...ref, primaryFeatureBase: null };
    const eng = new DTWPhaseMachine(unpinned, { targetReps: 5, side: 'left' });
    expect(eng.primaryFeature).toBe('ankleAngleToeL');
  });

  it('holds the family when a recorded reference adds an angle', () => {
    const eng = new DTWPhaseMachine(withAnkleAngles(dorsi()), { targetReps: 5, side: 'left' });
    expect(eng.primaryFeature).toBe('footPitchNormL');
  });

  it('still resolves the side within the pinned family', () => {
    // What an exact primaryFeature pin could not do.
    const eng = new DTWPhaseMachine(withAnkleAngles(dorsi()), { targetReps: 5, side: 'right' });
    expect(eng.primaryFeature).toBe('footPitchNormR');
  });

  it('pins every foot exercise, not just the dorsiflexion pair', () => {
    for (const name of ['CalfRaisesSeated', 'CalfRaisesStanding',
      'SeatedDorsiflexion', 'StandingDorsiflexion']) {
      const ref = withAnkleAngles(generateReference(EXERCISE_CONFIGS[name]));
      const eng = new DTWPhaseMachine(ref, { targetReps: 5, side: 'left' });
      expect(`${name}:${eng.primaryFeature}`).toBe(`${name}:footPitchNormL`);
    }
  });

  it('leaves the angle exercises alone', () => {
    // Regression guard: the pin is opt-in, so the twelve MoveNet exercises
    // must keep auto-picking exactly as before.
    expect(makeArmRaiseEngine().primaryFeature).toBe('shoulderAngleL');
  });
});

// ─── Velocity jump filter ────────────────────────────────────────────────────
// The filter masks primary-feature jumps above 20 units in one frame, to reject
// tracking glitches. The threshold is ABSOLUTE, which means it does different
// things to different feature families - and for the four foot exercises it
// currently does nothing at all. These pin both halves of that, so switching
// dorsiflexion to an angle feature cannot silently activate an untested filter
// on the least reliable exercises in the system.

describe('velocity jump filter', () => {
  const stepOnce = (eng, feature, v, t) => eng.step({
    t, now: t, features: { [feature]: v }, say: () => {}, setHighlight: () => {},
  });

  it('masks an impossible jump for an angle feature', () => {
    const eng = makeArmRaiseEngine();
    stepOnce(eng, 'shoulderAngleL', 30, 1000);
    expect(eng._prevPrimaryValue).toBe(30);

    // 30 degrees in one frame is roughly 900 deg/s. Not a shoulder.
    stepOnce(eng, 'shoulderAngleL', 60, 1033);
    expect(eng._prevPrimaryValue).toBe(30);
  });

  it('lets real movement through', () => {
    const eng = makeArmRaiseEngine();
    stepOnce(eng, 'shoulderAngleL', 30, 1000);
    stepOnce(eng, 'shoulderAngleL', 45, 1033);
    expect(eng._prevPrimaryValue).toBe(45);
  });

  it('cannot fire at all for footPitchNorm, whose whole range is 0.17', () => {
    // Documents a real gap rather than asserting correctness: the four foot
    // exercises have NO velocity gate today. A chair-leg latch that throws
    // footPitchNorm from 0.12 to 5.0 - roughly thirty times the entire range
    // of the movement - is passed straight through, because 4.88 < 20.
    const eng = new DTWPhaseMachine(
      generateReference(EXERCISE_CONFIGS.SeatedDorsiflexion),
      { targetReps: 5, side: 'left' }
    );
    expect(eng.primaryFeature).toBe('footPitchNormL');
    stepOnce(eng, 'footPitchNormL', 0.12, 1000);
    stepOnce(eng, 'footPitchNormL', 5.0, 1033);
    expect(eng._prevPrimaryValue).toBe(5.0);
  });

  it('activates for a foot exercise the moment its primary is an angle', () => {
    // The consequence of the pending dorsiflexion switch: the same filter that
    // has never run on these exercises starts running. Pinned here so it is a
    // decision rather than a surprise on the phone.
    const ref = withAnkleAngles(generateReference(EXERCISE_CONFIGS.SeatedDorsiflexion));
    const eng = new DTWPhaseMachine(
      { ...ref, primaryFeatureBase: 'ankleAngleToe' },
      { targetReps: 5, side: 'left' }
    );
    expect(eng.primaryFeature).toBe('ankleAngleToeL');

    stepOnce(eng, 'ankleAngleToeL', 95, 1000);
    expect(eng._prevPrimaryValue).toBe(95);

    // A chair-leg latch swings the ankle angle wildly; now it gets caught.
    stepOnce(eng, 'ankleAngleToeL', 140, 1033);
    expect(eng._prevPrimaryValue).toBe(95);

    // And a real dorsiflexion at a plausible speed is not masked.
    stepOnce(eng, 'ankleAngleToeL', 103, 1066);
    expect(eng._prevPrimaryValue).toBe(103);
  });
});

// ─── Canonical policy on recorded references ─────────────────────────────────
// A .ref.json replaces the synthetic reference wholesale, so without an overlay
// every policy field reverts to whatever the extractor happened to write -
// including the clinical caps and the camera setup limits.

describe('canonical policy overlay', () => {
  const canonical = generateReference(EXERCISE_CONFIGS.SeatedDorsiflexion);

  it('keeps the feature pin a recording does not know about', () => {
    const recorded = { name: 'SeatedDorsiflexion', template: [], featureRanges: {} };
    expect(recorded.primaryFeatureBase).toBeUndefined();
    expect(applyCanonicalPolicy(recorded, canonical).primaryFeatureBase).toBe('footPitchNorm');
  });

  it('refuses to let a recording redefine the clinical caps', () => {
    const recorded = {
      name: 'SeatedDorsiflexion',
      clinicalCaps: { footPitchNorm: { min: -99 } },
    };
    expect(applyCanonicalPolicy(recorded, canonical).clinicalCaps)
      .toEqual(canonical.clinicalCaps);
  });

  it('refuses to let a recording loosen the camera setup limits', () => {
    const recorded = { name: 'SeatedDorsiflexion', framing: { view: 'front' } };
    const merged = applyCanonicalPolicy(recorded, canonical);
    expect(merged.framing.view).toBe('side');
    expect(merged.framing.maxRollDeg).toBe(8);
    expect(merged.framing.requireFoot).toBe(true);
  });

  it('leaves the movement shape to the recording', () => {
    // The split: EXERCISE_CONFIGS owns policy, the recording owns shape.
    const recorded = {
      name: 'SeatedDorsiflexion',
      template: [{ phase: 'lowered' }],
      featureRanges: { footPitchNormL: { min: 0, max: 0.2, range: 0.2 } },
      repCycle: { start: 'lowered', effort: 'dorsiflexed' },
    };
    const merged = applyCanonicalPolicy(recorded, canonical);
    expect(merged.template).toBe(recorded.template);
    expect(merged.featureRanges).toBe(recorded.featureRanges);
    expect(merged.repCycle).toBe(recorded.repCycle);
  });

  it('passes a reference through untouched when there is no canonical entry', () => {
    const recorded = { name: 'Whatever', clinicalCaps: { x: { max: 1 } } };
    expect(applyCanonicalPolicy(recorded, undefined)).toBe(recorded);
  });

  it('covers every field the engine treats as policy', () => {
    expect(CANONICAL_FIELDS).toEqual(expect.arrayContaining([
      'primaryFeature', 'primaryFeatureBase', 'clinicalCaps', 'framing',
      'minRomPct', 'timing', 'detector', 'mode', 'side',
    ]));
  });
});

// ─── Live cap breach, for a visible cue ──────────────────────────────────────
// A cap breach used to produce a spoken string and, once the rep closed, a flag
// on the rep. Neither is visible while it is happening: the spoken cue is gone
// as soon as the next one replaces it, and repClassification.capBreaches only
// arrives on the frame a rep is counted, which is far too late to warn anyone.
//
// stepResult.capBreaches reports the caps exceeded on THIS frame, so the
// renderer can turn the skeleton red at the moment it matters.

describe('live cap breaches', () => {
  beforeEach(() => localStorage.clear());

  it('reports nothing while the patient is inside the caps', () => {
    const eng = makeArmRaiseEngine();
    const out = drive(eng, armRaiseRep(), { feature: 'shoulderAngleL' });
    expect(out.every(r => r.capBreaches.length === 0)).toBe(true);
  });

  it('reports the breach on the frames it is happening', () => {
    // SideArmRaise caps shoulderAngleL at 95.
    const eng = makeArmRaiseEngine();
    const out = drive(eng, [...hold(30, 8), ...ramp(30, 110, 14), ...hold(110, 8)],
      { feature: 'shoulderAngleL' });

    const breaching = out.filter(r => r.capBreaches.length > 0);
    expect(breaching.length).toBeGreaterThan(0);
    expect(breaching[0].capBreaches[0]).toMatchObject({
      key: 'shoulderAngleL', bound: 'max', limit: 95,
    });
  });

  it('clears as soon as the patient comes back inside the limit', () => {
    // The cue has to be live, not sticky, or it stops meaning anything.
    // Ramped rather than jumped: an 80-degree step in one frame is masked by the
    // velocity filter as a tracking artefact, so it correctly reports no breach.
    const eng = makeArmRaiseEngine();
    const values = [...hold(30, 6), ...ramp(30, 110, 14), ...hold(110, 4),
                    ...ramp(110, 60, 10), ...hold(60, 6)];
    const out = drive(eng, values, { feature: 'shoulderAngleL' });

    expect(out.some(r => r.capBreaches.length > 0)).toBe(true);
    expect(out[out.length - 1].capBreaches).toHaveLength(0);
  });

  it('warns even before a rep has started', () => {
    // The accumulating per-rep list is gated on the cycle being active. A
    // patient holding their arm too high before they begin still needs telling.
    const eng = makeArmRaiseEngine();
    const out = drive(eng, hold(110, 6), { feature: 'shoulderAngleL' });
    expect(eng.cycleState).toBe('idle');
    expect(out[out.length - 1].capBreaches.length).toBeGreaterThan(0);
  });

  it('does not fire on missing keypoints', () => {
    // NaN is absence, not a breach — colouring the skeleton red because a limb
    // went out of frame would train patients to ignore the cue.
    const eng = makeArmRaiseEngine();
    const out = drive(eng, [NaN, NaN, NaN], { feature: 'shoulderAngleL' });
    expect(out.every(r => r.capBreaches.length === 0)).toBe(true);
  });

  it('is independent of DTW match quality', () => {
    // The case the colour priority exists for: a patient can track the template
    // well and still be past a clinical limit. Quality alone would show green.
    const eng = makeArmRaiseEngine();
    const out = drive(eng, [...hold(30, 8), ...ramp(30, 110, 14), ...hold(110, 8)],
      { feature: 'shoulderAngleL' });
    const overshoot = out.filter(r => r.capBreaches.length > 0);
    expect(overshoot.some(r => (r.quality ?? 0) > 0.7)).toBe(true);
  });

  it('still records the breach against the rep as well', () => {
    // Additive: the live signal must not have replaced the per-rep record a
    // clinician reviews afterwards.
    const eng = makeArmRaiseEngine();
    const out = drive(eng, [
      ...hold(30, 8), ...ramp(30, 110, 14), ...hold(110, 8), ...ramp(110, 30, 14), ...hold(30, 8),
    ], { feature: 'shoulderAngleL' });
    const rep = out.find(r => r.repDelta > 0);
    expect(rep.repClassification.flagged).toBe(true);
    expect(rep.repClassification.capBreaches.length).toBeGreaterThan(0);
  });
});

// ─── Feedback pacing ─────────────────────────────────────────────────────────
// The engine re-ran its whole priority ladder every step with no memory, so the
// winning string ping-ponged between categories. Measured on a Galaxy A36
// during a real set: 19 cues in 8 seconds, mean gap 427ms, against utterances
// needing 1.1-2.3s to speak. 94% could not physically finish before the host
// cut them off, including the "Raise too high" that mattered.
//
// Pacing lives here rather than in the host because the transport only sends a
// message when the string CHANGES, so returning the PREVIOUS string is exactly
// "say nothing new".

/** Every distinct coaching string the engine emitted, in order. */
function cueChanges(results) {
  const out = [];
  for (const r of results) {
    if (r.feedback && r.feedback !== out[out.length - 1]) out.push(r.feedback);
  }
  return out;
}

describe('feedback pacing', () => {
  it('does not change the cue more than once per gap window', () => {
    // Four full reps at 30fps is ~10s of wall clock. Before pacing this window
    // produced a new string every few frames.
    const eng = makeArmRaiseEngine();
    const out = drive(eng, [
      ...armRaiseRep(), ...armRaiseRep(), ...armRaiseRep(), ...armRaiseRep(),
    ], { feature: 'shoulderAngleL' });

    const spanMs = out.length * FRAME_MS;
    const changes = cueChanges(out).length;
    // Allow the rep-number announcements on top of the paced cues.
    expect(changes).toBeLessThanOrEqual(Math.ceil(spanMs / 2500) + eng.repCount + 1);
  });

  it('holds the previous string rather than inventing silence', () => {
    // Returning '' between cues would make the host flicker its caption to blank.
    const eng = makeArmRaiseEngine();
    const out = drive(eng, armRaiseRep(), { feature: 'shoulderAngleL' });
    const afterFirst = out.slice(out.findIndex(r => r.feedback));
    expect(afterFirst.every(r => r.feedback !== '')).toBe(true);
  });

  it('lets a safety warning through immediately, ignoring the gap', () => {
    // The regression this exists to prevent: a clinical-cap breach queued behind
    // "Keep going up" is a warning the patient never hears in time.
    const eng = makeArmRaiseEngine();
    const out = drive(eng, [
      ...hold(30, 8), ...ramp(30, 88, 12), ...hold(88, 4), ...ramp(88, 130, 8), ...hold(130, 6),
    ], { feature: 'shoulderAngleL' });

    const breaching = out.filter(r => r.capBreaches.length > 0);
    expect(breaching.length).toBeGreaterThan(0);
    expect(breaching.some(r => r.feedback === 'That\'s high enough'
      || r.feedback === 'Raise too high')).toBe(true);
  });

  it('marks a safety cue so the host knows it may interrupt', () => {
    // Without this the host cannot tell a clinical warning from a phase cue, and
    // a never-interrupt speech policy would silently delay the one that matters.
    const eng = makeArmRaiseEngine();
    const out = drive(eng, [
      ...hold(30, 8), ...ramp(30, 88, 12), ...hold(88, 4), ...ramp(88, 130, 8), ...hold(130, 6),
    ], { feature: 'shoulderAngleL' });

    const breaching = out.filter(r => r.capBreaches.length > 0);
    expect(breaching.some(r => r.feedbackPriority === 'safety')).toBe(true);
  });

  it('marks ordinary coaching as normal priority', () => {
    const eng = makeArmRaiseEngine();
    const out = drive(eng, armRaiseRep(), { feature: 'shoulderAngleL' });
    const clean = out.filter(r => r.capBreaches.length === 0);
    expect(clean.every(r => r.feedbackPriority === 'normal')).toBe(true);
  });

  it('still announces every rep number', () => {
    // Pacing must not swallow the count — it is the one cue the patient is
    // actively waiting for.
    const eng = makeArmRaiseEngine();
    const out = drive(eng, [...armRaiseRep(), ...armRaiseRep(), ...armRaiseRep()],
      { feature: 'shoulderAngleL' });
    const said = cueChanges(out);
    for (let n = 1; n <= eng.repCount; n++) {
      expect(said).toContain(String(n));
    }
  });

  it('resets its pacing clock when the counter resets', () => {
    // A second set must not inherit the first set's cooldown.
    const eng = makeArmRaiseEngine();
    drive(eng, armRaiseRep(), { feature: 'shoulderAngleL' });
    eng.resetCounters();
    expect(eng._lastCueAt).toBe(0);
    expect(eng._formCueRepIdx).toBe(-1);
  });
});
