// Tests for the export-time checks added alongside checkPhaseSeparation.
// Each one exists because a real exported reference passed every other check
// and was still unusable.
import {
  checkSingleCycle, checkCycleClosure, checkPrimaryFeatureSide, checkReferenceHealth,
} from './referenceHealth';

/** Build a template from a phase plan: [['resting', 3, 0], ['lifted', 4, 1], ...] */
function tpl(plan, feature = 'kneeLiftNormMax') {
  const frames = [];
  for (const [phase, count, value] of plan) {
    for (let i = 0; i < count; i++) frames.push({ phase, features: { [feature]: value } });
  }
  return frames;
}

const base = (template, over = {}) => ({
  name: 'SeatedMarch', mode: 'rep', side: 'alternating',
  repCycle: { start: 'resting', effort: 'lifted', return: 'resting' },
  primaryFeature: 'kneeLiftNormMax',
  template,
  ...over,
});

describe('checkSingleCycle', () => {
  it('accepts one pass that returns to the start phase', () => {
    const r = base(tpl([['resting', 3, 0], ['lifting', 6, 0.3], ['lifted', 12, 0.7],
                        ['lowering', 9, 0.3], ['resting', 30, 0]]));
    expect(checkSingleCycle(r).ok).toBe(true);
  });

  it('accepts one pass that does not wrap', () => {
    const r = base(tpl([['resting', 5, 0], ['lifting', 5, 0.3], ['lifted', 5, 0.7]]));
    expect(checkSingleCycle(r).ok).toBe(true);
  });

  it('rejects a template that cycles more than once', () => {
    // The real SitToStand export: nine runs across sixty frames, with the
    // effort posture "standing" reached twice.
    const r = base(tpl([['sitting', 7, 1.4], ['rising', 8, 1.5], ['standing', 3, 1.55],
                        ['sitting', 8, 1.4], ['seated', 12, 1.25], ['rising', 7, 1.5],
                        ['sitting', 4, 1.4], ['rising', 6, 1.5], ['standing', 5, 1.55]]),
                     { repCycle: { start: 'seated', effort: 'standing', return: 'seated' } });
    const res = checkSingleCycle(r);
    expect(res.ok).toBe(false);
    expect(res.details.effortRuns).toBe(2);
    expect(res.reason).toMatch(/more than once/);
  });

  it('tolerates transition labels chattering inside one climb', () => {
    // The working SeatedDorsiflexion reference: eleven runs, but "raised" is
    // reached once and "lowered" bookends it. A plain run count rejects this.
    const r = base(tpl([['lowered', 12, 129], ['dorsiflexing', 2, 126], ['lowering', 4, 127],
                        ['dorsiflexing', 11, 118], ['lowering', 1, 119],
                        ['dorsiflexing', 3, 110], ['lowering', 1, 111],
                        ['dorsiflexing', 2, 106], ['raised', 4, 105],
                        ['lowering', 8, 120], ['lowered', 12, 129]], 'ankleAngleToeR'),
                     { repCycle: { start: 'lowered', effort: 'raised', return: 'lowered' },
                       primaryFeature: 'ankleAngleToeR', side: 'both' });
    const res = checkSingleCycle(r);
    expect(res.ok).toBe(true);
    // Single-frame "lowering" flickers inside the climb are coalesced away, so
    // eleven raw runs collapse to seven — and "raised" is still reached once.
    expect(res.details.runs).toBe(7);
    expect(res.details.effortRuns).toBe(1);
  });

  it('tolerates the rest plateau flickering into several runs', () => {
    // The real StepUps template: one step, but the long stand before it picked
    // up single-frame "stepping_down" labels and split into five ground runs.
    const r = base(tpl([['ground', 6, 175], ['stepping_down', 1, 172], ['ground', 4, 175],
                        ['stepping_down', 1, 172], ['ground', 5, 175], ['stepping_up', 2, 160],
                        ['stepping_down', 2, 165], ['ground', 23, 175], ['stepping_up', 4, 150],
                        ['up', 7, 120], ['stepping_down', 3, 150], ['ground', 2, 175]],
                       'kneeAngleL'),
                     { repCycle: { start: 'ground', effort: 'up', return: 'ground' },
                       primaryFeature: 'kneeAngleL', side: 'both' });
    const res = checkSingleCycle(r);
    expect(res.ok).toBe(true);
    expect(res.details.effortRuns).toBe(1);
  });

  it('rejects a rest posture that appears in the middle rather than at the ends', () => {
    const r = base(tpl([['lifting', 4, 0.3], ['lifted', 4, 0.7],
                        ['resting', 4, 0], ['lowering', 4, 0.3]]));
    expect(checkSingleCycle(r).ok).toBe(false);
  });

  it('rejects an out-of-order repeat even with the same phase count', () => {
    const r = base(tpl([['resting', 4, 0], ['lifted', 4, 0.7],
                        ['resting', 4, 0], ['lifted', 4, 0.7]]));
    const res = checkSingleCycle(r);
    expect(res.ok).toBe(false);
    expect(res.details.effortRuns).toBe(2);
  });
});

