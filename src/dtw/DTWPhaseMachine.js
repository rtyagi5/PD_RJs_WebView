// ---------------------------------------------
// dtw/DTWPhaseMachine.js
// Drop-in replacement for PhaseMachine, driven by DTW reference matching.
// Same .step() interface → no changes needed in ExerciseTracker.
// ---------------------------------------------
import { OnlineSubsequenceDTW } from './dtwEngine.js';
import { computeFeatureRanges, extractPhaseOrder } from './referenceSchema.js';
import { BODY_PART_FEATURE_MAP, stripSideSuffix } from './universalFeatures.js';
import { PatientBaseline } from './PatientBaseline.js';
import { resolveRomGate } from './romGate.js';

// How long the bare rep number suppresses all other feedback after a rep counts.
// Was 3000ms, which is longer than a typical rep cycle — corrective cues could
// almost never reach the patient. Safety/overshoot warnings pre-empt this entirely.
const REP_ANNOUNCE_MS = 1200;

// Minimum wall-clock gap between two ROUTINE spoken cues.
//
// The engine runs its whole feedback ladder every step with no memory, so the
// winner ping-pongs between categories and the string changed 19 times in 8
// seconds on device - a mean gap of 427ms against utterances that need 1.1-2.3s
// to speak. 94% of cues were physically unable to finish.
//
// Rate limiting belongs HERE rather than in the host, because the transport only
// sends a message when the string CHANGES (ExerciseTracker.maybeSendUpdates).
// Holding the previous string is therefore exactly equivalent to "say nothing
// new", and costs no extra plumbing.
//
// 2500ms clears the longest cue in the reference ("Please do not bend the
// elbow", ~2.2s) with room to breathe.
const FEEDBACK_MIN_GAP_MS = 2500;

// Corrective form cues are limited to one per repetition on top of the gap.
// A posture fault is a property of the rep, not of the frame, and repeating it
// mid-movement gives the patient nothing they can act on.
const FORM_CUE_PER_REP = 1;

// Phase cues are timing-critical in a way corrective cues are not: "Keep going
// up" is only useful while the patient is going up. Holding one behind the
// routine gap meant it was spoken about a movement that had already finished,
// which reads as the coach lagging behind you.
//
// So a phase cue fires on the phase CHANGE instead of on the gap clock, with
// only a short floor to stop a thrashing phase machine from chattering. It is
// emitted at most once per entry into a phase.
const PHASE_CUE_MIN_GAP_MS = 1000;

// Artefact budget for the primary feature, expressed as template-ranges per
// second. The template range is the exercise's own full sweep, so 8 of them per
// second is far beyond any human movement while still admitting a fast rep:
// shoulderAngleR's range is 75.6 degrees, giving ~605 deg/s, where a brisk arm
// raise peaks near 230 deg/s.
const MAX_FEATURE_RANGES_PER_SEC = 8;

// Floor, so a near-static template or a very small dt cannot produce a budget of
// approximately zero and reject every sample.
const MIN_ARTEFACT_BUDGET = 5;

// A rejection streak longer than this is not an artefact - it is where the limb
// actually is, and the filter has lost track. Resync rather than staying blind.
const MAX_REJECT_STREAK_MS = 250;

// Tempo. The reference has always declared feedback.tempo {tooFast, holdCue} and
// _pickFeedback has always had a "3. Tempo (future: needs movement speed
// tracking)" stub, so the cue could never fire however fast the patient moved.
//
// The template's own sweep rate is the natural yardstick: one half-rep covers
// the primary feature's full range, so range / (repDuration/2) is the pace the
// exercise was demonstrated at. Anything far above that is not a rep the engine
// can measure - which is exactly the regime where reps were being lost.
// Tempo is judged on REP DURATION, not on instantaneous rate.
//
// The first implementation compared a smoothed |d(primary)/dt| against the
// template's AVERAGE sweep rate. That is a category error, and SeatedDorsiflexion
// exposed it: a sine-like movement's peak rate is ~1.6x its own average even at
// identical pace, and footPitchNorm is a 3-10 pixel signal whose |delta|/dt
// spikes on noise alone. Measured on device, a patient whose reps took
// 3.3-13.7s against a 4.1s demonstration - i.e. mostly SLOWER - was told to slow
// down 14 times, making it the most frequent cue in the session.
//
// Rep duration compares like with like, is unit-free, and cannot be moved by
// keypoint jitter.
const TOO_FAST_FRACTION = 0.6;

