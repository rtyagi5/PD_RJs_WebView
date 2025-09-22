// specs/CalfRaisesStanding.spec.js
//
// Simple standing calf raise: count reps from foot pitch delta only
// (toe.y - heel.y, normalized by shank). Lock a baseline after short warmup.
// Optional knee-straight guard; everything else is intentionally minimal.

// Angle-only debug previous values
let __prevToeL = NaN, __prevHeelL = NaN, __prevToeR = NaN, __prevHeelR = NaN;
let __lastLogTs = 0;
// Angle-based rep state (absolute thresholds)
let __loweredTsActive = 0; // dwell timer when in absolute lowered band (side-agnostic)
let __prevReadyFlag = false; // for one-shot READY log without relying on 'this'

// (Removed unused baseline helpers)

const CalfRaisesStanding = {
  name: 'CalfRaisesStanding',
  detector: 'mediapipe',
  side: 'both',
  mode: 'rep',

  // For the HUD show the active toe angle
  primaryMetric: 'activeToeAngle',

  // Timing: short hold, moderate cooldown so quick, real raises count
  dwellMs: 150,        // Short hold to accommodate balance
  refractoryMs: 500,   // Cooldown between reps

  // Posture guards with more tolerance
  kneeStraightMin: 145,  // Slightly more tolerant of bent knees
  trunkUprightMin: 155,  // Slightly more tolerant of forward lean

  onStart: () => {
    // reset per-session state
    __prevToeL = __prevHeelL = __prevToeR = __prevHeelR = NaN;
    __lastLogTs = 0;
    __loweredTsActive = 0;
    // Do not auto-enable debug; logs are gated by window.__LOG_ANGLES
  },

  highlights: function ({ setHighlight, features }) {
    const f = features || {};
    const activeToe = f.activeToeAngle;
    const raiseDeg = f.degRaiseDynamic;
    const armed = !!f.armReady;

    // Posture checks
    const kMin = f.kneeAngleMin; const kThr = f.kneeStraightMin;
    const tMin = f.trunkAngleMin; const tThr = f.trunkUprightMin;
    const badKnee  = Number.isFinite(kMin) && Number.isFinite(kThr) && kMin < (kThr - 10);
    const badTrunk = Number.isFinite(tMin) && Number.isFinite(tThr) && tMin < tThr;
    const badPosture = badKnee || badTrunk;

    const inLowered = !!f.loweredOk;
    const inRaised  = Number.isFinite(activeToe) && Number.isFinite(raiseDeg) && activeToe >= raiseDeg;

    let color = '#FFB020'; // transition orange by default
    if (badPosture) color = '#FF4D4F'; // red
    else if (inLowered && armed) color = '#66FF00'; // green when ok to raise
    else if (inRaised) color = '#66FF00'; // green at top
    else if (inLowered && !armed) color = '#66CCFF'; // cool blue while waiting to arm

    // Add hysteresis like Seated so color doesn't flicker
    if (!this._hl) this._hl = { lastColor: null, lastTs: 0 };
    const now = Date.now();
    const HOLD_MS = 250;
    const { lastColor, lastTs } = this._hl;
    if (lastColor === '#FFB020' && now - lastTs < HOLD_MS) color = '#FFB020';
    if (color !== lastColor) { this._hl.lastColor = color; this._hl.lastTs = now; }

    // Emphasize active side keypoints if available, else draw both sides
    const uiSide = String(f?.side || '').toLowerCase();
    const active = f?.activeSide || (uiSide === 'left' || uiSide === 'right' ? uiSide : null);
    let pts;
    if (active === 'left' || active === 'right') {
      const s = active;
      pts = [`${s}_hip`, `${s}_knee`, `${s}_ankle`, `${s}_heel`, `${s}_foot_index`];
    } else {
      pts = ['left_ankle','left_heel','left_foot_index','right_ankle','right_heel','right_foot_index'];
    }

    setHighlight({ color, keypoints: pts });
  },

  // State machine (angle-based)
  phases: [
    {
      id: 'lowered',
      enter: "loweredOk===true"
    },
    {
      id: 'raised',
      enter: "(" +
        " Number.isFinite(activeToeAngle) && Number.isFinite(degRaiseDynamic) && (" +
          " activeToeAngle >= degRaiseDynamic" +
        ")" +
        " ) && (" +
        " !Number.isFinite(kneeStraightMin) || !Number.isFinite(kneeAngleMin) || kneeAngleMin >= (kneeStraightMin - 10)" +
        " )"
    },
  ],

  rep: { from: 'lowered', to: 'raised' },

  feedback: [
    { when: "phase=='lowered'", say: 'Lift your heels' },
    { when: "phase=='lowered' && !armReady", say: 'Hold neutral briefly to arm' },
    { when: "phase=='raised'",  say: 'Nice — control down' },
    { when: "Number.isFinite(kneeAngleMin) && Number.isFinite(kneeStraightMin) && kneeAngleMin < kneeStraightMin", say: 'Keep knees straighter' },
    { when: "Number.isFinite(trunkAngleMin) && trunkAngleMin < trunkUprightMin", say: 'Stand tall' },
  ],

  computeExtraFeatures: ({ kps, utils }) => {
    const Lk = utils.kp(kps, 'left_knee');  const Rk = utils.kp(kps, 'right_knee');
    const La = utils.kp(kps, 'left_ankle'); const Ra = utils.kp(kps, 'right_ankle');
    const Lh = utils.kp(kps, 'left_heel');  const Rh = utils.kp(kps, 'right_heel');
    const Lfi = utils.kp(kps, 'left_foot_index'); const Rfi = utils.kp(kps, 'right_foot_index');

    const P = utils.present, A = utils.angle;
    const vis = p => (p?.score || 0) >= 0.15;
    const finite = v => Number.isFinite(v);

    const angToeL  = (P(Lk)&&P(La)&&P(Lfi)&&vis(La)&&vis(Lfi)) ? A(Lk, La, Lfi) : NaN;
    const angHeelL = (P(Lk)&&P(La)&&P(Lh) &&vis(La)&&vis(Lh))  ? A(Lk, La, Lh)  : NaN;
    const angToeR  = (P(Rk)&&P(Ra)&&P(Rfi)&&vis(Ra)&&vis(Rfi)) ? A(Rk, Ra, Rfi) : NaN;
    const angHeelR = (P(Rk)&&P(Ra)&&P(Rh) &&vis(Ra)&&vis(Rh))  ? A(Rk, Ra, Rh)  : NaN;

    // Log only when angle changes by >=1° and debounce logs to ~5/sec
    const now = Date.now();
    const shouldLog = (now - __lastLogTs) >= 200 && (typeof window !== 'undefined' && window.__LOG_ANGLES === true);
    const changed = (a,b) => (finite(a)&&finite(b) && Math.abs(a-b) >= 1);
    if (shouldLog && (
      changed(angToeL, __prevToeL) || changed(angHeelL, __prevHeelL) ||
      changed(angToeR, __prevToeR) || changed(angHeelR, __prevHeelR)
    )) {
      __lastLogTs = now;
      // eslint-disable-next-line no-console
      console.log('[CRS-STANDING ANGLES]',
        `L toe=${finite(angToeL)?angToeL.toFixed(0):'—'}`,
        `L heel=${finite(angHeelL)?angHeelL.toFixed(0):'—'}`,
        `R toe=${finite(angToeR)?angToeR.toFixed(0):'—'}`,
        `R heel=${finite(angHeelR)?angHeelR.toFixed(0):'—'}`
      );
    }
    __prevToeL = finite(angToeL) ? angToeL : __prevToeL;
    __prevHeelL = finite(angHeelL) ? angHeelL : __prevHeelL;
    __prevToeR = finite(angToeR) ? angToeR : __prevToeR;
    __prevHeelR = finite(angHeelR) ? angHeelR : __prevHeelR;

    // --- Angle-based rep logic (ABSOLUTE THRESHOLDS) ---
    // Use whichever toe angle is available and larger for robustness
    let activeSide = null;
    if (finite(angToeL) && finite(angToeR)) activeSide = (angToeL >= angToeR) ? 'left' : 'right';
    else if (finite(angToeL)) activeSide = 'left';
    else if (finite(angToeR)) activeSide = 'right';

    const activeToeAngle = activeSide === 'left' ? angToeL : activeSide === 'right' ? angToeR : NaN;

    // Simple absolute thresholds derived from your observed data
    const loweredMax = 110;    // <= this is neutral (wider)
    const raisedMin = 115;     // >= this is raised (lower for sensitivity)

    const loweredOk = Number.isFinite(activeToeAngle) && activeToeAngle <= loweredMax;
    if (loweredOk) {
      if (!__loweredTsActive) __loweredTsActive = now;
    } else {
      __loweredTsActive = 0;
    }

    const armReady = loweredOk && (now - __loweredTsActive) >= 80; // shorter dwell to arm
    const degRaiseDynamic = raisedMin; // fixed absolute raised target

    // Minimal posture metrics (optional)
    const kneeAngleL = NaN, kneeAngleR = NaN, kneeAngleMin = NaN;
    const kneeStraightMin = CalfRaisesStanding.kneeStraightMin;

    // One-shot log when a rep condition is satisfied (pre-phase), to aid debugging
    if (typeof window !== 'undefined' && window.__DEBUG_CRS) {
      const readyNow = !!(armReady && Number.isFinite(activeToeAngle) && activeToeAngle >= degRaiseDynamic);
      if (readyNow && !__prevReadyFlag) {
        // eslint-disable-next-line no-console
        console.log('[CRS-STANDING READY]', `side=${activeSide||'—'}`, `toe=${activeToeAngle?.toFixed?.(0)}`, `>=${degRaiseDynamic}`);
      }
      __prevReadyFlag = readyNow;
    }

    return {
      ankleAngleToeL: angToeL,
      ankleAngleHeelL: angHeelL,
      ankleAngleToeR: angToeR,
      ankleAngleHeelR: angHeelR,
      activeSide,
      activeToeAngle,
      degRaiseDynamic,
      loweredOk,
      armReady,
      kneeAngleL, kneeAngleR, kneeAngleMin, kneeStraightMin,
    };
  },
};

export default CalfRaisesStanding;
