import { featureDistance, fullDTW, OnlineSubsequenceDTW } from './dtwEngine';

const RANGES = {
  shoulderAngleL: { min: 30, max: 90, range: 60 },
  shoulderAngleR: { min: 30, max: 90, range: 60 },
  shoulderAngleMin: { min: 30, max: 90, range: 60 },
  trunkAngleL: { min: 170, max: 172, range: 2 },
};

describe('featureDistance', () => {
  it('is zero for identical vectors', () => {
    const v = { shoulderAngleL: 60, shoulderAngleR: 60 };
    expect(featureDistance(v, v, RANGES, {}, null)).toBe(0);
  });

  it('grows with the size of the difference', () => {
    const ref = { shoulderAngleL: 30 };
    const near = featureDistance({ shoulderAngleL: 40 }, ref, RANGES, {}, null);
    const far = featureDistance({ shoulderAngleL: 90 }, ref, RANGES, {}, null);
    expect(far).toBeGreaterThan(near);
  });

  it('skips features that are NaN on either side', () => {
    const a = { shoulderAngleL: NaN, shoulderAngleR: 60 };
    const b = { shoulderAngleL: 30, shoulderAngleR: 60 };
    // Only the comparable feature counts, and it matches exactly.
    expect(featureDistance(a, b, RANGES, {}, null)).toBe(0);
  });

  it('returns Infinity when nothing is comparable', () => {
    const a = { shoulderAngleL: NaN };
    const b = { shoulderAngleL: 30 };
    expect(featureDistance(a, b, RANGES, {}, null)).toBe(Infinity);
  });

  it('ignores the inactive side and aggregates for a single-side session', () => {
    const live = { shoulderAngleL: 30, shoulderAngleR: 999, shoulderAngleMin: 999 };
    const ref = { shoulderAngleL: 30, shoulderAngleR: 30, shoulderAngleMin: 30 };
    // The wildly wrong right side must not pollute a left-side session.
    expect(featureDistance(live, ref, RANGES, {}, 'left')).toBe(0);
  });

  it('ignores per-side keys for alternating exercises, comparing aggregates only', () => {
    const live = { shoulderAngleL: 999, shoulderAngleR: 999, shoulderAngleMin: 30 };
    const ref = { shoulderAngleL: 30, shoulderAngleR: 30, shoulderAngleMin: 30 };
    expect(featureDistance(live, ref, RANGES, {}, 'alternating')).toBe(0);
  });

  it('floors the normalising range so near-static features cannot dominate', () => {
    // trunkAngle has range 2; without the floor a 2° wobble would read as a full
    // range deviation and swamp the real movement feature.
    const withStatic = featureDistance(
      { trunkAngleL: 172 }, { trunkAngleL: 170 }, RANGES, {}, null
    );
    expect(withStatic).toBeLessThan(0.5);
  });

  it('respects per-feature weights', () => {
    const live = { shoulderAngleL: 60 };
    const ref = { shoulderAngleL: 30 };
    const light = featureDistance(live, ref, RANGES, { shoulderAngleL: 1 }, null);
    const heavy = featureDistance(live, ref, RANGES, { shoulderAngleL: 4 }, null);
    expect(heavy).toBeGreaterThan(light);
  });
});

