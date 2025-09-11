
// specs/SeatedDorsiflexion.spec.js

// --- session calibration & small spike guards ---
let __footDYBaseline = NaN;   // baseline (toe.y - heel.y)/shank
let __toeBaseline    = NaN;   // baseline toe vs knee (normalized)
let __heelBaseline   = NaN;   // baseline heel vs knee (normalized)
let __baselineFrames = 0;
let __baselineLocked = false;

let __prevFootDY = NaN;

const __BASE_FRAMES    = 45;   // ~1.5s @ 30fps
const __EMA_ALPHA_INIT = 0.15; // warmup settle
const __EMA_ALPHA_SLOW = 0.06; // slow creep pre-lock

const ema = (prev, v, a) => (Number.isFinite(prev) ? (a*v + (1-a)*prev) : v);

// URL knobs, e.g. ?footPctMin=0.10&heelTol=0.03&toeUpMin=0.02
function getPct(name, fallback) {
  const v = Number(new URLSearchParams(window.location.search).get(name));
  return (Number.isFinite(v) && v > 0 && v < 0.5) ? v : fallback;
}

function clampRangeOrNaN(v, lo = -0.2, hi = 2.0) {
  return Number.isFinite(v) && v > lo && v < hi ? v : NaN;
}
function clampJump(prev, v, maxJump = 0.5) {
  if (!Number.isFinite(v) || !Number.isFinite(prev)) return v;
  return Math.abs(v - prev) > maxJump ? prev : v;
}

