// ---------------------------------------------
// dtw/PatientBaseline.js
// Records and manages patient-specific ROM baselines.
//
// First session: records the patient's personal min/max for each feature
// during a calibration window (~first 2 reps or N seconds).
// Subsequent sessions: loads stored baseline, uses it for:
//   1. Feature normalization (DTW compares against patient's range, not gold standard)
//   2. "Good rep" tolerance (within 5% of personal baseline = good)
//   3. Attempts vs completed reps (partial movement = attempt, full = completed)
//   4. Progress tracking (ROM improvement over sessions)
// ---------------------------------------------

const CALIBRATION_REPS = 2;         // reps to capture before locking baseline
const CALIBRATION_MIN_FRAMES = 60;  // minimum frames before allowing lock
const TOLERANCE = 0.05;             // 5% tolerance for "good rep" classification
const STORAGE_PREFIX = 'dtw_baseline_';

export class PatientBaseline {
  /**
   * @param {string} exerciseName
   * @param {string} patientId - unique patient identifier
   * @param {Object} [opts]
   * @param {Object} [opts.referenceRanges] - Gold standard feature ranges (safety envelope)
   * @param {number} [opts.calibrationReps] - Reps before locking baseline
   * @param {number} [opts.tolerance] - Fraction tolerance for good rep (default 0.05)
   */
  constructor(exerciseName, patientId, opts = {}) {
    this.exerciseName = exerciseName;
    this.patientId = patientId;
    this.referenceRanges = opts.referenceRanges || null;
    this.calibrationReps = opts.calibrationReps ?? CALIBRATION_REPS;
    this.tolerance = opts.tolerance ?? TOLERANCE;

    // Baseline state
    this.isCalibrating = true;
    this.isLocked = false;
    this.calibrationFrames = 0;
    this.calibrationRepsCompleted = 0;

    // Per-feature running min/max during calibration
    this.featureStats = {};  // { key: { min, max, sum, count, emaValue } }

    // Locked baseline: patient's personal ROM per feature
    this.baseline = null;  // { key: { min, max, range, mean } }

    // Session history for progress tracking
    this.sessionHistory = [];  // [{ date, baseline, repStats }]

    // Current session rep tracking
    this.reps = {
      completed: 0,    // Full ROM reps (within tolerance of baseline)
      attempts: 0,     // Partial reps (movement detected but insufficient ROM)
      total: 0,        // completed + attempts
    };

    // Per-rep quality buffer (tracks feature extremes within current rep)
    this._repBuffer = {};  // { key: { min, max } } — reset per rep cycle

    // Try to load existing baseline from storage
    this._loadFromStorage();
  }

  /**
   * Feed a frame of features during calibration or active tracking.
   * Call this every frame.
   *
   * @param {Object} features - Universal feature vector
   */
  updateFrame(features) {
    if (this.isCalibrating && !this.isLocked) {
      this._updateCalibration(features);
    }

    // Always update rep buffer (for attempts vs completed tracking)
    this._updateRepBuffer(features);
  }

  /**
   * Signal that a rep was detected (from DTWPhaseMachine).
   * Classifies the rep as completed or attempt based on baseline comparison.
   *
   * @param {Object} features - Current feature vector at rep completion
   * @param {number} quality - DTW quality score (0-1)
   * @returns {{ completed: boolean, quality: number, romPct: number, details: Object }}
   */
  onRepDetected(features, quality) {
    this.reps.total++;

    if (this.isCalibrating && !this.isLocked) {
      this.calibrationRepsCompleted++;
      if (this.calibrationRepsCompleted >= this.calibrationReps &&
          this.calibrationFrames >= CALIBRATION_MIN_FRAMES) {
        this._lockBaseline();
      }
      // During calibration, all reps count as completed
      this.reps.completed++;
      return { completed: true, quality, romPct: 1.0, details: { calibrating: true } };
    }

    // Compare rep against baseline
    const repAnalysis = this._analyzeRep();

    if (repAnalysis.romPct >= (1 - this.tolerance)) {
      // Within tolerance = completed rep
      this.reps.completed++;
      this._resetRepBuffer();
      return { completed: true, quality, ...repAnalysis };
    } else {
      // Insufficient ROM = attempt
      this.reps.attempts++;
      this._resetRepBuffer();
      return { completed: false, quality, ...repAnalysis };
    }
  }