// How long a "too fast" verdict stands after the rep that earned it. Long enough
// to be spoken and acted on, short enough that slowing down clears it.
const TOO_FAST_HOLD_MS = 2500;

// Cue importance, low number = more important. The routine gap is per-cue, but a
// cooldown started by a trivial cue must not silence an important one: a phase
// cue fired at the top of a set was holding back "slow down" for 2.5s, which is
// exactly the window in which the patient's speed was costing them reps.
// Even an important cue has to let the previous one be heard. Without this the
// priority bypass below turns into a floodgate: measured on device, rep numbers
// (rank 1) jumped the queue at 82ms, 141ms and 149ms after the previous cue.
// Safety is the only thing allowed to cut in with no floor at all.
const MIN_CUE_FLOOR_MS = 900;

const TIER_RANK = {
  safety: 0, tempo: 1, rep: 2, guardrail: 3, form: 4, range: 5, phase: 6,
};

// A patient cannot hold a posture a third of a range past the reference for a
// whole set, so a reading that is NEVER inside the envelope is not a patient
// exceeding a limit - it is the wrong instrument pointed at the right movement.
// Measured on device: the phone was moved from a table to the floor (which
// genuinely improved foot keypoint confidence), and footPitchNormL - a raw
// image-space vertical ratio, not a viewpoint-invariant angle - then sat at
// -0.3 against a reference band of -0.077..0.099 and a clinical floor of -0.12
// for the entire set. The safety check therefore fired on essentially every
// frame, and because safety sits above the rep announcement in the ladder it
// starved the count: the patient heard "1" and then "4".
//
// So a cap breach only counts once the feature has been seen INSIDE its limits
// at least once. Until then the setup is what is wrong, and saying
// "that's far enough" to someone who has not moved is worse than saying
// nothing - it teaches them to distrust the coaching.
const OFF_CALIBRATION_GRACE_MS = 4000;
const OFF_CALIBRATION_RANGE_MULTIPLE = 1.0;

// A breach that is continuously true is one fact, not one fact per frame. Speak
// it for a window, go quiet, and repeat only if it is still true much later -
// which also lets the rest of the ladder (the rep number especially) through in
// between, instead of being starved by a latched safety cue.
const BREACH_REPORT_MS = 1500;
const SUSTAINED_BREACH_REPEAT_MS = 6000;

// Names the action before the reason. A patient who hears only "that isn't
// reading" does not know what to do about it.
const OFF_CALIBRATION_CUE = 'Check your phone position, the movement is not reading correctly';

