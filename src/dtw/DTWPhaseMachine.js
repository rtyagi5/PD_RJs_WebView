// ---------------------------------------------
// dtw/DTWPhaseMachine.js
// Drop-in replacement for PhaseMachine, driven by DTW reference matching.
// Same .step() interface → no changes needed in ExerciseTracker.
// ---------------------------------------------
import { OnlineSubsequenceDTW } from './dtwEngine.js';
import { computeFeatureRanges, extractPhaseOrder } from './referenceSchema.js';
import { BODY_PART_FEATURE_MAP } from './universalFeatures.js';
import { PatientBaseline } from './PatientBaseline.js';

// Resolve a startCue against the active side. Accepts either a plain string (returned
// as-is) or an object keyed by side ('left' | 'right' | 'alternating' | 'both').
// Resolution order: exact side match → 'both' → first available variant.
function resolveStartCue(cue, side) {
  if (!cue) return null;
  if (typeof cue === 'string') return cue;
  if (typeof cue === 'object') {
    if (side && cue[side]) return cue[side];
    if (cue.both) return cue.both;
    return cue.left || cue.right || cue.alternating || null;
  }
  return null;
}

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
    this.formDeviationThreshold = reference.formDeviationThreshold ?? 0.5;

    // State
    this.phase = null;
    this.prevPhase = null;
    this.repCount = 0;
    this.lastFeedback = '';
    this.refractoryUntil = 0;
    this.lastPhaseEnterAt = 0;
    this._repAnnouncedUntil = 0; // suppress other feedback for 1.5s after a rep counts

    // Time-mode timers
    this.holdStartMs = null;
    this.accumHoldMs = 0;

    // Rep tracking — full cycle state machine: idle → sawStart → sawEffort → completed
    this.cycleState = 'idle'; // 'idle' | 'sawStart' | 'sawEffort'
    this.effortEnteredAt = 0; // timestamp when arm entered sawEffort (used for time-based return gate)

    // Alternating guardrail: track which side was used per rep
    this.lastActiveSide = null;        // side counted on the previous rep
    this.activeSideDuringCycle = null; // side detected during the current cycle

    // Primary feature ROM tracking: measure actual movement instead of template position.
    // Honor an explicit `reference.primaryFeature` override first (used by bilateral-symmetric
    // exercises like MiniSquats that want side-independent tracking via an aggregate feature).
    // Otherwise fall back to the auto-picker: largest-range feature filtered by active side.
    let bestKey = null;
    let bestRange = 0;
    if (reference.primaryFeature && this.featureRanges[reference.primaryFeature]) {
      bestKey = reference.primaryFeature;
      bestRange = this.featureRanges[reference.primaryFeature].range || 0;
    } else {
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

    // Reference start value for the primary feature — used as a guard to prevent
    // counting a rep when the DTW mislabels the return phase while the limb is
    // still mid-range (happens when DTW quality is low and template position drifts).
    // Computed as the mean primary-feature value across all start-phase frames.
    this.refStartValue = null;
    if (this.primaryFeature && Array.isArray(reference.template) && reference.template.length > 0) {
      const startFrames = reference.template.filter(f => f.phase === this.repCycle.start);
      const vals = startFrames.map(f => f.features?.[this.primaryFeature]).filter(Number.isFinite);
      if (vals.length > 0) {
        this.refStartValue = vals.reduce((a, b) => a + b, 0) / vals.length;
      }
    }

    // Build a spec-like object for compatibility
    this.spec = {
      name: reference.name,
      mode: this.mode,
      detector: reference.detector || 'movenet',
      phases: this.phaseOrder.map(id => ({ id })),
      rep: { from: this.repCycle.start, to: this.repCycle.effort },
      framing: reference.framing || undefined,
      startCue: resolveStartCue(reference.startCue, this.side) || undefined,
    };

    // One-line health summary — verifies the engine resolved sensible defaults.
    // primaryFeature and minRomForRep are the two most common silent-failure points.
    // Adaptive precision so tiny thresholds (e.g. footPitchNorm) aren't shown as "0.0"
    const fmt = (n) => (n == null ? 'null' : (Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(3)));
    console.log(
      `[DTW] Engine ready: ${reference.name} | mode=${this.mode} side=${this.side} ` +
      `detector=${this.spec.detector} primary=${this.primaryFeature} ` +
      `refStartValue=${fmt(this.refStartValue)} ` +
      `minRomForRep=${fmt(this.minRomForRep)} ` +
      `effortPhases=${[...this.effortPhases].join(',')} ` +
      `repCycle=${this.repCycle.start}->${this.repCycle.effort}->${this.repCycle.return || this.repCycle.start} ` +
      `targetReps=${this.targetReps ?? '—'} targetMs=${this.targetMs ?? '—'} ` +
      `patientBaseline=${this.patientBaseline ? 'on' : 'off'}`
    );
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
    this.effortEnteredAt = 0;
    this._movedAwayAt = null;
    this.cycleFeatureMin = Infinity;
    this.cycleFeatureMax = -Infinity;
    this.lastActiveSide = null;
    this.activeSideDuringCycle = null;
    this._repAnnouncedUntil = 0;
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
      // Two paths to advance idle → sawStart:
      // (a) DTW labels current phase as the start phase, OR
      // (b) Primary feature is at the start position (covers the case where the user
      //     starts at rest before DTW phase has stabilized — common on mobile, fixes
      //     "first rep not detected" on exercises like LiftsAndChops).
      if (this.cycleState === 'idle'
          && (this.phase === this.repCycle.start || this._primaryFeatureNearStart(features))) {
        this.cycleState = 'sawStart';
        this.cycleFeatureMin = Infinity;
        this.cycleFeatureMax = -Infinity;
        this.activeSideDuringCycle = null;
      }
      if (this.cycleState === 'sawStart') {
        const pVal = this.primaryFeature ? features[this.primaryFeature] : null;
        // Direction-agnostic gate: arm/limb has moved meaningfully away from the
        // start position (works for both increasing AND decreasing exercises).
        // Uses raw feature value directly so fast movements aren't missed when
        // the DTW phase label is too noisy to pass the dwell filter.
        const movedEnough = Number.isFinite(pVal) && this.refStartValue !== null
          && Math.abs(pVal - this.refStartValue) >= this.minRomForRep;
        // Phase-label fallback: only when keypoints are missing (pVal=NaN).
        const phaseFallback = !Number.isFinite(pVal) && this.effortPhases.has(this.phase);
        if (movedEnough || phaseFallback) {
          // Hysteresis: require sustained movement for ≥100ms before transitioning.
          // A single-frame keypoint spike won't satisfy this, killing spike-triggered
          // false reps (esp. on BicepCurls where wrist jitter swings elbowAngle 20-30°).
          if (this._movedAwayAt == null) this._movedAwayAt = now;
          if ((now - this._movedAwayAt) >= 100) {
            this.cycleState = 'sawEffort';
            this.effortEnteredAt = now;
            this._movedAwayAt = null;
            // Reset cycle ROM trackers so the spike sample doesn't pollute actualRom.
            this.cycleFeatureMin = Number.isFinite(pVal) ? pVal : Infinity;
            this.cycleFeatureMax = Number.isFinite(pVal) ? pVal : -Infinity;
          }
        } else {
          this._movedAwayAt = null;
        }
      }
      // Rep-gate conditions (excluding refractory). Used both to count a rep AND to
      // detect "would-have-counted" cycles that need to be absorbed during refractory.
      const repGateReady = this.cycleState === 'sawEffort'
          && (now - this.effortEnteredAt) >= 300
          && romOk && this._primaryFeatureNearStart(features);

      if (repGateReady && now >= this.refractoryUntil) {
        // Full cycle complete with meaningful movement — check alternating guardrail
        if (this._alternatingSideOk()) {
          repClassification = this._classifyRep(features, result.quality);
          // Always count the rep — cycleState/time/ROM/refractory gates already validated it.
          // completed vs attempt is metadata for telemetry, not a counting gate.
          this.repCount++;
          repDelta = 1;
          this.lastActiveSide = this.activeSideDuringCycle;
          console.log(`[DTW] Rep ${this.repCount} | classification=${repClassification.completed ? 'completed' : 'attempt'} romPct=${((repClassification.romPct ?? 0) * 100).toFixed(0)}% details=`, repClassification.details);
        }
        console.log(`[DTW] Rep! rom=${actualRom.toFixed(1)} min=${this.minRomForRep.toFixed(1)} reps=${this.repCount} activeSide=${this.activeSideDuringCycle} lastSide=${this.lastActiveSide}`);
        if (repDelta > 0) this._repAnnouncedUntil = now + 3000;
        this.refractoryUntil = now + this.refractoryMs;
        this.cycleState = 'sawStart'; // ready for next cycle (already at start)
        this.cycleFeatureMin = Infinity;
        this.cycleFeatureMax = -Infinity;
        this.activeSideDuringCycle = null;
        this._movedAwayAt = null;
      } else if (repGateReady && now < this.refractoryUntil) {
        // Block-and-reset: rep would have counted but refractory blocks it. Reset
        // cycleState anyway so the suppressed sawEffort doesn't carry over and trigger
        // a rep the moment refractory expires. Critical for StepUps where the down
        // motion looks like a complete rep cycle to the engine.
        this.cycleState = 'sawStart';
        this.cycleFeatureMin = Infinity;
        this.cycleFeatureMax = -Infinity;
        this.activeSideDuringCycle = null;
        this._movedAwayAt = null;
      }
    }

    // Backup: DTW cycle detection can advance the cycle state even without
    // phase transitions (handles edge cases where phase labels are noisy)
    if (result.cycleComplete && repDelta === 0 && this.mode === 'reps' && now >= this.refractoryUntil) {
      // Only count if we've seen at least the effort phase AND meaningful ROM
      if (this.cycleState === 'sawEffort' && romOk && this._primaryFeatureNearStart(features)) {
        if (this._alternatingSideOk()) {
          repClassification = this._classifyRep(features, result.quality);
          // Always count — see primary-path comment above.
          this.repCount++;
          repDelta = 1;
          this.lastActiveSide = this.activeSideDuringCycle;
          console.log(`[DTW-backup] Rep ${this.repCount} | classification=${repClassification.completed ? 'completed' : 'attempt'} romPct=${((repClassification.romPct ?? 0) * 100).toFixed(0)}% details=`, repClassification.details);
        }
        console.log(`[DTW-backup] Rep! rom=${actualRom.toFixed(1)} min=${this.minRomForRep.toFixed(1)} reps=${this.repCount} activeSide=${this.activeSideDuringCycle} lastSide=${this.lastActiveSide}`);
        if (repDelta > 0) this._repAnnouncedUntil = now + 3000;
        this.refractoryUntil = now + this.refractoryMs;
        this.cycleState = 'idle';
        this.cycleFeatureMin = Infinity;
        this.cycleFeatureMax = -Infinity;
        this.activeSideDuringCycle = null;
        this._movedAwayAt = null;
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
   * Guard: primary feature must be near the reference's start position before a rep counts.
   * Prevents false counts when DTW quality is low and the phase label says "lowered/start"
   * while the limb is actually still mid-range (e.g. shoulderAngle=67° labelled "lowered").
   * Tolerance = minRomForRep (25-35% of reference range).
   */
  _primaryFeatureNearStart(features) {
    if (!this.primaryFeature || this.refStartValue == null) return true;
    const pVal = features[this.primaryFeature];
    if (!Number.isFinite(pVal)) return true; // can't verify — give benefit of doubt
    return Math.abs(pVal - this.refStartValue) <= this.minRomForRep;
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

    // 0a. Rep just counted: announce the number for 1.5 s (highest priority)
    if (performance.now() < this._repAnnouncedUntil) {
      return String(this.repCount);
    }

    // 0b. Alternating guardrail: warn when same leg used twice in a row
    if (this.isAlternating && this.cycleState === 'sawEffort'
        && this.activeSideDuringCycle && this.lastActiveSide
        && this.activeSideDuringCycle === this.lastActiveSide) {
      return 'Switch legs — alternate each step!';
    }

    // 1. Form/safety: only check posture during stable phases (lowered/raised).
    // During movement phases the user can't act on posture cues — let phase cues through.
    const isStablePhase = this.cycleState === 'idle' || this.cycleState === 'sawStart';
    if (isStablePhase && fb.form && Array.isArray(fb.form)) {
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
    // Only check the primary movement feature — checking all features causes static
    // posture features (trunk/hip with range≈0) to trigger false "too much" warnings.
    if (!this.primaryFeature) return false;
    const dev = deviations[this.primaryFeature];
    if (!dev) return false;
    const range = this.featureRanges[this.primaryFeature];
    if (!range || range.range < 20) return false;
    return dev.live > range.max + 0.2 * range.range
        || dev.live < range.min - 0.2 * range.range;
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