  /**
   * Get the normalized feature value relative to patient baseline.
   * Returns 0-1 where 0 = baseline min, 1 = baseline max.
   * Values > 1 mean exceeding baseline ROM (improvement!).
   *
   * @param {string} key - Feature key
   * @param {number} value - Raw feature value
   * @returns {number} 0-1+ normalized value, or NaN if no baseline
   */
  normalize(key, value) {
    if (!this.baseline || !this.baseline[key]) return NaN;
    const b = this.baseline[key];
    if (b.range < 1e-6) return Number.isFinite(value) ? 0.5 : NaN;
    return (value - b.min) / b.range;
  }

  /**
   * Get normalized feature vector (all features normalized to patient baseline).
   * @param {Object} features - Raw universal features
   * @returns {Object} Normalized features (0-1 scale per patient)
   */
  normalizeAll(features) {
    const out = {};
    for (const [key, val] of Object.entries(features)) {
      if (!Number.isFinite(val)) { out[key] = val; continue; }
      const norm = this.normalize(key, val);
      out[key] = Number.isFinite(norm) ? norm : val;
    }
    return out;
  }

  /**
   * Get patient-adapted feature ranges for DTW matching.
   * Blends gold standard ranges with patient baseline.
   * @returns {Object|null} { key: { min, max, range } }
   */
  getAdaptedRanges() {
    if (!this.baseline) return null;

    const adapted = {};
    for (const [key, b] of Object.entries(this.baseline)) {
      adapted[key] = {
        min: b.min,
        max: b.max,
        range: b.range,
      };
    }
    return adapted;
  }

  /**
   * Check if a feature value is within the safety envelope (gold standard).
   * Returns null if no safety limit exists.
   * @param {string} key - Feature key
   * @param {number} value - Raw feature value
   * @returns {{ safe: boolean, message: string }|null}
   */
  checkSafety(key, value) {
    if (!this.referenceRanges || !this.referenceRanges[key]) return null;
    const r = this.referenceRanges[key];
    const margin = r.range * 0.25; // 25% beyond reference range = unsafe

    if (value > r.max + margin) {
      return { safe: false, message: `${key} exceeds safe range` };
    }
    if (value < r.min - margin) {
      return { safe: false, message: `${key} below safe range` };
    }
    return { safe: true, message: '' };
  }

  /**
   * Get a summary of the current session for progress tracking.
   * @returns {Object}
   */
  getSessionSummary() {
    return {
      exerciseName: this.exerciseName,
      patientId: this.patientId,
      date: new Date().toISOString(),
      baseline: this.baseline ? { ...this.baseline } : null,
      reps: { ...this.reps },
      completionRate: this.reps.total > 0
        ? Math.round((this.reps.completed / this.reps.total) * 100)
        : 0,
      isCalibrating: this.isCalibrating,
    };
  }

  /**
   * Get progress compared to previous sessions.
   * @returns {Object|null}
   */
  getProgress() {
    if (this.sessionHistory.length === 0 || !this.baseline) return null;

    const prev = this.sessionHistory[this.sessionHistory.length - 1];
    if (!prev.baseline) return null;

    const improvements = {};
    for (const [key, current] of Object.entries(this.baseline)) {
      const prevB = prev.baseline[key];
      if (!prevB) continue;
      const rangeDelta = current.range - prevB.range;
      const rangePct = prevB.range > 1e-6 ? (rangeDelta / prevB.range) * 100 : 0;
      if (Math.abs(rangePct) > 1) { // Only report > 1% change
        improvements[key] = {
          previous: prevB.range,
          current: current.range,
          changePct: Math.round(rangePct),
        };
      }
    }

    return {
      sessionsCompleted: this.sessionHistory.length,
      improvements,
      prevCompletionRate: prev.reps?.total > 0
        ? Math.round((prev.reps.completed / prev.reps.total) * 100)
        : null,
    };
  }

