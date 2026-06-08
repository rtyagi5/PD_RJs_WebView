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

import { runAllChecks } from './PoseQuality';

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
};

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
    const { allGood, checks } = runAllChecks(keypoints, frameW, frameH, this.spec);
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
      const msg = this._primaryCoachingMessage(checks);
      return this._result(checks, msg || 'Position yourself in the frame');
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
          const msg = this._primaryCoachingMessage(checks);
          return this._result(checks, msg || 'Position yourself in the frame');
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

  _result(coachingChecks, message, countdownRemaining) {
    return {
      state: this.state,
      coachingChecks: coachingChecks || this._lastChecks,
      countdownRemaining: countdownRemaining ?? null,
      message: message ?? '',
    };
  }

  /** Pick the highest-priority failing check message. */
  _primaryCoachingMessage(checks) {
    // Priority: visibility → distance → angle → lighting
    const order = ['visibility', 'distance', 'angle', 'lighting'];
    for (const name of order) {
      const c = checks.find(ch => ch.name === name);
      if (c && c.status !== 'good' && c.message) return c.message;
    }
    return '';
  }
}
