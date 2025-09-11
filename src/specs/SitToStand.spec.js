// ---------------------------------------------
// specs/SitToStand.spec.js
// ---------------------------------------------
const SitToStand = {
    name: 'SitToStand',
    side: 'both',                          // <- we consume both sides
    primaryMetric: 'kneeAngleMax',         // HUD prefers the standing indicator
    dwellMs: 140,
  
    // Fallback thresholds when ankle isn't visible (distance normalized by shoulder-hip)
    seatedDistThresh:   0.24,
    standingDistThresh: 0.32,
  
    phases: [
      {
        id: 'seated',
        enter:
          "(Number.isFinite(kneeAngleMin) && kneeAngleMin < 150) || " +
          "(!Number.isFinite(kneeAngleMin) && Number.isFinite(hipToKneeNormMin) && hipToKneeNormMin < seatedDistThresh)"
      },
      {
        id: 'standing',
        enter:
          "(Number.isFinite(kneeAngleMax) && kneeAngleMax > 170) || " +
          "(!Number.isFinite(kneeAngleMax) && Number.isFinite(hipToKneeNormMax) && hipToKneeNormMax > standingDistThresh)"
      },
    ],
  
    rep: { from: 'seated', to: 'standing' },
  
    feedback: [
        { when: "phase=='seated'",   say: 'Get ready',
            highlight: ({ setHighlight }) =>
            setHighlight({ keypoints: ['left_hip','left_knee','left_ankle','right_hip','right_knee','right_ankle'],
                          color: '#FF4D4D' })
        },
        { when: "phase=='standing'", say: 'Nice stand!',
            highlight: ({ setHighlight }) =>
            setHighlight({ keypoints: ['left_hip','left_knee','left_ankle','right_hip','right_knee','right_ankle'],
                          color: '#66FF00' })
        },
            
        { when: "!Number.isFinite(kneeAngleMax) && !Number.isFinite(hipToKneeNormMax)",
          say:  'Keep hips, knees (and ankles if possible) in frame'
        },
    ],
  
    // Compute both sides, then expose fused min/max features for simple rules.
    computeExtraFeatures: ({ kps, utils }) => {
      const sides = ['left', 'right'];
  
      const kneeAngle = {};
      const hipToKneeNorm = {};
  
      for (const s of sides) {
        const hip      = utils.kp(kps, `${s}_hip`);
        const knee     = utils.kp(kps, `${s}_knee`);
        const ankle    = utils.kp(kps, `${s}_ankle`);
        const shoulder = utils.kp(kps, `${s}_shoulder`);
  
        // angle fallback: only if all three are present
        kneeAngle[s] =
          (utils.present(hip) && utils.present(knee) && utils.present(ankle))
            ? utils.angle(hip, knee, ankle)
            : NaN;
  
        // distance fallback normalized by torso segment (shoulder->hip)
        hipToKneeNorm[s] =
          (utils.present(hip) && utils.present(knee) && utils.present(shoulder))
            ? utils.calculateDistance(hip, knee) / Math.max(utils.calculateDistance(shoulder, hip), 1e-6)
            : NaN;
      }
  
      const finite = v => Number.isFinite(v);
      const mins   = [kneeAngle.left, kneeAngle.right].filter(finite);
      const maxs   = mins; // reuse list; contents are same set
  
      const kneeAngleMin = mins.length ? Math.min(...mins) : NaN;
      const kneeAngleMax = maxs.length ? Math.max(...maxs) : NaN;
  
      const dMins = [hipToKneeNorm.left, hipToKneeNorm.right].filter(finite);
      const dMaxs = dMins;
  
      const hipToKneeNormMin = dMins.length ? Math.min(...dMins) : NaN;
      const hipToKneeNormMax = dMaxs.length ? Math.max(...dMaxs) : NaN;
  
      // expose per-side too if you ever want to log them
      return {
        kneeAngleL: kneeAngle.left,   kneeAngleR: kneeAngle.right,
        kneeAngleMin, kneeAngleMax,
        hipToKneeNormL: hipToKneeNorm.left, hipToKneeNormR: hipToKneeNorm.right,
        hipToKneeNormMin, hipToKneeNormMax,
      };
    },
  };
  
  export default SitToStand;
  