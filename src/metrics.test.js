// Guards the regression class where METRIC_MAP named features that the DTW
// engine never produces, so joint angles silently stopped reaching the host app.
import {
  METRIC_MAP,
  resolveMetricKeys,
  pickExerciseMetrics,
  prettyNum,
  pretty,
  _resetMetricWarnings,
} from './metrics';
import { UNIVERSAL_FEATURE_KEYS } from './dtw/universalFeatures';
import { EXERCISE_CONFIGS } from './dtw/specToReference';

const UNIVERSAL = new Set(UNIVERSAL_FEATURE_KEYS);

describe('METRIC_MAP integrity', () => {
  it('covers every configured exercise', () => {
    for (const name of Object.keys(EXERCISE_CONFIGS)) {
      expect(METRIC_MAP[name]).toBeDefined();
      expect(METRIC_MAP[name].length).toBeGreaterThan(0);
    }
  });

  it('does not name exercises that no longer exist', () => {
    for (const name of Object.keys(METRIC_MAP)) {
      expect(EXERCISE_CONFIGS[name]).toBeDefined();
    }
  });

  // THE regression guard: every entry must resolve to a real universal feature,
  // for every side the exercise can be run with.
  it.each(['left', 'right', 'both'])(
    'resolves every metric to a real universal feature (side=%s)',
    (side) => {
      const bad = [];
      for (const [exercise, metrics] of Object.entries(METRIC_MAP)) {
        for (const metric of metrics) {
          for (const key of resolveMetricKeys(metric, side)) {
            if (!UNIVERSAL.has(key)) bad.push(`${exercise}: "${metric}" → "${key}"`);
          }
        }
      }
      expect(bad).toEqual([]);
    }
  );
});

describe('resolveMetricKeys', () => {
  it('resolves a bilateral base to the active side only', () => {
    expect(resolveMetricKeys('kneeAngle', 'left')).toEqual(['kneeAngleL']);
    expect(resolveMetricKeys('kneeAngle', 'right')).toEqual(['kneeAngleR']);
  });

  it('emits both sides when no single side is active', () => {
    expect(resolveMetricKeys('kneeAngle', 'both')).toEqual(['kneeAngleL', 'kneeAngleR']);
    expect(resolveMetricKeys('kneeAngle', undefined)).toEqual(['kneeAngleL', 'kneeAngleR']);
    expect(resolveMetricKeys('kneeAngle', 'alternating')).toEqual(['kneeAngleL', 'kneeAngleR']);
  });

  it('passes aggregates through untouched regardless of side', () => {
    expect(resolveMetricKeys('kneeAngleMin', 'left')).toEqual(['kneeAngleMin']);
    expect(resolveMetricKeys('handsHeightNorm', 'right')).toEqual(['handsHeightNorm']);
  });

  it('is case-insensitive about side', () => {
    expect(resolveMetricKeys('kneeAngle', 'LEFT')).toEqual(['kneeAngleL']);
  });
});

describe('pickExerciseMetrics', () => {
  beforeEach(() => _resetMetricWarnings());

  it('emits side-resolved universal keys as the payload field names', () => {
    const feat = { shoulderAngleL: 88.4, shoulderAngleR: 12.1, elbowAngleL: 170.2, elbowAngleR: 168 };
    const out = pickExerciseMetrics('SideArmRaise', feat, 'left');
    expect(out).toEqual({ shoulderAngleL: 88, elbowAngleL: 170 });
    // The inactive side must not leak into a single-side session.
    expect(out.shoulderAngleR).toBeUndefined();
  });

  it('emits both sides for a bilateral session', () => {
    const feat = { shoulderAngleL: 88, shoulderAngleR: 87, elbowAngleL: 170, elbowAngleR: 169 };
    const out = pickExerciseMetrics('SideArmRaise', feat, 'both');
    expect(Object.keys(out).sort()).toEqual(
      ['elbowAngleL', 'elbowAngleR', 'shoulderAngleL', 'shoulderAngleR']
    );
  });

  it('omits features that are NaN (missing keypoints) without warning', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const out = pickExerciseMetrics('SideArmRaise', { shoulderAngleL: NaN, elbowAngleL: 170 }, 'left');
    expect(out).toEqual({ elbowAngleL: 170 });
    // NaN is an expected, graceful state — it must not be reported as a config error.
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('warns once when a metric key is absent from the feature set entirely', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    pickExerciseMetrics('SideArmRaise', {}, 'left');
    pickExerciseMetrics('SideArmRaise', {}, 'left'); // repeat → still one warning per key
    expect(warn).toHaveBeenCalledTimes(2); // shoulderAngleL + elbowAngleL, once each
    warn.mockRestore();
  });

  it('returns an empty object for an unknown exercise', () => {
    expect(pickExerciseMetrics('NoSuchExercise', { kneeAngleL: 90 }, 'left')).toEqual({});
  });

  it('tolerates a null feature object', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(pickExerciseMetrics('SideArmRaise', null, 'left')).toEqual({});
    console.warn.mockRestore();
  });
});

describe('number formatting', () => {
  it('rounds angles to whole degrees', () => {
    expect(prettyNum('shoulderAngleL', 88.6)).toBe(89);
  });

  it('keeps 2 decimals for normalized features', () => {
    expect(prettyNum('footPitchNormL', 0.12345)).toBe(0.12);
    expect(prettyNum('kneeLiftNormMax', 0.309)).toBe(0.31);
  });

  it('keeps 2 decimals for small magnitudes even when not normalized', () => {
    expect(prettyNum('someAngle', 1.234)).toBe(1.23);
  });

  it('returns undefined for non-finite values', () => {
    expect(prettyNum('shoulderAngleL', NaN)).toBeUndefined();
    expect(prettyNum('shoulderAngleL', Infinity)).toBeUndefined();
    expect(prettyNum('shoulderAngleL', undefined)).toBeUndefined();
  });

  it('renders an em dash for unusable HUD values', () => {
    expect(pretty('shoulderAngleL', NaN)).toBe('—');
  });
});
