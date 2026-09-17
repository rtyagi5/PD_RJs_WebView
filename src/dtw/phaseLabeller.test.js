import { DTWPhaseMachine } from './DTWPhaseMachine';
// Phase labels decide refStartValue and templateDirection, so getting them wrong
// inverts the direction gate and the exercise silently counts nothing. These
// tests pin the signal-based labelling that replaced the old positional split.
import {
  labelPhasesBySignal, resolveExpectedDirection, resolvePhaseRoles, resolveCycle,
} from './phaseLabeller';
import { checkPhaseSeparation } from './referenceHealth';
import { EXERCISE_CONFIGS, generateReference } from './specToReference';
import recorded from './__fixtures__/broken-positional-labels.ref.json';

const ARM_PHASES = ['lowered', 'transition_up', 'raised', 'transition_down'];
const ARM_CYCLE = { from: 'lowered', to: 'raised' };

const hold = (v, n) => Array(n).fill(v);
const ramp = (a, b, n) => Array.from({ length: n }, (_, i) => a + (b - a) * (i / (n - 1)));
const toFrames = (vals, key) => vals.map(v => ({ features: { [key]: v } }));

/** Wrap labelled frames as a reference so checkPhaseSeparation can judge them. */
function asReference(frames, labels, key) {
  const template = frames.map((f, i) => ({ frame: i, phase: labels[i], features: f.features }));
  const vals = template.map(f => f.features[key]).filter(Number.isFinite);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  return {
    name: 'SideArmRaise', mode: 'rep', repCycle: ARM_CYCLE, template,
    featureRanges: { [key]: { min, max, range: max - min } },
    feedback: { phase: {} },
  };
}

describe('direction resolution', () => {
  it('knows SideArmRaise moves up into effort', () => {
    expect(resolveExpectedDirection('SideArmRaise', 'shoulderAngleL')).toBe(1);
  });

  it('knows SeatedDorsiflexion moves down into effort', () => {
    // This is why direction cannot be guessed from a recording: the two
    // exercises rest at opposite ends of their feature range.
    expect(resolveExpectedDirection('SeatedDorsiflexion', 'ankleAngleToeL')).toBe(-1);
  });

  it('returns 0 for an unknown exercise rather than guessing', () => {
    expect(resolveExpectedDirection('NotAnExercise', 'shoulderAngleL')).toBe(0);
  });
});

describe('phase roles', () => {
  it('reads approach and recover from the declared cycle order', () => {
    const roles = resolvePhaseRoles(ARM_PHASES, resolveCycle(ARM_CYCLE));
    expect(roles).toEqual({
      start: 'lowered', effort: 'raised',
      approach: 'transition_up', recover: 'transition_down',
    });
  });

  it('falls back to the destination posture when there is no transition phase', () => {
    const roles = resolvePhaseRoles(['lowered', 'raised'], resolveCycle(ARM_CYCLE));
    expect(roles.approach).toBe('raised');
  });

  it('resolves for every exercise in the real config', () => {
    for (const [name, cfg] of Object.entries(EXERCISE_CONFIGS)) {
      const phases = cfg.phases.map(p => p.id);
      const cycle = resolveCycle(cfg.repCycle);
      const ok = resolvePhaseRoles(phases, cycle) ? 'ok' : 'unresolvable';
      expect(`${name}: ${ok}`).toBe(`${name}: ok`);
    }
  });
});

describe('labelling a clean rep', () => {
  const vals = [...hold(30, 10), ...ramp(30, 90, 10), ...hold(90, 10), ...ramp(90, 30, 10)];
  const frames = toFrames(vals, 'shoulderAngleL');
  const opts = {
    phases: ARM_PHASES, repCycle: ARM_CYCLE,
    primaryFeature: 'shoulderAngleL', exerciseName: 'SideArmRaise',
  };

  it('puts the rest plateau in the start phase and the peak in the effort phase', () => {
    const res = labelPhasesBySignal(frames, opts);
    expect(res.ok).toBe(true);
    expect(res.labels.slice(0, 10)).toEqual(Array(10).fill('lowered'));
    expect(res.labels.slice(20, 30)).toEqual(Array(10).fill('raised'));
    expect(res.labels).toContain('transition_up');
    expect(res.labels).toContain('transition_down');
  });

  it('produces a reference that passes the health check', () => {
    const res = labelPhasesBySignal(frames, opts);
    expect(checkPhaseSeparation(asReference(frames, res.labels, 'shoulderAngleL')).ok).toBe(true);
  });
});