  /**
   * Save current session and baseline to localStorage.
   */
  saveToStorage() {
    const key = this._storageKey();
    const data = {
      baseline: this.baseline,
      sessionHistory: [
        ...this.sessionHistory,
        this.getSessionSummary(),
      ],
      savedAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
      console.warn('[PatientBaseline] localStorage save failed:', e);
    }
  }

  /**
   * Reset baseline (e.g., for re-calibration).
   */
  resetBaseline() {
    this.isCalibrating = true;
    this.isLocked = false;
    this.calibrationFrames = 0;
    this.calibrationRepsCompleted = 0;
    this.featureStats = {};
    this.baseline = null;
    this._resetRepBuffer();
  }

  // ─── Internals ─────────────────────────────────────

  _updateCalibration(features) {
    this.calibrationFrames++;

    for (const [key, val] of Object.entries(features)) {
      if (!Number.isFinite(val)) continue;

      if (!this.featureStats[key]) {
        this.featureStats[key] = { min: val, max: val, sum: val, count: 1 };
      } else {
        const s = this.featureStats[key];
        s.min = Math.min(s.min, val);
        s.max = Math.max(s.max, val);
        s.sum += val;
        s.count++;
      }
    }
  }

  _lockBaseline() {
    this.baseline = {};
    for (const [key, s] of Object.entries(this.featureStats)) {
      const range = s.max - s.min;
      this.baseline[key] = {
        min: s.min,
        max: s.max,
        range,
        mean: s.sum / s.count,
      };
    }

    this.isCalibrating = false;
    this.isLocked = true;
    console.log(`[PatientBaseline] Locked baseline for "${this.exerciseName}" ` +
      `(${Object.keys(this.baseline).length} features, ${this.calibrationFrames} frames, ` +
      `${this.calibrationRepsCompleted} reps)`);
  }

  _updateRepBuffer(features) {
    for (const [key, val] of Object.entries(features)) {
      if (!Number.isFinite(val)) continue;
      if (!this._repBuffer[key]) {
        this._repBuffer[key] = { min: val, max: val };
      } else {
        this._repBuffer[key].min = Math.min(this._repBuffer[key].min, val);
        this._repBuffer[key].max = Math.max(this._repBuffer[key].max, val);
      }
    }
  }

  _resetRepBuffer() {
    this._repBuffer = {};
  }

  /**
   * Analyze the current rep buffer against baseline.
   * Returns ROM percentage and per-feature details.
   */
  _analyzeRep() {
    if (!this.baseline) return { romPct: 1.0, details: { noBaseline: true } };

    const details = {};
    let totalRomPct = 0;
    let featureCount = 0;

    for (const [key, b] of Object.entries(this.baseline)) {
      if (b.range < 1e-6) continue; // Skip static features
      const buf = this._repBuffer[key];
      if (!buf) continue;

      const repRange = buf.max - buf.min;
      const romPct = Math.min(1.5, repRange / b.range); // Cap at 150%

      details[key] = {
        baselineRange: b.range,
        repRange,
        romPct: Math.round(romPct * 100) + '%',
      };

      totalRomPct += romPct;
      featureCount++;
    }

    const avgRomPct = featureCount > 0 ? totalRomPct / featureCount : 1.0;

    return { romPct: avgRomPct, details };
  }

  _storageKey() {
    return `${STORAGE_PREFIX}${this.patientId}_${this.exerciseName}`;
  }

  _loadFromStorage() {
    const key = this._storageKey();
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const data = JSON.parse(raw);

      if (data.baseline && typeof data.baseline === 'object' && Object.keys(data.baseline).length > 0) {
        this.baseline = data.baseline;
        this.isCalibrating = false;
        this.isLocked = true;
        console.log(`[PatientBaseline] Loaded stored baseline for "${this.exerciseName}" ` +
          `(${Object.keys(this.baseline).length} features)`);
      }

      if (Array.isArray(data.sessionHistory)) {
        this.sessionHistory = data.sessionHistory;
      }
    } catch (e) {
      console.warn('[PatientBaseline] localStorage load failed:', e);
    }
  }
}
