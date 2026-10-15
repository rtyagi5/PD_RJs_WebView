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

/** How far the primary feature may sit from where it started, as a fraction of
 *  its own range, and still count as a closed rep cycle.
 *
 *  Not a taste threshold. DTWPhaseMachine opens the next rep when the primary
 *  feature comes back within `nearStartTolerance = minRomPct * range` of
 *  refStartValue, so this IS that window: a template that does not close to
 *  within it describes an end posture the engine would not accept as "back at
 *  the start". A reference that declares its own minRomPct gets measured
 *  against its own window; 0.25 is DTWPhaseMachine's default for one that
 *  does not. */
const DEFAULT_CLOSURE_PCT = 0.25;
const closurePct = reference => (
  Number.isFinite(reference?.minRomPct) ? reference.minRomPct : DEFAULT_CLOSURE_PCT
);

/** Suffixes that make a feature key side-agnostic. */
const AGGREGATE_SUFFIXES = ['Min', 'Max', 'Avg'];

const isAggregate = key => AGGREGATE_SUFFIXES.some(suf => String(key).endsWith(suf));
const isSided = key => /[LR]$/.test(String(key)) && !isAggregate(key);


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
  if (!reference) return { ok: true, reason: null, details };
  // Runs for time mode too. The consequence differs but is no milder: a
  // time-mode session accumulates hold time for exactly as long as the matched
  // phase equals repCycle.effort
  //
  //   const inTarget = this.phase === this.targetPhaseId;
  //
  // so if the labels do not separate "straight" from "not_straight", the timer
  // either never starts or never stops, and the patient is told they have held
  // a posture they are not in. There is no rep count to look wrong first.
  if (reference.mode !== 'rep' && reference.mode !== 'time') {
    return { ok: true, reason: null, details };
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

/** Collapse the template into consecutive runs of the same phase label. */
function phaseRuns(template) {
  const runs = [];
  for (const frame of template) {
    const phase = frame?.phase;
    if (!runs.length || runs[runs.length - 1].phase !== phase) runs.push({ phase, frames: 1 });
    else runs[runs.length - 1].frames++;
  }
  return runs;
}

/**
 * Drop single-frame runs and re-merge their neighbours.
 *
 * A real recording flickers: one frame of "stepping_down" in the middle of a
 * long stand splits one rest plateau into three runs and would otherwise read
 * as three visits to the rest posture. One frame out of sixty is 2% of a rep -
 * far too brief to be a real phase of the movement.
 */
function coalesceFlickers(runs, minFrames = 2) {
  const kept = runs.filter((r, i) => r.frames >= minFrames || i === 0 || i === runs.length - 1);
  const merged = [];
  for (const run of kept) {
    if (merged.length && merged[merged.length - 1].phase === run.phase) {
      merged[merged.length - 1].frames += run.frames;
    } else {
      merged.push({ ...run });
    }
  }
  return merged;
}

/**
 * A rep template must be ONE pass through the movement.
 *
 * The extractor resamples whatever frame span the operator marked as a rep, so
 * boundaries that actually span two-and-a-half reps produce a template that
 * cycles repeatedly. Nothing downstream notices: every phase is populated, the
 * start and effort postures are still separable, and checkPhaseSeparation
 * passes. But DTW then matches the patient against a template that says the
 * movement goes up, down, up, down, and the phase proportions - which set the
 * tempo baseline and the per-phase cue budget - are all wrong.
 *
 * Counted on the START and EFFORT phases only, not on every phase run. A real
 * recording's TRANSITION labels chatter: on the climb the signal wobbles, the
 * labeller flips between "dorsiflexing" and "lowering" a few times, and the run
 * count inflates without the movement having cycled twice. The working
 * SeatedDorsiflexion reference does exactly that - eleven runs for one clean
 * rep - so a plain run count rejects good references. The start and effort
 * phases are also precisely what the engine reads: refStartValue,
 * refEffortValue and templateDirection all come from those two label sets, and
 * nothing is derived from the transitions.
 */
export function checkSingleCycle(reference) {
  const template = Array.isArray(reference?.template) ? reference.template : [];
  if (template.length < 2) return { ok: true, reason: null, details: {} };

  const cycle = resolveCycle(reference?.repCycle);
  if (!cycle) return { ok: true, reason: null, details: {} };

  const runs = coalesceFlickers(phaseRuns(template));
  const details = {
    runs: runs.length,
    sequence: runs.map(r => `${r.phase}(${r.frames})`).join(' -> '),
  };

  const indicesOf = phase => runs
    .map((r, i) => (r.phase === phase ? i : -1))
    .filter(i => i >= 0);

  const effortRuns = indicesOf(cycle.effort);
  details.effortRuns = effortRuns.length;
  if (effortRuns.length > 1) {
    return {
      ok: false,
      reason:
        `the effort posture "${cycle.effort}" occurs ${effortRuns.length} separate times, ` +
        `so the template passes through the movement more than once: ${details.sequence}. ` +
        `The rep boundaries on step 3 are spanning more than one repetition.`,
      details,
    };
  }

  // How MANY times the rest posture appears is not the cycle counter - the
  // effort count above is. A long stand between reps picks up label noise and
  // splits into several runs without the movement having repeated: a real
  // StepUps template read ground -> stepping_down -> ground -> stepping_down ->
  // ground before the patient had taken a single step, and counting those as
  // five repetitions rejected a template with exactly one.
  //
  // What does matter is that the rest posture TOUCHES an end. A rep either
  // starts at rest, ends at rest, or both; a rest plateau found only in the
  // middle means the marked span begins partway through one repetition and
  // finishes partway through the next, so the template's first frame is not the
  // posture the engine waits for before opening a rep.
  const startRuns = indicesOf(cycle.start);
  details.startRuns = startRuns.length;
  if (startRuns.length && !startRuns.includes(0) && !startRuns.includes(runs.length - 1)) {
    return {
      ok: false,
      reason:
        `the rest posture "${cycle.start}" appears only in the middle of the template, ` +
        `not at either end: ${details.sequence}. The marked rep starts partway through ` +
        `a repetition.`,
      details,
    };
  }

  return { ok: true, reason: null, details };
}

/**
 * A rep ends where it began. If the primary feature finishes far from where it
 * started, the marked span is not a whole cycle - it is a fragment, and
 * refStartValue (the posture the engine waits to see before opening a rep) is
 * measured from a posture the template never actually returns to.
 */
export function checkCycleClosure(reference) {
  if (!reference || reference.mode !== 'rep') return { ok: true, reason: null, details: {} };
  const template = Array.isArray(reference.template) ? reference.template : [];
  const feature = resolvePrimaryFeature(reference);
  if (!feature || template.length < 2) return { ok: true, reason: null, details: {} };

  const values = template.map(f => f.features?.[feature]).filter(Number.isFinite);
  if (values.length < 2) return { ok: true, reason: null, details: {} };

  const first = values[0];
  const last = values[values.length - 1];
  const range = reference.featureRanges?.[feature]?.range
    ?? (Math.max(...values) - Math.min(...values));
  if (!(range > 0)) return { ok: true, reason: null, details: {} };

  const limit = closurePct(reference);
  const drift = Math.abs(last - first) / range;
  const details = { feature, first, last, range, drift, limit };
  if (drift <= limit) return { ok: true, reason: null, details };

  return {
    ok: false,
    reason:
      `${feature} ends at ${last.toFixed(3)} but started at ${first.toFixed(3)} - ` +
      `${(drift * 100).toFixed(0)}% of its range away, against the ${(limit * 100).toFixed(0)}% ` +
      `window the engine uses to decide a patient is back at the start. ` +
      `The template does not close, so its end posture would not reopen a rep.`,
    details,
  };
}

/**
 * A one-sided `primaryFeature` is now re-resolved onto the session's side by
 * DTWPhaseMachine._resolvePinnedFeature, so recording on the right and
 * assigning the left is no longer a failure - the engine swaps the key.
 *
 * One case survives that repair. An alternating exercise needs a Min/Max/Avg
 * aggregate, because the active limb changes every rep; if the pinned family
 * has no aggregate form in this reference, the engine cannot promote the pin
 * and discards it for whatever the auto-picker finds instead. The operator's
 * choice is then silently not what counts reps, which is worth catching while
 * the video is still open.
 */
export function checkPrimaryFeatureSide(reference) {
  const pin = reference?.primaryFeature;
  const details = { primaryFeature: pin, side: reference?.side };
  if (!pin || !isSided(pin) || reference.side !== 'alternating') {
    return { ok: true, reason: null, details };
  }

  const base = String(pin).replace(/[LR]$/, '');
  const ranges = reference.featureRanges
    || (Array.isArray(reference.template) ? computeFeatureRanges(reference.template) : {});
  const aggregate = AGGREGATE_SUFFIXES
    .map(suf => `${base}${suf}`)
    .find(key => ranges[key]);
  details.aggregate = aggregate || null;

  if (aggregate) return { ok: true, reason: null, details };

  return {
    ok: false,
    reason:
      `"${pin}" names one side and this exercise alternates, so the engine needs a ` +
      `Min/Max/Avg aggregate to follow whichever limb is active - but "${base}" has no ` +
      `aggregate form in this reference, so your choice would be discarded and reps ` +
      `counted on whatever the auto-picker lands on. Pick an aggregate on step 3.`,
    details,
  };
}

/**
 * A clinical cap the demonstration itself breaches is not a limit.
 *
 * It fires on every patient who performs the exercise the way it was shown, so
 * the warning becomes background noise - and worse, `_classifyRep` marks any
 * rep with a cap breach as `attempt` rather than `completed`, so a whole set of
 * correct repetitions is recorded as a set of failures.
 *
 * Measured three times before this check existed: SeatedDorsiflexion capped at
 * 95 degrees against a demonstration reaching 104.7 ("That's far enough" nine
 * times in ten reps), CalfRaisesSeated capped at 0.22 against 0.299, and
 * BicepCurls capped at a 40-degree elbow against a full curl of 11.9.
 *
 * This does NOT say which of the two is wrong. A cap can be right and the
 * demonstration sloppy, or the cap can be a guess the movement disproves. It
 * says only that the two disagree, which is always worth knowing before a
 * reference ships.
 */
export function checkCapsAgainstDemonstration(reference, caps) {
  const limits = caps || reference?.clinicalCaps;
  const details = { breaches: [] };
  if (!limits || !reference?.featureRanges) return { ok: true, reason: null, details };

  for (const [base, lim] of Object.entries(limits)) {
    for (const suf of ['L', 'R', ...AGGREGATE_SUFFIXES]) {
      const key = `${base}${suf}`;
      const r = reference.featureRanges[key];
      if (!r || !Number.isFinite(r.min) || !Number.isFinite(r.max)) continue;
      const underMin = Number.isFinite(lim?.min) && r.min < lim.min;
      const overMax = Number.isFinite(lim?.max) && r.max > lim.max;
      if (!underMin && !overMax) continue;
      details.breaches.push({
        key,
        demoMin: r.min,
        demoMax: r.max,
        limit: underMin ? lim.min : lim.max,
        kind: underMin ? 'min' : 'max',
        by: underMin ? lim.min - r.min : r.max - lim.max,
      });
    }
  }

  if (!details.breaches.length) return { ok: true, reason: null, details };

  // Reported as a warning, not an error. Which side is wrong is a clinical
  // question, and blocking the export would force an answer from whoever
  // happens to be holding the camera.
  const worst = details.breaches.reduce((a, b) => (b.by > a.by ? b : a));
  return {
    ok: true,
    warning:
      `the demonstration goes past this exercise's own clinical cap: ` +
      `${worst.key} reaches ${worst.kind === 'min' ? worst.demoMin.toFixed(2) : worst.demoMax.toFixed(2)} ` +
      `against a cap of ${worst.kind} ${worst.limit} — past it by ${worst.by.toFixed(2)}` +
      (details.breaches.length > 1 ? ` (and ${details.breaches.length - 1} more)` : '') +
      `. Every patient who matches this demonstration will be warned, and their ` +
      `reps recorded as attempts rather than completions. Either the cap is wrong ` +
      `or the demonstration is.`,
    details,
  };
}

/**
 * Every health check, in one call. Errors block an export; warnings do not.
 *
 * @param {Object} reference
 * @returns {{ok:boolean, errors:Array<{check:string, reason:string}>,
 *            warnings:Array<{check:string, reason:string}>}}
 */
export function checkReferenceHealth(reference, canonical = null) {
  // A freshly exported reference does not carry clinicalCaps - applyCanonicalPolicy
  // adds them at load - so the extractor passes the config in to be checked against.
  const caps = canonical?.clinicalCaps ?? reference?.clinicalCaps ?? null;
  const checks = [
    ['phase separation', checkPhaseSeparation],
    ['single cycle', checkSingleCycle],
    ['cycle closure', checkCycleClosure],
    ['primary feature side', checkPrimaryFeatureSide],
    ['clinical caps', ref => checkCapsAgainstDemonstration(ref, caps)],
  ];
  const errors = [];
  const warnings = [];
  for (const [name, fn] of checks) {
    const res = fn(reference);
    if (!res.ok) errors.push({ check: name, reason: res.reason });
    else if (res.warning) warnings.push({ check: name, reason: res.warning });
  }
  return { ok: errors.length === 0, errors, warnings };
}

export { MIN_SEPARATION_PCT, DEFAULT_CLOSURE_PCT };
