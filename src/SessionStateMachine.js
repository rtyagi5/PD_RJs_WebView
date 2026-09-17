// ---------------------------------------------
// SessionStateMachine.js
// Top-level session state machine:
//   LOADING → COACHING → COUNTDOWN → ACTIVE → COMPLETED
//                 ↑          ↑          │
//                 └──────────┘          ↓
//                                   INACTIVE → (ACTIVE or COACHING)
//
// Pure logic — no React, no DOM. Call step() every frame.
// ---------------------------------------------

import { runAllChecks, CHECK_PRIORITY } from './PoseQuality';

// ── States ───────────────────────────────────────────────────────────────────
export const SESSION_STATES = Object.freeze({
  LOADING:   'loading',
  COACHING:  'coaching',
  COUNTDOWN: 'countdown',
  ACTIVE:    'active',
  INACTIVE:  'inactive',
  COMPLETED: 'completed',
});

// ── Tunables ─────────────────────────────────────────────────────────────────
const DEFAULTS = {
  stableFrames:      30,     // ~1 s @ 30 fps — coaching checks must pass consecutively
  countdownSeconds:  5,      // countdown length before ACTIVE
  inactiveThreshold: 15,     // frames with missing keypoints before INACTIVE
  reactivateFrames:  10,     // frames with keypoints back before resuming ACTIVE
  maxInactiveMs:     15000,  // 15 s absent → fall back to COACHING
  minCoachingMs:     3000,   // coaching phase visible for at least 3 s
  countdownBadFramesAllowed: 30, // tolerate brief check failures during countdown (≈1s @ 30fps)
  checkDwellMs:      700,    // a verdict must persist this long before it is acted on
};

// Quality checks are pure per-frame functions, and several of their inputs are
// not stable frame to frame. MediaPipe's confidence on an occluded far limb
// swings hard: measured during one setup, kneeL went 0.61, 0.55, 0.37, 0.21,
// 0.46, 0.25 on a patient who had not moved. The foot check therefore returned
// three different verdicts in under two seconds - wrong_side, then no_foot,
// then good - and the consequences were both wrong.
//
// The message slot went to whichever verdict happened to be current, so "Turn
// around so your left side faces the camera" was shown for 0.4s and then
// replaced. And because one of the flickers was `good`, the session was waved
// through to countdown with the patient still sitting the wrong way round.
//
// So a verdict has to hold before it counts, in both directions - the same
// medicine that fixed phase thrash in the rep engine. Instantaneous truth about
// a noisy signal is not truth.

export class SessionStateMachine {
  /**
   * @param {Object} spec  – the active exercise spec (may include framing overrides)
   * @param {Object} opts  – override any DEFAULTS above
   */
  constructor(spec, opts = {}) {
    this.spec = spec || {};
    this.cfg = { ...DEFAULTS, ...opts };

    this.state = SESSION_STATES.LOADING;

    // Coaching stability counter
    this._goodFrames = 0;
    this._coachingEnteredMs = null;

    // Countdown
    this._countdownStartMs = null;
    this._countdownBadFrames = 0;

    // Inactive tracking
    this._missingFrames = 0;
    this._presentFrames = 0;
    this._inactiveSinceMs = null;

    // Stabilised verdicts: name -> { status, candidate, candidateSince }
    this._verdicts = new Map();

    // Latest coaching results (kept for overlay drawing)
    this._lastChecks = [];
  }

  /** Reset to LOADING (e.g. on exercise change). */
  reset() {
    this.state = SESSION_STATES.LOADING;
    this._goodFrames = 0;
    this._coachingEnteredMs = null;
    this._countdownStartMs = null;
    this._countdownBadFrames = 0;
    this._missingFrames = 0;
    this._presentFrames = 0;
    this._inactiveSinceMs = null;
    this._lastChecks = [];
  }