describe('OnlineSubsequenceDTW', () => {
  // A simple 3-phase template: rest → rise → hold.
  const template = [
    ...Array(10).fill({ features: { shoulderAngleL: 30 }, phase: 'lowered' }),
    ...Array(10).fill(0).map((_, i) => ({
      features: { shoulderAngleL: 30 + (i + 1) * 6 }, phase: 'rising',
    })),
    ...Array(10).fill({ features: { shoulderAngleL: 90 }, phase: 'raised' }),
  ].map((f, i) => ({ ...f, frame: i }));

  function make() {
    return new OnlineSubsequenceDTW({ template, featureRanges: RANGES, side: 'left' });
  }

  it('reports the phase the patient currently resembles', () => {
    const dtw = make();
    let r;
    for (let i = 0; i < 5; i++) r = dtw.step({ shoulderAngleL: 30 });
    expect(r.phase).toBe('lowered');

    for (let i = 0; i < 5; i++) r = dtw.step({ shoulderAngleL: 90 });
    expect(r.phase).toBe('raised');
  });

  it('reports templatePosition as a 0..1 progress value', () => {
    const dtw = make();
    const atRest = dtw.step({ shoulderAngleL: 30 });
    const atTop = dtw.step({ shoulderAngleL: 90 });
    expect(atRest.templatePosition).toBeGreaterThanOrEqual(0);
    expect(atTop.templatePosition).toBeLessThanOrEqual(1);
    expect(atTop.templatePosition).toBeGreaterThan(atRest.templatePosition);
  });

  it('scores quality high for a matching pose and low for a bad one', () => {
    const dtw = make();
    const good = dtw.step({ shoulderAngleL: 30 });
    const bad = dtw.step({ shoulderAngleL: 400 });
    expect(good.quality).toBeGreaterThan(0.9);
    expect(bad.quality).toBeLessThan(good.quality);
  });

  it('clamps quality to the 0..1 range', () => {
    const dtw = make();
    const r = dtw.step({ shoulderAngleL: 5000 });
    expect(r.quality).toBeGreaterThanOrEqual(0);
    expect(r.quality).toBeLessThanOrEqual(1);
  });

  it('reports per-feature deviations against the aligned frame', () => {
    const dtw = make();
    const r = dtw.step({ shoulderAngleL: 30 });
    expect(r.deviations.shoulderAngleL).toMatchObject({ live: 30 });
    expect(r.deviations.shoulderAngleL).toHaveProperty('reference');
    expect(r.deviations.shoulderAngleL).toHaveProperty('normalizedDelta');
  });

  it('survives frames where every feature is missing', () => {
    const dtw = make();
    expect(() => dtw.step({ shoulderAngleL: NaN })).not.toThrow();
  });

  it('resolves ties toward the middle of a held band, not the first frame', () => {
    // Frames 20..29 all encode 90°. A patient holding 90° must be reported as
    // 'raised' rather than snapping to the first frame that happens to tie.
    const dtw = make();
    let r;
    for (let i = 0; i < 6; i++) r = dtw.step({ shoulderAngleL: 90 });
    expect(r.phase).toBe('raised');
  });

  it('forgets accumulated state on reset', () => {
    const dtw = make();
    for (let i = 0; i < 10; i++) dtw.step({ shoulderAngleL: 60 });
    dtw.reset();
    expect(dtw.frameCount).toBe(0);
  });
});

describe('fullDTW', () => {
  const seq = (vals) => vals.map(v => ({ shoulderAngleL: v }));

  // NOTE: fullDTW returns { cost, path } where `cost` is already normalised by
  // path length (see dtwEngine.js) — there is no separate normalizedCost field.
  it('reports near-zero cost for identical sequences', () => {
    const a = seq([30, 45, 60, 75, 90]);
    expect(fullDTW(a, a, RANGES).cost).toBeCloseTo(0, 5);
  });

  it('costs less for a similar sequence than a dissimilar one', () => {
    const ref = seq([30, 45, 60, 75, 90]);
    const similar = fullDTW(seq([31, 46, 59, 76, 89]), ref, RANGES).cost;
    const different = fullDTW(seq([90, 75, 60, 45, 30]), ref, RANGES).cost;
    expect(similar).toBeLessThan(different);
  });

  it('returns an alignment path spanning both sequences', () => {
    const { path } = fullDTW(seq([30, 60, 90]), seq([30, 60, 90]), RANGES);
    expect(path.length).toBeGreaterThan(0);
    expect(path[0]).toEqual([0, 0]);
    expect(path[path.length - 1]).toEqual([2, 2]);
  });

  it('tolerates time warping (same shape, different speed)', () => {
    const fast = seq([30, 60, 90]);
    const slow = seq([30, 30, 60, 60, 90, 90]);
    expect(fullDTW(slow, fast, RANGES).cost).toBeLessThan(0.1);
  });
});
