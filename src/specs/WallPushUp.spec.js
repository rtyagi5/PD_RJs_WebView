// ---------------------------------------------
// specs/WallPushUp.spec.js (back-facing; shoulder-based)
// ---------------------------------------------
const WallPushUp = {
    name: 'WallPushUp',
    side: 'both',
    mode: 'rep',
    primaryMetric: 'elbowOffsetMax', // HUD shows how far elbows flare (normalized)
  
    dwellMs: 220,
    refractoryMs: 300,
  
    // Thresholds (tune to taste)
    // Typical from behind:
    //   lowered (bent):   elbowOffsetMax ~0.45–0.80
    //   raised (extended): elbowOffsetMax ~0.15–0.35
    elbowOffsetDown: 0.26,  // <= this → "raised"
    elbowOffsetUp:   0.45,  // >= this → "lowered"
  
    // Posture cues (feedback only, not gating)
    trunkStraightMin: 160,  // straight-ish trunk from behind
    elbowLevelTol:    0.20, // keep elbows at similar height (normalized by shoulder width)
  
    phases: [
      {
        id: 'lowered',
        enter: "Number.isFinite(elbowOffsetMax) && elbowOffsetMax >= elbowOffsetUp"
      },
      {
        id: 'raised',
        // Keep raised simple & robust: use only the elbow offset with hysteresis
        enter: "Number.isFinite(elbowOffsetMax) && elbowOffsetMax <= elbowOffsetDown"
      },
    ],
  
    // Count when going from lowered -> raised
    rep: { from: 'lowered', to: 'raised' },
  
    feedback: [
      // Lowered: start cue (green)
      { when: "phase=='lowered'", say: 'Start Position - Push back',
        highlight: ({ setHighlight }) =>
          setHighlight({ keypoints: ['left_shoulder','left_elbow','right_shoulder','right_elbow'], color: '#66FF00' })
      },

      // Transition: neither lowered nor raised (orange)
      { when: "!(phase=='lowered' || phase=='raised')", say: 'Keep going',
        highlight: ({ setHighlight }) =>
          setHighlight({ keypoints: ['left_shoulder','left_elbow','right_shoulder','right_elbow'], color: '#FFB020' })
      },

      // Raised: top position (green)
      { when: "phase=='raised'", say: 'Nice extension - Push forward',
        highlight: ({ setHighlight }) =>
          setHighlight({ keypoints: ['left_shoulder','left_elbow','right_shoulder','right_elbow'], color: '#66FF00' })
      },

      // Posture cues
      { when: "Number.isFinite(trunkAngleMin) && trunkAngleMin < trunkStraightMin", say: 'Keep your body straight' },
      { when: "Number.isFinite(elbowLevelDiff) && elbowLevelDiff > elbowLevelTol", say: 'Keep elbows level' },
    ],
  
    // Compute features using only points visible from behind:
    //  - shoulderWidth
    //  - per-side elbowOffsetNorm (|elbow.x - shoulder.x| / shoulderWidth)
    //  - elbowOffsetMax (fused, robust if one elbow is missing)
    //  - shoulderBendAngle per side (angle hip-shoulder-elbow) + min (feedback only)
    //  - elbowLevelDiff (|Le.y - Re.y| / shoulderWidth)
    //  - trunkAngle per side + min (feedback)
    computeExtraFeatures: ({ kps, utils }) => {
      const Ls = utils.kp(kps, 'left_shoulder');
      const Rs = utils.kp(kps, 'right_shoulder');
      const Le = utils.kp(kps, 'left_elbow');
      const Re = utils.kp(kps, 'right_elbow');
      const Lh = utils.kp(kps, 'left_hip');
      const Rh = utils.kp(kps, 'right_hip');
      const La = utils.kp(kps, 'left_ankle');
      const Ra = utils.kp(kps, 'right_ankle');
  
      const present = utils.present;
      const finite  = v => Number.isFinite(v);
  
      const shoulderWidth = (present(Ls) && present(Rs))
        ? Math.max(utils.calculateDistance(Ls, Rs), 1e-6) : NaN;
  
      // Horizontal elbow flare (normalized)
      const elbowOffsetNormL = (present(Ls) && present(Le) && finite(shoulderWidth))
        ? Math.abs(Le.x - Ls.x) / shoulderWidth : NaN;
      const elbowOffsetNormR = (present(Rs) && present(Re) && finite(shoulderWidth))
        ? Math.abs(Re.x - Rs.x) / shoulderWidth : NaN;
  
      const offsets = [elbowOffsetNormL, elbowOffsetNormR].filter(finite);
      const elbowOffsetMax = offsets.length ? Math.max(...offsets) : NaN;
  
      // Shoulder bend angle (feedback only)
      const shoulderBendAngleL =
        (present(Lh) && present(Ls) && present(Le)) ? utils.angle(Lh, Ls, Le) : NaN;
      const shoulderBendAngleR =
        (present(Rh) && present(Rs) && present(Re)) ? utils.angle(Rh, Rs, Re) : NaN;
      const bendAngles = [shoulderBendAngleL, shoulderBendAngleR].filter(finite);
      const shoulderBendAngleMin = bendAngles.length ? Math.min(...bendAngles) : NaN;
  
      // Elbow vertical level diff (feedback)
      const elbowLevelDiff = (present(Le) && present(Re) && finite(shoulderWidth))
        ? Math.abs(Le.y - Re.y) / shoulderWidth : NaN;
  
      // Trunk posture (feedback)
      const trunkAngleL =
        (present(Ls) && present(Lh) && present(La)) ? utils.angle(Ls, Lh, La)
        : (present(Ls) && present(Lh) && present(Re)) ? utils.angle(Ls, Lh, Re) : NaN;
  
      const trunkAngleR =
        (present(Rs) && present(Rh) && present(Ra)) ? utils.angle(Rs, Rh, Ra)
        : (present(Rs) && present(Rh) && present(Le)) ? utils.angle(Rs, Rh, Le) : NaN;
  
      const trunkAngles = [trunkAngleL, trunkAngleR].filter(finite);
      const trunkAngleMin = trunkAngles.length ? Math.min(...trunkAngles) : NaN;
  
      return {
        // primary metric for gating + HUD
        elbowOffsetNormL, elbowOffsetNormR, elbowOffsetMax,
  
        // shoulder-angle feedback
        shoulderBendAngleL, shoulderBendAngleR, shoulderBendAngleMin,
  
        // posture cues
        elbowLevelDiff,
        trunkAngleL, trunkAngleR, trunkAngleMin,
      };
    },
  };