  /**
   * Call once per animation frame.
   *
   * @param {Object} params
   * @param {Array}  params.keypoints    – raw keypoints array from pose detector
   * @param {number} params.frameW       – video width in px
   * @param {number} params.frameH       – video height in px
   * @param {boolean} params.hasDetector – is the pose detector ready?
   * @param {boolean} params.hasVideo    – is the webcam video stream ready?
   * @param {boolean} params.engineDone  – has PhaseMachine signalled completion?
   * @param {number} [params.now]        – current timestamp (default: performance.now())
   *
   * @returns {{ state, coachingChecks, countdownRemaining, message }}
   */
  step({ keypoints, frameW, frameH, hasDetector, hasVideo, engineDone, now }) {
    now = now ?? performance.now();
    const S = SESSION_STATES;

    // ── Terminal state ─────────────────────────────────────────────────────
    if (this.state === S.COMPLETED) {
      return this._result(null, 'Exercise complete!');
    }

    // ── LOADING ────────────────────────────────────────────────────────────
    if (this.state === S.LOADING) {
      if (hasDetector && hasVideo) {
        this.state = S.COACHING;
        this._goodFrames = 0;
      }
      return this._result(null, 'Loading pose detector…');
    }

    // Run coaching quality checks (used by COACHING, COUNTDOWN, and INACTIVE→COACHING)
    const raw = runAllChecks(keypoints, frameW, frameH, this.spec);

    // Only COACHING uses the held verdicts. It is the one state with no
    // hysteresis of its own, and the one where both failures happened: it picks
    // the spoken message, and it decides whether to start the countdown at all.
    // COUNTDOWN and ACTIVE already debounce on their own terms
    // (countdownBadFramesAllowed, inactiveThreshold, reactivateFrames), and
    // stacking a second layer there only makes the session slow to notice a
    // patient who has genuinely stopped or left the frame.
    const stable = this._stabilise(raw, now);
    const { allGood, checks } = this.state === S.COACHING ? stable : raw;
    this._lastChecks = checks;

    // ── COACHING ───────────────────────────────────────────────────────────
    if (this.state === S.COACHING) {
      // Track when we first entered coaching
      if (this._coachingEnteredMs == null) this._coachingEnteredMs = now;
      const coachingElapsed = now - this._coachingEnteredMs;

      if (allGood) {
        this._goodFrames++;
        // Only transition after minimum coaching duration AND stable frames
        if (this._goodFrames >= this.cfg.stableFrames && coachingElapsed >= this.cfg.minCoachingMs) {
          this.state = S.COUNTDOWN;
          this._countdownStartMs = now;
        }
      } else {
        this._goodFrames = 0;
      }
      const failing = this._primaryFailingCheck(checks);
      return this._result(
        checks,
        failing?.message || 'Position yourself in the frame',
        null,
        failing?.name || null,
      );
    }

    // ── COUNTDOWN ──────────────────────────────────────────────────────────
    if (this.state === S.COUNTDOWN) {
      // Hysteresis: tolerate brief check failures during countdown (mobile keypoints
      // flicker between good/bad frames). Only fall back to COACHING when the failure
      // is sustained, avoiding the "Get away → Starting in 4 → Get away" oscillation.
      if (!allGood) {
        this._countdownBadFrames++;
        if (this._countdownBadFrames >= this.cfg.countdownBadFramesAllowed) {
          this.state = S.COACHING;
          this._goodFrames = 0;
          this._countdownStartMs = null;
          this._countdownBadFrames = 0;
          const failing = this._primaryFailingCheck(checks);
          return this._result(
            checks,
            failing?.message || 'Position yourself in the frame',
            null,
            failing?.name || null,
          );
        }
      } else {
        this._countdownBadFrames = 0;
      }

      const elapsed = now - this._countdownStartMs;
      const totalMs = this.cfg.countdownSeconds * 1000;
      const remaining = Math.max(0, Math.ceil((totalMs - elapsed) / 1000));

      if (elapsed >= totalMs) {
        this.state = S.ACTIVE;
        this._missingFrames = 0;
        this._presentFrames = 0;
        // Per-exercise start cue tells the user exactly what to do (raise arm, squat, etc.)
        // Falls back to a generic "Begin!" if the spec didn't define one.
        const startCue = this.spec?.startCue || 'Begin!';
        return this._result(checks, startCue, 0);
      }

      return this._result(checks, `Starting in ${remaining}…`, remaining);
    }

    // ── ACTIVE ─────────────────────────────────────────────────────────────
    if (this.state === S.ACTIVE) {
      if (engineDone) {
        this.state = S.COMPLETED;
        return this._result(null, 'Exercise complete!');
      }

      // Check if patient left the frame
      const visCheck = checks.find(c => c.name === 'visibility');
      const visible = visCheck?.status === 'good';

      if (!visible) {
        this._missingFrames++;
        this._presentFrames = 0;
        if (this._missingFrames >= this.cfg.inactiveThreshold) {
          this.state = S.INACTIVE;
          this._inactiveSinceMs = now;
          return this._result(checks, 'Return to the frame to continue');
        }
      } else {
        this._missingFrames = 0;
      }

      // No coaching message during ACTIVE — PhaseMachine provides feedback
      return this._result(null, null);
    }

    // ── INACTIVE ───────────────────────────────────────────────────────────
    if (this.state === S.INACTIVE) {
      const visCheck = checks.find(c => c.name === 'visibility');
      const visible = visCheck?.status === 'good';

      if (visible) {
        this._presentFrames++;
        if (this._presentFrames >= this.cfg.reactivateFrames) {
          this.state = S.ACTIVE;
          this._missingFrames = 0;
          this._presentFrames = 0;
          this._inactiveSinceMs = null;
          return this._result(null, null);
        }
      } else {
        this._presentFrames = 0;
      }

      // Too long absent → fall back to COACHING
      if (this._inactiveSinceMs && (now - this._inactiveSinceMs) > this.cfg.maxInactiveMs) {
        this.state = S.COACHING;
        this._goodFrames = 0;
        this._inactiveSinceMs = null;
        return this._result(checks, 'Please reposition yourself');
      }

      return this._result(checks, 'Return to the frame to continue');
    }

    // Fallback (should not reach here)
    return this._result(null, '');
  }

