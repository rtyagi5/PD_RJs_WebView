// Headless validation of all 16 DTW exercise references
import { bootstrapAllReferences } from './bootstrapReferences.js';
import { validateAllExercises, validateExercise } from './validateDTW.js';

beforeAll(() => {
  bootstrapAllReferences();
});

test('all 16 exercises detect correct rep count (synthetic, no side filter)', () => {
  const results = validateAllExercises({ numReps: 5, noise: 0.02 });

  const failures = results.filter(r => r.status === 'FAIL' || r.status === 'ERROR');

  // Log summary for debugging
  for (const r of results) {
    console.log(
      `${r.status.padEnd(5)} ${r.name?.padEnd(25) || '?'} ` +
      `reps=${r.detectedReps ?? '?'}/${r.targetReps ?? '?'} ` +
      `phases=[${r.uniquePhases?.join(',') || '—'}] ` +
      `quality=${r.avgQuality || '—'}`
    );
  }

  // At minimum, no exercises should ERROR
  const errors = results.filter(r => r.status === 'ERROR');
  expect(errors).toHaveLength(0);

  // Time-mode exercises (StandingStraightUp) don't count reps — exclude from rep check
  const repExercises = results.filter(r => r.mode !== 'time');
  const timeExercises = results.filter(r => r.mode === 'time');
  const passingRep = repExercises.filter(r => r.status === 'PASS');
  console.log(`\nRep-mode: ${passingRep.length}/${repExercises.length} PASS`);
  console.log(`Time-mode: ${timeExercises.map(r => r.name).join(', ')} (skipped rep check)`);

  // All rep-mode exercises should PASS
  expect(passingRep.length).toBe(repExercises.length);
});

test('SideArmRaise with side=left detects reps correctly', () => {
  // This specifically tests the side-aware filtering fix
  const ref = require('./referenceRegistry.js').getReference('SideArmRaise');
  expect(ref).toBeTruthy();

  const { DTWPhaseMachine } = require('./DTWPhaseMachine.js');
  const engine = new DTWPhaseMachine(ref, { targetReps: 5, side: 'left' });

  // Generate synthetic sequence using only left-side features
  const template = ref.template;
  const T = template.length;
  let t = 0;

  for (let rep = 0; rep < 5; rep++) {
    for (let i = 0; i < 60; i++) {
      const tIdx = (i / 59) * (T - 1);
      const lo = Math.floor(tIdx);
      const hi = Math.min(lo + 1, T - 1);
      const frac = tIdx - lo;

      const features = {};
      const fLo = template[lo].features;
      const fHi = template[hi].features;

      for (const key of new Set([...Object.keys(fLo), ...Object.keys(fHi)])) {
        const a = fLo[key];
        const b = fHi[key];
        if (Number.isFinite(a) && Number.isFinite(b)) {
          let val = a + frac * (b - a);
          // For right-side features, keep them static (simulating single-arm exercise)
          if (key.endsWith('R')) {
            val = fLo[key]; // stay at the "lowered" position
          }
          features[key] = val;
        }
      }

      engine.step({ t: t++, features, now: t * 33 });
    }
  }

  console.log(`SideArmRaise side=left: detected ${engine.repCount}/5 reps`);
  expect(engine.repCount).toBeGreaterThanOrEqual(3); // at least 3 of 5
  expect(engine.repCount).toBeLessThanOrEqual(7);    // no more than 7 (no wild overcounting)
});