describe('checkCycleClosure', () => {
  it('accepts a cycle that returns to its starting value', () => {
    const r = base(tpl([['resting', 3, 0], ['lifted', 6, 0.7], ['resting', 3, 0]]));
    expect(checkCycleClosure(r).ok).toBe(true);
  });

  it('rejects a fragment that ends far from where it started', () => {
    const r = base(tpl([['resting', 3, 0], ['lifted', 6, 1.0], ['lowering', 3, 0.6]]));
    const res = checkCycleClosure(r);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/does not close/);
  });

  it('measures against the minRomPct a reference declares for itself', () => {
    // nearStartTolerance is minRomPct * range, so a reference with a wide
    // tolerance is allowed a correspondingly looser close.
    const plan = [['resting', 3, 0], ['lifted', 6, 1.0], ['lowering', 3, 0.5]];
    expect(checkCycleClosure(base(tpl(plan))).ok).toBe(false);          // default 25%
    expect(checkCycleClosure(base(tpl(plan), { minRomPct: 0.8 })).ok).toBe(true);
  });

  it('ignores time-mode references, which have no rep cycle to close', () => {
    const r = base(tpl([['straight', 6, 170], ['relaxing', 6, 150]]), { mode: 'time' });
    expect(checkCycleClosure(r).ok).toBe(true);
  });
});

describe('checkPrimaryFeatureSide', () => {
  const template = tpl([['resting', 3, 0], ['lifted', 6, 0.7], ['resting', 3, 0]]);
  // A reference carries its own featureRanges; the check reads them to find out
  // whether the pinned family has an aggregate the engine could promote to.
  const withRanges = (over, ranges) => base(template, { ...over, featureRanges: ranges });

  it('accepts an aggregate on an alternating exercise', () => {
    expect(checkPrimaryFeatureSide(base(template)).ok).toBe(true);
  });

  it('accepts a one-sided pin when the family has an aggregate to promote to', () => {
    const res = checkPrimaryFeatureSide(withRanges(
      { primaryFeature: 'kneeLiftNormL' },
      { kneeLiftNormL: { range: 0.7 }, kneeLiftNormMax: { range: 0.7 } }));
    expect(res.ok).toBe(true);
    expect(res.details.aggregate).toBe('kneeLiftNormMax');
  });

  it('rejects a one-sided pin whose family has no aggregate form', () => {
    const res = checkPrimaryFeatureSide(withRanges(
      { primaryFeature: 'hipToAnkleNormL' },
      { hipToAnkleNormL: { range: 0.3 }, hipToAnkleNormR: { range: 0.3 } }));
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/no\s+aggregate form/);
  });

  it('does not object to a one-sided pin on a two-sided exercise', () => {
    // The engine re-resolves these onto the session's side, so they are fine.
    const res = checkPrimaryFeatureSide(
      base(template, { side: 'both', primaryFeature: 'elbowAngleR' }));
    expect(res.ok).toBe(true);
    expect(res.warning).toBeUndefined();
  });

  it('does not mistake an aggregate suffix for a side', () => {
    const res = checkPrimaryFeatureSide(
      base(template, { side: 'both', primaryFeature: 'elbowAngleMin' }));
    expect(res.ok).toBe(true);
  });
});

describe('checkReferenceHealth', () => {
  it('collects every failing check, not just the first', () => {
    const r = base(
      tpl([['resting', 4, 0], ['lifted', 4, 0.7], ['resting', 4, 0], ['lifted', 4, 0.7]]),
      { side: 'alternating', primaryFeature: 'hipToAnkleNormL',
        featureRanges: { hipToAnkleNormL: { range: 0.3 } } });
    const res = checkReferenceHealth(r);
    expect(res.ok).toBe(false);
    expect(res.errors.map(e => e.check)).toEqual(
      expect.arrayContaining(['single cycle', 'primary feature side']));
  });

  it('passes a healthy single-cycle reference', () => {
    const r = base(tpl([['resting', 3, 0], ['lifting', 6, 0.3], ['lifted', 12, 0.7],
                        ['lowering', 9, 0.3], ['resting', 30, 0]]));
    const res = checkReferenceHealth(r);
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
  });
});

