// Unit tests for the ROM-gate resolver. The engine-level behaviour these
// thresholds produce is covered in DTWPhaseMachine.test.js.
import { resolveRomGate, featureKind, absoluteFloorFor, ROM_FLOORS } from './romGate';

/** Build a PatientBaseline-shaped stub with a locked range for one feature. */
function lockedBaseline(feature, range) {
  return { isLocked: true, baseline: { [feature]: { min: 0, max: range, range, mean: range / 2 } } };
}

describe('feature classification', () => {
  it('treats keys containing Angle as degrees', () => {
    expect(featureKind('shoulderAngleL')).toBe('angle');
    expect(featureKind('ankleAngleToeR')).toBe('angle');
    expect(featureKind('kneeAngleMin')).toBe('angle');
    expect(absoluteFloorFor('elbowAngleL')).toBe(ROM_FLOORS.angle);
  });

  it('treats normalized keys as ratios', () => {
    expect(featureKind('footPitchNormL')).toBe('ratio');
    expect(featureKind('kneeLiftNormMax')).toBe('ratio');
    expect(featureKind('handsHeightNorm')).toBe('ratio');
    expect(absoluteFloorFor('footPitchNormL')).toBe(ROM_FLOORS.ratio);
  });

  it('defaults an unknown key to the ratio floor', () => {
    // An 8-degree floor applied to a 0-1 feature would block every rep outright,
    // so the gentler unit is the safe default.
    expect(featureKind('somethingNew')).toBe('ratio');
  });
});

describe('resolveRomGate', () => {
  const base = { primaryFeature: 'shoulderAngleL', minRomPct: 0.25, templateRange: 60 };

  it('falls back to the template range when there is no baseline', () => {
    const g = resolveRomGate({ ...base });
    expect(g.source).toBe('template');
    expect(g.value).toBeCloseTo(15, 6);
    expect(g.baselineValue).toBeNull();
  });

  it('uses the patient range when the baseline is locked and smaller', () => {
    const g = resolveRomGate({ ...base, patientBaseline: lockedBaseline('shoulderAngleL', 40) });
    expect(g.source).toBe('baseline');
    expect(g.value).toBeCloseTo(10, 6); // 0.25 x 40, easier than the template 15
    expect(g.clamped).toBeNull();
  });

  it('ignores a baseline that has not locked yet', () => {
    // Mid-calibration min/max is still growing; a gate derived from it would
    // drift downward frame by frame.
    const bl = lockedBaseline('shoulderAngleL', 40);
    bl.isLocked = false;
    const g = resolveRomGate({ ...base, patientBaseline: bl });
    expect(g.source).toBe('template');
  });

  it('ignores a locked baseline with no entry for the primary feature', () => {
    const g = resolveRomGate({ ...base, patientBaseline: lockedBaseline('kneeAngleL', 40) });
    expect(g.source).toBe('template');
  });

  it('clamps to the template value so a large calibration cannot make the gate harder', () => {
    const g = resolveRomGate({ ...base, patientBaseline: lockedBaseline('shoulderAngleL', 200) });
    expect(g.clamped).toBe('ceiling');
    expect(g.value).toBeCloseTo(15, 6);
  });

  it('clamps a degenerate baseline up to the absolute floor', () => {
    // A calibration that captured almost no movement would otherwise produce a
    // near-zero gate that counts sensor noise as reps.
    const g = resolveRomGate({ ...base, patientBaseline: lockedBaseline('shoulderAngleL', 0.5) });
    expect(g.clamped).toBe('floor');
    expect(g.value).toBe(ROM_FLOORS.angle);
  });

  it('applies the ratio floor to normalized features', () => {
    const g = resolveRomGate({
      primaryFeature: 'footPitchNormL', minRomPct: 0.8, templateRange: 0.17,
      patientBaseline: lockedBaseline('footPitchNormL', 0.001),
    });
    expect(g.value).toBe(ROM_FLOORS.ratio);
  });

  it('prefers a protocol baseline over the in-session calibration', () => {
    // WI-4 adds this source; the resolver must already prefer it so that work
    // is an addition rather than a rewrite.
    const g = resolveRomGate({
      ...base,
      patientBaseline: lockedBaseline('shoulderAngleL', 40),
      protocolBaseline: { jointRanges: { shoulderAngleL: { range: 20 } } },
    });
    expect(g.source).toBe('protocol');
    expect(g.value).toBeCloseTo(8, 6); // 0.25 x 20 = 5, clamped up to the 8 floor
  });

  it('survives a missing template range without producing NaN', () => {
    const g = resolveRomGate({ primaryFeature: 'shoulderAngleL', minRomPct: 0.25, templateRange: undefined });
    expect(Number.isFinite(g.value)).toBe(true);
  });
});

describe('the floor never exceeds the template gate', () => {
  it('does not demand more movement than the demonstration showed', () => {
    // StandingDorsiflexion: 4.84 degrees of range, minRomPct 0.80 -> 3.87.
    // The flat 8-degree floor would raise the gate above the whole movement.
    const gate = resolveRomGate({
      primaryFeature: 'ankleAngleToeL', minRomPct: 0.80, templateRange: 4.84,
    });
    expect(gate.value).toBeCloseTo(3.872, 3);
    expect(gate.value).toBeLessThan(4.84);
  });

  it('still floors a baseline that captured almost nothing', () => {
    const gate = resolveRomGate({
      primaryFeature: 'ankleAngleToeL', minRomPct: 0.80, templateRange: 4.84,
      patientBaseline: lockedBaseline('ankleAngleToeL', 0.1),
    });
    expect(gate.value).toBeCloseTo(3.872, 3);
    expect(gate.clamped).toBe('floor');
  });

  it('leaves exercises with a normal range untouched', () => {
    // SeatedDorsiflexion: 26.49 range -> template gate 21.19, well above 8.
    const gate = resolveRomGate({
      primaryFeature: 'ankleAngleToeR', minRomPct: 0.80, templateRange: 26.49,
    });
    expect(gate.value).toBeCloseTo(21.192, 3);
    expect(gate.floor).toBe(8);
  });
});
