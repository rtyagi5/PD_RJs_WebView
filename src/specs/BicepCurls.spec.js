// ---------------------------------------------
// specs/BicepCurls.spec.js
// ---------------------------------------------
const BicepCurls = {
    name: 'BicepCurls',
    side: 'both',                 // look at both arms
    mode: 'rep',
    primaryMetric: 'elbowAngleMin',
    dwellMs: 120,
    refractoryMs: 250,
  
    // Count every curl (no alternation requirement)
    repMode: 'perLift',
  
    // Thresholds (tune as you like)
    // Smaller elbow angle = more flexion. Typical: ~170° straight, ~60-80° curled.
    elbowFlexUp: 75,     // <= means "raised" (curl)
    elbowFlexDown: 150,  // >= means "lowered" (extended)
    trunkUprightMin: 165, // posture cue only (not gating)
  
    phases: [
      {
        id: 'lowered',
        enter: "Number.isFinite(elbowAngleMin) && elbowAngleMin >= elbowFlexDown"
      },
      {
        id: 'raised',
        enter: "Number.isFinite(elbowAngleMin) && elbowAngleMin <= elbowFlexUp"
      },
    ],
  
    // One rep = lowered -> raised (per-lift)
    rep: { from: 'lowered', to: 'raised' },
  
    feedback: [
      // Lowered: start cue (green)
      { when: "phase=='lowered'", say: 'Start Position - Curl up',
        highlight: ({ setHighlight }) =>
          setHighlight({ keypoints: ['left_shoulder','left_elbow','left_wrist','right_shoulder','right_elbow','right_wrist'], color: '#66FF00' })
      },

      // Transition: neither lowered nor raised (orange)
      { when: "!(phase=='lowered' || phase=='raised')", say: 'Keep going',
        highlight: ({ setHighlight }) =>
          setHighlight({ keypoints: ['left_shoulder','left_elbow','left_wrist','right_shoulder','right_elbow','right_wrist'], color: '#FFB020' })
      },

      // Raised: highlight the more flexed arm (green)
      {
        when: "phase=='raised'",
        say: 'Squeeze at top - lower slowly',
        highlight: ({ setHighlight, features }) => {
          const l = features.elbowAngleL, r = features.elbowAngleR;
          let side = null;
          if (Number.isFinite(l) && Number.isFinite(r)) side = (l <= r ? 'left' : 'right');
          else if (Number.isFinite(l)) side = 'left';
          else if (Number.isFinite(r)) side = 'right';
  
          const pts = side
            ? [`${side}_shoulder`, `${side}_elbow`, `${side}_wrist`]
            : ['left_shoulder','left_elbow','left_wrist','right_shoulder','right_elbow','right_wrist'];
          setHighlight({ keypoints: pts, color: '#66FF00' });
        }
      },

      // Posture cue independent of the phase gating
      { when: "Number.isFinite(trunkAngleMin) && trunkAngleMin < trunkUprightMin", say: 'Stand tall' },
    ],
  
    // Compute both elbows & a trunk posture cue
    computeExtraFeatures: ({ kps, utils }) => {
      const sides = ['left', 'right'];
      const elbow = {};
      const trunk = {};
  
      for (const s of sides) {
        const shoulder = utils.kp(kps, `${s}_shoulder`);
        const elbowPt  = utils.kp(kps, `${s}_elbow`);
        const wrist    = utils.kp(kps, `${s}_wrist`);
        const hip      = utils.kp(kps, `${s}_hip`);
        const ankle    = utils.kp(kps, `${s}_ankle`);
  
        elbow[s] =
          (utils.present(shoulder) && utils.present(elbowPt) && utils.present(wrist))
            ? utils.angle(shoulder, elbowPt, wrist)
            : NaN;
  
        trunk[s] =
          (utils.present(shoulder) && utils.present(hip) && utils.present(ankle))
            ? utils.angle(shoulder, hip, ankle)
            : NaN;
      }
  
      const finite = v => Number.isFinite(v);
      const elbows = [elbow.left, elbow.right].filter(finite);
      const trunks = [trunk.left, trunk.right].filter(finite);
  
      const elbowAngleMin = elbows.length ? Math.min(...elbows) : NaN;
      const trunkAngleMin = trunks.length ? Math.min(...trunks) : NaN;
  
      return {
        elbowAngleL: elbow.left, elbowAngleR: elbow.right,
        elbowAngleMin,
        trunkAngleL: trunk.left, trunkAngleR: trunk.right,
        trunkAngleMin,
      };
    },
  };

// Smooth color transitions with a short hold for orange to avoid flicker.
BicepCurls.highlights = function ({ setHighlight, features }) {
  const down = BicepCurls.elbowFlexDown;
  const up   = BicepCurls.elbowFlexUp;
  const l = features.elbowAngleL;
  const r = features.elbowAngleR;
  const minElbow = features.elbowAngleMin;

  // Determine phase-like state using thresholds (mirrors spec logic)
  const isLowered = Number.isFinite(minElbow) && minElbow >= down;
  const isRaised  = Number.isFinite(minElbow) && minElbow <= up;

  // Choose which side to highlight when raised (more flexed = smaller angle)
  let pts = ['left_shoulder','left_elbow','left_wrist','right_shoulder','right_elbow','right_wrist'];
  if (isRaised) {
    let side = null;
    if (Number.isFinite(l) && Number.isFinite(r)) side = (l <= r ? 'left' : 'right');
    else if (Number.isFinite(l)) side = 'left';
    else if (Number.isFinite(r)) side = 'right';
    
    if (side) {
      pts = [`${side}_shoulder`, `${side}_elbow`, `${side}_wrist`];
    }
  }

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
  
  export default BicepCurls;
  