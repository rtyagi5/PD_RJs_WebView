// ---------------------------------------------
// specs/MiniLunges.spec.js
// ---------------------------------------------
const MiniLunges = {
    name: 'MiniLunges',
    side: 'both',                // evaluate both legs, fuse metrics
    mode: 'rep',
    primaryMetric: 'kneeAngleMin',
    dwellMs: 140,
    refractoryMs: 300,
  
    // Count alternating bends as a *pair* (L then R or R then L)
    repMode: 'pair',
    // selectActiveSide: (features) => {
    //   // Which knee is more flexed (smaller angle)?
    //   const l = features.kneeAngleL ?? Infinity;
    //   const r = features.kneeAngleR ?? Infinity;
    //   if (!Number.isFinite(l) && !Number.isFinite(r)) return null;
    //   // margin to avoid flicker
    //   if (l + 1 < r) return 'left';
    //   if (r + 1 < l) return 'right';
    //   return null;
    // },
    selectActiveSide: (features) => {
        const l = features.kneeAngleL;
        const r = features.kneeAngleR;
        const bothFinite = Number.isFinite(l) && Number.isFinite(r);
        if (bothFinite) {
            // smaller angle = more flexion
            if (l + 2 < r) return 'left';
            if (r + 2 < l) return 'right';
            return null; // too close → ambiguous
        }
        // fallbacks if one side is missing
        if (Number.isFinite(l) && !Number.isFinite(r)) return 'left';
        if (!Number.isFinite(l) && Number.isFinite(r)) return 'right';
        return null;
    },    
  
    // Thresholds: smaller knee angle = more flexion
    // Tweak these to be "mini" (shallow) lunges.
    lungeKneeUp:   165,  // <= this means you're “in” the lunge
    lungeKneeDown: 175,  // >= this means you’re back “out” (hysteresis)
    trunkUprightMin: 165,
  
    phases: [
      {
        id: 'lowered',
        enter:
          "(" +
          " Number.isFinite(kneeAngleMin) && kneeAngleMin >= lungeKneeDown" +
          ")"
      },
      {
        id: 'raised',
        enter:
          "(" +
          " Number.isFinite(kneeAngleMin) && kneeAngleMin <= lungeKneeUp" +
          ")"
      },
    ],
  
    // Count when going from lowered -> raised
    rep: { from: 'lowered', to: 'raised' },
  
    feedback: [
      { when: "phase=='lowered'", say: 'Step into a small lunge' },
      {
        when: "phase=='raised'",
        say: 'Nice!',
        highlight: ({ setHighlight, features }) => {
          const l = features.kneeAngleL ?? Infinity;
          const r = features.kneeAngleR ?? Infinity;
          // highlight the more-flexed knee
          let side = null;
          if (l + 1 < r) side = 'left';
          else if (r + 1 < l) side = 'right';
  
          const pts = side
            ? [`${side}_hip`, `${side}_knee`, `${side}_ankle`]
            : ['left_hip','left_knee','left_ankle','right_hip','right_knee','right_ankle'];
  
          setHighlight({ keypoints: pts, color: '#66FF00' });
        }
      },
      { when: "Number.isFinite(trunkAngleMin) && trunkAngleMin < trunkUprightMin", say: 'Stand tall' },
    ],
  
    // Compute per-side knee angles and trunk; fuse a “min” knee angle across sides
    computeExtraFeatures: ({ kps, utils }) => {
      const sides = ['left', 'right'];
      const kneeAngle = {};   // angle(hip, knee, ankle) -- smaller = more flexion
      const trunk     = {};   // angle(shoulder, hip, ankle) (fallback knee)
  
      for (const s of sides) {
        const hip      = utils.kp(kps, `${s}_hip`);
        const knee     = utils.kp(kps, `${s}_knee`);
        const ankle    = utils.kp(kps, `${s}_ankle`);
        const shoulder = utils.kp(kps, `${s}_shoulder`);
  
        kneeAngle[s] =
          (utils.present(hip) && utils.present(knee) && utils.present(ankle))
            ? utils.angle(hip, knee, ankle) : NaN;
  
        trunk[s] =
          (utils.present(shoulder) && utils.present(hip) && utils.present(ankle))
            ? utils.angle(shoulder, hip, ankle)
            : (utils.present(shoulder) && utils.present(hip) && utils.present(knee))
                ? utils.angle(shoulder, hip, knee) : NaN;
      }
  
      const finite = v => Number.isFinite(v);
      const knees  = [kneeAngle.left, kneeAngle.right].filter(finite);
      const trunks = [trunk.left, trunk.right].filter(finite);
  
      const kneeAngleMin = knees.length ? Math.min(...knees) : NaN;
      const trunkAngleMin = trunks.length ? Math.min(...trunks) : NaN;
  
      return {
        kneeAngleL: kneeAngle.left, kneeAngleR: kneeAngle.right,
        kneeAngleMin,
        trunkAngleL: trunk.left, trunkAngleR: trunk.right,
        trunkAngleMin,
      };
    },
  };
  
  export default MiniLunges;
  