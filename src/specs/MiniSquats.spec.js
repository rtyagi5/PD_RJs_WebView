// ---------------------------------------------
// specs/MiniSquats.spec.js
// ---------------------------------------------
const MiniSquats = {
    name: 'MiniSquats',
    side: 'both',                    // read both legs; fuse below
    primaryMetric: 'kneeAngleMin',   // HUD shows depth indicator
    dwellMs: 120,
    refractoryMs: 300,
  
    // Distance fallback thresholds (normalized by shoulder->hip)
    downDistThresh: 0.22,            // deeper = smaller distance
    upDistThresh:   0.30,
  
    // Hysteresis via separate “enter” thresholds
    squatAngleDown: 155,             // down if min knee angle ≤ 135°
    squatAngleUp:   175,             // up   if max knee angle ≥ 165°
  
    phases: [
      {
        id: 'down',
        enter:
          "(Number.isFinite(kneeAngleMin) && kneeAngleMin <= squatAngleDown) || " +
          "(!Number.isFinite(kneeAngleMin) && Number.isFinite(hipToKneeNormMin) && hipToKneeNormMin <= downDistThresh)"
      },
      {
        id: 'up',
        enter:
          "(Number.isFinite(kneeAngleMax) && kneeAngleMax >= squatAngleUp) || " +
          "(!Number.isFinite(kneeAngleMax) && Number.isFinite(hipToKneeNormMax) && hipToKneeNormMax >= upDistThresh)"
      },
    ],
  
    // Count when returning to up
    rep: { from: 'up', to: 'down' },

    feedback: [
      // Up position (green)
      { when: "phase=='up'", say: 'Please Start Squatting down',
        highlight: ({ setHighlight }) => setHighlight({
          keypoints: ['left_hip','left_knee','left_ankle','right_hip','right_knee','right_ankle'],
          color: '#66FF00'
        })
      },
      // Down position (green)
      { when: "phase=='down'", say: 'Down - Start Standing up',
        highlight: ({ setHighlight }) => setHighlight({
          keypoints: ['left_hip','left_knee','left_ankle','right_hip','right_knee','right_ankle'],
          color: '#66FF00'
        })
      },
      // Transition (orange)
      { when: "!(phase=='down' || phase=='up')", say: 'Keep going',
        highlight: ({ setHighlight }) => setHighlight({
          keypoints: ['left_hip','left_knee','left_ankle','right_hip','right_knee','right_ankle'],
          color: '#FFB020'
        })
      },
      { when: "!Number.isFinite(kneeAngleMin) && !Number.isFinite(hipToKneeNormMin)",
        say:  'Face camera; keep hips, knees (ankles if possible) visible'
      },
    ],
  
    // Compute both sides; expose fused min/max for simple rules
    computeExtraFeatures: ({ kps, utils }) => {
      const sides = ['left', 'right'];
      const kneeAngle = {};
      const hipToKneeNorm = {};
  
      for (const s of sides) {
        const hip      = utils.kp(kps, `${s}_hip`);
        const knee     = utils.kp(kps, `${s}_knee`);
        const ankle    = utils.kp(kps, `${s}_ankle`);
        const shoulder = utils.kp(kps, `${s}_shoulder`);
  
        kneeAngle[s] =
          (utils.present(hip) && utils.present(knee) && utils.present(ankle))
            ? utils.angle(hip, knee, ankle)
            : NaN;
  
        hipToKneeNorm[s] =
          (utils.present(hip) && utils.present(knee) && utils.present(shoulder))
            ? utils.calculateDistance(hip, knee) / Math.max(utils.calculateDistance(shoulder, hip), 1e-6)
            : NaN;
      }
  
      const finite = v => Number.isFinite(v);
      const kList  = [kneeAngle.left, kneeAngle.right].filter(finite);
      const dList  = [hipToKneeNorm.left, hipToKneeNorm.right].filter(finite);
  
      const kneeAngleMin = kList.length ? Math.min(...kList) : NaN;
      const kneeAngleMax = kList.length ? Math.max(...kList) : NaN;
  
      const hipToKneeNormMin = dList.length ? Math.min(...dList) : NaN;
      const hipToKneeNormMax = dList.length ? Math.max(...dList) : NaN;
  
      return {
        kneeAngleL: kneeAngle.left,    kneeAngleR: kneeAngle.right,
        kneeAngleMin, kneeAngleMax,
        hipToKneeNormL: hipToKneeNorm.left, hipToKneeNormR: hipToKneeNorm.right,
        hipToKneeNormMin, hipToKneeNormMax,
      };
    },
  };

// Smooth color highlight with a short hold on orange to avoid flicker.
MiniSquats.highlights = function ({ setHighlight, features }) {
  const pts = ['left_hip','left_knee','left_ankle','right_hip','right_knee','right_ankle'];
  const {
    kneeAngleMin, kneeAngleMax,
    hipToKneeNormMin, hipToKneeNormMax,
    downDistThresh = MiniSquats.downDistThresh,
    upDistThresh = MiniSquats.upDistThresh,
    squatAngleDown = MiniSquats.squatAngleDown,
    squatAngleUp = MiniSquats.squatAngleUp,
  } = features;

  const finite = (v) => Number.isFinite(v);
  const isDown = (finite(kneeAngleMin) && kneeAngleMin <= squatAngleDown) ||
                 (!finite(kneeAngleMin) && finite(hipToKneeNormMin) && hipToKneeNormMin <= downDistThresh);
  const isUp = (finite(kneeAngleMax) && kneeAngleMax >= squatAngleUp) ||
               (!finite(kneeAngleMax) && finite(hipToKneeNormMax) && hipToKneeNormMax >= upDistThresh);

  let desired = '#66FF00'; // green by default
  if (!isDown && !isUp) desired = '#FFB020'; // orange during movement

  if (!this._hl) this._hl = { lastColor: null, lastTs: 0 };
  const now = Date.now();
  const HOLD_MS = 250;
  const { lastColor, lastTs } = this._hl;
  if (lastColor === '#FFB020' && now - lastTs < HOLD_MS) {
    desired = '#FFB020';
  }
  if (desired !== lastColor) {
    this._hl.lastColor = desired;
    this._hl.lastTs = now;
  }

  setHighlight({ keypoints: pts, color: desired });
};

export default MiniSquats;
  