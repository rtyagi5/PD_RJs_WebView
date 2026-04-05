// ---------------------------------------------
// dtw/DTWPhaseMachine.js
// Drop-in replacement for PhaseMachine, driven by DTW reference matching.
// Same .step() interface → no changes needed in ExerciseTracker.
// ---------------------------------------------
import { OnlineSubsequenceDTW } from './dtwEngine.js';
import { computeFeatureRanges, extractPhaseOrder } from './referenceSchema.js';
import { BODY_PART_FEATURE_MAP } from './universalFeatures.js';
import { PatientBaseline } from './PatientBaseline.js';

export class DTWPhaseMachine {
  /**
   * @param {Object} reference - Reference JSON object (see referenceSchema.js)
   * @param {Object} opts - { targetReps, targetSeconds }
   */
  constructor(reference, { targetReps = 10, targetSeconds, patientId, side } = {}) {
    this.reference = reference;
    this.targetReps = targetReps;
    this.patientId = patientId || null;

    // Mode
    this.mode = reference.mode === 'time' ? 'time' : 'reps';
    this.isAlternating = reference.side === 'alternating';

    // For alternating exercises, use 'alternating' mode in the DTW engine so it
    // compares only aggregate features (Min/Max/Avg), making both legs visible.
    // The JWT 'side' indicates the affected side but must not restrict rep counting.
    this.side = this.isAlternating ? 'alternating' : (side || null);

    // Compute feature ranges if not provided
    this.featureRanges = reference.featureRanges || computeFeatureRanges(reference.template);

    // Extract phase order and rep cycle (full cycle: start → effort → return)
    this.phaseOrder = extractPhaseOrder(reference.template);
    const rawCycle = reference.repCycle || {};
    // Support both old { from, to } and new { start, effort, return } formats
    this.repCycle = {
      start:  rawCycle.start  ?? rawCycle.from ?? this.phaseOrder[0],
      effort: rawCycle.effort ?? rawCycle.to   ?? this.phaseOrder[1],
      return: rawCycle.return ?? rawCycle.from ?? this.phaseOrder[0],
    };

    // Timing
    const timing = reference.timing || {};
    this.dwellMs = timing.dwellMs ?? 200;
    this.refractoryMs = timing.refractoryMs ?? 300;

    // Time-mode config
    this.targetMs = this.mode === 'time'
      ? (typeof targetSeconds === 'number' ? targetSeconds * 1000
        : (typeof targetReps === 'number' ? targetReps * 1000 : 5000))
      : null;
    this.targetPhaseId = this.repCycle.effort;

    // Build the DTW engine
    this.dtw = new OnlineSubsequenceDTW({
      template: reference.template,
      featureRanges: this.featureRanges,
      matchThreshold: timing.matchThreshold ?? 0.5,
      refractoryFrames: Math.max(5, Math.round((this.refractoryMs / 1000) * (timing.fps || 30))),
      weights: reference.featureWeights || null,
      side: this.side,
    });

    // Feedback config
    this.feedback = reference.feedback || {};
    this.formDeviationThreshold = reference.formDeviationThreshold ?? 0.3;

    // State
    this.phase = null;
    this.prevPhase = null;
    this.repCount = 0;
    this.lastFeedback = '';
    this.refractoryUntil = 0;
    this.lastPhaseEnterAt = 0;

    // Time-mode timers
    this.holdStartMs = null;
    this.accumHoldMs = 0;

    // Rep tracking — full cycle state machine: idle → sawStart → sawEffort → completed
    this.cycleState = 'idle'; // 'idle' | 'sawStart' | 'sawEffort'

    // Alternating guardrail: track which side was used per rep
    this.lastActiveSide = null;        // side counted on the previous rep
    this.activeSideDuringCycle = null; // side detected during the current cycle

    // Primary feature ROM tracking: measure actual movement instead of template position
    // Find the feature with the largest range (filtered by active side)
    let bestKey = null;
    let bestRange = 0;
    for (const [key, stats] of Object.entries(this.featureRanges)) {
      if (this.isAlternating) {
        // Alternating: primary feature must be an aggregate (Min/Max/Avg) so it
        // captures whichever leg is active rather than one specific side.
        if (key.endsWith('L') || key.endsWith('R')) continue;
      } else if (this.side) {
        if (this.side === 'left' && key.endsWith('R')) continue;
        if (this.side === 'right' && key.endsWith('L')) continue;
        if (key.endsWith('Min') || key.endsWith('Max') || key.endsWith('Avg')) continue;
      }
      if ((stats.range || 0) > bestRange) {
        bestRange = stats.range;
        bestKey = key;
      }
    }
    this.primaryFeature = bestKey;
    this.primaryFeatureRange = bestRange;
    this.minRomForRep = (reference.minRomPct ?? 0.25) * bestRange; // % of template range = meaningful movement
    this.cycleFeatureMin = Infinity;
    this.cycleFeatureMax = -Infinity;
    console.log(`[DTW] Primary feature: ${bestKey} range=${bestRange.toFixed(1)} minROM=${this.minRomForRep.toFixed(1)} side=${this.side}`);

    // Effort-adjacent phases: include transition phases leading to the effort phase
    // so limited-ROM patients who reach transition_up (but not raised) still get reps
    const effortIdx = this.phaseOrder.indexOf(this.repCycle.effort);
    this.effortPhases = new Set([this.repCycle.effort]);
    if (effortIdx > 0) {
      const prevPhase = this.phaseOrder[effortIdx - 1];
      if (prevPhase !== this.repCycle.start && prevPhase !== this.repCycle.return) {
        this.effortPhases.add(prevPhase);
      }
    }

    // Patient baseline (D-phase: adaptive ROM)
    this.patientBaseline = null;
    if (this.patientId) {
      this.patientBaseline = new PatientBaseline(reference.name, this.patientId, {
        referenceRanges: this.featureRanges,
      });
    }

    // Build a spec-like object for compatibility
    this.spec = {
      name: reference.name,
      mode: this.mode,
      detector: reference.detector || 'movenet',
      phases: this.phaseOrder.map(id => ({ id })),
      rep: { from: this.repCycle.start, to: this.repCycle.effort },
      framing: reference.framing || undefined,
    };
  }

