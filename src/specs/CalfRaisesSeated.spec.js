// --- simple per-session calibration & guards ---
let __plantarBaseline = NaN;
let __toeBaseline = NaN;
let __ankleBaseline = NaN;
let __footDYBaseline = NaN; // toe.y - heel.y (normalized) baseline
let __baselineFrames = 0;
let __baselineLocked = false; // Tracks if baseline is locked after initial calibration

let __prevPlantar = NaN;
let __prevFootDY = NaN;

const __BASE_FRAMES = 45;     // ~1.5s at 30fps
const __EMA_ALPHA_INIT = 0.15; // early settle
const __EMA_ALPHA_SLOW = 0.06; // slow creep when near-baseline (prevents drift)

const ema = (prev, v, a) => (Number.isFinite(prev) ? (a*v + (1-a)*prev) : v);

// Optional tuning via URL, e.g. ?raisePct=0.06&hystPct=0.03&footPctMin=0.12
function getPct(name, fallback) {
  const v = Number(new URLSearchParams(window.location.search).get(name));
  return (Number.isFinite(v) && v > 0 && v < 0.5) ? v : fallback;
}
function getTol(name, fallback) {
  const v = Number(new URLSearchParams(window.location.search).get(name));
  return (Number.isFinite(v) && v > 0 && v < 0.5) ? v : fallback;
}

// Very small sanity-guards against wild one-frame spikes
function clampRangeOrNaN(v, lo = -0.2, hi = 2.0) {
  return Number.isFinite(v) && v > lo && v < hi ? v : NaN;
}
function clampJump(prev, v, maxJump = 0.5) {
  if (!Number.isFinite(v)) return v;
  if (!Number.isFinite(prev)) return v;
  return Math.abs(v - prev) > maxJump ? prev : v;
}

