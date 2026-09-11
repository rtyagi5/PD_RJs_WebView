import { PatientBaseline } from './PatientBaseline';

const KEY = 'shoulderAngleL';

/** Feed frames sweeping the feature lo → hi → lo, hitting both extremes exactly. */
function feedRep(bl, lo, hi, halfFrames = 20) {
  for (let i = 0; i <= halfFrames; i++) {
    bl.updateFrame({ [KEY]: lo + (hi - lo) * (i / halfFrames) });
  }
  for (let i = halfFrames; i >= 0; i--) {
    bl.updateFrame({ [KEY]: lo + (hi - lo) * (i / halfFrames) });
  }
  return bl.onRepDetected({ [KEY]: hi });
}

// NOTE: positional constructor — (exerciseName, patientId, opts)
function makeBaseline({ patientId = 'test-patient', exerciseName = 'SideArmRaise', ...opts } = {}) {
  return new PatientBaseline(exerciseName, patientId, opts);
}

beforeEach(() => {
  localStorage.clear();
});

describe('calibration', () => {
  it('starts in calibrating state', () => {
    expect(makeBaseline().isCalibrating).toBe(true);
  });

  it('locks the baseline after the calibration reps', () => {
    const bl = makeBaseline();
    feedRep(bl, 30, 90);
    expect(bl.isCalibrating).toBe(true); // one rep is not enough
    feedRep(bl, 30, 90);
    expect(bl.isCalibrating).toBe(false);
    expect(bl.isLocked).toBe(true);
  });

  it('records the patient\'s own observed range', () => {
    const bl = makeBaseline();
    feedRep(bl, 30, 70);
    feedRep(bl, 30, 70);
    expect(bl.baseline[KEY].min).toBeCloseTo(30, 0);
    expect(bl.baseline[KEY].max).toBeCloseTo(70, 0);
  });

  it('locks even when every rep breached a cap', () => {
    // The deadlock. A clinical cap that sits somewhere every rep crosses used to
    // return before the calibration counter, so the baseline never locked, the
    // ROM gate stayed on the template forever, and nothing said so. Measured on
    // a SeatedDorsiflexion set: the clinical floor (-0.12) sat 0.014 BELOW the
    // demonstration's own peak (-0.106), so all five reps were flagged and the
    // patient scraped a gate set at 80% of a range they were never credited for.
    const bl = makeBaseline();
    const breach = { capBreaches: [{ key: KEY, bound: 'max', source: 'clinicalCap' }] };
    for (let r = 0; r < 2; r++) {
      for (let i = 0; i <= 20; i++) bl.updateFrame({ [KEY]: 30 + 60 * (i / 20) });
      for (let i = 20; i >= 0; i--) bl.updateFrame({ [KEY]: 30 + 60 * (i / 20) });
      bl.onRepDetected({ [KEY]: 90 }, 1, breach);
    }
    expect(bl.isLocked).toBe(true);
    expect(bl.reps.flagged).toBe(2);
    // Flagged reps still must not be graded as good ones.
    expect(bl.reps.completed).toBe(0);
    // And the range they demonstrated is what got captured.
    expect(bl.baseline[KEY].range).toBeCloseTo(60, 0);
  });

  it('does not lock on rep count alone without enough frames', () => {
    const bl = makeBaseline();
    // Two reps but only a handful of frames — below CALIBRATION_MIN_FRAMES.
    for (let r = 0; r < 2; r++) {
      bl.updateFrame({ [KEY]: 30 });
      bl.updateFrame({ [KEY]: 90 });
      bl.onRepDetected({ [KEY]: 90 });
    }
    expect(bl.isCalibrating).toBe(true);
  });
});

