// ---------------------------------------------
// specs/LongArcQuad.spec.js
// ---------------------------------------------
const LongArcQuad = {
    name: 'LongArcQuad',
    // We’ll read whichever side the UI passes to the tracker (left/right).
    // This spec does not auto-pick the side.
    side: 'either',
  
    primaryMetric: 'kneeAngle',  // HUD shows knee angle for the selected side
    dwellMs: 120,
    refractoryMs: 300,
  
    // Angle hysteresis (degrees)
    laqAngleFlexed:   160,       // "flexed" if knee ≤ 110°
    laqAngleExtended: 178,       // "extended" if knee ≥ 165°
  
    // Distance fallback (normalized by same-side hip→knee length)
    // hipToAnkleNorm = |hip-ankle| / max(|hip-knee|, 1e-6)
    // Smaller when flexed; larger when extended
    laqDistFlexed:    1.40,
    laqDistExtended:  1.70,
  
    // Require starting posture so first kick counts on the first extension
    startPhase: 'flexed',
  
    phases: [
      {
        id: 'flexed',
        enter:
          "(Number.isFinite(kneeAngle) && kneeAngle <= laqAngleFlexed) || " +
          "(!Number.isFinite(kneeAngle) && Number.isFinite(hipToAnkleNorm) && hipToAnkleNorm <= laqDistFlexed)"
      },
      {
        id: 'extended',
        enter:
          "(Number.isFinite(kneeAngle) && kneeAngle >= laqAngleExtended) || " +
          "(!Number.isFinite(kneeAngle) && Number.isFinite(hipToAnkleNorm) && hipToAnkleNorm >= laqDistExtended)"
      },
    ],
  
    // Count on the kick
    rep: { from: 'flexed', to: 'extended' },
  
    feedback: [
      { when: "phase=='flexed'",   say: 'Prepare to kick',
        highlight: ({ setHighlight, features }) =>
          setHighlight({ keypoints: [`${features.side}_hip`,`${features.side}_knee`,`${features.side}_ankle`],
                         color: '#FF4D4D' })
      },
      { when: "phase=='extended'", say: 'Nice extension',
        highlight: ({ setHighlight, features }) =>
          setHighlight({ keypoints: [`${features.side}_hip`,`${features.side}_knee`,`${features.side}_ankle`],
                         color: '#66FF00' })
      },
      // Optional guardrails
      { when: "kneeAngle > 175", say: "Don't hyperextend" },
      { when: "!Number.isFinite(kneeAngle) && !Number.isFinite(hipToAnkleNorm)",
        say:  'Keep hip, knee and ankle visible'
      },
    ],
  
    // Spec-local features: distance fallback (single side)
    computeExtraFeatures: ({ kps, side, utils }) => {
      const hip   = utils.kp(kps, `${side}_hip`);
      const knee  = utils.kp(kps, `${side}_knee`);
      const ankle = utils.kp(kps, `${side}_ankle`);
  
      // Base already provides kneeAngle for the chosen side (hip–knee–ankle).
      // Here we add a robust distance fallback normalized by thigh length.
      let hipToAnkleNorm = NaN;
      if (utils.present(hip) && utils.present(knee) && utils.present(ankle)) {
        const hipAnkle = utils.calculateDistance(hip, ankle);
        const hipKnee  = Math.max(utils.calculateDistance(hip, knee), 1e-6);
        hipToAnkleNorm = hipAnkle / hipKnee;
      }
  
      return { hipToAnkleNorm };
    },
  };
  
  export default LongArcQuad;
  