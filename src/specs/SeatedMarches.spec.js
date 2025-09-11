// ---------------------------------------------
// specs/SeatedMarches.spec.js
// ---------------------------------------------
const SeatedMarches = {
    name: 'SeatedMarches',
    side: 'both',                      // evaluate both legs; fuse metrics
    mode: 'rep',                       // count each lift
    primaryMetric: 'kneeLiftNormMax',  // HUD: how high the higher knee is
    dwellMs: 140,                      // a touch more dwell to avoid flicker
    refractoryMs: 300,
    repMode: 'pair',
    selectActiveSide: (features) => {
    const up = (Number.isFinite(features.kneeLiftNormUp) ? features.kneeLiftNormUp : 0.06);
    const l = features.kneeLiftNormL ?? -Infinity;
    const r = features.kneeLiftNormR ?? -Infinity;

    const lOK = Number.isFinite(l) && l >= up;
    const rOK = Number.isFinite(r) && r >= up;

    // require the new side to clearly exceed the up threshold
    if (lOK && !rOK) return 'left';
    if (rOK && !lOK) return 'right';

    if (lOK && rOK) {
        if (l > r + 0.01) return 'left';
        if (r > l + 0.01) return 'right';
    }
    return null; // tie / not clearly up => don't switch
    },  
    
    // Thresholds (knee-lift first; hip/trunk are posture guidance)
    kneeLiftNormUp:   0.06,  // "raised" if knee rises ≥ 6% of shoulder–hip length
    kneeLiftNormDown: 0.03,  // "lowered" once back ≤ 3% (hysteresis)
  
    // Posture targets / feedback only (do NOT gate phases with these)
    trunkUprightMin:  165,   // encourage upright sitting
    // (hip flex angle stays for telemetry, not for phase gating)
    hipFlexAngleTip:  140,   // optional soft cue: smaller angle = more flexion
  
    phases: [
      {
        id: 'lowered',
        enter:
          "Number.isFinite(kneeLiftNormMax) && kneeLiftNormMax <= kneeLiftNormDown"
      },
      {
        id: 'raised',
        enter:
          "Number.isFinite(kneeLiftNormMax) && kneeLiftNormMax >= kneeLiftNormUp"
      },
    ],
  
    // Count a rep when you go from lowered -> raised
    rep: { from: 'lowered', to: 'raised' },
  
    feedback: [
      { when: "phase=='lowered'", say: 'Lift one knee up' },
  
      {
        when: "phase=='raised'",
        say: 'Nice lift',
        highlight: ({ setHighlight, features }) => {
          // Pick the clearly higher knee with a small margin to avoid flicker
          const l = features.kneeLiftNormL ?? -Infinity;
          const r = features.kneeLiftNormR ?? -Infinity;
          let side = 'left';
          if (r > l + 0.01) side = 'right';
          if (l > r + 0.01) side = 'left';
          // if nearly tied, keep both green so it doesn’t jump
          const pts = (Math.abs(l - r) < 0.01)
            ? ['left_hip','left_knee','left_ankle','right_hip','right_knee','right_ankle']
            : [`${side}_hip`, `${side}_knee`, `${side}_ankle`];
  
          setHighlight({ keypoints: pts, color: '#66FF00' });
        }
      },
  
      // Posture cue independent of rep logic
      {
        when: "Number.isFinite(trunkAngleMin) && trunkAngleMin < trunkUprightMin",
        say: 'Sit tall'
      },
    ],
  
    // Compute per-side angles + a simple knee-lift measure; then fuse metrics
    computeExtraFeatures: ({ kps, utils }) => {
      const sides = ['left', 'right'];
      const hipFlex = {};         // angle(shoulder, hip, knee) — smaller = more flexion
      const trunk   = {};         // angle(shoulder, hip, ankle) (fallback to knee)
      const lift    = {};         // vertical knee lift normalized by shoulder-hip
  
      for (const s of sides) {
        const shoulder = utils.kp(kps, `${s}_shoulder`);
        const hip      = utils.kp(kps, `${s}_hip`);
        const knee     = utils.kp(kps, `${s}_knee`);
        const ankle    = utils.kp(kps, `${s}_ankle`);
  
        hipFlex[s] =
          (utils.present(shoulder) && utils.present(hip) && utils.present(knee))
            ? utils.angle(shoulder, hip, knee) : NaN;
  
        trunk[s] =
          (utils.present(shoulder) && utils.present(hip) && utils.present(ankle))
            ? utils.angle(shoulder, hip, ankle)
            : (utils.present(shoulder) && utils.present(hip) && utils.present(knee))
                ? utils.angle(shoulder, hip, knee) : NaN;
  
        // y increases downward; hip.y - knee.y > 0 only if knee rises above hip
        lift[s] =
          (utils.present(shoulder) && utils.present(hip) && utils.present(knee))
            ? Math.max(0, hip.y - knee.y) / Math.max(utils.calculateDistance(shoulder, hip), 1e-6)
            : NaN;
      }
  
      const finite = v => Number.isFinite(v);
      const hipFlexAngles = [hipFlex.left, hipFlex.right].filter(finite);
      const trunks        = [trunk.left, trunk.right].filter(finite);
      const lifts         = [lift.left, lift.right].filter(finite);
  
      const hipFlexAngleMin  = hipFlexAngles.length ? Math.min(...hipFlexAngles) : NaN;
      const trunkAngleMin    = trunks.length ? Math.min(...trunks) : NaN;
      const kneeLiftNormMax  = lifts.length ? Math.max(...lifts) : NaN;
  
      return {
        hipFlexAngleL: hipFlex.left, hipFlexAngleR: hipFlex.right,
        hipFlexAngleMin,
        trunkAngleL: trunk.left, trunkAngleR: trunk.right,
        trunkAngleMin,
        kneeLiftNormL: lift.left, kneeLiftNormR: lift.right,
        kneeLiftNormMax,
      };
    },
  };
  
  export default SeatedMarches;
  