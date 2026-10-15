// A recorded reference names the feature FAMILY the movement lives in. What it
// does NOT get to decide on its own is which limb to watch — that depends on how
// the exercise is assigned:
//
//   side: 'left' / 'right'  -> watch the assigned limb (re-resolve the pin onto it)
//   side: 'alternating'     -> watch an aggregate, and require the side to change
//   side: 'both'            -> watch an aggregate, either limb counts, order free
//
// Before any of this, the pin was honoured verbatim and bypassed the auto-picker's
// side filter: a BicepCurls reference recorded on the right arm counted the right
// elbow even for a patient assigned the left, silently counting nothing.
//
// The 'both' case was then found on device — BicepCurls is recorded 'both', so the
// swap resolved it to elbowAngleL for a left-assigned session and right-arm curls
// counted nothing:
//   [DTW] Primary feature: elbowAngleL range=166.4 minROM=66.6 side=left
import { DTWPhaseMachine } from './DTWPhaseMachine';
import { generateReference, EXERCISE_CONFIGS } from './specToReference';

/** A synthetic reference with a recorded pin bolted on, as the extractor exports. */
function refWithPin(exercise, primaryFeature, over = {}) {
  return { ...generateReference(EXERCISE_CONFIGS[exercise]), primaryFeature, ...over };
}

const engineFor = (ref, side) => new DTWPhaseMachine(ref, { targetReps: 5, side });

describe('a sided reference resolves its pin onto the session side', () => {
  // `side: 'right'` here makes the reference unilateral, which is what the swap
  // logic is for. BicepCurls' own config is 'both' — see the next block.
  const sided = (pin, refSide) => refWithPin('BicepCurls', pin, { side: refSide });

  it('swaps a right-recorded pin to the left for a left session', () => {
    const eng = engineFor(sided('elbowAngleR', 'right'), 'left');
    expect(eng.primaryFeature).toBe('elbowAngleL');
  });

  it('swaps a left-recorded pin to the right for a right session', () => {
    const eng = engineFor(sided('elbowAngleL', 'left'), 'right');
    expect(eng.primaryFeature).toBe('elbowAngleR');
  });

  it('leaves the pin alone when it already matches the session side', () => {
    const eng = engineFor(sided('elbowAngleL', 'left'), 'left');
    expect(eng.primaryFeature).toBe('elbowAngleL');
  });

  it('keeps the pin when the session side is unknown', () => {
    const eng = engineFor(sided('elbowAngleR', 'right'), null);
    expect(eng.primaryFeature).toBe('elbowAngleR');
  });
});

describe('a bilateral reference watches an aggregate, so either limb counts', () => {
  it('promotes a one-sided pin to the aggregate for a falling movement', () => {
    // A curl CLOSES the elbow, so the working arm is the one at the minimum.
    const eng = engineFor(refWithPin('BicepCurls', 'elbowAngleR'), 'left');
    expect(eng.primaryFeature).toBe('elbowAngleMin');
  });

  it('does not care which side the session is assigned', () => {
    for (const side of ['left', 'right', null]) {
      const eng = engineFor(refWithPin('BicepCurls', 'elbowAngleR'), side);
      expect(eng.primaryFeature).toBe('elbowAngleMin');
    }
  });

  it('reads the direction of travel off the template, not a hardcoded suffix', () => {
    const ref = refWithPin('BicepCurls', 'elbowAngleR');
    const eng = engineFor(ref, 'left');
    // lowered (158) -> raised (52): the elbow angle falls into the effort phase.
    expect(eng._effortDirection('elbowAngleR')).toBeLessThan(0);
  });

  it('keeps the pin when no aggregate matches the direction of travel', () => {
    // shoulderAngle RISES into the effort phase, and universalFeatures has no
    // shoulderAngleMax — only shoulderAngleMin, which tracks the resting arm.
    // Resolving onto it would watch the limb that never moves.
    const ref = refWithPin('SideArmRaise', 'shoulderAngleR');
    const eng = engineFor(ref, 'left');
    expect(eng._effortDirection('shoulderAngleR')).toBeGreaterThan(0);
    expect(eng.primaryFeature).not.toBe('shoulderAngleMin');
  });

  it('counts a rep on either arm', () => {
    // The real feature pipeline supplies the aggregates alongside the sided keys
    // (computeUniversalFeatures), so the fixture does the same.
    const ramp = (a, b, n) => Array.from({ length: n }, (_, i) => a + (b - a) * (i / (n - 1)));
    const hold = (v, n) => Array(n).fill(v);
    const rep = [...hold(170, 8), ...ramp(170, 40, 12), ...hold(40, 8), ...ramp(40, 170, 12)];

    const countOn = arm => {
      const eng = engineFor(refWithPin('BicepCurls', 'elbowAngleR'), 'left');
      let t = 1000;
      for (let r = 0; r < 3; r++) {
        for (const v of rep) {
          const L = arm === 'L' ? v : 170;
          const R = arm === 'R' ? v : 170;
          eng.step({
            t, now: t,
            features: { elbowAngleL: L, elbowAngleR: R, elbowAngleMin: Math.min(L, R) },
            say: () => {}, setHighlight: () => {},
          });
          t += 33;
        }
      }
      return eng.repCount;
    };

    // The left arm already worked before this change; the right arm is the bug.
    expect(countOn('L')).toBeGreaterThan(0);
    expect(countOn('R')).toBeGreaterThan(0);
  });
});

describe('alternating and aggregate pins are unchanged', () => {
  it('leaves an aggregate pin untouched', () => {
    const eng = engineFor(refWithPin('MiniSquats', 'kneeAngleMin'), 'right');
    expect(eng.primaryFeature).toBe('kneeAngleMin');
  });

  it('promotes a one-sided pin to an aggregate for an alternating exercise', () => {
    const ref = refWithPin('SeatedMarch', 'kneeLiftNormL');
    const eng = engineFor(ref, 'left');
    expect(eng.primaryFeature).toBe('kneeLiftNormMax');
  });

  it('falls back to the auto-picker when the family has no aggregate', () => {
    // hipToAnkleNorm has no Min/Max/Avg form, so an alternating reference
    // pinned to one side must not be honoured — the auto-picker's own
    // aggregate rule takes over instead.
    const ref = refWithPin('SeatedMarch', 'hipToAnkleNormL');
    const eng = engineFor(ref, 'left');
    expect(/(?:Min|Max|Avg)$/.test(eng.primaryFeature)).toBe(true);
  });
});