  resetCounters() {
    this.phase = null;
    this.prevPhase = null;
    this.repCount = 0;
    this.lastFeedback = '';
    this.refractoryUntil = 0;
    this.lastPhaseEnterAt = 0;
    this.holdStartMs = null;
    this.accumHoldMs = 0;
    this.cycleState = 'idle';
    this.cycleFeatureMin = Infinity;
    this.cycleFeatureMax = -Infinity;
    this.lastActiveSide = null;
    this.activeSideDuringCycle = null;
    this.dtw.reset();
    // Don't reset patient baseline on counter reset — it persists across the session
  }

  /**
   * Same interface as PhaseMachine.step().
   * @param {Object} inputs - { t, features, now, say, setHighlight }
   * @returns {Object} - { phase, repDelta, repCount, feedback, done, timeHeldMs?, timeRemainingMs? }
   */
  step({ t, features, now = performance.now(), say, setHighlight }) {
    // Feed frame to patient baseline tracker
    if (this.patientBaseline) {
      this.patientBaseline.updateFrame(features);
    }

    // Run DTW matching
    const result = this.dtw.step(features);
    let repDelta = 0;
    let repClassification = null;

    // Diagnostic: throttled DTW state logging (every 60 frames)
    if (!this._diagFC) this._diagFC = 0;
    if (++this._diagFC % 60 === 0) {
      const pf = this.primaryFeature;
      const pVal = pf && Number.isFinite(features[pf]) ? features[pf].toFixed(1) : 'NaN';
      const range = this.featureRanges[pf];
      const rMin = range ? range.min?.toFixed(1) : '?';
      const rMax = range ? range.max?.toFixed(1) : '?';
      console.log(
        `[DTW-diag] phase=${this.phase || '—'} cycle=${this.cycleState}` +
        ` quality=${(result.quality ?? 0).toFixed(3)} tPos=${(result.templatePosition ?? 0).toFixed(2)}` +
        ` pf=${pf}=${pVal} (ref ${rMin}→${rMax}) rom=${(this.cycleFeatureMax - this.cycleFeatureMin).toFixed(1)}` +
        ` minRom=${this.minRomForRep.toFixed(1)} reps=${this.repCount}`
      );
    }

    // Phase detection with dwell
    const newPhase = result.phase;
    if (!this.phase) {
      this.phase = newPhase;
      this.lastPhaseEnterAt = now;
      // Initialize cycle state on first phase detection
      if (this.mode === 'reps' && this.phase === this.repCycle.start) {
        this.cycleState = 'sawStart';
        this.cycleFeatureMin = Infinity;
        this.cycleFeatureMax = -Infinity;
        this.activeSideDuringCycle = null;
      }
    } else if (newPhase !== this.phase) {
      if (now - this.lastPhaseEnterAt >= this.dwellMs) {
        this.prevPhase = this.phase;
        this.phase = newPhase;
        this.lastPhaseEnterAt = now;
      }
    }

    // Track actual ROM of primary feature during current cycle
    if (this.cycleState !== 'idle' && this.primaryFeature) {
      const pVal = features[this.primaryFeature];
      if (Number.isFinite(pVal)) {
        this.cycleFeatureMin = Math.min(this.cycleFeatureMin, pVal);
        this.cycleFeatureMax = Math.max(this.cycleFeatureMax, pVal);
      }
    }
    const actualRom = this.cycleFeatureMax - this.cycleFeatureMin;
    const romOk = actualRom >= this.minRomForRep;

    // Detect which leg is active during this cycle (alternating guardrail)
    if (this.isAlternating && this.cycleState !== 'idle') {
      const hL = features.hipAngleL;
      const hR = features.hipAngleR;
      // Only assign when one leg is clearly more flexed (>30° difference) to avoid
      // mis-detecting side when both legs are near the resting position
      if (Number.isFinite(hL) && Number.isFinite(hR) && Math.abs(hL - hR) > 30) {
        this.activeSideDuringCycle = hL < hR ? 'left' : 'right';
      }
    }

    // Rep counting (reps mode): full cycle start → effort → return
    // Runs every frame (not just on phase transitions) for responsiveness
    if (this.mode === 'reps') {
      if (this.cycleState === 'idle' && this.phase === this.repCycle.start) {
        this.cycleState = 'sawStart';
        this.cycleFeatureMin = Infinity;
        this.cycleFeatureMax = -Infinity;
        this.activeSideDuringCycle = null;
      }
      if (this.cycleState === 'sawStart' && this.effortPhases.has(this.phase)) {
        this.cycleState = 'sawEffort';
      }
      if (this.cycleState === 'sawEffort' && this.phase === this.repCycle.return
          && romOk && now >= this.refractoryUntil) {
        // Full cycle complete with meaningful movement — check alternating guardrail
        if (this._alternatingSideOk()) {
          repClassification = this._classifyRep(features, result.quality);
          if (repClassification.completed) {
            this.repCount++;
            repDelta = 1;
            this.lastActiveSide = this.activeSideDuringCycle;
          }
        }
        console.log(`[DTW] Rep! rom=${actualRom.toFixed(1)} min=${this.minRomForRep.toFixed(1)} reps=${this.repCount} activeSide=${this.activeSideDuringCycle} lastSide=${this.lastActiveSide}`);
        this.refractoryUntil = now + this.refractoryMs;
        this.cycleState = 'sawStart'; // ready for next cycle (already at start)
        this.cycleFeatureMin = Infinity;
        this.cycleFeatureMax = -Infinity;
        this.activeSideDuringCycle = null;
      }
    }

    // Backup: DTW cycle detection can advance the cycle state even without
    // phase transitions (handles edge cases where phase labels are noisy)
    if (result.cycleComplete && repDelta === 0 && this.mode === 'reps' && now >= this.refractoryUntil) {
      // Only count if we've seen at least the effort phase AND meaningful ROM
      if (this.cycleState === 'sawEffort' && romOk) {
        if (this._alternatingSideOk()) {
          repClassification = this._classifyRep(features, result.quality);
          if (repClassification.completed) {
            this.repCount++;
            repDelta = 1;
            this.lastActiveSide = this.activeSideDuringCycle;
          }
        }
        console.log(`[DTW-backup] Rep! rom=${actualRom.toFixed(1)} min=${this.minRomForRep.toFixed(1)} reps=${this.repCount} activeSide=${this.activeSideDuringCycle} lastSide=${this.lastActiveSide}`);
        this.refractoryUntil = now + this.refractoryMs;
        this.cycleState = 'idle';
        this.cycleFeatureMin = Infinity;
        this.cycleFeatureMax = -Infinity;
        this.activeSideDuringCycle = null;
      }
    }

    // Time-mode accounting
    let timeHeldMs = 0;
    let timeRemainingMs = null;

    if (this.mode === 'time' && this.targetPhaseId) {
      const inTarget = this.phase === this.targetPhaseId;

      if (inTarget) {
        if (this.holdStartMs == null) this.holdStartMs = now;
      } else if (this.holdStartMs != null) {
        this.accumHoldMs += now - this.holdStartMs;
        this.holdStartMs = null;
      }

      timeHeldMs = this.accumHoldMs;
      if (this.holdStartMs != null) {
        timeHeldMs += Math.max(0, now - this.holdStartMs);
      }

      timeRemainingMs = Math.max(0, (this.targetMs ?? 0) - timeHeldMs);
      this.repCount = Math.floor(timeHeldMs / 1000); // legacy HUD
    }

    // Feedback (priority: form > range > tempo > phase)
    const fb = this._pickFeedback(result, features);
    this.lastFeedback = fb;

    // Done?
    const done = this.mode === 'time'
      ? (this.targetMs != null ? timeHeldMs >= this.targetMs : false)
      : this.repCount >= this.targetReps;

    return {
      phase: this.phase,
      repDelta,
      repCount: this.repCount,
      feedback: this.lastFeedback,
      done,
      timeHeldMs: this.mode === 'time' ? timeHeldMs : undefined,
      timeRemainingMs: this.mode === 'time' ? Math.max(0, timeRemainingMs ?? 0) : undefined,
      // Extra DTW-specific data (available but not required by ExerciseTracker)
      quality: result.quality,
      templatePosition: result.templatePosition,
      deviations: result.deviations,
      // Patient baseline data
      repClassification,
      isCalibrating: this.patientBaseline?.isCalibrating ?? false,
      completedReps: this.patientBaseline?.reps?.completed ?? this.repCount,
      attemptedReps: this.patientBaseline?.reps?.attempts ?? 0,
      totalReps: this.patientBaseline?.reps?.total ?? this.repCount,
      activeSide: this.activeSideDuringCycle,   // null when idle; 'left'/'right' during rep
    };
  }

