// // ---------------------------------------------
// // specs/LiftsAndChops.spec.js
// // ---------------------------------------------
// const LiftsAndChops = {
//     name: 'LiftsAndChops',
//     side: 'both',
//     mode: 'rep',
//     // Show how high the hands are (0=hip height, 1≈shoulder height)
//     primaryMetric: 'handsHeightNorm',
//     dwellMs: 140,
//     refractoryMs: 300,
  
//     // Count one rep when you go LIFTED -> CHOPPED.
//     // Using 'pair' mode means we count each completed chop when you switch sides
//     // (e.g., Right lift->chop, then Left lift->chop). If you’d rather count every
//     // lift->chop regardless of side, change repMode to 'perLift' or remove it.
//     repMode: 'pair',
//     selectActiveSide: (features) => {
//       const s = features.handsXNormSigned; // + right side, - left side
//       if (!Number.isFinite(s)) return null;
//       if (s >  +0.02) return 'right';
//       if (s <  -0.02) return 'left';
//       return null;
//     },
  
//     // Thresholds (tweak to taste)
//     // Horizontal: how far to one side (normalized by shoulder width)
//     xSideEnter: 0.15, // need to be ~15% of shoulder width to either side
//     // Vertical: hands height relative to torso (0=hip level, 1≈shoulder level)
//     liftHigh:   0.55, // hands up near shoulders
//     chopLow:    0.25, // hands down near hips
  
//     phases: [
//       // “Lifted”: hands high AND over either left or right side
//       {
//         id: 'lifted',
//         enter:
//           "(" +
//           "  Number.isFinite(handsHeightNorm) && handsHeightNorm >= liftHigh &&" +
//           "  Number.isFinite(handsXAbsNorm) && handsXAbsNorm >= xSideEnter" +
//           ")"
//       },
//       // “Chopped”: hands low AND still to one side (same direction)
//       {
//         id: 'chopped',
//         enter:
//           "(" +
//           "  Number.isFinite(handsHeightNorm) && handsHeightNorm <= chopLow &&" +
//           "  Number.isFinite(handsXAbsNorm) && handsXAbsNorm >= xSideEnter" +
//           ")"
//       },
//     ],
  
//     // Count when we go from lifted -> chopped
//     rep: { from: 'lifted', to: 'chopped' },
  
//     feedback: [
//       {
//         when: "phase=='lifted'",
//         say: 'Finish the chop',
//         highlight: ({ setHighlight }) => {
//           // brighten both arms/hands at the top
//           setHighlight({
//             keypoints: [
//               'left_wrist','left_elbow','left_shoulder',
//               'right_wrist','right_elbow','right_shoulder'
//             ],
//             color: '#66FF00'
//           });
//         }
//       },
//       {
//         when: "phase=='chopped'",
//         say: 'Good chop',
//         highlight: ({ setHighlight }) => {
//           // brighten both arms/hands at the bottom
//           setHighlight({
//             keypoints: [
//               'left_wrist','left_elbow','left_shoulder',
//               'right_wrist','right_elbow','right_shoulder'
//             ],
//             color: '#66FF00'
//           });
//         }
//       },
//     ],
  // ---------------------------------------------
