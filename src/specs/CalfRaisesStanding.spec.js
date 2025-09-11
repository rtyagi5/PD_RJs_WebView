// specs/CalfRaisesStanding.spec.js
//
// Simple standing calf raise: count reps from foot pitch delta only
// (toe.y - heel.y, normalized by shank). Lock a baseline after short warmup.
// Optional knee-straight guard; everything else is intentionally minimal.

let __footDYBaseline = NaN;   // baseline toe.y - heel.y (normalized)
let __baselineFrames = 0;
let __baselineLocked = false;

let __prevFootDY = NaN;

const __BASE_FRAMES = 60;      // ~2s @ 30fps for faster initialization
const __EMA_ALPHA_INIT = 0.15;  // Much faster initial settling
const __EMA_ALPHA_SLOW = 0.05;  // More responsive to changes

const ema = (prev, v, a) => (Number.isFinite(prev) ? (a*v + (1-a)*prev) : v);

// URL tuning: ?footPctMin=0.10&kneeStraightMin=150
function getPct(name, fallback) {
  const v = Number(new URLSearchParams(window.location.search).get(name));
  return (Number.isFinite(v) && v > 0 && v < 0.5) ? v : fallback;
}
function getNum(name, fallback) {
  const v = Number(new URLSearchParams(window.location.search).get(name));
  return Number.isFinite(v) ? v : fallback;
}

// Light sanity guards
function clampRangeOrNaN(v, lo = -0.2, hi = 2.0) {
  return Number.isFinite(v) && v > lo && v < hi ? v : NaN;
}
function clampJump(prev, v, maxJump = 0.5) {
  if (!Number.isFinite(v) || !Number.isFinite(prev)) return v;
  return Math.abs(v - prev) > maxJump ? prev : v;
}