  /**
   * Returns true if the current rep is on the correct side (alternating guardrail).
   * Non-alternating exercises always return true.
   */
  _alternatingSideOk() {
    if (!this.isAlternating) return true;
    if (!this.activeSideDuringCycle) return true; // couldn't detect side: benefit of doubt
    if (!this.lastActiveSide) return true;         // first rep: any side OK
    return this.activeSideDuringCycle !== this.lastActiveSide;
  }

  _pickFeedback(dtwResult, features) {
    const fb = this.feedback;
    const deviations = dtwResult.deviations;

    // 0. Alternating guardrail: warn when same leg used twice in a row
    if (this.isAlternating && this.cycleState === 'sawEffort'
        && this.activeSideDuringCycle && this.lastActiveSide
        && this.activeSideDuringCycle === this.lastActiveSide) {
      return 'Switch legs — alternate each step!';
    }

    // 1. Form/safety: check if any body part deviates significantly
    if (fb.form && Array.isArray(fb.form)) {
      for (const formRule of fb.form) {
        const featureKeys = BODY_PART_FEATURE_MAP[formRule.bodyPart] || [];
        for (const key of featureKeys) {
          const dev = deviations[key];
          if (dev && Math.abs(dev.normalizedDelta) > this.formDeviationThreshold) {
            return formRule.say;
          }
        }
      }
    }

    // 2. Range: check if patient isn't reaching far enough or overshooting
    if (fb.range) {
      const pos = dtwResult.templatePosition;
      // Near the peak of the movement (70-100% through template) but quality is low
      if (pos > 0.5 && pos < 0.9 && dtwResult.quality < 0.5 && fb.range.tooLittle) {
        return fb.range.tooLittle;
      }
      // Overshoot detection: features exceed reference range
      if (this._detectOvershoot(deviations) && fb.range.tooMuch) {
        return fb.range.tooMuch;
      }
    }

    // 3. Tempo (future: needs movement speed tracking)
    // Placeholder for when we add speed comparison

    // 4. Phase feedback (default)
    if (fb.phase && this.phase) {
      return fb.phase[this.phase] || fb.phase.transition || this.lastFeedback;
    }

    return this.lastFeedback || '';
  }