const CalfRaisesSeated = {
  name: 'CalfRaisesSeated',
  detector: 'mediapipe',
  side: 'both',
  mode: 'rep',

  // HUD metric
  primaryMetric: 'plantarMetric',

  dwellMs: 180,
  refractoryMs: 450,

  // Original absolutes (fallback only)
  heelBelowKneeUp:   0.28,
  heelBelowKneeDown: 0.40,
  ankleBelowKneeUp:  0.30,
  ankleBelowKneeDown:0.42,

  trunkUprightMin: 155,

  onStart: () => {
    __plantarBaseline = NaN;
    __toeBaseline = NaN;
    __ankleBaseline = NaN;
    __footDYBaseline = NaN;
    __baselineFrames = 0;
    __baselineLocked = false;
    __prevPlantar = NaN;
    __prevFootDY = NaN;
  },

  // draw ankle–heel–toe links to visualize pitch
  highlights: ({ setHighlight }) => {
    setHighlight({
      color: '#00E5FF',
      keypoints: [
        ['left_ankle','left_heel'],   ['left_heel','left_foot_index'],
        ['right_ankle','right_heel'], ['right_heel','right_foot_index'],
      ],
    });
  },

  phases: [
    {
      id: 'lowered',
      enter:
        "Number.isFinite(plantarMetric) && Number.isFinite(plantarDown) && plantarMetric >= plantarDown"
    },
    {
      id: 'raised',
      enter:
        "Number.isFinite(plantarMetric) && Number.isFinite(plantarUp) && " +
        "(plantarMetric <= plantarUp || " +  // Either the plantar metric is low enough
        "(Number.isFinite(footPitchDelta) && footPitchDelta >= footPitchDeltaMin * 0.5))" // Or we see significant foot pitch change
    },
  ],

  rep: { 
    from: 'lowered', 
    to: 'raised',
    onComplete: () => {
      // Debug log when a rep is completed
      if (window.__DEBUG_CRS) {
        console.log('[CRS] Rep completed!');
      }
    }
  },

  feedback: [
    { when: "phase=='lowered'", say: 'Lift both heels' },
    { when: "phase=='raised'",  say: 'Nice — control down' },
    { when: "Number.isFinite(trunkAngleMin) && trunkAngleMin < trunkUprightMin", say: 'Sit tall' },
  ],

  computeExtraFeatures: ({ kps, utils }) => {
    const Lk = utils.kp(kps, 'left_knee');  const Rk = utils.kp(kps, 'right_knee');
    const La = utils.kp(kps, 'left_ankle'); const Ra = utils.kp(kps, 'right_ankle');
    const Lh = utils.kp(kps, 'left_heel');  const Rh = utils.kp(kps, 'right_heel');
    const Lfi = utils.kp(kps, 'left_foot_index'); const Rfi = utils.kp(kps, 'right_foot_index');
    const Ls = utils.kp(kps, 'left_shoulder'); const Rs = utils.kp(kps, 'right_shoulder');
    const Lhip = utils.kp(kps, 'left_hip');  const Rhip = utils.kp(kps, 'right_hip');

    const P = utils.present, D = utils.calculateDistance, A = utils.angle;
    const finite = v => Number.isFinite(v);
    const avg = arr => { const v = arr.filter(finite); return v.length ? v.reduce((a,b)=>a+b,0)/v.length : NaN; };

    const shankLenL = (P(Lk)&&P(La)) ? Math.max(D(Lk, La), 1e-6) : NaN;
    const shankLenR = (P(Rk)&&P(Ra)) ? Math.max(D(Rk, Ra), 1e-6) : NaN;

    // normalized heights vs knee
    const heelBelowKneeNormL  = (P(Lk)&&P(Lh)&&finite(shankLenL)) ? (Lh.y  - Lk.y)/shankLenL : NaN;
    const heelBelowKneeNormR  = (P(Rk)&&P(Rh)&&finite(shankLenR)) ? (Rh.y  - Rk.y)/shankLenR : NaN;
    const ankleBelowKneeNormL = (P(Lk)&&P(La)&&finite(shankLenL)) ? (La.y  - Lk.y)/shankLenL : NaN;
    const ankleBelowKneeNormR = (P(Rk)&&P(Ra)&&finite(shankLenR)) ? (Ra.y  - Rk.y)/shankLenR : NaN;
    const toeBelowKneeNormL   = (P(Lk)&&P(Lfi)&&finite(shankLenL)) ? (Lfi.y - Lk.y)/shankLenL : NaN;
    const toeBelowKneeNormR   = (P(Rk)&&P(Rfi)&&finite(shankLenR)) ? (Rfi.y - Rk.y)/shankLenR : NaN;

    // toe - heel vertical separation (grows when heel rises and toes stay)
    const footDYNormL = (P(Lfi)&&P(Lh)&&finite(shankLenL)) ? (Lfi.y - Lh.y)/shankLenL : NaN;
    const footDYNormR = (P(Rfi)&&P(Rh)&&finite(shankLenR)) ? (Rfi.y - Rh.y)/shankLenR : NaN;

    const heelAvg   = avg([heelBelowKneeNormL,  heelBelowKneeNormR]);
    const ankleAvg  = avg([ankleBelowKneeNormL, ankleBelowKneeNormR]);
    const toeAvg    = avg([toeBelowKneeNormL,   toeBelowKneeNormR]);
    const footDYAvg = avg([footDYNormL,         footDYNormR]);

    // primary metric: prefer heels (MP), else ankles
    let plantarMetricRaw = Number.isFinite(heelAvg) ? heelAvg : ankleAvg;
    plantarMetricRaw = clampRangeOrNaN(plantarMetricRaw);
    const plantarMetric = clampJump(__prevPlantar, plantarMetricRaw, 0.45);
    __prevPlantar = Number.isFinite(plantarMetric) ? plantarMetric : __prevPlantar;

    // pitch signal (toe-heel separation)
    let footDY = clampRangeOrNaN(footDYAvg);
    footDY = clampJump(__prevFootDY, footDY, 0.50);
    __prevFootDY = Number.isFinite(footDY) ? footDY : __prevFootDY;

    // --- baselines: first N frames unconditionally, then only near "down" posture
    const alphaInit = __EMA_ALPHA_INIT, alphaSlow = __EMA_ALPHA_SLOW;

    // live thresholds (use previous iteration values for conservative gating)
    const RAISE_PCT = getPct('raisePct', 0.06);
    const HYST_PCT  = getPct('hystPct',  0.03);

    // Calculate baseline during warmup or when not yet locked
    if (Number.isFinite(plantarMetric)) {
      if (__baselineFrames < __BASE_FRAMES) {
        // Initial warmup period - calculate baseline
        __plantarBaseline = ema(__plantarBaseline, plantarMetric, alphaInit);
        __toeBaseline = ema(__toeBaseline, toeAvg, alphaInit);
        __ankleBaseline = ema(__ankleBaseline, ankleAvg, alphaInit);
        __footDYBaseline = ema(__footDYBaseline, footDY, alphaInit);
        __baselineFrames++;
        
        // Lock the baseline after warmup period
        if (__baselineFrames >= __BASE_FRAMES) {
          __baselineLocked = true;
          // Add small buffers to account for natural variation
          __plantarBaseline = __plantarBaseline * 1.02; // 2% buffer
          __footDYBaseline = __footDYBaseline * 0.98;   // 2% buffer
        }
      }
    }

    // Use locked baseline if available, otherwise fall back to dynamic baseline
    const baseline = __baselineLocked ? __plantarBaseline : 
                   (Number.isFinite(__plantarBaseline) ? __plantarBaseline : plantarMetric);
    
    // Calculate thresholds - use fixed percentages of the locked baseline
    let plantarUp, plantarDown;
    if (__baselineLocked) {
      // Fixed thresholds based on locked baseline - adjusted for ground contact
      plantarUp = baseline * 0.92;    // 8% decrease from baseline (easier to reach)
      plantarDown = baseline * 0.98;  // 2% decrease from baseline (minimal hysteresis)
    } else if (Number.isFinite(baseline)) {
      // Fallback to dynamic thresholds if baseline not locked yet
      plantarUp = baseline * (1 - RAISE_PCT);
      plantarDown = baseline * (1 - HYST_PCT);
    } else {
      // Absolute fallback values
      const usingHeels = Number.isFinite(heelAvg);
      plantarUp = usingHeels ? CalfRaisesSeated.heelBelowKneeUp : CalfRaisesSeated.ankleBelowKneeUp;
      plantarDown = usingHeels ? CalfRaisesSeated.heelBelowKneeDown : CalfRaisesSeated.ankleBelowKneeDown;
    }

    // toe/ankle deviation from their baselines
    const toeDeltaAbs   = (Number.isFinite(toeAvg)   && Number.isFinite(__toeBaseline))   ? Math.abs(toeAvg   - __toeBaseline)   : NaN;
    const ankleDeltaAbs = (Number.isFinite(ankleAvg) && Number.isFinite(__ankleBaseline)) ? Math.abs(ankleAvg - __ankleBaseline) : NaN;

    const toeStayTol   = getTol('toeTol',   0.03); // ~3% of shank length
    const ankleStayTol = getTol('ankleTol', 0.03);

    // foot pitch delta (should increase when heel rises)
    const footDYBase = Number.isFinite(__footDYBaseline) ? __footDYBaseline : footDY;
    const footPitchDelta = (Number.isFinite(footDY) && Number.isFinite(footDYBase)) ? (footDY - footDYBase) : NaN;

    // min extra pitch increase required (fraction of baseline pitch or absolute)
    const footPctMin = getPct('footPctMin', 0.08); // Reduced from 12% to 8% for easier detection
    const footPitchDeltaMin = Number.isFinite(footDYBase)
      ? (__baselineLocked 
          ? Math.max(0.01, 0.08 * footDYBase)  // Reduced minimum threshold for ground contact
          : Math.max(0.01, footPctMin * footDYBase))
      : 0.03; // Reduced fallback absolute

    // near-baseline detector - only update if not locked
    const nearBaseline = 
      Number.isFinite(plantarMetric) && 
      Number.isFinite(plantarDown) &&
      plantarMetric >= plantarDown &&
      (!Number.isFinite(toeDeltaAbs) || toeDeltaAbs <= toeStayTol) &&
      (!Number.isFinite(ankleDeltaAbs) || ankleDeltaAbs <= ankleStayTol) &&
      // Only consider near baseline if we're within 5% of the baseline plantar metric
      (!__baselineLocked || (Number.isFinite(__plantarBaseline) && 
       Math.abs(plantarMetric - __plantarBaseline) / __plantarBaseline <= 0.05));

    // Only update baselines if not locked and we're in a good position
    if (nearBaseline && !__baselineLocked) {
      __plantarBaseline = ema(__plantarBaseline, plantarMetric, alphaSlow);
      __toeBaseline = ema(__toeBaseline, toeAvg, alphaSlow);
      __ankleBaseline = ema(__ankleBaseline, ankleAvg, alphaSlow);
      __footDYBaseline = ema(__footDYBaseline, footDY, alphaSlow);
    }

    // posture cue
    const trunkL = (P(Ls)&&P(Lhip)&&(P(La)||P(Lk))) ? A(Ls, Lhip, (P(La)?La:Lk)) : NaN;
    const trunkR = (P(Rs)&&P(Rhip)&&(P(Ra)||P(Rk))) ? A(Rs, Rhip, (P(Ra)?Ra:Rk)) : NaN;
    const trunkAngleMin = [trunkL, trunkR].filter(Number.isFinite).length
      ? Math.min(trunkL, trunkR)
      : NaN;

    // extra: delta for logs/HUD
    const plantarDelta =
      (Number.isFinite(baseline) && Number.isFinite(plantarMetric))
        ? (baseline - plantarMetric)
        : NaN;

    // Debug output
    if (window.__DEBUG_CRS) {
      // eslint-disable-next-line no-console
      console.log(
        `[CRS] ${__baselineLocked ? 'LOCKED' : 'CALIBRATING'}`,
        `phase=${this?.phase || 'none'}`,
        `pm=${plantarMetric?.toFixed?.(2)}`,
        `up=${plantarUp?.toFixed?.(2)}`,
        `dn=${plantarDown?.toFixed?.(2)}`,
        `pitchΔ=${footPitchDelta?.toFixed?.(2)}`,
        `trunk=${trunkAngleMin?.toFixed?.(0) || '?'}°`,
        `lock=${__baselineLocked ? 'Y' : 'N'}`
      );
    }

    return {
      heelBelowKneeNormL, heelBelowKneeNormR,
      ankleBelowKneeNormL, ankleBelowKneeNormR,
      toeBelowKneeNormL, toeBelowKneeNormR,
      heelBelowKneeNormAvg: heelAvg,
      ankleBelowKneeNormAvg: ankleAvg,

      plantarMetric, plantarUp, plantarDown, plantarDelta,

      // gates to reject whole-foot pickup
      footPitchDelta, footPitchDeltaMin,
      toeDeltaAbs, ankleDeltaAbs, toeStayTol, ankleStayTol,

      // posture
      trunkAngleL: trunkL, trunkAngleR: trunkR, trunkAngleMin,
    };
  },
};

export default CalfRaisesSeated;