const SeatedDorsiflexion = {
  name: 'SeatedDorsiflexion',
  detector: 'mediapipe',
  side: 'both',
  mode: 'rep',

  // Show the pitch delta (negative when toes lift up)
  primaryMetric: 'footPitchDelta',

  dwellMs: 180,
  refractoryMs: 450,

  // posture (same spirit as seated calf raise)
  trunkUprightMin: 155,

  onStart: () => {
    __footDYBaseline = NaN;
    __toeBaseline    = NaN;
    __heelBaseline   = NaN;
    __baselineFrames = 0;
    __baselineLocked = false;
    __prevFootDY     = NaN;
  },

  // visualize ankle–heel–toe so pitch is obvious
  highlights: ({ setHighlight }) => {
    setHighlight({
      color: '#00E5FF',
      keypoints: [
        ['left_ankle','left_heel'],   ['left_heel','left_foot_index'],
        ['right_ankle','right_heel'], ['right_heel','right_foot_index'],
      ],
    });
  },

  // For dorsiflexion: footPitchDelta goes NEGATIVE (toe up, heel stays).
  // lowered:  footPitchDelta >= -pitchDown
  // raised:   footPitchDelta <= -pitchUp
  phases: [
    {
      id: 'lowered',
      enter:
        "Number.isFinite(footPitchDelta) && Number.isFinite(pitchDown) && footPitchDelta >= (-pitchDown)"
    },
    {
      id: 'raised',
      enter:
        "(" +
        // main lift (delta sufficiently negative)
        " Number.isFinite(footPitchDelta) && Number.isFinite(pitchUp) && footPitchDelta <= (-pitchUp)" +
        // posture
        " ) && (" +
        " !Number.isFinite(trunkAngleMin) || trunkAngleMin >= (trunkUprightMin - 5)" +
        // guard 1: heel stays near baseline (reject whole-foot pickup)
        " ) && (" +
        " !Number.isFinite(heelStayTol) || (Number.isFinite(heelDeltaAbs) && heelDeltaAbs <= heelStayTol)" +
        // guard 2: toe truly moved up vs knee baseline
        " ) && (" +
        " !Number.isFinite(toeUpDeltaMin) || (Number.isFinite(toeUpDelta) && toeUpDelta >= toeUpDeltaMin)" +
        ")"
    },
  ],

  rep: { from: 'lowered', to: 'raised' },

  feedback: [
    { when: "phase=='lowered'", say: 'Lift your toes up' },
    { when: "phase=='raised'",  say: 'Nice — lower slowly' },
    { when: "Number.isFinite(trunkAngleMin) && trunkAngleMin < trunkUprightMin", say: 'Sit tall' },
  ],

  computeExtraFeatures: ({ kps, utils }) => {
    const kp = utils.kp, P = utils.present, D = utils.calculateDistance, A = utils.angle;

    // joints
    const Lk = kp(kps, 'left_knee');   const Rk = kp(kps, 'right_knee');
    const La = kp(kps, 'left_ankle');  const Ra = kp(kps, 'right_ankle');
    const Lh = kp(kps, 'left_heel');   const Rh = kp(kps, 'right_heel');
    const Lfi = kp(kps, 'left_foot_index'); const Rfi = kp(kps, 'right_foot_index');
    const Ls = kp(kps, 'left_shoulder');    const Rs = kp(kps, 'right_shoulder');
    const Lhip = kp(kps, 'left_hip');       const Rhip = kp(kps, 'right_hip');

    const finite = Number.isFinite;
    const avg = arr => {
      const v = arr.filter(Number.isFinite);
      return v.length ? v.reduce((a,b)=>a+b,0)/v.length : NaN;
    };

    // normalize by shank
    const shankLenL = (P(Lk)&&P(La)) ? Math.max(D(Lk, La), 1e-6) : NaN;
    const shankLenR = (P(Rk)&&P(Ra)) ? Math.max(D(Rk, Ra), 1e-6) : NaN;

    // toe/heel vs knee (normalized)
    const heelBelowKneeNormL = (P(Lk)&&P(Lh)&&finite(shankLenL)) ? (Lh.y  - Lk.y)/shankLenL : NaN;
    const heelBelowKneeNormR = (P(Rk)&&P(Rh)&&finite(shankLenR)) ? (Rh.y  - Rk.y)/shankLenR : NaN;
    const toeBelowKneeNormL  = (P(Lk)&&P(Lfi)&&finite(shankLenL))? (Lfi.y - Lk.y)/shankLenL : NaN;
    const toeBelowKneeNormR  = (P(Rk)&&P(Rfi)&&finite(shankLenR))? (Rfi.y - Rk.y)/shankLenR : NaN;

    // pitch = toe.y - heel.y (normalized). Dorsiflexion makes this SMALLER.
    let footDYNormL = (P(Lfi)&&P(Lh)&&finite(shankLenL)) ? (Lfi.y - Lh.y)/shankLenL : NaN;
    let footDYNormR = (P(Rfi)&&P(Rh)&&finite(shankLenR)) ? (Rfi.y - Rh.y)/shankLenR : NaN;

    let footDY = avg([footDYNormL, footDYNormR]);
    footDY = clampRangeOrNaN(footDY);
    footDY = clampJump(__prevFootDY, footDY, 0.50);
    __prevFootDY = finite(footDY) ? footDY : __prevFootDY;

    const toeAvg  = avg([toeBelowKneeNormL,  toeBelowKneeNormR]);
    const heelAvg = avg([heelBelowKneeNormL, heelBelowKneeNormR]);

    // --- warmup + lock baseline when near "down" (flat foot) ---
    if (finite(footDY) && __baselineFrames < __BASE_FRAMES) {
      __footDYBaseline = ema(__footDYBaseline, footDY, __EMA_ALPHA_INIT);
      __toeBaseline    = ema(__toeBaseline,    toeAvg, __EMA_ALPHA_INIT);
      __heelBaseline   = ema(__heelBaseline,   heelAvg, __EMA_ALPHA_INIT);
      __baselineFrames++;

      // lock only when near-down (very small pitch delta) & heel quiet
      const tempDelta = finite(__footDYBaseline) ? (footDY - __footDYBaseline) : 0;
      const nearDown  = finite(tempDelta) && Math.abs(tempDelta) < 0.02;
      const heelQuiet = !finite(heelAvg) || !finite(__heelBaseline) || Math.abs(heelAvg - __heelBaseline) <= 0.02;

      if (__baselineFrames >= __BASE_FRAMES && nearDown && heelQuiet) {
        __baselineLocked = true;
        // tiny cushion so early reps fire cleanly
        __footDYBaseline *= 1.02; // slightly larger baseline → easier to go "below"
      }
    }

    // delta from baseline (negative when toes go up)
    const footDYBase = finite(__footDYBaseline) ? __footDYBaseline : footDY;
    const footPitchDelta = (finite(footDY) && finite(footDYBase)) ? (footDY - footDYBase) : NaN;

    // thresholds (use magnitude; sign handled in phase)
    const footPctMin = getPct('footPctMin', 0.10); // 10% of baseline pitch
    const pitchUpMag  = finite(footDYBase) ? Math.max(0.015, footPctMin * Math.abs(footDYBase)) : 0.03;
    const pitchDownMag = 0.5 * pitchUpMag; // hysteresis back toward baseline

    // guards:
    // 1) heel stays near baseline (no whole-foot pickup)
    const heelDeltaAbs = (finite(heelAvg) && finite(__heelBaseline)) ? Math.abs(heelAvg - __heelBaseline) : NaN;
    const heelStayTol  = getPct('heelTol', 0.03); // ~3% shank

    // 2) toe truly moved upward vs knee baseline
    // toeAboveKneeNorm decreases when toe rises → baseline - current is positive
    const toeUpDelta    = (finite(toeAvg) && finite(__toeBaseline)) ? (__toeBaseline - toeAvg) : NaN;
    const toeUpDeltaMin = Math.max(0.015, getPct('toeUpMin', 0.02)); // ~1.5–2%

    // allow baselines to creep ONLY pre-lock when clearly down & heel quiet
    if (!__baselineLocked) {
      const clearlyDown = finite(footPitchDelta) && Math.abs(footPitchDelta) <= pitchDownMag;
      const quietHeel   = !finite(heelDeltaAbs) || heelDeltaAbs <= Math.min(0.02, heelStayTol);
      if (clearlyDown && quietHeel && finite(footDY)) {
        __footDYBaseline = ema(__footDYBaseline, footDY, __EMA_ALPHA_SLOW);
        if (finite(toeAvg))  __toeBaseline  = ema(__toeBaseline,  toeAvg,  __EMA_ALPHA_SLOW);
        if (finite(heelAvg)) __heelBaseline = ema(__heelBaseline, heelAvg, __EMA_ALPHA_SLOW);
      }
    }

    // posture (coaching)
    const trunkL = (P(Ls)&&P(Lhip)&&(P(La)||P(Lk))) ? A(Ls, Lhip, (P(La)?La:Lk)) : NaN;
    const trunkR = (P(Rs)&&P(Rhip)&&(P(Ra)||P(Rk))) ? A(Rs, Rhip, (P(Ra)?Ra:Rk)) : NaN;
    const trunkAngleMin = [trunkL, trunkR].filter(finite).length
      ? Math.min(trunkL, trunkR)
      : NaN;

    // expose thresholds with names that match phase expressions
    const pitchUp   = pitchUpMag;    // magnitude (phase tests footPitchDelta <= -pitchUp)
    const pitchDown = pitchDownMag;  // magnitude (phase tests footPitchDelta >= -pitchDown)

    // debug
    if (window.__DEBUG_SDF && finite(footDYBase)) {
      // eslint-disable-next-line no-console
      console.log(
        `[SDF] ${__baselineLocked ? 'LOCKED' : 'WARMUP'} `
        + `pitchΔ=${footPitchDelta?.toFixed?.(3)} `
        + `up>=${(-pitchUp).toFixed(3)} down<=${(-pitchDown).toFixed(3)} `
        + `heelΔ=${heelDeltaAbs?.toFixed?.(3)}≤${heelStayTol?.toFixed?.(3)} `
        + `toe↑Δ=${toeUpDelta?.toFixed?.(3)}≥${toeUpDeltaMin?.toFixed?.(3)} `
        + `trunkMin=${trunkAngleMin?.toFixed?.(0) || '—'}`
      );
    }

    return {
      // main signals
      footPitchDelta, pitchUp, pitchDown,

      // guards
      heelDeltaAbs, heelStayTol,
      toeUpDelta, toeUpDeltaMin,

      // posture
      trunkAngleL: trunkL, trunkAngleR: trunkR, trunkAngleMin,
    };
  },
};

export default SeatedDorsiflexion;
