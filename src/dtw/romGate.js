// ---------------------------------------------
// dtw/romGate.js
// Resolves the minimum ROM a movement must cover to count as a rep.
//
// The gate used to be a fixed fraction of the TEMPLATE's feature range:
//
//     minRomForRep = (reference.minRomPct ?? 0.25) * templateRange
//
// which asks every patient to move as far as the idealised template does.
// SeatedDorsiflexion is the clearest failure: minRomPct is 0.80 against a
// template that sweeps 0.12 -> -0.05, so the gate demands ~0.14 of footPitchNorm
// while real limited dorsiflexion produces 0.05-0.15. A stroke patient with
// restricted ankle ROM is then physically incapable of registering a rep, and
// nothing in the UI says so — the reps are just silently uncounted.
//
// The patient's own locked baseline is the correct denominator. This module is
// the single place that decision is made, so WI-4's protocol baseline becomes a
// new *source* here rather than a rewrite of the engine.
// ---------------------------------------------

/**
 * Absolute floors, applied after the baseline scales the gate down.
 *
 * A patient whose calibration captured almost no movement (they were still, or
 * keypoints were unreliable) would otherwise produce a near-zero gate that
 * counts sensor noise as reps — which is worse than under-counting, because it
 * reports progress that did not happen.
 *
 * STARTING VALUES, to be tuned against WI-3 replay data. They are deliberately
 * generous rather than clinically derived; nothing here is a measurement claim.
 */
export const ROM_FLOORS = {
  angle: 8,     // degrees
  ratio: 0.02,  // normalized (shank-relative) units
};

/**
 * Classify a universal feature key as an angle or a normalized ratio.
 * Angles: shoulderAngleL, elbowAngleMin, ankleAngleToeR, ...
 * Ratios: footPitchNormL, kneeLiftNormMax, handsHeightNorm, hipToAnkleNormL, ...
 * @param {string} featureKey
 * @returns {'angle'|'ratio'}
 */
export function featureKind(featureKey) {
  if (typeof featureKey === 'string' && featureKey.includes('Angle')) return 'angle';
  // Ratio is the safer default for an unrecognised key: an 8-degree floor applied
  // to a 0-1 normalized feature would block every rep outright.
  return 'ratio';
}

/** @returns {number} the absolute floor for this feature's units. */
export function absoluteFloorFor(featureKey) {
  return ROM_FLOORS[featureKind(featureKey)];
}

/**
 * Read a feature's locked range out of a baseline-shaped object.
 * @returns {number|null} the range, or null if unavailable/unusable.
 */
function lockedRangeFor(baseline, primaryFeature) {
  if (!baseline || !primaryFeature) return null;
  // PatientBaseline exposes its locked ranges on `.baseline`; a protocol baseline
  // (WI-4) will expose `.jointRanges`. Accept either, plus a plain map.
  const ranges = baseline.baseline || baseline.jointRanges || baseline;
  const entry = ranges?.[primaryFeature];
  const range = entry?.range;
  if (!Number.isFinite(range) || range <= 0) return null;
  return range;
}

/**
 * Resolve the rep ROM gate.
 *
 * Resolution order: protocol baseline > in-session calibration > template range.
 *
 * @param {Object}  args
 * @param {string}  args.primaryFeature   feature the gate is measured on
 * @param {number}  args.minRomPct        fraction of a range that counts as effort
 * @param {number}  args.templateRange    the reference template's range for that feature
 * @param {Object}  [args.patientBaseline] a PatientBaseline (in-session calibration)
 * @param {Object}  [args.protocolBaseline] a WI-4 joint-protocol baseline (not built yet)
 * @returns {{value:number, source:'protocol'|'baseline'|'template',
 *            templateValue:number, baselineValue:number|null,
 *            floor:number, ceiling:number, clamped:'floor'|'ceiling'|null}}
 */
export function resolveRomGate({
  primaryFeature,
  minRomPct,
  templateRange,
  patientBaseline = null,
  protocolBaseline = null,
}) {
  const pct = Number.isFinite(minRomPct) ? minRomPct : 0.25;
  const safeTemplateRange = Number.isFinite(templateRange) ? templateRange : 0;
  const templateValue = pct * safeTemplateRange;

  // The template gate is the ceiling: a patient with an unusually large
  // calibration must not be able to make the gate HARDER than the original.
  const ceiling = templateValue;

  // The floor exists to stop a baseline that captured almost no movement from
  // shrinking the gate into sensor noise. It must never exceed the TEMPLATE
  // gate, because that value is the demonstration's own definition of a full
  // rep - a floor above it asserts that a correct repetition is not one.
  //
  // Measured: StandingDorsiflexion is a genuinely small movement. Its recorded
  // reference separates the two postures by 4.02 degrees, with the plateaus
  // holding to 0.23 - a 17.7:1 signal-to-wobble, in line with every other foot
  // exercise in the set. minRomPct 0.80 puts its template gate at 3.87, and the
  // flat 8-degree angle floor raised that to 8.00: nearly twice the entire
  // demonstrated range. No patient could ever have scored a rep, and the logs
  // would have shown a healthy engine counting nothing.
  //
  // ROM_FLOORS are documented as untuned starting values, so this does not
  // change any number that was ever measured - it only stops one from being
  // applied where it is incoherent. Exercises whose template gate already
  // exceeds the floor (every other reference) are unaffected.
  const rawFloor = absoluteFloorFor(primaryFeature);
  const floor = templateValue > 0 ? Math.min(rawFloor, templateValue) : rawFloor;

  // Only a LOCKED baseline is trusted. Mid-calibration min/max is still growing,
  // so a gate derived from it would drift downward frame by frame.
  const protocolRange = lockedRangeFor(protocolBaseline, primaryFeature);
  const patientRange = patientBaseline?.isLocked
    ? lockedRangeFor(patientBaseline, primaryFeature)
    : null;

  let source = 'template';
  let baselineValue = null;

  if (protocolRange != null) {
    source = 'protocol';
    baselineValue = pct * protocolRange;
  } else if (patientRange != null) {
    source = 'baseline';
    baselineValue = pct * patientRange;
  }

  let value = baselineValue != null ? baselineValue : templateValue;

  // Ceiling first, floor second, so the floor wins any conflict — under-counting
  // is recoverable, counting noise as reps is not.
  let clamped = null;
  if (value > ceiling) { value = ceiling; clamped = 'ceiling'; }
  if (value < floor) { value = floor; clamped = 'floor'; }

  return { value, source, templateValue, baselineValue, floor, ceiling, clamped };
}