describe('labelling a rep that opens at the top', () => {
  // The exact shape that broke the one recorded reference in this repo: the clip
  // starts on a hold at the top, so a positional split labels the arm-UP frames
  // as "lowered". Labelling by value has to survive it.
  const vals = [...hold(90, 10), ...ramp(90, 30, 10), ...hold(30, 10), ...ramp(30, 90, 10)];
  const frames = toFrames(vals, 'shoulderAngleL');
  const run = () => labelPhasesBySignal(frames, {
    phases: ARM_PHASES, repCycle: ARM_CYCLE,
    primaryFeature: 'shoulderAngleL', exerciseName: 'SideArmRaise',
  });

  it('labels the opening plateau as the effort phase, not the start phase', () => {
    expect(run().labels.slice(0, 10)).toEqual(Array(10).fill('raised'));
  });

  it('labels the middle plateau as the start phase', () => {
    expect(run().labels.slice(20, 30)).toEqual(Array(10).fill('lowered'));
  });

  it('still passes the health check that the positional split failed', () => {
    expect(checkPhaseSeparation(asReference(frames, run().labels, 'shoulderAngleL')).ok).toBe(true);
  });
});

describe('refusals', () => {
  const opts = {
    phases: ARM_PHASES, repCycle: ARM_CYCLE,
    primaryFeature: 'shoulderAngleL', exerciseName: 'SideArmRaise',
  };

  it('refuses a signal that never changes', () => {
    const res = labelPhasesBySignal(toFrames(hold(45, 40), 'shoulderAngleL'), opts);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/never changes/);
  });

  it('refuses when the movement never settles at either end', () => {
    // A triangle wave: constant slope, sharp turning points, so the movement
    // never dwells at either end. (A cosine would NOT do here - it flattens at
    // its turning points, which is exactly what settling looks like.)
    const vals = [...ramp(30, 90, 30), ...ramp(90, 30, 30)];
    const res = labelPhasesBySignal(toFrames(vals, 'shoulderAngleL'), { ...opts, bandPct: 0.02 });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/rest posture/);
  });

  it('refuses an unknown exercise rather than picking an end at random', () => {
    const vals = [...hold(30, 10), ...ramp(30, 90, 10), ...hold(90, 10)];
    const res = labelPhasesBySignal(toFrames(vals, 'shoulderAngleL'), { ...opts, exerciseName: 'Mystery' });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/which end/);
  });

  it('refuses when the primary feature is mostly missing', () => {
    const vals = [...hold(NaN, 30), ...hold(30, 5), ...hold(90, 5)];
    const res = labelPhasesBySignal(toFrames(vals, 'shoulderAngleL'), opts);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/missing/);
  });
});

describe('rescuing the existing recorded reference', () => {
  // Its feature values are real; only the labels were wrong, and relabelling
  // needs no source video. If this passes, SideArmRaise needs no re-recording.
  const feature = 'shoulderAngleL';
  const result = labelPhasesBySignal(recorded.template, {
    phases: ARM_PHASES, repCycle: recorded.repCycle,
    primaryFeature: feature, exerciseName: 'SideArmRaise',
  });

  it('relabels without needing the source video', () => {
    expect(result.ok).toBe(true);
  });

  it('turns a reference the health check rejected into one it accepts', () => {
    const before = checkPhaseSeparation({ ...recorded, mode: 'rep' });
    expect(before.ok).toBe(false);

    const relabelled = {
      ...recorded,
      name: 'SideArmRaise',
      mode: 'rep',
      template: recorded.template.map((f, i) => ({ ...f, phase: result.labels[i] })),
    };
    const after = checkPhaseSeparation(relabelled);
    expect(after.ok).toBe(true);
    // The arm-down end becomes the start posture and the arm-up end the effort.
    expect(after.details.startMean).toBeLessThan(40);
    expect(after.details.effortMean).toBeGreaterThan(80);
  });
});

// ─── Declared feature directions ─────────────────────────────────────────────
// The labeller anchors "which end is rest" on the canonical template. That works
// only for features the template sweeps, so an alternative feature could not be
// trialled without first inventing template magnitudes for it — which is exactly
// what sank the earlier ankleAngleToe attempt, where a guessed 88->68 met a real
// 100-130.
//
// A config may now declare a feature's DIRECTION without its magnitude.
// Direction follows from anatomy and holds for every body; magnitude does not.