// specs/LiftsAndChops.spec.js
// ---------------------------------------------
const LiftsAndChops = {
    name: 'LiftsAndChops',
    side: 'both',
    mode: 'rep',
    primaryMetric: 'handsHeightNorm',
    dwellMs: 120,
    refractoryMs: 250,
  
    // per-lift counting (default) — each lifted→chopped = 1 rep
    // repMode: 'perLift',
  
    // Keep this for highlighting only (not used for counting now)
    selectActiveSide: (features) => {
      const s = features.handsXNormSigned;
      if (!Number.isFinite(s)) return null;
      // slightly wider neutral zone to avoid flicker around midline
      if (s > +0.06) return 'right';
      if (s < -0.06) return 'left';
      return null;
    },
  
    // Thresholds (tweak to taste)
    xSideEnter: 0.12, // how far to one side to consider “on left/right” for visuals
    liftHigh:   0.50, // lift target (normalized shoulder->hip span or your chosen norm)
    chopLow:    0.30, // chop target
  
    phases: [
      { id: 'lifted',  enter: "Number.isFinite(handsHeightNorm) && handsHeightNorm >= liftHigh" },
      { id: 'chopped', enter: "Number.isFinite(handsHeightNorm) && handsHeightNorm <= chopLow"  },
    ],
  
    // Count a rep when you go from lifted -> chopped (per-lift)
    rep: { from: 'lifted', to: 'chopped' },
  
    feedback: [
      {
        when: "phase=='lifted'",
        say: 'Finish the chop',
        highlight: ({ setHighlight, features }) => {
          const s = features.handsXNormSigned;
          const side = Number.isFinite(s) ? (s > 0 ? 'right' : s < 0 ? 'left' : null) : null;
          const pts = side
            ? [`${side}_wrist`, `${side}_elbow`, `${side}_shoulder`]
            : ['left_wrist','left_elbow','left_shoulder','right_wrist','right_elbow','right_shoulder'];
          setHighlight({ keypoints: pts, color: '#66FF00' });
        }
      },
      {
        when: "phase=='chopped'",
        say: 'Good chop',
        highlight: ({ setHighlight, features }) => {
          const s = features.handsXNormSigned;
          const side = Number.isFinite(s) ? (s > 0 ? 'right' : s < 0 ? 'left' : null) : null;
          const pts = side
            ? [`${side}_wrist`, `${side}_elbow`, `${side}_shoulder`]
            : ['left_wrist','left_elbow','left_shoulder','right_wrist','right_elbow','right_shoulder'];
          setHighlight({ keypoints: pts, color: '#66FF00' });
        }
      },
    ],
    // Compute hand centroid vs body midline and height
    computeExtraFeatures: ({ kps, utils }) => {
      // helpers
      const Ls = utils.kp(kps, 'left_shoulder');
      const Rs = utils.kp(kps, 'right_shoulder');
      const Lh = utils.kp(kps, 'left_hip');
      const Rh = utils.kp(kps, 'right_hip');
      const Lw = utils.kp(kps, 'left_wrist');
      const Rw = utils.kp(kps, 'right_wrist');
  
      // shoulder/hip midpoints
      const mid = (a,b) => (utils.present(a) && utils.present(b))
        ? { x:(a.x+b.x)/2, y:(a.y+b.y)/2 } : null;
  
      const midShoulder = mid(Ls, Rs);
      const midHip      = mid(Lh, Rh);
  
      // shoulder width & torso length
      const shoulderWidth = (utils.present(Ls) && utils.present(Rs))
        ? utils.calculateDistance(Ls, Rs) : NaN;
  
      const torsoLen = (midShoulder && midHip)
        ? utils.calculateDistance(midShoulder, midHip) : NaN;
  
      // hands centroid: both wrists avg if available; else whichever is present
      let hands = null;
      if (utils.present(Lw) && utils.present(Rw)) {
        hands = { x:(Lw.x + Rw.x)/2, y:(Lw.y + Rw.y)/2 };
      } else {
        hands = utils.present(Lw) ? Lw : (utils.present(Rw) ? Rw : null);
      }
  
      let handsXNormSigned = NaN;
      let handsXAbsNorm    = NaN;
      let handsHeightNorm  = NaN;
  
      if (hands && midShoulder) {
        const denomX = Math.max(shoulderWidth || 0, 1e-6);
        handsXNormSigned = (hands.x - midShoulder.x) / denomX; // + right, − left
        handsXAbsNorm    = Math.abs(handsXNormSigned);
      }
      if (hands && midHip && torsoLen) {
        // Upward = larger (hip.y - hands.y is positive as hands rise)
        const denomY = Math.max(torsoLen || 0, 1e-6);
        handsHeightNorm = Math.max(0, (midHip.y - hands.y)) / denomY;
      }
  
      return {
        handsXNormSigned,  // signed horizontal offset (side)
        handsXAbsNorm,     // magnitude of side offset
        handsHeightNorm,   // 0..~1, hip to shoulder
      };
    },
  };
  
  export default LiftsAndChops;
  