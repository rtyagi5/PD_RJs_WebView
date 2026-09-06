// ---------------------------------------------
// metrics.js
// Which universal features each exercise reports to the host app, and how a
// METRIC_MAP entry resolves to concrete feature keys at runtime.
//
// Extracted from ExerciseTracker_refactored.js so that:
//   - utilities.js no longer imports back into the tracker (circular dependency)
//   - this logic is unit-testable without loading React / tfjs / the webcam
// ---------------------------------------------

// Which metrics to sync / show for each exercise.
//
// IMPORTANT: every entry must be a key produced by computeUniversalFeatures()
// (see UNIVERSAL_FEATURE_KEYS in dtw/universalFeatures.js). Two forms are allowed:
//
//   1. A bilateral BASE name (e.g. 'kneeAngle') — resolved at runtime to the
//      side-suffixed key(s): 'kneeAngleL' for side='left', 'kneeAngleR' for
//      side='right', and BOTH for bilateral/alternating exercises.
//   2. A whole-body aggregate that exists verbatim (e.g. 'kneeAngleMin',
//      'handsHeightNorm') — emitted as-is.
//
// The emitted payload field name is always the RESOLVED universal key
// (e.g. 'kneeAngleL'), so the host app/backend receives unambiguous,
// side-explicit angle data. metrics.test.js enforces that every name here
// resolves against UNIVERSAL_FEATURE_KEYS — do not add legacy spec-only keys.
export const METRIC_MAP = {
  SideArmRaise:         ['shoulderAngle', 'elbowAngle'],
  MiniSquats:           ['kneeAngle', 'kneeAngleMin', 'hipToAnkleNorm'],
  SitToStand:           ['kneeAngle', 'hipToAnkleNorm'],
  LongArcQuad:          ['kneeAngle', 'hipToAnkleNorm'],
  StandingStraightUp:   ['trunkAngle', 'trunkAngleMin', 'kneeAngle', 'hipAngle'],
  SeatedMarch:          ['kneeLiftNorm', 'kneeLiftNormMax', 'hipAngle', 'hipAngleMin'],
  StandingMarch:        ['kneeLiftNorm', 'kneeLiftNormMax', 'hipAngle', 'hipAngleMin'],
  MiniLunges:           ['kneeAngle', 'kneeAngleMin'],
  BicepCurls:           ['elbowAngle', 'elbowAngleMin'],
  LiftsAndChops:        ['handsHeightNorm', 'handsXNorm'],
  StepUps:              ['kneeAngle', 'kneeLiftNorm', 'kneeLiftNormMax'],
  WallPushUp:           ['elbowAngle', 'shoulderAngle', 'trunkAngleMin'],
  CalfRaisesSeated:     ['footPitchNorm', 'ankleAngleToe', 'ankleAngleHeel'],
  CalfRaisesStanding:   ['footPitchNorm', 'ankleAngleToe', 'ankleAngleHeel'],
  SeatedDorsiflexion:   ['footPitchNorm', 'ankleAngleToe', 'trunkAngleMin'],
  StandingDorsiflexion: ['footPitchNorm', 'ankleAngleToe', 'trunkAngleMin'],
};

// Bilateral feature families that exist as `<base>L` / `<base>R` in the
// universal feature set. Anything not listed here is treated as a verbatim key.
export const BILATERAL_BASE_FEATURES = new Set([
  'shoulderAngle', 'elbowAngle', 'hipAngle', 'kneeAngle', 'trunkAngle',
  'ankleAngleToe', 'ankleAngleHeel',
  'wristHeightNorm', 'kneeLiftNorm', 'footPitchNorm', 'hipToAnkleNorm',
]);

/**
 * Resolve a METRIC_MAP entry to the concrete universal feature key(s) to emit.
 * Bilateral bases resolve to the active side; bilateral/alternating sessions
 * emit both sides so the backend gets a complete picture.
 * @param {string} metric - METRIC_MAP entry (base name or verbatim aggregate)
 * @param {string} [side] - 'left' | 'right' | anything else (both)
 * @returns {string[]} concrete universal feature keys
 */
export function resolveMetricKeys(metric, side) {
  if (!BILATERAL_BASE_FEATURES.has(metric)) return [metric];
  const s = String(side || '').toLowerCase();
  if (s === 'left') return [`${metric}L`];
  if (s === 'right') return [`${metric}R`];
  return [`${metric}L`, `${metric}R`];
}

/** Format a value for HUD/logs (string). */
export function pretty(key, val) {
  if (!Number.isFinite(val)) return '—';
  const k = String(key || '').toLowerCase();
  // For normalized/ratio-ish metrics or small magnitudes, show 2 decimals
  if (k.includes('norm') || k.includes('ratio') || Math.abs(val) < 2) {
    return val.toFixed(2);
  }
  return String(Math.round(val));
}

/** Format a value for the sync payload (number, or undefined when unusable). */
export function prettyNum(key, val) {
  if (!Number.isFinite(val)) return undefined;
  const k = String(key || '').toLowerCase();
  if (k.includes('norm') || k.includes('ratio') || Math.abs(val) < 2) {
    return Number(val.toFixed(2));
  }
  return Math.round(val);
}

// Track which unresolved metric keys we've already warned about, so the dev
// console gets one line per bad key instead of one per frame.
const _warnedMetricKeys = new Set();

/** Test seam: forget prior warnings so a test can assert on them. */
export function _resetMetricWarnings() {
  _warnedMetricKeys.clear();
}

/**
 * Build the per-frame metric payload for an exercise from the universal feature set.
 * Emits side-explicit universal keys (e.g. 'shoulderAngleL') as the field names.
 *
 * A key that resolves to nothing is logged once in development — previously such
 * keys were dropped silently, which is how the whole angle-sync payload went
 * missing when the DTW engine replaced the legacy feature names.
 *
 * @param {string} exerciseType
 * @param {Object} feat - universal feature object for the current frame
 * @param {string} [side]
 * @returns {Object} { [universalKey]: number }
 */
export function pickExerciseMetrics(exerciseType, feat, side) {
  const metrics = METRIC_MAP[exerciseType] || [];
  const out = {};

  metrics.forEach(metric => {
    resolveMetricKeys(metric, side).forEach(key => {
      const pv = prettyNum(key, feat?.[key]);
      if (pv !== undefined && pv !== null) {
        out[key] = pv;
      } else if (
        process.env.NODE_ENV !== 'production' &&
        !(feat && key in feat) &&
        !_warnedMetricKeys.has(key)
      ) {
        _warnedMetricKeys.add(key);
        console.warn(
          `[Metrics] "${key}" (from METRIC_MAP.${exerciseType} → "${metric}") ` +
          `is not a universal feature — it will never be sent to the host app.`
        );
      }
    });
  });
  return out;
}
