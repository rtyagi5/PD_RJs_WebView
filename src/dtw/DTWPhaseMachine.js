// ---------------------------------------------
// dtw/DTWPhaseMachine.js
// Drop-in replacement for PhaseMachine, driven by DTW reference matching.
// Same .step() interface → no changes needed in ExerciseTracker.
// ---------------------------------------------
import { OnlineSubsequenceDTW } from './dtwEngine.js';
import { computeFeatureRanges, extractPhaseOrder } from './referenceSchema.js';
import { BODY_PART_FEATURE_MAP } from './universalFeatures.js';
import { PatientBaseline } from './PatientBaseline.js';
import { resolveRomGate } from './romGate.js';

// How long the bare rep number suppresses all other feedback after a rep counts.
// Was 3000ms, which is longer than a typical rep cycle — corrective cues could
// almost never reach the patient. Safety/overshoot warnings pre-empt this entirely.
const REP_ANNOUNCE_MS = 1200;

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
   * @param {Object} opts - { targetReps, targetSeconds, patientId, side, summaryFeatures }
   * @param {string[]} opts.summaryFeatures - universal feature keys to capture
   *        per-rep min/max for (drives the `repSummary` payload sent to the host app)
   */
  constructor(reference, { targetReps = 10, targetSeconds, patientId, side, summaryFeatures = [] } = {}) {
    this.reference = reference;
    this.targetReps = targetReps;
    this.patientId = patientId || null;
    this.summaryFeatures = summaryFeatures;

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
    this._repAnnouncedUntil = 0; // suppress lower-priority feedback for REP_ANNOUNCE_MS after a rep counts

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
    // Resolve side-generic clinical caps (e.g. { shoulderAngle: { max: 95 } }) into the
    // concrete universal keys to watch. For a single-side session only that side is
    // checked; bilateral/alternating sessions watch both sides plus the aggregate the
    // template actually uses, so a cap still applies when the primary feature is a Min/Max.
    this.clinicalCaps = [];
    const capSource = reference.clinicalCaps || null;
    if (capSource) {
      const AGG_SUFFIX = { Min: 'Min', Max: 'Max', Avg: 'Avg' };
      for (const [base, limits] of Object.entries(capSource)) {
        const keys = [];
        if (this.side === 'left') keys.push(`${base}L`);
        else if (this.side === 'right') keys.push(`${base}R`);
        else keys.push(`${base}L`, `${base}R`);
        // Include whichever aggregate form exists in this reference's ranges.
        for (const suf of Object.keys(AGG_SUFFIX)) {
          if (this.featureRanges[`${base}${suf}`]) keys.push(`${base}${suf}`);
        }
        for (const key of keys) {
          this.clinicalCaps.push({
            key,
            min: Number.isFinite(limits?.min) ? limits.min : null,
            max: Number.isFinite(limits?.max) ? limits.max : null,
          });
        }
      }
    }

    this.primaryFeature = bestKey;
    this.primaryFeatureRange = bestRange;
    this.minRomPct = reference.minRomPct ?? 0.25;

    // Two thresholds that used to be one value. They answer different questions
    // and must scale differently:
    //
    //   minRomForRep       "did they move far enough for this to be effort?"
    //                      -> scales with the PATIENT, so limited ROM still counts.
    //   nearStartTolerance "are they back close enough to the start to close the rep?"
    //                      -> stays on the TEMPLATE, because it is measured against
    //                         refStartValue, which is a template-derived posture.
    //
    // Collapsing them (the original code) means shrinking the effort gate for a
    // limited-ROM patient also narrows their return window, so the rep opens more
    // easily and then never closes. The docstring on _primaryFeatureNearStart
    // already described this tolerance as a fraction of the REFERENCE range, so
    // this split restores the documented intent rather than changing it.
    this.templateRomGate = this.minRomPct * bestRange;
    this.nearStartTolerance = this.templateRomGate;
    this.minRomForRep = this.templateRomGate; // refined below once a baseline exists
    this.cycleFeatureMin = Infinity;
    this.cycleFeatureMax = -Infinity;
    this.cycleSummary = {};
    this.cycleCapBreaches = []; // { <featureKey>: { min, max } } for the in-flight rep
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

    // A returning patient's baseline is loaded synchronously in the PatientBaseline
    // constructor, so this can already resolve to 'baseline' on the very first frame.
    this._baselineWasLocked = !!this.patientBaseline?.isLocked;
    this._refreshRomGate('init');

    // Reference start value for the primary feature — used as a guard to prevent
    // counting a rep when the DTW mislabels the return phase while the limb is
    // still mid-range (happens when DTW quality is low and template position drifts).
    // Computed as the mean primary-feature value across all start-phase frames.
    this.refStartValue = null;
    this.refEffortValue = null;
    this.templateDirection = 0; // -1 (effort decreases primary), +1 (increases), 0 (same)
    if (this.primaryFeature && Array.isArray(reference.template) && reference.template.length > 0) {
      const startFrames = reference.template.filter(f => f.phase === this.repCycle.start);
      const startVals = startFrames.map(f => f.features?.[this.primaryFeature]).filter(Number.isFinite);
      if (startVals.length > 0) {
        this.refStartValue = startVals.reduce((a, b) => a + b, 0) / startVals.length;
      }
      const effortFrames = reference.template.filter(f => f.phase === this.repCycle.effort);
      const effortVals = effortFrames.map(f => f.features?.[this.primaryFeature]).filter(Number.isFinite);
      if (effortVals.length > 0) {
        this.refEffortValue = effortVals.reduce((a, b) => a + b, 0) / effortVals.length;
      }
      if (this.refStartValue !== null && this.refEffortValue !== null) {
        this.templateDirection = Math.sign(this.refEffortValue - this.refStartValue);
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
      `rom-source=${this.romGate?.source ?? 'template'} ` +
      `rom-template=${fmt(this.romGate?.templateValue)} ` +
      `rom-baseline=${fmt(this.romGate?.baselineValue)} ` +
      `rom-clamp=${this.romGate?.clamped ?? 'none'} ` +
      `nearStartTol=${fmt(this.nearStartTolerance)} ` +
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
    this._prevPrimaryValue = null;
    this.cycleFeatureMin = Infinity;
    this.cycleFeatureMax = -Infinity;
    this.cycleSummary = {};
    this.cycleCapBreaches = []; // { <featureKey>: { min, max } } for the in-flight rep
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
    // Velocity filter on the primary feature. At typical FPS (10-30), a real exercise
    // motion changes the joint angle by at most ~10° per frame. Single-frame jumps of
    // 25°+ are body-translation artifacts, MediaPipe heel/foot keypoint instability, or
    // background-edge confusion — NOT real motion. Mask such jumps as NaN so they don't
    // pollute movedEnough / nearStart / cycleFeatureMin/Max.
    //
    // _prevPrimaryValue stays at the last GOOD value during a rejection streak so the
    // engine doesn't lose track of the legitimate baseline.
    //
    // Trade-off: at very low FPS (<5), real motion can exceed 25°/frame and get filtered.
    // For rehab-grade exercises at 10+ FPS this is the right cutoff.
    if (this.primaryFeature) {
      const pVal = features[this.primaryFeature];
      const prev = this._prevPrimaryValue;
      if (Number.isFinite(pVal) && Number.isFinite(prev) && Math.abs(pVal - prev) > 20) {
        features = { ...features, [this.primaryFeature]: NaN };
      } else if (Number.isFinite(pVal)) {
        this._prevPrimaryValue = pVal;
      }
    }

    // Feed frame to patient baseline tracker
    if (this.patientBaseline) {
      this.patientBaseline.updateFrame(features);
      // PatientBaseline locks mid-session (>=2 reps and >=60 frames). The gate must
      // move at that moment; leaving it at the construction-time value means the
      // calibration we just captured is never actually used.
      if (this.patientBaseline.isLocked && !this._baselineWasLocked) {
        this._baselineWasLocked = true;
        this._refreshRomGate('baseline-locked');
      }
    }

    // Remember any clinical-cap breach for the rep currently in flight. The
    // warning is spoken immediately by _pickFeedback, but a spoken string is
    // gone the moment the next one replaces it — the rep record is what a
    // clinician can actually review afterwards.
    if (this.cycleState !== 'idle') {
      for (const b of this._capBreaches(features)) {
        if (!this.cycleCapBreaches.some(x => x.key === b.key && x.bound === b.bound)) {
          this.cycleCapBreaches.push(b);
        }
      }
    }

    // Run DTW matching
    const result = this.dtw.step(features);
    let repDelta = 0;
    let repClassification = null;
    let repSummary = null;

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
        this.cycleSummary = {};
        this.cycleCapBreaches = [];
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

    // Track min/max of every reported metric during the cycle, so a counted rep
    // can ship a true per-rep ROM summary to the host app / backend.
    if (this.cycleState !== 'idle') {
      for (const key of this.summaryFeatures) {
        const v = features[key];
        if (!Number.isFinite(v)) continue;
        const cur = this.cycleSummary[key];
        if (cur) {
          cur.min = Math.min(cur.min, v);
          cur.max = Math.max(cur.max, v);
        } else {
          this.cycleSummary[key] = { min: v, max: v };
        }
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
        this.cycleSummary = {};
        this.cycleCapBreaches = [];
        this.activeSideDuringCycle = null;
      }
      if (this.cycleState === 'sawStart') {
        const pVal = this.primaryFeature ? features[this.primaryFeature] : null;
        // Direction-aware gate: motion must be in the SAME direction as the template's
        // effort phase (e.g. CalfRaisesSeated expects footPitchNorm to INCREASE; if the
        // user dorsiflexes or shifts their body and the value DECREASES, that's not a rep).
        // templateDirection is -1 (effort decreases primary), +1 (increases), or 0 (no
        // direction defined — fall back to direction-agnostic).
        // Uses raw feature value directly so fast movements aren't missed when the DTW
        // phase label is too noisy to pass the dwell filter.
        let movedEnough = false;
        if (Number.isFinite(pVal) && this.refStartValue !== null) {
          const delta = pVal - this.refStartValue;
          const sameDirection = this.templateDirection === 0
            || Math.sign(delta) === this.templateDirection;
          movedEnough = sameDirection && Math.abs(delta) >= this.minRomForRep;
        }
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
        if (repDelta > 0) {
          repSummary = this._buildRepSummary();
          this._repAnnouncedUntil = now + REP_ANNOUNCE_MS;
        }
        this.refractoryUntil = now + this.refractoryMs;
        this.cycleState = 'sawStart'; // ready for next cycle (already at start)
        this.cycleFeatureMin = Infinity;
        this.cycleFeatureMax = -Infinity;
        this.cycleSummary = {};
        this.cycleCapBreaches = [];
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
        this.cycleSummary = {};
        this.cycleCapBreaches = [];
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
        if (repDelta > 0) {
          repSummary = this._buildRepSummary();
          this._repAnnouncedUntil = now + REP_ANNOUNCE_MS;
        }
        this.refractoryUntil = now + this.refractoryMs;
        // Match the primary rep path: the limb is back at the start position, so the
        // next cycle begins at 'sawStart'. Previously this path reset to 'idle', which
        // meant a rep counted via the backup route required an extra start-phase
        // detection before the next rep could register.
        this.cycleState = 'sawStart';
        this.cycleFeatureMin = Infinity;
        this.cycleFeatureMax = -Infinity;
        this.cycleSummary = {};
        this.cycleCapBreaches = [];
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

    // Feedback (priority: safety cap > rep announce > form > range > tempo > phase)
    const fb = this._pickFeedback(result, features, now);
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
      // Per-rep ROM summary — non-null only on the frame a rep is counted
      repSummary,
      isCalibrating: this.patientBaseline?.isCalibrating ?? false,
      completedReps: this.patientBaseline?.reps?.completed ?? this.repCount,
      flaggedReps: this.patientBaseline?.reps?.flagged ?? 0,
      attemptedReps: this.patientBaseline?.reps?.attempts ?? 0,
      totalReps: this.patientBaseline?.reps?.total ?? this.repCount,
      activeSide: this.activeSideDuringCycle,   // null when idle; 'left'/'right' during rep
    };
  }

  /**
   * Snapshot the in-flight cycle's min/max per tracked metric for the rep that
   * just counted. Values are rounded the same way the live payload rounds them.
   * @returns {Object|null} { rep, features: { <key>: { min, max } } }
   */
  _buildRepSummary() {
    const round = (v) => (Math.abs(v) < 2 ? Number(v.toFixed(2)) : Math.round(v));
    const out = {};
    for (const [key, { min, max }] of Object.entries(this.cycleSummary)) {
      if (!Number.isFinite(min) || !Number.isFinite(max)) continue;
      out[key] = { min: round(min), max: round(max) };
    }
    if (!Object.keys(out).length) return null;
    return { rep: this.repCount, features: out };
  }

  /**
   * Guard: primary feature must be near the reference's start position before a rep counts.
   * Prevents false counts when DTW quality is low and the phase label says "lowered/start"
   * while the limb is actually still mid-range (e.g. shoulderAngle=67° labelled "lowered").
   * Tolerance = nearStartTolerance (25-35% of the REFERENCE range). Deliberately
   * NOT minRomForRep: that gate scales down with the patient's own baseline, and
   * reusing it here would narrow the return window for exactly the limited-ROM
   * patients the baseline gate exists to help — the rep would open and never close.
   */
  _primaryFeatureNearStart(features) {
    if (!this.primaryFeature || this.refStartValue == null) return true;
    const pVal = features[this.primaryFeature];
    if (!Number.isFinite(pVal)) return true; // can't verify — give benefit of doubt
    return Math.abs(pVal - this.refStartValue) <= this.nearStartTolerance;
  }

  /**
   * Re-resolve the rep ROM gate from the best source currently available.
   * Called at construction and again the moment the patient baseline locks.
   * @param {string} reason - for the log line; threshold changes must never be silent.
   */
  _refreshRomGate(reason) {
    const prev = this.minRomForRep;
    this.romGate = resolveRomGate({
      primaryFeature: this.primaryFeature,
      minRomPct: this.minRomPct,
      templateRange: this.primaryFeatureRange,
      patientBaseline: this.patientBaseline,
      protocolBaseline: null, // WI-4 supplies this; resolver already prefers it.
    });
    this.minRomForRep = this.romGate.value;

    if (reason !== 'init' && prev !== this.minRomForRep) {
      const f = (n) => (n == null ? 'null' : (Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(3)));
      console.log(
        `[DTW] ROM gate ${f(prev)} -> ${f(this.minRomForRep)} (${reason}) ` +
        `source=${this.romGate.source} template=${f(this.romGate.templateValue)} ` +
        `baseline=${f(this.romGate.baselineValue)} clamp=${this.romGate.clamped ?? 'none'}`
      );
    }
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

  /**
   * Absolute safety check, independent of the DTW template.
   *
   * Two sources, either of which flags a violation:
   *  1. `clinicalCaps` from the exercise config — fixed, clinician-reviewable limits.
   *  2. PatientBaseline.checkSafety — the gold-standard envelope, once calibrated.
   *
   * Template-relative overshoot (_detectOvershoot) can't be relied on for this: it
   * triggers at `range.max + 20% of range`, which for a wide sweep lands well beyond
   * anything physically reachable.
   *
   * @returns {boolean} true if any watched feature is outside its safe limit
   */
  /**
   * Which clinical caps the current frame breaches, and by how much.
   * Returns details rather than a boolean so a breach can be attached to the rep
   * it happened during, not just spoken and forgotten.
   * @returns {Array<{key:string, value:number, bound:'min'|'max', limit:number, source:string}>}
   */
  _capBreaches(features) {
    const out = [];
    for (const cap of this.clinicalCaps) {
      const v = features[cap.key];
      if (!Number.isFinite(v)) continue;
      if (cap.max !== null && v > cap.max) {
        out.push({ key: cap.key, value: v, bound: 'max', limit: cap.max, source: 'clinicalCap' });
      } else if (cap.min !== null && v < cap.min) {
        out.push({ key: cap.key, value: v, bound: 'min', limit: cap.min, source: 'clinicalCap' });
      }
    }
    // Patient-specific envelope (only meaningful once the baseline has locked).
    if (this.patientBaseline && !this.patientBaseline.isCalibrating) {
      for (const cap of this.clinicalCaps) {
        const v = features[cap.key];
        if (!Number.isFinite(v)) continue;
        const verdict = this.patientBaseline.checkSafety(cap.key, v);
        if (verdict && verdict.safe === false) {
          out.push({ key: cap.key, value: v, bound: 'envelope', limit: null, source: 'baselineEnvelope' });
        }
      }
    }
    return out;
  }

  _exceedsClinicalCap(features) {
    return this._capBreaches(features).length > 0;
  }

  _pickFeedback(dtwResult, features, now = performance.now()) {
    const fb = this.feedback;
    const deviations = dtwResult.deviations;

    // 0. Safety ceiling — HIGHEST priority, above the rep announcement. A patient
    // moving past a clinical limit needs to hear it immediately; suppressing it
    // behind the rep number is how "don't raise above 90°" went silent.
    if (this._exceedsClinicalCap(features) && fb.range?.tooMuch) {
      return fb.range.tooMuch;
    }

    // 0a. Rep just counted: announce the number for REP_ANNOUNCE_MS.
    // Uses the caller-supplied clock (same one that set _repAnnouncedUntil) rather
    // than wall time, so the window is consistent and deterministic under test.
    if (now < this._repAnnouncedUntil) {
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
    const capBreaches = this.cycleCapBreaches || [];
    const flagged = capBreaches.length > 0;
    if (!this.patientBaseline) {
      return {
        completed: !flagged, flagged, capBreaches,
        quality, romPct: 1.0, details: {},
      };
    }
    return this.patientBaseline.onRepDetected(features, quality, { capBreaches });
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
