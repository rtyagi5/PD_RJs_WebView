// ---------------------------------------------
// specs/MiniLunges.spec.js - Side-facing mini lunges
// ---------------------------------------------
let __ml_loweredTs = 0;
let __ml_activeSide = null;
let __ml_angleHistory = [];

const MiniLunges = {
  name: 'MiniLunges',
  side: 'either',              // evaluate only the selected leg
  mode: 'rep',
  detector: 'movenet',         // side-facing friendly
  primaryMetric: 'kneeAngleActive',
  dwellMs: 150,               // Balanced dwell time
  refractoryMs: 400,          // Balanced refractory time

  repMode: 'single',
  selectActiveSide: (features) => {
    // Use UI side selection only - no auto-switching for stability
    const uiSide = String(features?.side || '').toLowerCase();
    if (uiSide === 'left' || uiSide === 'right') {
      __ml_activeSide = uiSide;
    } else if (!__ml_activeSide) {
      __ml_activeSide = 'left'; // default
    }
    return __ml_activeSide;
  },    

  // Simple angle thresholds for mini lunges (side-facing) - wider hysteresis for stability
  lungeKneeUp:   155,  // kneeAngleActive <= 155 ==> in lunge (raised)
  lungeKneeDown: 175,  // kneeAngleActive >= 175 ==> standing (lowered)
  trunkUprightMin: 165,

  onStart: () => {
    __ml_loweredTs = 0;
    __ml_activeSide = null;
    __ml_angleHistory = [];
  },

  phases: [
    {
      id: 'lowered',
      enter:
        "("+
          " Number.isFinite(kneeAngleActive) && Number.isFinite(lungeKneeDown) && kneeAngleActive >= lungeKneeDown"+
        ")"
    },
    {
      id: 'raised',
      enter:
        "("+
          " Number.isFinite(kneeAngleActive) && Number.isFinite(lungeKneeUp) && kneeAngleActive <= lungeKneeUp"+
        ")"
    },
  ],

  // Highlights based on simple knee angle gates on the active leg
  // - Green: when ready (kneeAngleActive >= down) and at bottom (kneeAngleActive <= up)
  // - Orange: in transition
  // Focus on active leg only - inactive leg will show in default aqua
  highlights: function ({ setHighlight, features }) {
    const up = this.lungeKneeUp;
    const down = this.lungeKneeDown;

    const active = this.selectActiveSide(features);
    const kneeActive = features.kneeAngleActive;
    const inReady = Number.isFinite(kneeActive) && Number.isFinite(down) && kneeActive >= down;
    const inBottom = Number.isFinite(kneeActive) && Number.isFinite(up) && kneeActive <= up;

    let activeColor = '#FFB020';
    if (inReady || inBottom) activeColor = '#66FF00';

    if (!this._hl) this._hl = { lastColor: null, lastTs: 0 };
    const now = Date.now();
    const HOLD_MS = 80;
    const { lastColor, lastTs } = this._hl;
    if (lastColor === '#FFB020' && now - lastTs < HOLD_MS) activeColor = '#FFB020';
    if (activeColor !== lastColor) { this._hl.lastColor = activeColor; this._hl.lastTs = now; }

    // Highlight the full active leg chain to make it prominent
    setHighlight({ 
      keypoints: [`${active}_hip`, `${active}_knee`, `${active}_ankle`], 
      color: activeColor 
    });
  },

  // Count when going from lowered -> raised
  rep: { from: 'lowered', to: 'raised' },

  feedback: [
    { when: "phase=='lowered'", say: 'Extend forward with the green leg' },
    { when: "phase=='raised'",  say: 'Raise back up to extended position and continue with the same leg' },
    { when: "Number.isFinite(trunkAngleMin) && trunkAngleMin < trunkUprightMin", say: 'Stand tall' },
  ],

  computeExtraFeatures: ({ kps, utils, side }) => {
    // Update active side from UI
    const uiSide = String(side || '').toLowerCase();
    if (uiSide === 'left' || uiSide === 'right') __ml_activeSide = uiSide;
    if (!__ml_activeSide) __ml_activeSide = 'left';

    // Only compute angles for the active leg to prevent interference
    const activeSide = __ml_activeSide;
    const inactiveSide = activeSide === 'left' ? 'right' : 'left';
    
    const kneeAngle = {};
    const trunk = {};

    // Compute angles only for active side with anatomical validation
    const hip = utils.kp(kps, `${activeSide}_hip`);
    const knee = utils.kp(kps, `${activeSide}_knee`);
    const ankle = utils.kp(kps, `${activeSide}_ankle`);
    const shoulder = utils.kp(kps, `${activeSide}_shoulder`);

    // Basic validation - just check if keypoints are present and reasonable
    const isValidKeypoints = (hip, knee, ankle) => {
      if (!utils.present(hip) || !utils.present(knee) || !utils.present(ankle)) return false;
      
      // Basic sanity check - keypoints shouldn't be at exact same position (cross-leg error)
      const hipKneeDist = Math.sqrt((hip.x - knee.x)**2 + (hip.y - knee.y)**2);
      const kneeAnkleDist = Math.sqrt((knee.x - ankle.x)**2 + (knee.y - ankle.y)**2);
      
      // Distances should be reasonable (not too close, indicating cross-leg connection)
      return hipKneeDist > 20 && kneeAnkleDist > 20;
    };

    const rawAngle = isValidKeypoints(hip, knee, ankle) ? utils.angle(hip, knee, ankle) : NaN;
    
    // Add light smoothing to prevent spurious angle jumps but preserve real movement
    if (Number.isFinite(rawAngle)) {
      __ml_angleHistory.push(rawAngle);
      if (__ml_angleHistory.length > 3) __ml_angleHistory.shift(); // Keep last 3 readings only
      
      // Use simple average instead of median for better responsiveness
      const average = __ml_angleHistory.reduce((sum, angle) => sum + angle, 0) / __ml_angleHistory.length;
      kneeAngle[activeSide] = average;
    } else {
      kneeAngle[activeSide] = NaN;
    }

    trunk[activeSide] = (utils.present(shoulder) && utils.present(hip) && utils.present(ankle))
      ? utils.angle(shoulder, hip, ankle)
      : (utils.present(shoulder) && utils.present(hip) && utils.present(knee))
        ? utils.angle(shoulder, hip, knee) : NaN;

    // Set inactive side to NaN to disable it completely
    kneeAngle[inactiveSide] = NaN;
    trunk[inactiveSide] = NaN;

    // Only use active leg values - no min/max across legs
    const kneeAngleMin = kneeAngle[activeSide];
    const kneeAngleMax = kneeAngle[activeSide];
    const trunkAngleMin = trunk[activeSide];

    // Get active leg knee angle
    const kneeAngleActive = __ml_activeSide === 'right' ? kneeAngle.right : kneeAngle.left;

    // Simple arming: dwell in standing position
    const now = Date.now();
    const inStanding = Number.isFinite(kneeAngleActive) && kneeAngleActive >= MiniLunges.lungeKneeDown;
    if (inStanding) {
      if (!__ml_loweredTs) __ml_loweredTs = now;
    } else {
      __ml_loweredTs = 0;
    }
    const armReady = inStanding && (now - __ml_loweredTs) >= 80; // ms - shorter dwell

    // Debug logging for cross-leg detection issues (enable with: window.__DBG_ML = true in browser console)
    if (typeof window !== 'undefined' && window.__DBG_ML) {
      const leftHip = utils.kp(kps, 'left_hip');
      const leftKnee = utils.kp(kps, 'left_knee');
      const leftAnkle = utils.kp(kps, 'left_ankle');
      const rightHip = utils.kp(kps, 'right_hip');
      const rightKnee = utils.kp(kps, 'right_knee');
      const rightAnkle = utils.kp(kps, 'right_ankle');
      
      console.log('[MiniLunges DEBUG]',
        `active=${__ml_activeSide}`,
        `ka=${Number.isFinite(kneeAngleActive)?kneeAngleActive.toFixed(1):'—'}`,
        `armed=${armReady?'Y':'N'}`,
        `standing=${inStanding?'Y':'N'}`,
        `\nL: hip(${leftHip?.x?.toFixed(0)},${leftHip?.y?.toFixed(0)}) knee(${leftKnee?.x?.toFixed(0)},${leftKnee?.y?.toFixed(0)}) ankle(${leftAnkle?.x?.toFixed(0)},${leftAnkle?.y?.toFixed(0)})`,
        `\nR: hip(${rightHip?.x?.toFixed(0)},${rightHip?.y?.toFixed(0)}) knee(${rightKnee?.x?.toFixed(0)},${rightKnee?.y?.toFixed(0)}) ankle(${rightAnkle?.x?.toFixed(0)},${rightAnkle?.y?.toFixed(0)})`
      );
    }

    return {
      kneeAngleL: kneeAngle.left,
      kneeAngleR: kneeAngle.right,
      kneeAngleMin,
      kneeAngleMax,
      trunkAngleL: trunk.left,
      trunkAngleR: trunk.right,
      trunkAngleMin,
      kneeAngleActive,
      activeSide: __ml_activeSide,
      armReady,
    };
  },
};

export default MiniLunges;