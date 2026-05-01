// ---------------------------------------------
// dtw/validateDTW.js
// Validation utility: generates synthetic movement sequences and
// compares DTWPhaseMachine vs PhaseMachine (hand-coded spec) outputs.
// Run from the /reference-extractor page or browser console.
// ---------------------------------------------
import { DTWPhaseMachine } from './DTWPhaseMachine.js';
import { getReference } from './referenceRegistry.js';
import { EXERCISE_CONFIGS } from './specToReference.js';

/**
 * Generate a synthetic movement sequence for an exercise.
 * Creates N reps of the movement pattern by cycling through the reference template.
 *
 * @param {string} exerciseName
 * @param {number} [numReps=5]
 * @param {number} [framesPerRep=60]
 * @param {number} [noise=0.02] - Random noise amplitude (fraction of feature range)
 * @returns {Array<Object>} Array of feature vectors
 */
export function generateSyntheticSequence(exerciseName, numReps = 5, framesPerRep = 60, noise = 0.02) {
  const ref = getReference(exerciseName);
  if (!ref) throw new Error(`No reference for "${exerciseName}"`);

  const template = ref.template;
  const T = template.length;
  const sequence = [];

  for (let rep = 0; rep < numReps; rep++) {
    // Vary speed slightly per rep (0.8x to 1.2x)
    const speedFactor = 0.8 + Math.random() * 0.4;
    const actualFrames = Math.round(framesPerRep * speedFactor);

    for (let i = 0; i < actualFrames; i++) {
      // Map frame index to template position
      const tIdx = (i / (actualFrames - 1)) * (T - 1);
      const lo = Math.floor(tIdx);
      const hi = Math.min(lo + 1, T - 1);
      const frac = tIdx - lo;

      // Interpolate features
      const features = {};
      const fLo = template[lo].features;
      const fHi = template[hi].features;

      for (const key of new Set([...Object.keys(fLo), ...Object.keys(fHi)])) {
        const a = fLo[key];
        const b = fHi[key];
        if (Number.isFinite(a) && Number.isFinite(b)) {
          let val = a + frac * (b - a);
          // Add noise
          const range = ref.featureRanges?.[key]?.range || 1;
          val += (Math.random() - 0.5) * 2 * noise * range;
          features[key] = val;
        } else if (Number.isFinite(a)) {
          features[key] = a;
        } else if (Number.isFinite(b)) {
          features[key] = b;
        }
      }

      sequence.push(features);
    }
  }

  return sequence;
}

/**
 * Run a synthetic sequence through DTWPhaseMachine and collect results.
 * @param {string} exerciseName
 * @param {Array<Object>} sequence - Feature vectors
 * @param {number} [targetReps=5]
 * @returns {Object} { phases, repCounts, feedbacks, qualities, finalRepCount }
 */
export function runDTWOnSequence(exerciseName, sequence, targetReps = 5) {
  const ref = getReference(exerciseName);
  if (!ref) throw new Error(`No reference for "${exerciseName}"`);

  const engine = new DTWPhaseMachine(ref, { targetReps });
  const results = { phases: [], repDeltas: [], feedbacks: [], qualities: [], repCounts: [] };
  let t = 0;

  for (const features of sequence) {
    const out = engine.step({ t: t++, features, now: t * 33 }); // ~30fps timing
    results.phases.push(out.phase);
    results.repDeltas.push(out.repDelta);
    results.repCounts.push(out.repCount);
    results.feedbacks.push(out.feedback);
    results.qualities.push(out.quality);
  }

  return {
    ...results,
    finalRepCount: engine.repCount,
  };
}

/**
 * Full validation for one exercise: generate synthetic data, run DTW, report results.
 * @param {string} exerciseName
 * @param {Object} [opts]
 * @returns {Object} Validation report
 */
export function validateExercise(exerciseName, opts = {}) {
  const numReps = opts.numReps || 5;
  const noise = opts.noise ?? 0.02;

  const ref = getReference(exerciseName);
  if (!ref) return { name: exerciseName, status: 'SKIP', reason: 'No reference' };

  // Scale rep duration to the exercise's refractoryMs (synthetic frames are ~33ms each).
  // Without this, exercises with large refractory windows (e.g. StepUps at 2500ms) get
  // every other rep blocked because consecutive synthetic reps fall inside refractory.
  const refractoryMs = ref?.timing?.refractoryMs || 300;
  const framesPerRep = Math.max(60, Math.ceil((refractoryMs + 1500) / 33));

  const sequence = generateSyntheticSequence(exerciseName, numReps, framesPerRep, noise);
  const dtwResult = runDTWOnSequence(exerciseName, sequence, numReps);

  // Analyze results
  const repAccuracy = dtwResult.finalRepCount / numReps;
  const avgQuality = dtwResult.qualities.reduce((a, b) => a + b, 0) / dtwResult.qualities.length;

  // Phase transitions: count distinct phase changes
  let phaseChanges = 0;
  for (let i = 1; i < dtwResult.phases.length; i++) {
    if (dtwResult.phases[i] !== dtwResult.phases[i - 1]) phaseChanges++;
  }

  // Unique phases seen
  const uniquePhases = new Set(dtwResult.phases);

  // Rep detection timing
  const repFrames = [];
  for (let i = 0; i < dtwResult.repDeltas.length; i++) {
    if (dtwResult.repDeltas[i] > 0) repFrames.push(i);
  }

  const status = repAccuracy >= 0.8 ? 'PASS' : repAccuracy >= 0.5 ? 'WARN' : 'FAIL';

  return {
    name: exerciseName,
    status,
    mode: ref.mode,
    targetReps: numReps,
    detectedReps: dtwResult.finalRepCount,
    repAccuracy: Math.round(repAccuracy * 100) + '%',
    avgQuality: avgQuality.toFixed(3),
    phaseChanges,
    uniquePhases: [...uniquePhases],
    repFrames,
    totalFrames: sequence.length,
    framesPerDetectedRep: dtwResult.finalRepCount > 0
      ? Math.round(sequence.length / dtwResult.finalRepCount)
      : 'N/A',
  };
}

/**
 * Run validation across ALL 16 exercises.
 * @param {Object} [opts]
 * @returns {Array<Object>} Array of validation reports
 */
export function validateAllExercises(opts = {}) {
  const results = [];
  for (const name of Object.keys(EXERCISE_CONFIGS)) {
    try {
      results.push(validateExercise(name, opts));
    } catch (err) {
      results.push({ name, status: 'ERROR', reason: err.message });
    }
  }

  // Summary
  const pass = results.filter(r => r.status === 'PASS').length;
  const warn = results.filter(r => r.status === 'WARN').length;
  const fail = results.filter(r => r.status === 'FAIL').length;
  const skip = results.filter(r => r.status === 'SKIP').length;
  const error = results.filter(r => r.status === 'ERROR').length;

  console.log(`\n[DTW Validation] ${pass} PASS, ${warn} WARN, ${fail} FAIL, ${skip} SKIP, ${error} ERROR (of ${results.length})`);
  console.table(results.map(r => ({
    Exercise: r.name,
    Status: r.status,
    Reps: `${r.detectedReps ?? '?'}/${r.targetReps ?? '?'}`,
    Quality: r.avgQuality || '—',
    Phases: r.uniquePhases?.join(',') || '—',
  })));

  return results;
}

// Expose to browser console for easy testing
if (typeof window !== 'undefined') {
  window.__validateDTW = validateAllExercises;
  window.__validateExercise = validateExercise;
}