const CalfRaisesStanding = {
  name: 'CalfRaisesStanding',
  detector: 'mediapipe',
  side: 'both',
  mode: 'rep',

  // For the HUD we show the rotation (more intuitive than a ratio)
  primaryMetric: 'footPitchDelta',

  // Very relaxed timing for maximum sensitivity
  dwellMs: 200,        // Minimal hold time
  refractoryMs: 500,   // Minimal cooldown between reps

  // Posture guards with more tolerance
  kneeStraightMin: 145,  // Slightly more tolerant of bent knees
  trunkUprightMin: 155,  // Slightly more tolerant of forward lean

  onStart: () => {
    __footDYBaseline = NaN;
    __baselineFrames = 0;
    __baselineLocked = false;
    __prevFootDY = NaN;
  },

  highlights: ({ setHighlight }) => {
    setHighlight({
      color: '#00E5FF',
      keypoints: [
        ['left_ankle','left_heel'],   ['left_heel','left_foot_index'],
        ['right_ankle','right_heel'], ['right_heel','right_foot_index'],
      ],
    });
  },

  // State machine with relaxed conditions for better detection
  phases: [
    {
      id: 'lowered',
      enter: "Number.isFinite(footPitchDelta) && Number.isFinite(pitchDown) && footPitchDelta <= pitchDown"
    },
    {
      id: 'raised',
      enter: "(" +
        " Number.isFinite(footPitchDelta) && Number.isFinite(pitchUp) && " +
        " footPitchDelta >= pitchUp" +  // Must reach threshold
        " ) && (" +
        " !Number.isFinite(kneeStraightMin) || !Number.isFinite(kneeAngleMin) || kneeAngleMin >= (kneeStraightMin - 10)" +  // 10° tolerance
        " )"
    },
  ],

  rep: { from: 'lowered', to: 'raised' },

  feedback: [
    { when: "phase=='lowered'", say: 'Lift your heels' },
    { when: "phase=='raised'",  say: 'Nice — control down' },
    { when: "Number.isFinite(kneeAngleMin) && Number.isFinite(kneeStraightMin) && kneeAngleMin < kneeStraightMin", say: 'Keep knees straighter' },
    { when: "Number.isFinite(trunkAngleMin) && trunkAngleMin < trunkUprightMin", say: 'Stand tall' },
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
    const avg = a => { const v = a.filter(finite); return v.length ? v.reduce((x,y)=>x+y,0)/v.length : NaN; };

    const shankLenL = (P(Lk)&&P(La)) ? Math.max(D(Lk, La), 1e-6) : NaN;
    const shankLenR = (P(Rk)&&P(Ra)) ? Math.max(D(Rk, Ra), 1e-6) : NaN;

    // toe - heel vertical separation / shank (goes UP when heel rises, toes stay)
    const footDYNormL = (P(Lfi)&&P(Lh)&&finite(shankLenL)) ? (Lfi.y - Lh.y)/shankLenL : NaN;
    const footDYNormR = (P(Rfi)&&P(Rh)&&finite(shankLenR)) ? (Rfi.y - Rh.y)/shankLenR : NaN;
    
    // Require BOTH feet to be detected for better accuracy
    let footDY = NaN;
    if (Number.isFinite(footDYNormL) && Number.isFinite(footDYNormR)) {
      // Very sensitive to any lift
      const minLift = 0.05;  // Very low minimum lift threshold
      if (footDYNormL > minLift || footDYNormR > minLift) {
        // Use the foot that's lifting more
        footDY = Math.max(footDYNormL, footDYNormR);
      }
    }
    
    // Only update if we have a valid, significant movement
    if (Number.isFinite(footDY)) {
      footDY = clampRangeOrNaN(footDY, -0.5, 1.0);  // Wider range
      footDY = clampJump(__prevFootDY, footDY, 0.4);  // Very permissive jump clamping
      __prevFootDY = footDY;
    }

    // Warmup/lock baseline for foot pitch only
    if (Number.isFinite(footDY) && __baselineFrames < __BASE_FRAMES) {
      __footDYBaseline = ema(__footDYBaseline, footDY, __EMA_ALPHA_INIT);
      __baselineFrames++;
      if (__baselineFrames >= __BASE_FRAMES) {
        __baselineLocked = true;
        __footDYBaseline *= 0.98; // tiny buffer
      }
    } else if (Number.isFinite(footDY) && !__baselineLocked) {
      __footDYBaseline = ema(__footDYBaseline, footDY, __EMA_ALPHA_SLOW);
    }

    const footDYBase = Number.isFinite(__footDYBaseline) ? __footDYBaseline : footDY;

    // The delta we track
    const footPitchDelta = (Number.isFinite(footDY) && Number.isFinite(footDYBase)) ? (footDY - footDYBase) : NaN;

    // Very relaxed thresholds for maximum detection
    const footPctMin = getPct('footPctMin', 0.10);  // 10% of baseline pitch
    const minAbs = 0.03;                           // Very low absolute minimum
    
    // Calculate minimum required movement with much higher thresholds
    const pitchDeltaMin = Number.isFinite(footDYBase)
      ? Math.max(minAbs, footPctMin * Math.max(footDYBase, 1e-3))
      : 0.15;  // Much higher fallback

    // Require very distinct movement
    const pitchUp   = pitchDeltaMin;      // Must reach full threshold
    const pitchDown = pitchDeltaMin * 0.1; // Very little movement required to count as down

    // Posture (light)
    const trunkL = (P(Ls)&&P(Lhip)&&(P(La)||P(Lk))) ? A(Ls, Lhip, (P(La)?La:Lk)) : NaN;
    const trunkR = (P(Rs)&&P(Rhip)&&(P(Ra)||P(Rk))) ? A(Rs, Rhip, (P(Ra)?Ra:Rk)) : NaN;
    const trunkAngleMin = [trunkL, trunkR].filter(finite).length ? Math.min(trunkL, trunkR) : NaN;

    const kneeAngleL = (P(Lhip)&&P(Lk)&&P(La)) ? A(Lhip, Lk, La) : NaN;
    const kneeAngleR = (P(Rhip)&&P(Rk)&&P(Ra)) ? A(Rhip, Rk, Ra) : NaN;
    const kneeAngleMin = [kneeAngleL, kneeAngleR].filter(finite).length ? Math.min(kneeAngleL, kneeAngleR) : NaN;

    const kneeStraightMin = getNum('kneeStraightMin', CalfRaisesStanding.kneeStraightMin);

    // Enhanced debug output
  if (window.__DEBUG_CRS) {
    // eslint-disable-next-line no-console
    console.log(
      `[CRS-STANDING ${__baselineLocked ? 'LOCKED' : 'CAL'}]`,
      `phase=${this?.phase || 'none'}`,
      `pitchΔ=${footPitchDelta?.toFixed?.(2)}`,
      `up=${pitchUp?.toFixed?.(2)}`,
      `dn=${pitchDown?.toFixed?.(2)}`,
      `base=${footDYBase?.toFixed?.(3)}`,
      `knee=${kneeAngleMin?.toFixed?.(0) || '?'}°`,
      `trunk=${trunkAngleMin?.toFixed?.(0) || '?'}°`,
      `lock=${__baselineLocked ? 'Y' : 'N'}`
    );
  }

    return {
      // primary metric & thresholds (simple mode)
      footPitchDelta,
      pitchUp,
      pitchDown,

      // posture (light guards)
      kneeAngleL, kneeAngleR, kneeAngleMin, kneeStraightMin,
      trunkAngleL: trunkL, trunkAngleR: trunkR, trunkAngleMin,
    };
  },
};

export default CalfRaisesStanding;
