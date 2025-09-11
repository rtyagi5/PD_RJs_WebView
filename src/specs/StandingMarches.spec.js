// ---------------------------------------------
// specs/StandingMarches.spec.js
// ---------------------------------------------
const StandingMarches = {
    name: 'StandingMarches',
    side: 'both',
    mode: 'rep',
    primaryMetric: 'kneeToAnkleLiftNormMax',
    dwellMs: 160,              // a touch more dwell to reduce flicker
    refractoryMs: 300,
  
    // Count alternating lifts as a pair (L then R or R then L)
    repMode: 'pair',
    selectActiveSide: (features) => {
      const l = features.kneeToAnkleLiftNormL ?? -Infinity;
      const r = features.kneeToAnkleLiftNormR ?? -Infinity;
      if (!Number.isFinite(l) && !Number.isFinite(r)) return null;
      if (l > r + 0.01) return 'left';
      if (r > l + 0.01) return 'right';
      return null; // tie → don’t flip sides
    },
  
    // Knee-lift thresholds (hip-referenced so rest ≈ 0)
    kneeToAnkleLiftNormUp:   0.12,
    kneeToAnkleLiftNormDown: 0.06,
  
    // Posture feedback only (do NOT gate phases with these)
    trunkUprightMin: 170,
    hipFlexAngleTip: 165,
  
    phases: [
      {
        id: 'lowered',
        enter: "Number.isFinite(kneeToAnkleLiftNormMax) && kneeToAnkleLiftNormMax <= kneeToAnkleLiftNormDown"
      },
      {
        id: 'raised',
        enter: "Number.isFinite(kneeToAnkleLiftNormMax) && kneeToAnkleLiftNormMax >= kneeToAnkleLiftNormUp"
      },
    ],
  
    // Count when going from lowered -> raised
    rep: { from: 'lowered', to: 'raised' },
  
    feedback: [
      {
        when: "phase=='lowered'",
        say: 'Lift a knee',
        highlight: ({ setHighlight }) => {
          setHighlight({
            keypoints: ['left_hip','left_knee','left_ankle','right_hip','right_knee','right_ankle'],
            color: '#FFB020'
          });
        }
      },
      {
        when: "phase=='raised'",
        say: 'Nice lift',
        highlight: ({ setHighlight, features }) => {
          const l = features.kneeToAnkleLiftNormL ?? -Infinity;
          const r = features.kneeToAnkleLiftNormR ?? -Infinity;
          if (Math.abs(l - r) < 0.01) {
            // nearly tied -> show both green to avoid flicker
            setHighlight({
              keypoints: ['left_hip','left_knee','left_ankle','right_hip','right_knee','right_ankle'],
              color: '#66FF00'
            });
          } else {
            const side = l > r ? 'left' : 'right';
            setHighlight({
              keypoints: [`${side}_hip`, `${side}_knee`, `${side}_ankle`],
              color: '#66FF00'
            });
          }
        }
      },
      // Posture cue independent of the phase gating
      { when: "Number.isFinite(trunkAngleMin) && trunkAngleMin < trunkUprightMin", say: 'Stand tall' },
    ],
  
    // Features:
    // - hipFlexAngle per side (shoulder-hip-knee; smaller = more flexion) -> for feedback only
    // - trunk angle per side (shoulder-hip-ankle; fallback shoulder-hip-knee)
    // - kneeToAnkleLiftNorm: (hip.y - knee.y)/|hip-ankle|  (≈0 at rest; grows as knee rises)
    computeExtraFeatures: ({ kps, utils }) => {
      const sides = ['left', 'right'];
      const hipFlex = {};
      const trunk   = {};
      const lift    = {};
  
      for (const s of sides) {
        const shoulder = utils.kp(kps, `${s}_shoulder`);
        const hip      = utils.kp(kps, `${s}_hip`);
        const knee     = utils.kp(kps, `${s}_knee`);
        const ankle    = utils.kp(kps, `${s}_ankle`);
  
        hipFlex[s] =
          (utils.present(shoulder) && utils.present(hip) && utils.present(knee))
            ? utils.angle(shoulder, hip, knee)
            : NaN;
  
        trunk[s] =
          (utils.present(shoulder) && utils.present(hip) && utils.present(ankle))
            ? utils.angle(shoulder, hip, ankle)
            : (utils.present(shoulder) && utils.present(hip) && utils.present(knee))
              ? utils.angle(shoulder, hip, knee)
              : NaN;
  
        // y increases downward; rest has knee below hip -> (hip.y - knee.y) <= 0 → clamp to 0
        lift[s] =
          (utils.present(hip) && utils.present(knee) && utils.present(ankle))
            ? Math.max(0, hip.y - knee.y) / Math.max(utils.calculateDistance(hip, ankle), 1e-6)
            : NaN;
      }
  
      const finite = v => Number.isFinite(v);
      const hipFlexAngles = [hipFlex.left, hipFlex.right].filter(finite);
      const trunks        = [trunk.left, trunk.right].filter(finite);
      const lifts         = [lift.left, lift.right].filter(finite);
  
      const hipFlexAngleMin         = hipFlexAngles.length ? Math.min(...hipFlexAngles) : NaN;
      const trunkAngleMin           = trunks.length ? Math.min(...trunks) : NaN;
      const kneeToAnkleLiftNormMax  = lifts.length ? Math.max(...lifts) : NaN;
  
      return {
        hipFlexAngleL: hipFlex.left, hipFlexAngleR: hipFlex.right,
        hipFlexAngleMin,
        trunkAngleL: trunk.left, trunkAngleR: trunk.right,
        trunkAngleMin,
        kneeToAnkleLiftNormL: lift.left, kneeToAnkleLiftNormR: lift.right,
        kneeToAnkleLiftNormMax,
      };
    },
  };
  
  export default StandingMarches;
  