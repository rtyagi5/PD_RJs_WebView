// ---------------------------------------------
// dtw/phaseLabeller.js
// Assigns phase labels to recorded frames from the MOVEMENT, not the frame index.
//
// ReferenceExtractor used to label phases by position: first half of the rep got
// phases[0], second half got phases[1], with no reference to any feature value
// (`autoLabelPhases`, and again in `handleExport`). That is why the one recorded
// reference in this repo has its `lowered` phase sitting at ~92 degrees with the
// arm UP — the clip simply happened to open on a hold at the top.
//
// The engine derives refStartValue, refEffortValue and templateDirection from
// these labels, so getting them wrong inverts the direction gate and the
// exercise silently counts nothing. Every reference authored through the old
// path is suspect; see references/README.md.
//
// Labelling from the signal also makes the result independent of WHERE
// detectRepBoundaries chose to cut the rep, because refStartValue is computed
// from frames labelled `start` rather than from frame 0. A template that opens
// at the top of the movement still labels correctly.
// ---------------------------------------------
import { EXERCISE_CONFIGS, generateReference } from './specToReference.js';
import { stripSideSuffix } from './universalFeatures.js';

/** Fraction of the observed span that counts as "at" the start or effort posture. */
export const DEFAULT_BAND_PCT = 0.15;

/** Minimum frames that must land in each of the start and effort bands. */
const MIN_BAND_FRAMES = 3;

/** Resolve {start, effort} from either the current or the legacy repCycle shape. */
export function resolveCycle(repCycle) {
  if (!repCycle) return null;
  if (repCycle.start && repCycle.effort) return { start: repCycle.start, effort: repCycle.effort };
  if (repCycle.from && repCycle.to) return { start: repCycle.from, effort: repCycle.to };
  return null;
}

function mean(a) {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
}

/**
 * Which way does this exercise's primary feature move from rest into effort?
 *
 * This cannot be inferred from a recording alone: SideArmRaise starts LOW
 * (shoulderAngle 30 -> 90) while SeatedDorsiflexion starts HIGH
 * (footPitchNorm 0.12 -> -0.05). Both are "rest to effort", in opposite
 * directions. The canonical synthetic reference is the semantic anchor for which
 * end is which; the recording supplies only the shape between them.
 *
 * @returns {number} +1, -1, or 0 when it cannot be determined
 */
export function resolveExpectedDirection(exerciseName, primaryFeature) {
  const config = EXERCISE_CONFIGS[exerciseName];
  if (!config || !primaryFeature) return 0;
  let ref;
  try {
    ref = generateReference(config);
  } catch {
    return 0;
  }
  const cycle = resolveCycle(ref.repCycle);
  if (!cycle || !Array.isArray(ref.template)) return 0;

  const valuesIn = (phase) => ref.template
    .filter(f => f.phase === phase)
    .map(f => f.features?.[primaryFeature])
    .filter(Number.isFinite);

  const startMean = mean(valuesIn(cycle.start));
  const effortMean = mean(valuesIn(cycle.effort));
  if (Number.isFinite(startMean) && Number.isFinite(effortMean)) {
    return Math.sign(effortMean - startMean);
  }

  // The template is the preferred anchor, but it only sweeps the features the
  // exercise currently counts with. A config may also DECLARE the direction of a
  // feature it does not sweep, which is what makes an alternative feature
  // testable on real footage without first inventing template magnitudes for it
  // — the exact mistake that sank the previous ankleAngleToe attempt, where a
  // guessed 88->68 met a real 100-130.
  //
  // Direction is safe to declare where magnitude is not, because it follows from
  // anatomy rather than from any particular body.
  const declared = config.featureDirections?.[stripSideSuffix(primaryFeature)];
  return Number.isFinite(declared) ? Math.sign(declared) : 0;
}

/**
 * Split the phase list into the four roles the labeller uses.
 *
 * Phases are declared in cycle order, e.g.
 *   [lowered, transition_up, raised, transition_down]
 * so whatever sits between `start` and `effort` going forward is the approach,
 * and whatever sits between `effort` and `start` (wrapping) is the return.
 */
export function resolvePhaseRoles(phases, cycle) {
  const startIdx = phases.indexOf(cycle.start);
  const effortIdx = phases.indexOf(cycle.effort);
  if (startIdx === -1 || effortIdx === -1) return null;

  const between = (fromIdx, toIdx) => {
    const out = [];
    for (let i = 1; i < phases.length; i++) {
      const idx = (fromIdx + i) % phases.length;
      if (idx === toIdx) break;
      out.push(phases[idx]);
    }
    return out;
  };

  const approach = between(startIdx, effortIdx);
  const recover = between(effortIdx, startIdx);
  return {
    start: cycle.start,
    effort: cycle.effort,
    // Fall back to the destination posture when an exercise declares no
    // transition phase in that direction.
    approach: approach[0] || cycle.effort,
    recover: recover[0] || approach[0] || cycle.start,
  };
}