describe('resolveExpectedDirection', () => {
  it('still prefers the canonical template where it has values', () => {
    // Each exercise's OWN templated feature: dorsiflexion now sweeps the ankle
    // angle, the calf raises still sweep footPitchNorm.
    expect(resolveExpectedDirection('SeatedDorsiflexion', 'ankleAngleToeL')).toBe(-1);
    expect(resolveExpectedDirection('CalfRaisesSeated', 'footPitchNormL')).toBe(1);
  });

  it('falls back to a declared direction for a feature the template omits', () => {
    // Without this the labeller refuses outright: "cannot tell which end of
    // footPitchNormL is the rest posture". The two features have swapped roles -
    // the ankle angle is templated now and footPitchNorm is the declared one -
    // but the fallback is what is under test, not which feature uses it.
    expect(resolveExpectedDirection('SeatedDorsiflexion', 'footPitchNormL')).toBe(-1);
    expect(resolveExpectedDirection('StandingDorsiflexion', 'ankleAngleToeL')).toBe(-1);
  });

  it('has dorsiflexion and calf raises pointing opposite ways', () => {
    // The anatomy: dorsiflexion brings the toes toward the shin and CLOSES the
    // knee-ankle-toe angle; a calf raise plantarflexes and OPENS it. Getting
    // these the same way round would make each exercise count the other.
    expect(resolveExpectedDirection('SeatedDorsiflexion', 'ankleAngleToeR')).toBe(-1);
    expect(resolveExpectedDirection('CalfRaisesSeated', 'ankleAngleToeR')).toBe(1);
    expect(resolveExpectedDirection('StandingDorsiflexion', 'ankleAngleToeR')).toBe(-1);
    expect(resolveExpectedDirection('CalfRaisesStanding', 'ankleAngleToeR')).toBe(1);
  });

  it('applies the declaration to every side and aggregate of the family', () => {
    for (const key of ['ankleAngleToeL', 'ankleAngleToeR', 'ankleAngleHeelL']) {
      expect(`${key}:${resolveExpectedDirection('SeatedDorsiflexion', key)}`)
        .toBe(`${key}:-1`);
    }
  });

  it('counts dorsiflexion on the angle at the ankle', () => {
    // Switched on measured evidence. footPitchNorm is (toe.y - heel.y) / shank,
    // a raw image-space ratio that reports how tilted the foot LOOKS rather than
    // how far the ankle moved, and it failed three distinct ways on device -
    // a phone moved to the floor, an occluded far foot, and a patient who
    // changed their knee angle mid-set and stopped being counted.
    expect(EXERCISE_CONFIGS.SeatedDorsiflexion.primaryFeatureBase).toBe('ankleAngleToe');
    const eng = new DTWPhaseMachine(
      generateReference(EXERCISE_CONFIGS.SeatedDorsiflexion),
      { targetReps: 5, side: 'left' }
    );
    expect(eng.primaryFeature).toBe('ankleAngleToeL');
  });

  it('carries measured magnitudes, not guessed ones', () => {
    // The invariant the old "never magnitude" guard was protecting, now that the
    // switch has happened: a guessed 88->68 meeting a real 100-130 is what sank
    // the previous attempt at this feature. So the synthetic template's values
    // must agree with what the recorded reference actually demonstrates.
    const cfg = EXERCISE_CONFIGS.SeatedDorsiflexion;
    const vals = cfg.phases.flatMap(ph => {
      const f = ph.features.ankleAngleToe;
      return f ? [f.from, f.to] : [];
    });
    expect(vals.length).toBeGreaterThan(0);

    // Range observed in the recorded reference (ankleAngleToeR): 104.65..131.14.
    // Allow a little slack for rounding the template to whole degrees.
    for (const v of vals) {
      expect(`${v} within demonstrated range`).toBe(
        `${v}${v >= 100 && v <= 135 ? '' : ' OUT OF RANGE'} within demonstrated range`
      );
    }
  });

  it('returns 0 for a feature with neither template values nor a declaration', () => {
    expect(resolveExpectedDirection('SeatedDorsiflexion', 'elbowAngleMin')).toBe(0);
  });

  it('returns 0 for an unknown exercise', () => {
    expect(resolveExpectedDirection('NotAnExercise', 'ankleAngleToeR')).toBe(0);
  });
});