// ---------------------------------------------------------------
// Direction anchoring for features the canonical template does not sweep.
// ---------------------------------------------------------------
describe('SitToStand can be extracted on hip angle', () => {
  // eslint-disable-next-line global-require
  const { resolveExpectedDirection } = require('./phaseLabeller');

  it('anchors hipAngle from the declared direction', () => {
    // Seated the hip is flexed, standing it is extended, so effort > start.
    expect(resolveExpectedDirection('SitToStand', 'hipAngleL')).toBe(1);
    expect(resolveExpectedDirection('SitToStand', 'hipAngleMin')).toBe(1);
  });

  it('still anchors the features the template itself sweeps', () => {
    expect(resolveExpectedDirection('SitToStand', 'kneeAngleL')).toBe(1);
    expect(resolveExpectedDirection('SitToStand', 'hipToAnkleNormL')).toBe(1);
  });

  it('refuses a feature the exercise has no opinion about', () => {
    expect(resolveExpectedDirection('SitToStand', 'elbowAngleL')).toBe(0);
  });
});

describe('time-mode references are checked too', () => {
  // StandingStraightUp holds a posture rather than counting reps, but the hold
  // timer runs on the same phase labels, so separable phases matter just as much.
  const timeRef = (over = {}) => ({
    name: 'StandingStraightUp', mode: 'time', side: 'both',
    repCycle: { start: 'not_straight', effort: 'straight', return: 'not_straight' },
    primaryFeature: 'trunkAngleMin',
    ...over,
  });

  it('accepts a hold whose two postures are clearly apart', () => {
    const r = timeRef({ template: tpl([['not_straight', 8, 150], ['straightening', 4, 162],
                                       ['straight', 12, 175], ['relaxing', 4, 162],
                                       ['not_straight', 8, 150]], 'trunkAngleMin') });
    expect(checkReferenceHealth(r).ok).toBe(true);
  });

  it('rejects a hold whose postures are indistinguishable', () => {
    // Recorded standing tall the whole time: the labeller splits the clip on
    // noise, so the rest posture's mean lands inside the span of the target
    // phase and the hold timer would run more or less continuously.
    const r = timeRef({ template: [
      ...tpl([['not_straight', 8, 174]], 'trunkAngleMin'),
      ...tpl([['straight', 4, 170], ['straight', 4, 178]], 'trunkAngleMin'),
      ...tpl([['not_straight', 8, 174]], 'trunkAngleMin'),
    ] });
    const res = checkReferenceHealth(r);
    expect(res.ok).toBe(false);
    expect(res.errors.map(e => e.check)).toContain('phase separation');
  });
});

describe('checkCapsAgainstDemonstration', () => {
  // eslint-disable-next-line global-require
  const { checkCapsAgainstDemonstration } = require('./referenceHealth');
  const ref = (ranges) => ({ name: 'X', featureRanges: ranges });

  it('passes when the demonstration stays inside the cap', () => {
    const res = checkCapsAgainstDemonstration(
      ref({ elbowAngleL: { min: 45, max: 178, range: 133 } }), { elbowAngle: { min: 40 } });
    expect(res.ok).toBe(true);
    expect(res.warning).toBeUndefined();
  });

  it('warns when the demonstration goes past a min cap', () => {
    // The real BicepCurls numbers: a full curl reaches 11.9 against a cap of 40.
    const res = checkCapsAgainstDemonstration(
      ref({ elbowAngleL: { min: 11.93, max: 178.35, range: 166.4 } }), { elbowAngle: { min: 40 } });
    expect(res.ok).toBe(true);                      // a warning, not a block
    expect(res.warning).toMatch(/past it by 28\.07/);
    expect(res.details.breaches).toHaveLength(1);
  });

  it('warns when the demonstration goes past a max cap', () => {
    const res = checkCapsAgainstDemonstration(
      ref({ shoulderAngleL: { min: 16.8, max: 99.7, range: 82.9 } }), { shoulderAngle: { max: 95 } });
    expect(res.warning).toMatch(/against a cap of max 95/);
  });

  it('checks aggregates as well as sides, and reports the worst', () => {
    const res = checkCapsAgainstDemonstration(
      ref({
        elbowAngleL:   { min: 30, max: 170, range: 140 },
        elbowAngleMin: { min: 11.93, max: 178, range: 166 },
      }), { elbowAngle: { min: 40 } });
    expect(res.details.breaches).toHaveLength(2);
    expect(res.warning).toMatch(/elbowAngleMin/);
    expect(res.warning).toMatch(/and 1 more/);
  });

  it('is silent for an exercise with no caps', () => {
    expect(checkCapsAgainstDemonstration(ref({ a: { min: 0, max: 1 } }), null).ok).toBe(true);
  });
});
