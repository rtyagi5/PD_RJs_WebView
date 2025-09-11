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
      { when: "phase=='down'", say: 'Controlled dip',
        highlight: ({ setHighlight }) =>
          setHighlight({ keypoints: ['left_hip','left_knee','left_ankle','right_hip','right_knee','right_ankle'], color: '#FF4D4D' })
      },
      { when: "phase=='up'",   say: 'Stand tall',
        highlight: ({ setHighlight }) =>
          setHighlight({ keypoints: ['left_hip','left_knee','left_ankle','right_hip','right_knee','right_ankle'], color: '#66FF00' })
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
  
  export default MiniSquats;
  