  // ── Internal helpers ─────────────────────────────────────────────────────

  _result(coachingChecks, message, countdownRemaining, blockingCheck = null) {
    return {
      state: this.state,
      coachingChecks: coachingChecks || this._lastChecks,
      countdownRemaining: countdownRemaining ?? null,
      message: message ?? '',
      // Which failing check produced this message, if any. The generic
      // "Position yourself in the frame" fallback leaves it null. The host needs
      // the distinction: a named fault is an instruction the patient is blocked
      // on and must actually hear, while the fallback is ambient.
      blockingCheck,
    };
  }

  /**
   * Hold each check's verdict until a different one has persisted for
   * `checkDwellMs`, then commit it. Applies in both directions, so a momentary
   * `good` cannot clear a real fault any more than a momentary fault can raise
   * a false one.
   *
   * The returned checks carry the STABLE status and that status's message, so
   * the spoken instruction and the drawn overlay agree with each other and with
   * whatever the session is actually gated on.
   */
  _stabilise(raw, now) {
    const checks = raw.checks.map(c => {
      let v = this._verdicts.get(c.name);
      if (!v) {
        // First sight of this check: adopt it, with nothing to debounce against.
        v = { status: c.status, candidate: null, candidateSince: 0, sample: c };
        this._verdicts.set(c.name, v);
      }
      if (c.status === v.status) {
        v.candidate = null;
        v.sample = c;                       // keep the freshest reading of the held verdict
      } else if (c.status !== v.candidate) {
        v.candidate = c.status;
        v.candidateSince = now;
        v.candidateSample = c;
      } else if (now - v.candidateSince >= this.cfg.checkDwellMs) {
        v.status = c.status;
        v.sample = c;
        v.candidate = null;
      } else {
        v.candidateSample = c;
      }
      // Report the held verdict, with the most recent reading that produced it.
      return { ...v.sample, name: c.name, status: v.status };
    });

    const by = name => checks.find(c => c.name === name);
    const allGood = by('distance')?.status === 'good'
      && by('angle')?.status === 'good'
      && by('roll')?.status !== 'rolled'
      && by('visibility')?.status === 'good'
      && by('foot')?.status === 'good';

    return { allGood, checks };
  }

  /** Pick the highest-priority failing check. */
  _primaryFailingCheck(checks) {
    for (const name of CHECK_PRIORITY) {
      const c = checks.find(ch => ch.name === name);
      if (c && c.status !== 'good' && c.message) return c;
    }
    return null;
  }
}
