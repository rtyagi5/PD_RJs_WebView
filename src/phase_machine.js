// ---------------------------------------------
// phase_machine.js
// ---------------------------------------------

export class PhaseMachine {
    /**
     * @param {Object} spec - normalized spec-like object (phases, rep, feedback, dwellMs, refractoryMs, optional time)
     * @param {Object} opts - { targetReps, targetSeconds }
     */
    constructor(spec, { targetReps = 10, targetSeconds } = {}) {
      this.spec = normalizeSpec(spec);
      this.targetReps = targetReps;
  
      // Mode detection
      this.mode = this.spec.mode === 'time' || this.spec.isTimeBased ? 'time' : 'reps';
  
      // --- Pair mode (optional) ---
      this.repMode = this.spec.repMode || 'perLift'; // 'perLift' | 'pair'
      this.selectActiveSide =
        typeof this.spec.selectActiveSide === 'function' ? this.spec.selectActiveSide : null;
      this.lastSide = null;     // informational (not used by pair counting anymore)
      this.pairAwait = null;    // side we’re waiting to complete the pair with
  
      // Time-mode config
      const timeCfg = this.spec.time || {};
      this.targetPhaseId = timeCfg.targetPhase ?? (this.spec.rep?.to ?? null);
  
      // Resolve target duration (ms) for time mode
      this.targetMs =
        (typeof timeCfg.targetMs === 'number' && timeCfg.targetMs >= 0 ? timeCfg.targetMs : null) ??
        (typeof this.spec.targetMs === 'number' ? this.spec.targetMs : null) ??
        (typeof targetSeconds === 'number' ? targetSeconds * 1000 : null) ??
        (this.mode === 'time' && typeof targetReps === 'number' ? targetReps * 1000 : null) ??
        5000;
  
      this.accumulate = timeCfg.accumulate ?? true;
      this.graceMs = timeCfg.graceMs ?? 0;
  
      // State
      this.phase = null;
      this.lastPhaseEnterAt = 0;
      this.refractoryUntil = 0;
      this.repCount = 0;
      this.feedback = '';
  
      // Time-mode timers
      this.holdStartMs = null;
      this.leftTargetAtMs = null;
      this.accumHoldMs = 0;
    }
  
    resetCounters() {
      this.phase = null;
      this.lastPhaseEnterAt = 0;
      this.feedback = '';
      this.refractoryUntil = 0;
  
      // time-mode timers
      this.holdStartMs = null;
      this.leftTargetAtMs = null;
      this.accumHoldMs = 0;
  
      // reps
      this.repCount = 0;
  
      // pair-mode
      this.lastSide = null;
      this.pairAwait = null;
    }
  