/** Centred moving average, so a single noisy frame cannot flip a slope sign. */
function smooth(series, window = 3) {
  const half = Math.floor(window / 2);
  return series.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let j = i - half; j <= i + half; j++) {
      if (j < 0 || j >= series.length) continue;
      if (!Number.isFinite(series[j])) continue;
      sum += series[j];
      n++;
    }
    return n ? sum / n : NaN;
  });
}

/**
 * Label frames by the primary feature's value.
 *
 * @param {Array}  frames  - [{ features: { ... } }]
 * @param {Object} opts
 * @param {string[]} opts.phases          - canonical phase ids, in cycle order
 * @param {Object}   opts.repCycle        - { start, effort } or legacy { from, to }
 * @param {string}   opts.primaryFeature
 * @param {number}   [opts.expectedDirection] - +1/-1; resolved from the config if omitted
 * @param {string}   [opts.exerciseName]      - used to resolve direction when not given
 * @param {number}   [opts.bandPct]           - default DEFAULT_BAND_PCT
 * @returns {{ok:boolean, labels:string[]|null, reason:string|null, details:Object}}
 */
export function labelPhasesBySignal(frames, opts = {}) {
  const {
    phases, repCycle, primaryFeature,
    exerciseName = null, bandPct = DEFAULT_BAND_PCT,
  } = opts;
  const details = {};

  if (!Array.isArray(frames) || frames.length < 4) {
    return { ok: false, labels: null, reason: 'not enough frames to label', details };
  }
  if (!Array.isArray(phases) || phases.length < 2) {
    return { ok: false, labels: null, reason: 'need at least two phases', details };
  }
  const cycle = resolveCycle(repCycle);
  if (!cycle) {
    return { ok: false, labels: null, reason: 'repCycle must define start and effort', details };
  }
  const roles = resolvePhaseRoles(phases, cycle);
  if (!roles) {
    return {
      ok: false, labels: null,
      reason: `repCycle refers to phases not in the phase list (${cycle.start}, ${cycle.effort})`,
      details,
    };
  }
  if (!primaryFeature) {
    return { ok: false, labels: null, reason: 'no primary feature selected', details };
  }

  const raw = frames.map(f => f.features?.[primaryFeature]);
  const finite = raw.filter(Number.isFinite);
  if (finite.length < frames.length * 0.5) {
    return {
      ok: false, labels: null,
      reason: `${primaryFeature} is missing on more than half the frames`,
      details,
    };
  }

  const series = smooth(raw);
  const lo = Math.min(...finite);
  const hi = Math.max(...finite);
  const span = hi - lo;
  Object.assign(details, { primaryFeature, min: lo, max: hi, span });

  if (!(span > 0)) {
    return { ok: false, labels: null, reason: 'the primary feature never changes', details };
  }

  let direction = Number.isFinite(opts.expectedDirection) && opts.expectedDirection !== 0
    ? opts.expectedDirection
    : resolveExpectedDirection(exerciseName, primaryFeature);
  if (!direction) {
    return {
      ok: false, labels: null,
      reason:
        `cannot tell which end of ${primaryFeature} is the rest posture for ` +
        `"${exerciseName || '(unknown exercise)'}" — pick a known exercise so the ` +
        `canonical template can anchor the direction`,
      details,
    };
  }
  details.direction = direction;

  // Direction decides which extreme is rest and which is effort.
  const startValue = direction > 0 ? lo : hi;
  const effortValue = direction > 0 ? hi : lo;
  const band = bandPct * span;
  Object.assign(details, { startValue, effortValue, band });

  const labels = new Array(frames.length);
  let startCount = 0;
  let effortCount = 0;

  for (let i = 0; i < frames.length; i++) {
    const v = series[i];
    if (!Number.isFinite(v)) {
      // Carry the previous label rather than inventing a phase for a dropped frame.
      labels[i] = labels[i - 1] ?? roles.start;
      continue;
    }
    if (Math.abs(v - startValue) <= band) {
      labels[i] = roles.start;
      startCount++;
    } else if (Math.abs(v - effortValue) <= band) {
      labels[i] = roles.effort;
      effortCount++;
    } else {
      // Between the two plateaus: which way is it travelling? Slope against the
      // template direction, from the smoothed series. Using the slope rather
      // than the frame index is what makes this correct for a template that
      // opens partway through the movement.
      const prev = series[Math.max(0, i - 1)];
      const next = series[Math.min(frames.length - 1, i + 1)];
      const slope = (Number.isFinite(next) ? next : v) - (Number.isFinite(prev) ? prev : v);
      labels[i] = slope * direction >= 0 ? roles.approach : roles.recover;
    }
  }

  Object.assign(details, { startCount, effortCount });
  if (startCount < MIN_BAND_FRAMES || effortCount < MIN_BAND_FRAMES) {
    return {
      ok: false, labels: null,
      reason:
        `only ${startCount} frame(s) at the rest posture and ${effortCount} at the effort ` +
        `posture (need ${MIN_BAND_FRAMES} each). The movement may never settle at either end — ` +
        `re-record resting fully between reps, or widen the band.`,
      details,
    };
  }

  return { ok: true, labels, reason: null, details };
}
