// --- per-session state ---
let __activeSide = null; // 'left' | 'right'
let __angleEmaL = NaN;
let __angleEmaR = NaN;
let __startAngle = NaN;  // captured initial lowered angle

const __EMA_ALPHA = 0.25; // smoothing for ankle angle
const ema = (prev, v, a = __EMA_ALPHA) => (Number.isFinite(prev) ? (a*v + (1-a)*prev) : v);

function getSidePref() {
  const s = String(new URLSearchParams(window.location.search).get('side') || '').toLowerCase();
  return (s === 'left' || s === 'right') ? s : null;
}

const CalfRaisesSeated = {
  name: 'CalfRaisesSeated',
  detector: 'mediapipe',
  side: 'both',
  mode: 'rep',

  // HUD metric (degrees)
  primaryMetric: 'ankleAngleActive',

  dwellMs: 180,       // slightly quicker to register transitions
  refractoryMs: 600,  // avoid double-triggering on noise

  // Coaching: seated exercises have a smaller body-to-frame ratio
  framing: {
    view: 'front',
    idealBodyRatio: 0.45,
    requiredKeypoints: [
      'left_shoulder', 'right_shoulder', 'left_hip', 'right_hip',
      'left_ankle', 'right_ankle', 'left_heel', 'right_heel',
    ],
  },

  onStart: () => {
    __activeSide = null;
    __angleEmaL = NaN; __angleEmaR = NaN;
    __startAngle = NaN;
  },

  // Side-aware highlights with simple green/orange
  highlights: function ({ setHighlight, features }) {
    const angle = features.ankleAngleActive;
    const loMin = features.degLowerMin, loMax = features.degLowerMax;
    const hiMin = features.degRaiseDynamic;

    // Pick side to emphasize: prefer computed activeSide, else UI side if present
    const uiSide = String(features?.side || '').toLowerCase();
    const active = features?.activeSide || (uiSide === 'left' || uiSide === 'right' ? uiSide : null) || __activeSide;

    // Pass keypoint NAMES so utilities.js can color segments where both endpoints are present
    let pts;
    if (active === 'left' || active === 'right') {
      const s = active;
      pts = [`${s}_hip`, `${s}_knee`, `${s}_ankle`, `${s}_heel`, `${s}_foot_index`];
    } else {
      pts = ['left_ankle','left_heel','left_foot_index','right_ankle','right_heel','right_foot_index'];
    }

    const inLowered = Number.isFinite(angle) && Number.isFinite(loMin) && Number.isFinite(loMax) && angle >= loMin && angle <= loMax;
    const inRaised  = Number.isFinite(angle) && Number.isFinite(hiMin) && angle >= hiMin;
    let desired = (inLowered || inRaised) ? '#66FF00' : '#FFB020';

    if (!this._hl) this._hl = { lastColor: null, lastTs: 0 };
    const now = Date.now();
    const HOLD_MS = 250;
    const { lastColor, lastTs } = this._hl;
    if (lastColor === '#FFB020' && now - lastTs < HOLD_MS) desired = '#FFB020';
    if (desired !== lastColor) { this._hl.lastColor = desired; this._hl.lastTs = now; }

    setHighlight({ keypoints: pts, color: desired });
  },

  phases: [
    {
      id: 'lowered',
      enter:
        "Number.isFinite(ankleAngleActive) && Number.isFinite(degLowerMin) && Number.isFinite(degLowerMax) && ankleAngleActive >= degLowerMin && ankleAngleActive <= degLowerMax"
    },
    {
      id: 'raised',
      enter:
        "Number.isFinite(ankleAngleActive) && Number.isFinite(degRaiseDynamic) && ankleAngleActive >= degRaiseDynamic"
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
    { when: "phase=='lowered'", say: 'Lift your heel' },
    { when: "phase=='raised'",  say: 'Nice — control down' },
  ],

  computeExtraFeatures: ({ kps, utils, side }) => {
    const Lk = utils.kp(kps, 'left_knee');  const Rk = utils.kp(kps, 'right_knee');
    const La = utils.kp(kps, 'left_ankle'); const Ra = utils.kp(kps, 'right_ankle');
    const Lh = utils.kp(kps, 'left_heel');  const Rh = utils.kp(kps, 'right_heel');
    const Lfi = utils.kp(kps, 'left_foot_index'); const Rfi = utils.kp(kps, 'right_foot_index');
    // angle-only: no trunk/hip needed

    const P = utils.present, A = utils.angle;
    const finite = v => Number.isFinite(v);

    // Ankle angles (knee-ankle-foot) for simple angle-based detection
    const ankleAngleL = (P(Lk)&&P(La)&&(P(Lfi)||P(Lh))) ? A(Lk, La, (P(Lfi)?Lfi:Lh)) : NaN;
    const ankleAngleR = (P(Rk)&&P(Ra)&&(P(Rfi)||P(Rh))) ? A(Rk, Ra, (P(Rfi)?Rfi:Rh)) : NaN;

    // Active side selection (prefer UI)
    const uiSide = String(side || '').toLowerCase();
    let activeSide = (uiSide === 'left' || uiSide === 'right') ? uiSide : getSidePref();
    if (!activeSide) {
      // pick side with a finite angle
      if (finite(ankleAngleL) && finite(ankleAngleR)) activeSide = 'left';
      else if (finite(ankleAngleL)) activeSide = 'left';
      else if (finite(ankleAngleR)) activeSide = 'right';
    }
    __activeSide = activeSide || __activeSide || null;

    // EMA smoothing of ankle angle per side
    if (finite(ankleAngleL)) __angleEmaL = ema(__angleEmaL, ankleAngleL);
    if (finite(ankleAngleR)) __angleEmaR = ema(__angleEmaR, ankleAngleR);

    const ankleAngleActive = (__activeSide === 'left') ? __angleEmaL : (__activeSide === 'right') ? __angleEmaR : NaN;

    // Thresholds (degrees)
    const degLowerMin = 70;   // flat/lowered window min
    const degLowerMax = 115;  // flat/lowered window max
    // Dynamic raised threshold: startAngle + 8°, fallback to 125 if startAngle not yet captured
    const deltaRaise = 8;
    const degRaiseDynamic = Number.isFinite(__startAngle) ? (__startAngle + deltaRaise) : 125;

    // Capture initial start angle when in green-lowered and within 70–140°
    const CAPTURE_MIN = 70, CAPTURE_MAX = 140;
    const isLoweredGreen = Number.isFinite(ankleAngleActive) && ankleAngleActive >= degLowerMin && ankleAngleActive <= degLowerMax;
    if (!Number.isFinite(__startAngle) && isLoweredGreen && ankleAngleActive >= CAPTURE_MIN && ankleAngleActive <= CAPTURE_MAX) {
      __startAngle = Math.round(ankleAngleActive);
    }

    // Debug output
    if (window.__DEBUG_CRS) {
      // eslint-disable-next-line no-console
      console.log(
        `[CRS-SEATED ANGLE ONLY ${(__activeSide||'?').toUpperCase()}]`,
        `phase=${this?.phase || 'none'}`,
        `angle=${ankleAngleActive?.toFixed?.(0)}`,
        `lower=[${degLowerMin}-${degLowerMax}]`,
        `raise>=${degRaiseDynamic}`,
        `startAngle=${Number.isFinite(__startAngle)?__startAngle:'—'}`
      );
    }

    return {
      // angle-only features returned
      ankleAngleL, ankleAngleR,
      ankleAngleActive,
      degLowerMin,
      degLowerMax,
      degRaiseDynamic,
      activeSide: __activeSide,
      startAngle: Number.isFinite(__startAngle) ? __startAngle : undefined,
    };
  },
};

export default CalfRaisesSeated;
