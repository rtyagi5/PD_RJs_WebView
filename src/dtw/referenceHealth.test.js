// These guard the failure mode that shape validation cannot see: a reference
// that is structurally perfect but whose phase labels invert the direction gate.
import { checkPhaseSeparation } from './referenceHealth';
import { generateAllReferences, EXERCISE_CONFIGS } from './specToReference';
import recordedSideArmRaise from './__fixtures__/broken-positional-labels.ref.json';

/** Minimal rep-mode reference with controllable start/effort postures. */
function makeRef({ startVals, effortVals, feature = 'shoulderAngleL' }) {
  const template = [
    ...startVals.map((v, i) => ({ frame: i, phase: 'lowered', features: { [feature]: v } })),
    ...effortVals.map((v, i) => ({ frame: 100 + i, phase: 'raised', features: { [feature]: v } })),
  ];
  return {
    name: 'Test', mode: 'rep', side: 'left', detector: 'movenet',
    template,
    repCycle: { start: 'lowered', effort: 'raised', return: 'lowered' },
    feedback: { phase: {} },
  };
}

describe('checkPhaseSeparation', () => {
  it('passes every synthetic reference the app ships with', () => {
    // If this ever fails, the generator has produced a template the engine
    // cannot gate on — a much bigger problem than one bad recording.
    for (const [name, ref] of Object.entries(generateAllReferences())) {
      const res = checkPhaseSeparation(ref);
      expect(`${name}: ${res.ok ? 'ok' : res.reason}`).toBe(`${name}: ok`);
    }
  });

  it('accepts phases that are cleanly separated', () => {
    const res = checkPhaseSeparation(makeRef({ startVals: [30, 30, 31], effortVals: [89, 90, 91] }));
    expect(res.ok).toBe(true);
    expect(res.details.separation).toBeGreaterThan(0.15);
  });

  it('rejects a reference whose start posture sits inside the effort span', () => {
    // The mis-segmented-recording signature: the effort phase swallowed the
    // whole movement, so refStartValue and templateDirection are arbitrary.
    const res = checkPhaseSeparation(makeRef({
      startVals: [92, 93, 92],
      effortVals: [21, 55, 94],
    }));
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/lies inside the span/);
  });

  it('rejects phases that barely differ across the full feature range', () => {
    // Separation is relative to the feature's OWN range, which for a real
    // reference is computed across the whole template, not just these two
    // phases. 3 degrees apart on a 100-degree feature is noise.
    const ref = makeRef({ startVals: [30, 31], effortVals: [33, 34] });
    ref.featureRanges = { shoulderAngleL: { min: 0, max: 100, range: 100 } };
    const res = checkPhaseSeparation(ref);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/measuring noise/);
  });

  it('rejects a reference with no frames for a cycle phase', () => {
    const ref = makeRef({ startVals: [30], effortVals: [90] });
    ref.repCycle.effort = 'nonexistent';
    const res = checkPhaseSeparation(ref);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/no template frames/);
  });

  it('leaves time-mode references alone', () => {
    const ref = makeRef({ startVals: [30], effortVals: [31] });
    ref.mode = 'time';
    expect(checkPhaseSeparation(ref).ok).toBe(true);
  });

  it('works without a precomputed featureRanges', () => {
    // featureRanges is added at registration time, so the check has to be able
    // to run either side of that.
    const ref = makeRef({ startVals: [30, 30], effortVals: [90, 90] });
    delete ref.featureRanges;
    expect(checkPhaseSeparation(ref).ok).toBe(true);
  });
});

describe('the recorded SideArmRaise reference', () => {
  it('is registered under a non-canonical name, so it never loads', () => {
    // Lookups use the canonical EXERCISE_CONFIGS key.
    expect(recordedSideArmRaise.name).toBe('Left Side Arm Raise');
    expect(EXERCISE_CONFIGS[recordedSideArmRaise.name]).toBeUndefined();
    expect(EXERCISE_CONFIGS.SideArmRaise).toBeDefined();
  });

  it('would invert the direction gate if it were simply renamed', () => {
    // This is why WI-8 is not a rename. Its "lowered" phase sits at ~92 degrees
    // (arm UP) while its "raised" phase spans the entire sweep, so
    // templateDirection would flip and raising the arm would be rejected as
    // wrong-direction motion. See references/README.md.
    const res = checkPhaseSeparation({ ...recordedSideArmRaise, mode: 'rep' });
    expect(res.ok).toBe(false);
    expect(res.details.startMean).toBeGreaterThan(85);
    expect(res.details.effortMin).toBeLessThan(30);
    expect(res.details.effortMax).toBeGreaterThan(85);
  });
});