// _featureRate is kept purely as a diagnostic now - it is what made the old
// instantaneous comparison look plausible, and seeing it next to repDur in the
// logs is how that mistake was caught.
const RATE_EMA = 0.4;

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

    // Pace the template was demonstrated at, in feature-units per second. Half a
    // rep sweeps the primary feature's full range, hence the /2.
    this.repDurationMs = timing.repDurationMs ?? 2000;

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
    this._lastCueAt = 0;        // when a routine (non-safety, non-rep) cue was last issued
    this._formCuesThisRep = 0;  // form cues already spent on the current rep
    this._formCueRepIdx = -1;   // which rep those were spent on
    this._lastPriority = 'normal'; // priority of the cue currently held in lastFeedback
    this._lastPhaseCued = null; // phase whose cue was last spoken
    this._prevPrimaryAt = NaN;  // when _prevPrimaryValue was accepted
    this._rejectingSince = 0;   // start of the current rejection streak, 0 when clear
    this._featureRate = 0;      // smoothed |d(primary)/dt|, feature-units per second
    this._lastCueTier = 'phase'; // importance of the cue that started the cooldown
    this._announcedRep = -1;     // rep number already spoken
    this._lastRepAt = 0;         // when the previous rep closed
    this._candidatePhase = null; // phase waiting to be confirmed
    this._candidateSince = 0;
    this._tooFastUntil = 0;      // verdict stands until this time

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
      // `primaryFeatureBase` narrows the auto-picker to one feature FAMILY while
      // leaving its side/aggregate resolution intact — which an exact
      // `primaryFeature` pin cannot do, since it would have to name a concrete
      // side key up front.
      //
      // Without it the picker compares raw ranges across incompatible units: a
      // 20-degree ankle angle beats a 0.17 footPitchNorm ratio on magnitude
      // alone. So the moment a recorded reference carries both families, every
      // foot exercise would silently switch primary feature — including the calf
      // raises, where an ankle angle is documented as the wrong instrument
      // because the foot pivots about the toe.
      const base = reference.primaryFeatureBase || null;
      for (const [key, stats] of Object.entries(this.featureRanges)) {
        if (base && stripSideSuffix(key) !== base) continue;
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
    this._capState = new Map(); // featureKey -> { seenInside, firstSampleAt, breachStartedAt }
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
      // The quality gates need to know which limb is being measured, or they
      // will happily pass a well-tracked foot that the engine is not using.
      side: this.side,
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
    this._capState = new Map(); // featureKey -> { seenInside, firstSampleAt, breachStartedAt }
    this.lastActiveSide = null;
    this.activeSideDuringCycle = null;
    this._repAnnouncedUntil = 0;
    this._lastCueAt = 0;
    this._formCuesThisRep = 0;
    this._formCueRepIdx = -1;
    this._lastPriority = 'normal';
    this._lastPhaseCued = null;
    this._prevPrimaryAt = NaN;
    this._rejectingSince = 0;
    this._featureRate = 0;
    this._lastCueTier = 'phase';
    this._announcedRep = -1;
    this._lastRepAt = 0;
    this._tooFastUntil = 0;
    this._candidatePhase = null;
    this._candidateSince = 0;
    this.dtw.reset();
    // Don't reset patient baseline on counter reset — it persists across the session
  }

  /**
   * Same interface as PhaseMachine.step().
   * @param {Object} inputs - { t, features, now, say, setHighlight }
   * @returns {Object} - { phase, repDelta, repCount, feedback, done, timeHeldMs?, timeRemainingMs? }
   */
  step({ t, features, now = performance.now(), say, setHighlight }) {
    // Artefact filter on the primary feature. Body-translation, MediaPipe foot
    // keypoint instability and background-edge confusion all produce jumps that
    // are not real motion, and letting them through pollutes movedEnough /
    // nearStart / cycleFeatureMin/Max.
    //
    // This used to be an absolute "> 20 units per STEP" test, which failed on
    // device in two ways at once. Measured on a Galaxy A36, 10-rep set at speed:
    //
    //   * Per STEP, not per second. Poses arrive at ~7.5/s, so a legitimate fast
    //     rep moves 30-55 degrees between samples and was rejected as an artefact.
    //   * It LATCHED. _prevPrimaryValue was deliberately frozen during a rejection
    //     streak, so once the true angle sat >20 away from that stale value every
    //     later sample was rejected too. The log shows sustained NaN with
    //     cycle=sawStart across an 11.4s window in which roughly four full reps
    //     were performed and NONE were recorded - not as completed, not even as
    //     attempts. They vanished.
    //
    // Now it is a RATE limit, and it gives up rather than latching.
    if (this.primaryFeature) {
      const pVal = features[this.primaryFeature];
      const prev = this._prevPrimaryValue;
      const dt = Number.isFinite(this._prevPrimaryAt) ? now - this._prevPrimaryAt : 0;

      if (Number.isFinite(pVal) && Number.isFinite(prev) && dt > 0) {
        // Budget scales with the template's own span, so this works for degrees
        // and for dimensionless ratios without a per-feature constant. A floor
        // keeps a near-static template (or a very short dt) from rejecting
        // everything.
        const budget = Math.max(
          MAX_FEATURE_RANGES_PER_SEC * (this.primaryFeatureRange || 0) * (dt / 1000),
          MIN_ARTEFACT_BUDGET
        );
        if (Math.abs(pVal - prev) > budget) {
          if (!this._rejectingSince) this._rejectingSince = now;
          if (now - this._rejectingSince < MAX_REJECT_STREAK_MS) {
            features = { ...features, [this.primaryFeature]: NaN };
          } else {
            // Rejecting this long means the "artefact" is where the limb actually
            // is and the filter has lost track. Resync rather than staying blind
            // - that blindness is what silently swallowed whole reps.
            this._prevPrimaryValue = pVal;
            this._prevPrimaryAt = now;
            this._rejectingSince = 0;
          }
        } else {
          // Accepted: this is real movement, so it is also the tempo signal.
          const rate = Math.abs(pVal - prev) / (dt / 1000);
          this._featureRate = this._featureRate * (1 - RATE_EMA) + rate * RATE_EMA;
          this._prevPrimaryValue = pVal;
          this._prevPrimaryAt = now;
          this._rejectingSince = 0;
        }
      } else if (Number.isFinite(pVal)) {
        this._prevPrimaryValue = pVal;
        this._prevPrimaryAt = now;
        this._rejectingSince = 0;
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
    // Evaluated every frame, not only mid-rep, so the UI can warn the moment a
    // patient goes past a safe limit rather than waiting for a rep to open.
    // A spoken cue alone is not enough here: it is gone as soon as the next one
    // replaces it, and a patient looking at their own skeleton will not hear it
    // over the sound of the exercise.
    this._updateCapState(features, now);
    const liveCapBreaches = this._capBreaches(features);
    if (this.cycleState !== 'idle') {
      for (const b of liveCapBreaches) {
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
        ` minRom=${this.minRomForRep.toFixed(1)} reps=${this.repCount}` +
        ` rate=${this._featureRate.toFixed(3)}/s repDur=${this.repDurationMs}ms${this._movingTooFast(now) ? ' FAST' : ''}`
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
      // Hysteresis: the CANDIDATE has to persist, not merely the incumbent.
      //
      // This used to test `now - lastPhaseEnterAt >= dwellMs`, which measures how
      // long we have been in the OLD phase - so once the current phase was older
      // than dwellMs, a single noisy sample committed a switch immediately, and
      // the next noisy sample could switch back dwellMs later. On a 3-10 pixel
      // signal like footPitchNorm that is most of what the phase machine did,
      // and it is why a patient who had already lowered kept being told to lower:
      // the phase was flipping under jitter, and each flip is a fresh phase cue.
      if (newPhase !== this._candidatePhase) {
        this._candidatePhase = newPhase;
        this._candidateSince = now;
      } else if (now - this._candidateSince >= this.dwellMs) {
        this.prevPhase = this.phase;
        this.phase = newPhase;
        this.lastPhaseEnterAt = now;
        this._candidatePhase = null;
      }
    } else {
      // Back to where we already are: whatever was building is not happening.
      this._candidatePhase = null;
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
          this._judgeTempo(now);
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
          this._judgeTempo(now);
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
      // 'safety' means this cue may interrupt speech already in progress. Without
      // it the host cannot tell a clinical warning from "Keep going up", and a
      // never-interrupt speech policy would silently delay the one cue that
      // must not wait.
      feedbackPriority: this._lastPriority,
      done,
      timeHeldMs: this.mode === 'time' ? timeHeldMs : undefined,
      timeRemainingMs: this.mode === 'time' ? Math.max(0, timeRemainingMs ?? 0) : undefined,
      // Extra DTW-specific data (available but not required by ExerciseTracker)
      quality: result.quality,
      templatePosition: result.templatePosition,
      deviations: result.deviations,
      // Clinical caps exceeded on THIS frame. Distinct from
      // repClassification.capBreaches, which is the whole rep and only arrives
      // on the frame a rep is counted — far too late to be a live warning.
      capBreaches: liveCapBreaches,
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
  /**
   * Form-check feature keys for a body part, restricted to the active side.
   *
   * BODY_PART_FEATURE_MAP lists both sides plus an aggregate. For a one-sided
   * exercise only the working side can be at fault, and the aggregates
   * (elbowAngleMin and friends) track whichever limb is more bent - normally
   * the resting one. Both produced form corrections about the wrong arm.
   */
  /**
   * The pace this exercise was demonstrated at, in feature-units per second.
   * Half a rep sweeps the primary feature's full range.
   */
  get templateSweepRate() {
    const half = this.repDurationMs / 2 / 1000;
    if (!half || !this.primaryFeatureRange) return 0;
    return this.primaryFeatureRange / half;
  }

  /**
   * Judge the rep that just closed. Called on the frame a rep is counted.
   *
   * Duration is measured rep-to-rep rather than from the cycle start, because a
   * patient who pauses between reps is not moving fast - the pause is part of
   * their cadence and counting it is what keeps this honest.
   */
  _judgeTempo(now) {
    const prev = this._lastRepAt;
    this._lastRepAt = now;
    if (!prev || !this.repDurationMs) return;
    const took = now - prev;
    if (took < TOO_FAST_FRACTION * this.repDurationMs) {
      this._tooFastUntil = now + TOO_FAST_HOLD_MS;
    }
  }

  /** True while the most recent rep was completed faster than the demonstration. */
  _movingTooFast(now = performance.now()) {
    return now < this._tooFastUntil;
  }

  _formKeysFor(bodyPart) {
    const all = BODY_PART_FEATURE_MAP[bodyPart] || [];
    if (this.side !== 'left' && this.side !== 'right') return all;
    const suffix = this.side === 'left' ? 'L' : 'R';
    const sided = all.filter(k => k.endsWith(suffix));
    // Fall back to the full list if this part has no per-side keys at all.
    return sided.length ? sided : all;
  }

  /** The breaches this one cap records for one value. Pure - no state touched. */
  _breachesForCap(cap, v) {
    const out = [];
    if (cap.max !== null && v > cap.max) {
      out.push({ key: cap.key, value: v, bound: 'max', limit: cap.max, source: 'clinicalCap' });
    } else if (cap.min !== null && v < cap.min) {
      out.push({ key: cap.key, value: v, bound: 'min', limit: cap.min, source: 'clinicalCap' });
    }
    // Patient-specific envelope (only meaningful once the baseline has locked).
    if (this.patientBaseline && !this.patientBaseline.isCalibrating) {
      const verdict = this.patientBaseline.checkSafety(cap.key, v);
      if (verdict && verdict.safe === false) {
        out.push({ key: cap.key, value: v, bound: 'envelope', limit: null, source: 'baselineEnvelope' });
      }
    }
    return out;
  }

  /**
   * Track, per capped feature, whether the live signal has ever read inside its
   * limits, and when the current excursion began.
   *
   * Called exactly once per step, before anything reads the result, so that the
   * two readers below - `_capBreaches` for the skeleton and rep flagging,
   * `_exceedsClinicalCap` for speech - stay pure and agree with each other. An
   * earlier draft latched inside `_capBreaches` itself, which is called twice
   * per step, so the second call would have seen the first call's latch and
   * silently suppressed a real breach.
   */
  _updateCapState(features, now = performance.now()) {
    for (const cap of this.clinicalCaps) {
      const v = features[cap.key];
      if (!Number.isFinite(v)) continue;
      let state = this._capState.get(cap.key);
      if (!state) {
        state = { seenInside: false, firstSampleAt: now, breachStartedAt: 0 };
        this._capState.set(cap.key, state);
      }
      if (this._breachesForCap(cap, v).length === 0) {
        state.seenInside = true;
        state.breachStartedAt = 0;
      } else if (!state.breachStartedAt) {
        state.breachStartedAt = now;
      }
    }
  }

  /**
   * How far outside its reference range a feature currently sits, measured in
   * whole reference ranges. 0 while inside, and 0 when we have no range to
   * judge against - which keeps the unknown case warning rather than silent.
   */
  _excursionRanges(key, v) {
    const r = this.featureRanges[key];
    if (!r || !(r.range > 0) || !Number.isFinite(v)) return 0;
    if (v > r.max) return (v - r.max) / r.range;
    if (v < r.min) return (r.min - v) / r.range;
    return 0;
  }

  /**
   * True when this reading is better explained by the wrong camera than by the
   * patient: it has never once been inside the limit, AND it sits further
   * outside the reference range than the movement's own full range.
   *
   * Both halves are load-bearing, and an earlier draft that used only the first
   * half was wrong. A patient who begins a set already holding their arm above
   * the cap has also "never been inside", and they genuinely need telling - at
   * 110 degrees against a 30-90 template that is a third of a range out, an
   * entirely believable posture. The device failure was 1.7 ranges out, which
   * no ankle can reach. The size of the excursion is what separates a hurt
   * patient from an instrument measuring a different quantity.
   */
  _misreading(key, v) {
    if (this._capState.get(key)?.seenInside === true) return false;
    return this._excursionRanges(key, v) >= OFF_CALIBRATION_RANGE_MULTIPLE;
  }

  /**
   * The primary feature has been misread for long enough that the patient not
   * having started yet cannot explain it.
   */
  _offCalibration(features, now = performance.now()) {
    if (!this.primaryFeature) return false;
    const state = this._capState.get(this.primaryFeature);
    if (!state || state.seenInside) return false;
    if (now - state.firstSampleAt < OFF_CALIBRATION_GRACE_MS) return false;
    return this._misreading(this.primaryFeature, features?.[this.primaryFeature]);
  }

  _capBreaches(features) {
    const out = [];
    for (const cap of this.clinicalCaps) {
      const v = features[cap.key];
      if (!Number.isFinite(v)) continue;
      // A reading this far outside the reference band, that has never once been
      // inside it, describes the camera rather than the patient. Honouring it
      // would paint the skeleton red for the entire set and flag every rep, on
      // evidence that says nothing about how they moved.
      if (this._misreading(cap.key, v)) continue;
      out.push(...this._breachesForCap(cap, v));
    }
    return out;
  }

  /**
   * The speech-facing view of the same breaches. A breach that stays true is one
   * fact, not one fact per frame: say it for a window, go quiet, and repeat only
   * if it is still true much later. The silence matters as much as the cue -
   * safety sits above the rep announcement in the ladder, so a permanently
   * latched warning starves the count, which on device is why the patient heard
   * "1" and then "4".
   */
  _exceedsClinicalCap(features, now = performance.now()) {
    const breaches = this._capBreaches(features);
    if (!breaches.length) return false;
    return breaches.some(b => {
      const startedAt = this._capState.get(b.key)?.breachStartedAt || 0;
      if (!startedAt) return true;
      return ((now - startedAt) % SUSTAINED_BREACH_REPEAT_MS) < BREACH_REPORT_MS;
    });
  }

  _selectFeedback(dtwResult, features, now = performance.now()) {
    const fb = this.feedback;
    const deviations = dtwResult.deviations;

    // 0. Safety ceiling — HIGHEST priority, above the rep announcement. A patient
    // moving past a clinical limit needs to hear it immediately; suppressing it
    // behind the rep number is how "don't raise above 90°" went silent.
    if (this._exceedsClinicalCap(features, now) && fb.range?.tooMuch) {
      return { say: fb.range.tooMuch, tier: 'safety' };
    }

    // 0a. Setup fault. Said at safety tier because it is the only thing worth
    // hearing while it is true - nothing measured from this camera means what
    // the reference says it means, so every cue below would be coaching noise.
    // Paced by the same sustained-breach window as an envelope breach, for the
    // same reason: it is one fact, not one fact per frame.
    if (this._offCalibration(features, now)) {
      const startedAt = this._capState.get(this.primaryFeature)?.firstSampleAt || 0;
      const elapsed = now - startedAt - OFF_CALIBRATION_GRACE_MS;
      if ((elapsed % SUSTAINED_BREACH_REPEAT_MS) < BREACH_REPORT_MS) {
        return { say: OFF_CALIBRATION_CUE, tier: 'safety' };
      }
    }

    // 0b. Tempo. This sits ABOVE the rep announcement on purpose. A patient
    // moving too fast counts reps fast, so the announce latch was open almost
    // continuously and masked this cue exactly when it was needed - on device,
    // reps landed 0.6-0.8s apart against a 1200ms latch, and "slow down" was
    // never once selected. Hearing why you are outrunning the tracker matters
    // more than hearing the number.
    if (this._movingTooFast(now) && fb.tempo?.tooFast) {
      return { say: fb.tempo.tooFast, tier: 'tempo' };
    }

    // 0a. Rep just counted: announce the number for REP_ANNOUNCE_MS.
    // Uses the caller-supplied clock (same one that set _repAnnouncedUntil) rather
    // than wall time, so the window is consistent and deterministic under test.
    if (now < this._repAnnouncedUntil) {
      return { say: String(this.repCount), tier: 'rep' };
    }

    // 0b. Alternating guardrail: warn when same leg used twice in a row
    if (this.isAlternating && this.cycleState === 'sawEffort'
        && this.activeSideDuringCycle && this.lastActiveSide
        && this.activeSideDuringCycle === this.lastActiveSide) {
      return { say: 'Switch legs — alternate each step!', tier: 'safety' };
    }

    // 1. Form/safety: only check posture during stable phases (lowered/raised).
    // During movement phases the user can't act on posture cues — let phase cues through.
    const isStablePhase = this.cycleState === 'idle' || this.cycleState === 'sawStart';
    if (isStablePhase && fb.form && Array.isArray(fb.form)) {
      for (const formRule of fb.form) {
        // Restrict to the side being exercised. The map lists L, R and the
        // aggregate for every body part, and checking all three meant a bend in
        // the RESTING arm raised "Please do not bend the elbow" during a
        // right-side raise - a correction aimed at a limb the patient is not
        // using. Aggregates (…Min/…Max/…Avg) are dropped for the same reason:
        // elbowAngleMin is whichever elbow is more bent, which in a one-sided
        // exercise is almost always the idle one.
        const featureKeys = this._formKeysFor(formRule.bodyPart);
        for (const key of featureKeys) {
          const dev = deviations[key];
          if (dev && Math.abs(dev.normalizedDelta) > this.formDeviationThreshold) {
            return { say: formRule.say, tier: 'form' };
          }
        }
      }
    }

    // 2. Range: check if patient isn't reaching far enough or overshooting
    if (fb.range) {
      const pos = dtwResult.templatePosition;
      // Near the peak of the movement (70-100% through template) but quality is low
      if (pos > 0.5 && pos < 0.9 && dtwResult.quality < 0.5 && fb.range.tooLittle) {
        return { say: fb.range.tooLittle, tier: 'range' };
      }
      // Overshoot detection: features exceed reference range
      if (this._detectOvershoot(deviations) && fb.range.tooMuch) {
        return { say: fb.range.tooMuch, tier: 'safety' };
      }
    }

    // 3. Tempo is handled above, with the safety ceiling - see _selectFeedback's
    //    opening. A fast patient counts reps fast, and the rep-announce latch
    //    below would otherwise mask the one cue that explains why.

    // 4. Phase feedback (default)
    if (fb.phase && this.phase) {
      return { say: fb.phase[this.phase] || fb.phase.transition || this.lastFeedback, tier: 'phase' };
    }

    return { say: this.lastFeedback || '', tier: 'phase' };
  }

  /**
   * Pace the selected cue.
   *
   * The selector above re-runs its whole ladder every step with no memory, so on
   * device the winning string changed 19 times in 8 seconds - a mean gap of 427ms
   * against utterances needing 1.1-2.3s. 94% of cues could not physically finish
   * before the host cut them off.
   *
   * Rate limiting has to happen here rather than in the host, because the host
   * only ever hears about a cue when the string CHANGES. Returning the PREVIOUS
   * string is therefore precisely "say nothing new", with no new plumbing and no
   * risk of the host and engine disagreeing about what is currently being said.
   *
   * Safety is never paced. Everything else waits its turn.
   */
  _pickFeedback(dtwResult, features, now = performance.now()) {
    const picked = this._selectFeedback(dtwResult, features, now);
    const say = picked?.say ?? '';
    const tier = picked?.tier ?? 'phase';

    // Safety always speaks, immediately, and resets the routine clock so a
    // routine cue cannot follow one straight down the patient's ear.
    if (tier === 'safety') {
      if (say && say !== this.lastFeedback) { this._lastCueAt = now; this._lastCueTier = 'safety'; }
      this._lastPriority = 'safety';
      return say;
    }

    // The rep number is short, self-explanatory and time-critical. It is not
    // paced, but it does not reset the routine clock either - it is not coaching.
    if (tier === 'rep') {
      this._lastPriority = 'normal';
      // Announce each number once. The rep-announce window re-wins the ladder
      // whenever another cue interrupts it, which on device said "9" twice
      // 141ms apart.
      if (this._announcedRep === this.repCount) return this.lastFeedback;
      this._announcedRep = this.repCount;
      this._lastCueAt = now;
      this._lastCueTier = 'rep';
      return say;
    }

    // A form fault belongs to the repetition, not the frame. Repeating it
    // mid-movement gives the patient nothing they can act on.
    if (tier === 'form') {
      if (this.repCount !== this._formCueRepIdx) {
        this._formCueRepIdx = this.repCount;
        this._formCuesThisRep = 0;
      }
      if (this._formCuesThisRep >= FORM_CUE_PER_REP) {
        this._lastPriority = 'normal';
        return this.lastFeedback;
      }
    }

    // Unchanged string: nothing is sent, so nothing to pace.
    if (say === this.lastFeedback) {
      this._lastPriority = 'normal';
      return this.lastFeedback;
    }

    this._lastPriority = 'normal';

    // A phase cue is tied to a moment, not to a cooldown. Speak it when the
    // phase actually changes, or not at all - a late "Keep going up" is worse
    // than silence because the patient is already coming down.
    if (tier === 'phase') {
      // Someone moving fast does not need telling they are going up; the cue is
      // stale before it finishes being spoken.
      if (this._movingTooFast(now)) return this.lastFeedback;
      if (this.phase === this._lastPhaseCued) return this.lastFeedback;
      if (now - this._lastCueAt < PHASE_CUE_MIN_GAP_MS) return this.lastFeedback;
      this._lastPhaseCued = this.phase;
      this._lastCueAt = now;
      this._lastCueTier = 'phase';
      return say;
    }

    // A cooldown started by a less important cue does not get to silence a more
    // important one.
    const outranksCooldown =
      (TIER_RANK[tier] ?? 9) < (TIER_RANK[this._lastCueTier] ?? 9);
    const since = now - this._lastCueAt;
    // Tempo is exempt from the floor, as safety is. Measured: it was being
    // selected correctly and then held 300ms behind a phase cue, so the one cue
    // that explains why a fast patient is losing reps never reached them. The
    // host coalesces on "latest wins" rather than interrupting, so an early
    // tempo cue simply supersedes the phase cue that was queued - which is the
    // right outcome, not a collision.
    const floor = tier === 'tempo' ? 0 : MIN_CUE_FLOOR_MS;
    if (outranksCooldown ? since < floor : since < FEEDBACK_MIN_GAP_MS) {
      return this.lastFeedback;
    }

    if (tier === 'form') this._formCuesThisRep += 1;
    this._lastCueAt = now;
    this._lastCueTier = tier;
    return say;
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