    /**
     * @param {Object} inputs – { t, features, now, say, setHighlight }
     * @returns {Object} – { phase, repDelta, repCount, feedback, done, timeHeldMs?, timeRemainingMs? }
     */
    step({ t, features, now = performance.now(), say, setHighlight }) {
      const { phases, rep, feedback, dwellMs, refractoryMs } = this.spec;
      let repDelta = 0;
  
      // 1) Which phase are we in?
      const nextPhase = phases.find((p) => evalBool(p.enter, features));
  
      // 2) Dwell + transitions
      if (!this.phase) {
        if (nextPhase) {
          this.phase = nextPhase.id;
          this.lastPhaseEnterAt = now;
        }
      } else if (nextPhase && nextPhase.id !== this.phase) {
        const dwellNeeded = (nextPhase.dwellMs ?? dwellMs) || 0;
        if (now - this.lastPhaseEnterAt >= dwellNeeded) {
          const prev = this.phase;
          this.phase = nextPhase.id;
          this.lastPhaseEnterAt = now;
  
          // Rep logic only for reps-mode
          if (this.mode !== 'time' && prev === rep.from && this.phase === rep.to && now >= this.refractoryUntil) {
            // if (this.repMode === 'pair' && this.selectActiveSide) {
            //   // New: count 1 ONLY when we complete both sides (A then B)
            //   const sideNow = this.selectActiveSide(features); // 'left' | 'right' | null
            //   if (sideNow) {
            //     if (this.pairAwait == null) {
            //       // first half of the pair
            //       this.pairAwait = sideNow;
            //     } else if (sideNow !== this.pairAwait) {
            //       // completed a pair
            //       this.repCount += 1;
            //       repDelta = 1;
            //       this.pairAwait = null; // ready for next pair
            //     }
            //     this.lastSide = sideNow;
            //   }
            //   this.refractoryUntil = now + (refractoryMs || 250);
            // } else {
                if (this.repMode === 'pair' && this.selectActiveSide) {
                    const sideNow = this.selectActiveSide(features);
                    if (!sideNow) {
                        console.log('[PM] pair: sideNow=null (cannot determine side on raise)');
                    } else {
                        console.log(`[PM] pair: sideNow=${sideNow}, lastSide=${this.lastSide ?? 'null'}`);
                        if (this.lastSide && sideNow !== this.lastSide) {
                            this.repCount += 1;
                            repDelta = 1;
                            console.log(`[PM] pair: counted, rep=${this.repCount}`);
                        }
                        this.lastSide = sideNow;
                    }
                    this.refractoryUntil = now + (refractoryMs || 250);
                } else {
                    // Default: per lift
                    this.repCount += 1;
                    repDelta = 1;
                    this.refractoryUntil = now + (refractoryMs || 250);
                }
          }
        }
      }
  
      // 3) Time-mode accounting
      let timeHeldMs = 0;
      let timeRemainingMs = null;
  
      if (this.mode === 'time' && this.targetPhaseId) {
        const inTarget = this.phase === this.targetPhaseId;
  
        if (inTarget) {
          if (this.holdStartMs == null) this.holdStartMs = now;
          this.leftTargetAtMs = null;
        } else if (this.holdStartMs != null) {
          if (this.graceMs > 0) {
            if (this.leftTargetAtMs == null) this.leftTargetAtMs = now;
            if (now - this.leftTargetAtMs > this.graceMs) {
              this.accumHoldMs += this.leftTargetAtMs - this.holdStartMs;
              this.holdStartMs = null;
              this.leftTargetAtMs = null;
            }
          } else {
            this.accumHoldMs += now - this.holdStartMs;
            this.holdStartMs = null;
            this.leftTargetAtMs = null;
          }
        }
  
        if (this.accumulate) {
          timeHeldMs = this.accumHoldMs;
          if (this.holdStartMs != null) {
            const effectiveNow = this.leftTargetAtMs ?? now;
            timeHeldMs += Math.max(0, effectiveNow - this.holdStartMs);
          }
        } else {
          if (this.holdStartMs != null) {
            const effectiveNow = this.leftTargetAtMs ?? now;
            timeHeldMs = Math.max(0, effectiveNow - this.holdStartMs);
          } else {
            timeHeldMs = 0;
          }
        }
  
        timeRemainingMs = Math.max(0, (this.targetMs ?? 0) - timeHeldMs);
        this.repCount = Math.floor(timeHeldMs / 1000); // legacy HUD compatibility
      }
  
      // 4) Feedback (first match wins)
      let fb = this.feedback;
      for (const r of feedback || []) {
        const ctx = {
          ...features,
          phase: this.phase,
          reps: this.repCount,
          timeHeldMs,
          timeRemainingMs,
        };
        if (evalBool(r.when, ctx)) {
          fb = r.say ?? fb;
          if (typeof r.highlight === 'function') {
            r.highlight({ setHighlight, features, phase: this.phase });
          }
          break;
        }
      }
      this.feedback = fb;
  
      // 5) Done?
      const done =
        this.mode === 'time'
          ? (this.targetMs != null ? timeHeldMs >= this.targetMs : false)
          : this.repCount >= this.targetReps;
  
      return {
        phase: this.phase,
        repDelta,
        repCount: this.repCount,
        feedback: this.feedback,
        done,
        timeHeldMs: this.mode === 'time' ? timeHeldMs : undefined,
        timeRemainingMs: this.mode === 'time' ? Math.max(0, timeRemainingMs ?? 0) : undefined,
      };
    }
  }
  
  // -- internals --------------------------------------------------------------
  
  function normalizeSpec(spec) {
    return {
      dwellMs: 120,
      refractoryMs: 300,
      feedback: [],
      ...spec,
      phases: spec.phases || [],
      rep: spec.rep || { from: null, to: null },
      time: spec.time || undefined,
    };
  }
  
  function evalBool(expr, ctx) {
    if (!expr) return false;
    const keys = Object.keys(ctx || {});
    const vals = Object.values(ctx || {});
    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function(...keys, 'Math', `return (${expr}) ? true : false;`);
      return !!fn(...vals, Math);
    } catch {
      return false;
    }
  }
  