// Smooth color transitions with a short hold for orange to avoid flicker.
WallPushUp.highlights = function ({ setHighlight, features }) {
  const down = WallPushUp.elbowOffsetDown;
  const up   = WallPushUp.elbowOffsetUp;
  const elbowOffset = features.elbowOffsetMax;

  // Determine phase-like state using thresholds (mirrors spec logic)
  const isLowered = Number.isFinite(elbowOffset) && elbowOffset >= up;
  const isRaised  = Number.isFinite(elbowOffset) && elbowOffset <= down;

  // Always highlight both arms for wall push-ups
  const pts = ['left_shoulder','left_elbow','right_shoulder','right_elbow'];

  // Color with orange hold
  let desired = '#66FF00';
  if (!isLowered && !isRaised) desired = '#FFB020';

  if (!this._hl) this._hl = { lastColor: null, lastTs: 0 };
  const now = Date.now();
  const HOLD_MS = 250;
  const { lastColor, lastTs } = this._hl;
  if (lastColor === '#FFB020' && now - lastTs < HOLD_MS) desired = '#FFB020';
  if (desired !== lastColor) { this._hl.lastColor = desired; this._hl.lastTs = now; }

  setHighlight({ keypoints: pts, color: desired });
};
  
  export default WallPushUp;
  