  /**
   * Check if any feature significantly overshoots the reference range.
   */
  _detectOvershoot(deviations) {
    for (const [key, dev] of Object.entries(deviations)) {
      const range = this.featureRanges[key];
      if (!range) continue;
      // Feature exceeds reference max by more than 20% of range
      if (dev.live > range.max + 0.2 * range.range) return true;
      // Feature below reference min by more than 20% of range
      if (dev.live < range.min - 0.2 * range.range) return true;
    }
    return false;
  }

  /**
   * Classify a detected rep as completed or attempt using PatientBaseline.
   * If no baseline is set, all reps count as completed.
   */
  _classifyRep(features, quality) {
    if (!this.patientBaseline) {
      return { completed: true, quality, romPct: 1.0, details: {} };
    }
    return this.patientBaseline.onRepDetected(features, quality);
  }

  /**
   * Save the patient baseline to localStorage.
   * Call at session end (onComplete).
   */
  saveBaseline() {
    if (this.patientBaseline) {
      this.patientBaseline.saveToStorage();
    }
  }

  /**
   * Get session summary for backend sync.
   */
  getSessionSummary() {
    return this.patientBaseline?.getSessionSummary() || {
      exerciseName: this.reference.name,
      reps: { completed: this.repCount, attempts: 0, total: this.repCount },
    };
  }

  /**
   * Get progress vs previous sessions.
   */
  getProgress() {
    return this.patientBaseline?.getProgress() || null;
  }
}
