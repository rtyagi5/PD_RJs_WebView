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

  // ---- The dorsiflexion-on-the-floor session ------------------------------
  //
  // The patient moved the phone from a table to the floor, which genuinely
  // improved foot keypoint confidence, and footPitchNormL - a raw image-space
  // vertical ratio rather than a viewpoint-invariant angle - then read -0.3 for
  // the whole set against a reference band of -0.077..0.099 and a clinical
  // floor of -0.12. They heard "That's far enough" twenty times without moving
  // their toes, and the count jumped from 1 to 4.

  const floorSession = v => Array(160).fill(v);

  it('does not warn about a limit the signal has never been inside', () => {
    const ref = generateReference(EXERCISE_CONFIGS.SeatedDorsiflexion);
    const eng = new DTWPhaseMachine(ref, { targetReps: 10, side: 'left' });
    const out = drive(eng, floorSession(-0.3), { feature: 'footPitchNormL' });
    const tooMuch = EXERCISE_CONFIGS.SeatedDorsiflexion.feedback.range.tooMuch;
    expect(out.filter(r => r.feedback === tooMuch)).toHaveLength(0);
  });

  it('names the setup fault instead, once it is not explainable by a slow start', () => {
    const ref = generateReference(EXERCISE_CONFIGS.SeatedDorsiflexion);
    const eng = new DTWPhaseMachine(ref, { targetReps: 10, side: 'left' });
    const out = drive(eng, floorSession(-0.3), { feature: 'footPitchNormL' });
    const cues = out.map(r => r.feedback);
    expect(cues.some(c => /having trouble tracking/i.test(c || ''))).toBe(true);
    // Silent for the grace window first - a patient who has not started yet is
    // not evidence of anything.
    const firstAt = cues.findIndex(c => /having trouble tracking/i.test(c || ''));
    expect(firstAt * FRAME_MS).toBeGreaterThanOrEqual(4000);
  });

  it('says the setup fault a handful of times, not once per frame', () => {
    const ref = generateReference(EXERCISE_CONFIGS.SeatedDorsiflexion);
    const eng = new DTWPhaseMachine(ref, { targetReps: 10, side: 'left' });
    // 30 seconds at 30fps. The device log had 20 safety cues in 26 seconds.
    const out = drive(eng, floorSession(-0.3), { feature: 'footPitchNormL', frameMs: FRAME_MS });
    const emissions = out
      .map(r => r.feedback)
      .filter((c, i, a) => c && c !== a[i - 1] && /having trouble tracking/i.test(c));
    expect(emissions.length).toBeLessThanOrEqual(2);
  });

  it('still warns when the patient really does cross a limit they were inside', () => {
    const ref = generateReference(EXERCISE_CONFIGS.SeatedDorsiflexion);
    const eng = new DTWPhaseMachine(ref, { targetReps: 10, side: 'left' });
    const tooMuch = EXERCISE_CONFIGS.SeatedDorsiflexion.feedback.range.tooMuch;
    // Rest at a normal flat-foot value first, then dorsiflex well past -0.12.
    const out = drive(eng, [...hold(0.05, 20), ...ramp(0.05, -0.25, 20), ...hold(-0.25, 20)],
      { feature: 'footPitchNormL' });
    expect(out.some(r => r.feedback === tooMuch)).toBe(true);
  });

  it('lets the rep number through instead of being starved by a latched warning', () => {
    // The count jumping 1 -> 4 was not a counting bug: safety sits above the rep
    // announcement in the ladder, so a permanently true warning meant reps 2 and
    // 3 never reached the announce branch at all.
    const eng = makeArmRaiseEngine();
    const overshootRep = [
      ...hold(30, 8), ...ramp(30, 130, 12), ...hold(130, 40), ...ramp(130, 30, 12), ...hold(30, 8),
    ];
    const out = drive(eng, [...overshootRep, ...overshootRep], { feature: 'shoulderAngleL' });
    const spoken = out.map(r => r.feedback).filter((c, i, a) => c && c !== a[i - 1]);
    expect(eng.repCount).toBe(2);
    // Every rep the engine counted was also announced.
    for (let n = 1; n <= eng.repCount; n += 1) {
      expect(`rep ${n} announced: ${spoken.includes(String(n))}`).toBe(`rep ${n} announced: true`);
    }
  });

  it('still warns on a believable overshoot held from the very first frame', () => {
    // The boundary is the SIZE of the excursion, not merely "never inside".
    // 110 degrees against a 30-90 template is a third of a range out: an
    // arm someone can really be holding. -0.3 on a 0.2 foot-pitch range is not.
    const eng = makeArmRaiseEngine();
    const out = drive(eng, hold(110, 40), { feature: 'shoulderAngleL' });
    expect(out.some(r => r.capBreaches.length > 0)).toBe(true);
  });

  it('keeps the skeleton honest: no red for a reading that describes the camera', () => {
    const ref = generateReference(EXERCISE_CONFIGS.SeatedDorsiflexion);
    const eng = new DTWPhaseMachine(ref, { targetReps: 10, side: 'left' });
    drive(eng, floorSession(-0.3), { feature: 'footPitchNormL' });
    expect(eng._capBreaches({ footPitchNormL: -0.3 })).toHaveLength(0);
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
  it('keeps the overall cue rate far below the measured failure', () => {
    // On device the string changed 19 times in 8s - 2.4/s - against utterances
    // needing 1.1-2.3s each, so 94% were cut off. The bound here is deliberately
    // generous: the point is the order of magnitude, not a precise budget, since
    // phase cues legitimately track phase transitions rather than a clock.
    // armRaiseRep() spans ~1.6s, but the recorded reference's own
    // timing.repDurationMs is 3422 - so the stock helper packs phase transitions
    // twice as densely as a real patient and would overstate the rate.
    const slowRep = [
      ...hold(30, 16), ...ramp(30, 90, 26), ...hold(90, 16),
      ...ramp(90, 30, 26), ...hold(30, 16),
    ];
    const eng = makeArmRaiseEngine();
    const out = drive(eng, [...slowRep, ...slowRep, ...slowRep, ...slowRep],
      { feature: 'shoulderAngleL' });

    // The guarantee is per-cue, not aggregate: a routine cue must get long
    // enough to be spoken. Asserting a session-wide rate instead made this test
    // sensitive to fixture timing to three decimal places, which says nothing
    // about whether a patient can hear anything.
    const changeTimes = [];
    let last = null;
    out.forEach((r, i) => {
      if (r.feedback && r.feedback !== last) {
        changeTimes.push(i * FRAME_MS);
        last = r.feedback;
      }
    });
    const gaps = changeTimes.slice(1).map((t, i) => t - changeTimes[i]);
    const median = gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
    // On device, before pacing, the median gap was ~420ms against utterances
    // needing 1100-2300ms.
    expect(median).toBeGreaterThanOrEqual(900);
  });

  it('does not repeat a phase cue while the phase is unchanged', () => {
    // Phase cues fire on the transition, so a long hold inside one phase must
    // stay silent rather than restating the obvious every gap window.
    const eng = makeArmRaiseEngine();
    const out = drive(eng, [...hold(30, 8), ...ramp(30, 90, 12), ...hold(90, 120)],
      { feature: 'shoulderAngleL' });

    const tail = out.slice(-80);
    const phases = new Set(tail.map(r => r.phase));
    expect(phases.size).toBe(1); // genuinely parked in one phase
    expect(cueChanges(tail).length).toBeLessThanOrEqual(1);
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

// ─── Form cues address the limb being exercised ──────────────────────────────
// BODY_PART_FEATURE_MAP lists both sides plus an aggregate for every body part,
// and _selectFeedback checked all of them regardless of the session side. During
// a right-side arm raise a bend in the RESTING left arm therefore produced
// "Please do not bend the elbow" — a correction about a limb the patient was not
// using, and one they cannot act on without guessing which arm is meant.

describe('form cue side selection', () => {
  it('only considers the exercised side', () => {
    const right = makeArmRaiseEngine({ side: 'right' });
    expect(right._formKeysFor('elbow')).toEqual(['elbowAngleR']);

    const left = makeArmRaiseEngine({ side: 'left' });
    expect(left._formKeysFor('elbow')).toEqual(['elbowAngleL']);
  });

  it('drops the aggregates, which track the wrong limb', () => {
    // elbowAngleMin is whichever elbow is more bent. In a one-sided exercise
    // that is normally the idle arm, so it is the worst possible form signal.
    const eng = makeArmRaiseEngine({ side: 'right' });
    const keys = eng._formKeysFor('elbow');
    expect(keys).not.toContain('elbowAngleMin');
    expect(keys).not.toContain('elbowAngleL');
  });

  it('keeps both sides when the exercise is genuinely bilateral', () => {
    const eng = makeArmRaiseEngine({ side: 'both' });
    expect(eng._formKeysFor('elbow')).toEqual(
      expect.arrayContaining(['elbowAngleL', 'elbowAngleR'])
    );
  });

  it('falls back to the full list for a part with no per-side keys', () => {
    // 'foot' includes footPitchNormAvg; a part whose keys are all aggregates
    // must not resolve to an empty list and silently disable its form rule.
    const eng = makeArmRaiseEngine({ side: 'right' });
    expect(eng._formKeysFor('nonexistent-part')).toEqual([]);
    expect(eng._formKeysFor('foot').length).toBeGreaterThan(0);
  });
});

// ─── The artefact filter must not swallow reps ───────────────────────────────
// Measured on a Galaxy A36, 10-rep set performed quickly. Two windows of 11.4s
// and 9.6s produced NO rep at all — not completed, not attempt. The engine sat
// at cycle=sawStart with pf=NaN while the logged angle swept 20→52→72→85→30.
//
// Two causes, both fixed here: the budget was per STEP rather than per second
// (poses arrive at ~7.5/s, so a fast rep legitimately moves 30-55 degrees
// between samples), and it LATCHED — _prevPrimaryValue was frozen during a
// rejection streak, so every later sample stayed >budget from a stale value and
// was rejected too.

describe('artefact filter, rate-based', () => {
  const stepAt = (eng, v, t) => eng.step({
    t, now: t, features: { shoulderAngleL: v }, say: () => {}, setHighlight: () => {},
  });

  it('admits a fast rep sampled at the phone\'s real pose rate', () => {
    // 7.5 poses/s is 133ms apart. A brisk raise covers ~40 degrees in that time;
    // the old absolute 20-per-step gate rejected it as an artefact.
    const eng = makeArmRaiseEngine();
    stepAt(eng, 20, 1000);
    stepAt(eng, 60, 1133);
    expect(eng._prevPrimaryValue).toBe(60);
    stepAt(eng, 95, 1266);
    expect(eng._prevPrimaryValue).toBe(95);
  });

  it('still rejects a jump no limb could make', () => {
    // Same 40-degree step, but in 16ms instead of 133ms — 2500 deg/s.
    const eng = makeArmRaiseEngine();
    stepAt(eng, 20, 1000);
    stepAt(eng, 60, 1016);
    expect(eng._prevPrimaryValue).toBe(20);
  });

  it('gives up rather than latching blind', () => {
    // The behaviour that lost whole reps: once rejecting, the reference value
    // was frozen, so nothing could ever come back inside the budget.
    const eng = makeArmRaiseEngine();
    stepAt(eng, 20, 1000);
    stepAt(eng, 120, 1016);           // rejected, streak opens
    expect(eng._prevPrimaryValue).toBe(20);
    stepAt(eng, 122, 1200);           // still within the streak window
    stepAt(eng, 124, 1400);           // streak has run long enough — resync
    expect(eng._prevPrimaryValue).toBe(124);
  });

  it('counts a fast set instead of dropping it on the floor', () => {
    // The regression test that matters: reps at roughly the cadence that
    // produced the 11.4s silent window must actually be counted.
    const eng = makeArmRaiseEngine();
    const fastRep = [
      ...hold(25, 2), ...ramp(25, 92, 5), ...hold(92, 2), ...ramp(92, 25, 5), ...hold(25, 2),
    ];
    drive(eng, [...fastRep, ...fastRep, ...fastRep], {
      feature: 'shoulderAngleL', frameMs: 133,
    });
    expect(eng.repCount).toBeGreaterThanOrEqual(2);
  });

  it('scales the budget to the feature, not to degrees', () => {
    // footPitchNorm's whole range is ~0.17, so an absolute 20-unit gate could
    // never fire on it. A range-relative budget works for both unit systems.
    const ref = generateReference(EXERCISE_CONFIGS.SeatedDorsiflexion);
    const eng = new DTWPhaseMachine(ref, { targetReps: 5, side: 'left' });
    const stepFoot = (v, t) => eng.step({
      t, now: t, features: { [eng.primaryFeature]: v }, say: () => {}, setHighlight: () => {},
    });
    stepFoot(0.12, 1000);
    stepFoot(0.13, 1133);            // plausible
    expect(eng._prevPrimaryValue).toBeCloseTo(0.13, 5);
    stepFoot(9.0, 1149);             // absurd for this feature
    expect(eng._prevPrimaryValue).toBeCloseTo(0.13, 5);
  });
});

// ─── Tempo ───────────────────────────────────────────────────────────────────
// feedback.tempo {tooFast, holdCue} has been declared in every reference since
// the schema was written, and _pickFeedback carried a "3. Tempo (future: needs
// movement speed tracking)" stub — so the cue could never fire however fast the
// patient moved. On device that mattered: fast reps were being DROPPED, and the
// one cue that would have explained why was unimplemented.

describe('tempo', () => {
  // Read the wording off the config rather than hardcoding it: the synthetic
  // reference and the recorded .ref.json word this cue differently.
  const TOO_FAST = EXERCISE_CONFIGS.SideArmRaise.feedback.tempo.tooFast;

  it('judges a rep against how long the demonstration took', () => {
    const eng = makeArmRaiseEngine();
    expect(eng.repDurationMs).toBeGreaterThan(0);

    // Two reps a comfortable distance apart: not fast.
    eng._judgeTempo(10000);
    eng._judgeTempo(10000 + eng.repDurationMs);
    expect(eng._movingTooFast(10000 + eng.repDurationMs)).toBe(false);

    // Two reps closer together than the demonstration: fast.
    eng._judgeTempo(20000);
    eng._judgeTempo(20000 + eng.repDurationMs * 0.4);
    expect(eng._movingTooFast(20000 + eng.repDurationMs * 0.4)).toBe(true);
  });

  it('ignores a pause between reps rather than calling it speed', () => {
    // Measured on SeatedDorsiflexion: reps 3.3-13.7s apart against a 4.1s
    // demonstration - mostly SLOWER - yet the old instantaneous-rate test called
    // it "too fast" 14 times, the most frequent cue in the session.
    const eng = makeArmRaiseEngine();
    eng._judgeTempo(10000);
    eng._judgeTempo(10000 + eng.repDurationMs * 3);
    expect(eng._movingTooFast(10000 + eng.repDurationMs * 3)).toBe(false);
  });

  it('cannot be triggered by keypoint jitter', () => {
    // The old signal was a smoothed |d(primary)/dt|, which on a 3-10 pixel
    // feature spikes on noise alone. Rep duration cannot be moved by it.
    const eng = makeArmRaiseEngine();
    eng._featureRate = 99999;
    expect(eng._movingTooFast(performance.now())).toBe(false);
  });

  it('stays quiet at the demonstrated pace', () => {
    const eng = makeArmRaiseEngine();
    const out = drive(eng, [...armRaiseRep(), ...armRaiseRep()],
      { feature: 'shoulderAngleL', frameMs: 133 });
    expect(out.some(r => r.feedback === TOO_FAST)).toBe(false);
  });

  it('says so when the patient outruns the template', () => {
    // Three fast reps rather than one: a tempo cue still waits out
    // MIN_CUE_FLOOR_MS behind whatever spoke last, and a single 720ms rep ends
    // before that floor expires. Being a little late is correct for this cue -
    // it is a correction, not a safety warning.
    const eng = makeArmRaiseEngine();
    const fast = [
      ...hold(25, 2), ...ramp(25, 92, 3), ...hold(92, 2), ...ramp(92, 25, 3), ...hold(25, 2),
    ];
    const out = drive(eng, [...fast, ...fast, ...fast],
      { feature: 'shoulderAngleL', frameMs: 60 });
    expect(out.some(r => r.feedback === TOO_FAST)).toBe(true);
  });

  it('reads the demonstrated pace off the recording, not a default', () => {
    // timing is canonical because dwellMs/refractoryMs are engine tuning, but
    // repDurationMs is a measurement OF the recording. Taking the 2000ms default
    // for a clip that ran 3422ms put the baseline at 83 units/s instead of 48,
    // so a patient at 2.5x the demonstration measured as 1.4x and stayed silent.
    const canonical = { timing: { dwellMs: 200, refractoryMs: 300, repDurationMs: 2000 } };
    const recorded = {
      name: 'SideArmRaise',
      timing: { dwellMs: 999, refractoryMs: 999, repDurationMs: 3422, fps: 15 },
    };
    const merged = applyCanonicalPolicy(recorded, canonical);
    expect(merged.timing.dwellMs).toBe(200);        // tuning stays canonical
    expect(merged.timing.refractoryMs).toBe(300);   // tuning stays canonical
    expect(merged.timing.repDurationMs).toBe(3422); // observation survives
    expect(merged.timing.fps).toBe(15);
  });

  it('does not fire on a stationary limb', () => {
    const eng = makeArmRaiseEngine();
    const out = drive(eng, hold(20, 30), { feature: 'shoulderAngleL', frameMs: 133 });
    expect(eng._movingTooFast(performance.now())).toBe(false);
    expect(out.some(r => r.feedback === TOO_FAST)).toBe(false);
  });

  it('replaces the phase cue rather than stacking on top of it', () => {
    // "Keep going up" is stale before it finishes being spoken at that pace, and
    // tempo sits above phase in the ladder - so a fast patient hears the useful
    // cue instead of the obvious one, not both.
    const eng = makeArmRaiseEngine();
    eng._tooFastUntil = 100000; // a rep just closed faster than the demonstration
    expect(eng._movingTooFast(99999)).toBe(true);
    const said = eng._pickFeedback(
      { deviations: {}, quality: 1, templatePosition: 0.2 }, {}, 99999
    );
    expect(said).toBe(TOO_FAST);
    expect(said).not.toBe('Keep going up');
  });

  it('suppresses the phase cue even where no tempo wording exists', () => {
    // Not every reference declares feedback.tempo. Those must still go quiet
    // rather than falling through to a stale phase cue.
    const eng = makeArmRaiseEngine();
    eng.feedback = { ...eng.feedback, tempo: undefined };
    eng._tooFastUntil = 100000;
    eng.lastFeedback = 'previous';
    const held = eng._pickFeedback(
      { deviations: {}, quality: 1, templatePosition: 0.2 }, {}, 99999
    );
    expect(held).toBe('previous');
  });

  it('never lets tempo outrank a safety warning', () => {
    // Going fast AND past a clinical limit must still say the dangerous thing.
    const eng = makeArmRaiseEngine();
    const out = drive(eng, [
      ...hold(25, 2), ...ramp(25, 130, 4), ...hold(130, 3),
    ], { feature: 'shoulderAngleL', frameMs: 60 });
    const breaching = out.filter(r => r.capBreaches.length > 0);
    expect(breaching.length).toBeGreaterThan(0);
    expect(breaching.some(r => r.feedbackPriority === 'safety')).toBe(true);
  });
});

// ─── Phase hysteresis ────────────────────────────────────────────────────────
// Reported from a SeatedDorsiflexion set: "it was giving me feedback lower down
// when I already lowered". The dwell test measured how long we had been in the
// OLD phase, so once the current phase was older than dwellMs a single noisy
// sample committed a switch instantly, and the next one switched back dwellMs
// later. footPitchNorm is a 3-10 pixel signal, so that was most of what the
// phase machine did — and every flip is a fresh phase cue about a movement the
// patient had already finished.

describe('phase hysteresis', () => {
  /** A settled signal with a single-sample spike part way through. */
  function withSpike(base, spikeAt, spikeTo, n) {
    return Array.from({ length: n }, (_, i) => (i === spikeAt ? spikeTo : base));
  }

  it('does not commit a phase on one stray sample', () => {
    const eng = makeArmRaiseEngine();
    drive(eng, hold(25, 20), { feature: 'shoulderAngleL' });
    const settled = eng.phase;

    drive(eng, withSpike(25, 3, 88, 8), { feature: 'shoulderAngleL', startT: 5000 });
    expect(eng.phase).toBe(settled);
  });

  it('still commits when the new phase is genuinely sustained', () => {
    // Hysteresis must not become deafness: a real movement has to get through.
    const eng = makeArmRaiseEngine();
    drive(eng, hold(25, 20), { feature: 'shoulderAngleL' });
    const settled = eng.phase;

    drive(eng, [...ramp(25, 90, 10), ...hold(90, 30)],
      { feature: 'shoulderAngleL', startT: 5000 });
    expect(eng.phase).not.toBe(settled);
  });

  it('abandons a candidate that does not persist', () => {
    // Two separate spikes toward different phases must not accumulate into one
    // confirmed switch.
    const eng = makeArmRaiseEngine();
    drive(eng, hold(25, 20), { feature: 'shoulderAngleL' });
    const settled = eng.phase;

    drive(eng, [25, 88, 25, 60, 25, 88, 25, 25],
      { feature: 'shoulderAngleL', startT: 5000 });
    expect(eng.phase).toBe(settled);
    expect(eng._candidatePhase).toBeNull();
  });

  it('cuts the cue churn a jittery signal produces', () => {
    // The user-visible payoff: fewer phase flips means fewer cues about a
    // movement that already happened.
    const eng = makeArmRaiseEngine();
    const jittery = Array.from({ length: 120 }, (_, i) =>
      (i % 2 === 0 ? 28 : 24) + (i % 7 === 0 ? 40 : 0));
    const out = drive(eng, jittery, { feature: 'shoulderAngleL' });
    expect(cueChanges(out).length).toBeLessThanOrEqual(3);
  });
});
