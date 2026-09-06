// ---------------------------------------------
// dtw/referenceHealth.js
// Semantic health checks for a DTW reference.
//
// validateReference() in referenceSchema.js checks SHAPE — required fields,
// frame structure, at least two phases. A reference can pass all of that and
// still be unusable, because the engine derives three things from the phase
// LABELS that shape validation never looks at:
//
//   refStartValue    mean of the primary feature across repCycle.start frames
//   refEffortValue   mean across repCycle.effort frames
//   templateDirection sign(refEffortValue - refStartValue)
//
// templateDirection drives the direction-aware gate in DTWPhaseMachine.step().
// If the phase labels are wrong, that gate is inverted: the patient performs the
// exercise correctly and the engine rejects the motion as "wrong direction",
// counting nothing while looking healthy in every log.
//
// This was found in a real recorded reference (see references/README.md), which
// is exactly the kind of failure that has to be caught at load rather than
// diagnosed from a patient complaint.
// ---------------------------------------------
import { computeFeatureRanges } from './referenceSchema.js';

/** Minimum separation between start and effort postures, as a fraction of the
 *  feature's own range. Below this the direction gate is measuring noise. */
const MIN_SEPARATION_PCT = 0.15;


function mean(values) {
  if (!values.length) return NaN;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Resolve {start, effort} from either the current or the legacy repCycle shape. */
function resolveCycle(repCycle) {
  if (!repCycle) return null;
  if (repCycle.start && repCycle.effort) return { start: repCycle.start, effort: repCycle.effort };
  if (repCycle.from && repCycle.to) return { start: repCycle.from, effort: repCycle.to };
  return null;
}

/** The feature the engine will gate on: an explicit override, else widest range.
 *  featureRanges is normally computed at registration time, so this check has to
 *  be able to derive them itself in order to run before or after registration. */
function resolvePrimaryFeature(reference) {
  if (reference.primaryFeature) return reference.primaryFeature;
  const ranges = reference.featureRanges
    || (Array.isArray(reference.template) ? computeFeatureRanges(reference.template) : {});
  let best = null;
  let bestRange = -1;
  for (const [key, stats] of Object.entries(ranges)) {
    const r = stats?.range ?? 0;
    if (r > bestRange) { bestRange = r; best = key; }
  }
  return best;
}

/**
 * Check that a reference's phase labels actually separate the start posture from
 * the effort posture on the feature the engine will gate on.
 *
 * @param {Object} reference
 * @returns {{ok:boolean, reason:string|null, details:Object}}
 */
export function checkPhaseSeparation(reference) {
  const details = {};
  if (!reference || reference.mode !== 'rep') {
    return { ok: true, reason: null, details }; // time-mode has no rep gate to break
  }

  const cycle = resolveCycle(reference.repCycle);
  if (!cycle) return { ok: true, reason: null, details }; // shape validation's job

  const feature = resolvePrimaryFeature(reference);
  if (!feature) return { ok: true, reason: null, details };
  details.feature = feature;

  const template = Array.isArray(reference.template) ? reference.template : [];
  const valuesFor = (phase) => template
    .filter(f => f.phase === phase)
    .map(f => f.features?.[feature])
    .filter(Number.isFinite);

  const startVals = valuesFor(cycle.start);
  const effortVals = valuesFor(cycle.effort);

  if (!startVals.length) {
    return { ok: false, reason: `no template frames labelled "${cycle.start}" carry ${feature}`, details };
  }
  if (!effortVals.length) {
    return { ok: false, reason: `no template frames labelled "${cycle.effort}" carry ${feature}`, details };
  }

  const startMean = mean(startVals);
  const effortMean = mean(effortVals);
  const effortMin = Math.min(...effortVals);
  const effortMax = Math.max(...effortVals);
  const range = reference.featureRanges?.[feature]?.range
    ?? (Math.max(...startVals, ...effortVals) - Math.min(...startVals, ...effortVals));


  Object.assign(details, { startMean, effortMean, effortMin, effortMax, range });

  // The decisive check. If the start posture sits INSIDE the span of the effort
  // phase, the two phases are not distinguishable on this feature: the effort
  // phase has swallowed the whole movement (a mis-segmented recording), and
  // both refStartValue and templateDirection become arbitrary.
  if (startMean > effortMin && startMean < effortMax) {
    return {
      ok: false,
      reason:
        `the "${cycle.start}" posture (${feature}=${startMean.toFixed(1)}) lies inside the ` +
        `span of the "${cycle.effort}" phase (${effortMin.toFixed(1)}..${effortMax.toFixed(1)}). ` +
        `The phases are not separable, so templateDirection and refStartValue would both ` +
        `be arbitrary and the direction gate could reject correct movement.`,
      details,
    };
  }

  const separation = range > 0 ? Math.abs(effortMean - startMean) / range : 0;
  details.separation = separation;
  if (separation < MIN_SEPARATION_PCT) {
    return {
      ok: false,
      reason:
        `"${cycle.start}" and "${cycle.effort}" differ by only ` +
        `${(separation * 100).toFixed(0)}% of ${feature}'s range ` +
        `(min ${(MIN_SEPARATION_PCT * 100).toFixed(0)}%). The rep gate would be measuring noise.`,
      details,
    };
  }

  return { ok: true, reason: null, details };
}

export { MIN_SEPARATION_PCT };