describe('rep classification', () => {
  it('counts a full-range rep as completed', () => {
    const bl = makeBaseline();
    feedRep(bl, 30, 90);
    feedRep(bl, 30, 90);
    const result = feedRep(bl, 30, 90);
    expect(result.completed).toBe(true);
  });

  // Regression: the per-rep buffer used to survive the calibration phase, so the
  // first rep classified after the baseline locked always inherited the full
  // calibration min/max and scored 100% ROM no matter how short it really was.
  it('counts a clearly short rep as an attempt', () => {
    const bl = makeBaseline();
    feedRep(bl, 30, 90); // baseline range 60
    feedRep(bl, 30, 90);
    // ~25% of baseline ROM — far below the 70% threshold.
    const result = feedRep(bl, 30, 45);
    expect(result.completed).toBe(false);
    expect(result.romPct).toBeLessThan(0.7);
  });

  it('does not let calibration ROM leak into the first classified rep', () => {
    const bl = makeBaseline();
    feedRep(bl, 0, 100);
    feedRep(bl, 0, 100);
    expect(bl.isCalibrating).toBe(false);
    // The very next rep is tiny; it must be judged on its own merits.
    const first = feedRep(bl, 0, 10);
    expect(first.romPct).toBeLessThan(0.3);
    expect(first.completed).toBe(false);
  });

  it('accepts a rep at ~70% of baseline (the documented tolerance)', () => {
    const bl = makeBaseline();
    feedRep(bl, 0, 100);
    feedRep(bl, 0, 100);
    const result = feedRep(bl, 0, 75);
    expect(result.romPct).toBeGreaterThanOrEqual(0.7);
    expect(result.completed).toBe(true);
  });

  it('tracks completed and attempted counts separately', () => {
    const bl = makeBaseline();
    feedRep(bl, 30, 90);
    feedRep(bl, 30, 90);
    feedRep(bl, 30, 90); // good
    feedRep(bl, 30, 40); // short
    expect(bl.reps.total).toBeGreaterThanOrEqual(2);
    expect(bl.reps.completed + bl.reps.attempts).toBe(bl.reps.total);
  });
});

describe('safety envelope', () => {
  it('returns null when no reference range exists for the feature', () => {
    const bl = makeBaseline();
    expect(bl.checkSafety('unknownFeature', 100)).toBeNull();
  });

  it('flags a value well beyond the reference range', () => {
    const bl = makeBaseline({ referenceRanges: { [KEY]: { min: 30, max: 90, range: 60 } } });
    const verdict = bl.checkSafety(KEY, 200);
    expect(verdict.safe).toBe(false);
  });

  it('accepts a value inside the reference range', () => {
    const bl = makeBaseline({ referenceRanges: { [KEY]: { min: 30, max: 90, range: 60 } } });
    expect(bl.checkSafety(KEY, 60).safe).toBe(true);
  });

  it('allows a 25% margin beyond the range before flagging', () => {
    const bl = makeBaseline({ referenceRanges: { [KEY]: { min: 30, max: 90, range: 60 } } });
    expect(bl.checkSafety(KEY, 100).safe).toBe(true);  // within +15 margin
    expect(bl.checkSafety(KEY, 110).safe).toBe(false); // beyond it
  });
});

describe('persistence', () => {
  it('round-trips a locked baseline through localStorage', () => {
    const bl = makeBaseline();
    feedRep(bl, 30, 90);
    feedRep(bl, 30, 90);
    bl.saveToStorage();

    const restored = makeBaseline();
    expect(restored.baseline[KEY]).toBeDefined();
    expect(restored.baseline[KEY].max).toBeCloseTo(bl.baseline[KEY].max, 0);
  });

  it('keeps separate baselines per patient and exercise', () => {
    const a = makeBaseline();
    feedRep(a, 30, 90);
    feedRep(a, 30, 90);
    a.saveToStorage();

    const other = makeBaseline({ patientId: 'someone-else' });
    expect(other.isCalibrating).toBe(true);
  });

  it('survives corrupt stored data instead of throwing', () => {
    localStorage.setItem('dtw_baseline_test-patient_SideArmRaise', '{not json');
    expect(() => makeBaseline()).not.toThrow();
  });

  it('clears the baseline on reset', () => {
    const bl = makeBaseline();
    feedRep(bl, 30, 90);
    feedRep(bl, 30, 90);
    bl.resetBaseline();
    expect(bl.isCalibrating).toBe(true);
  });
});

describe('normalisation helpers', () => {
  it('normalises a value against the locked baseline', () => {
    const bl = makeBaseline();
    feedRep(bl, 0, 100);
    feedRep(bl, 0, 100);
    const mid = bl.normalize(KEY, 50);
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.7);
  });

  it('reports a session summary', () => {
    const bl = makeBaseline();
    feedRep(bl, 30, 90);
    feedRep(bl, 30, 90);
    const summary = bl.getSessionSummary();
    expect(summary.exerciseName).toBe('SideArmRaise');
    expect(summary.reps).toBeDefined();
  });
});
