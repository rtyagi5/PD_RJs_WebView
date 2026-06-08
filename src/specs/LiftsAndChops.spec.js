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
      // Lifted: top position (green)
      { when: "phase=='lifted'", say: 'Lifted - Finish the chop',
        highlight: ({ setHighlight, features }) => {
          const s = features.handsXNormSigned;
          const side = Number.isFinite(s) ? (s > 0 ? 'right' : s < 0 ? 'left' : null) : null;
          const pts = side
            ? [`${side}_wrist`, `${side}_elbow`, `${side}_shoulder`]
            : ['left_wrist','left_elbow','left_shoulder','right_wrist','right_elbow','right_shoulder'];
          setHighlight({ keypoints: pts, color: '#66FF00' });
        }
      },

      // Transition: neither lifted nor chopped (orange)
      { when: "!(phase=='lifted' || phase=='chopped')", say: 'Keep going',
        highlight: ({ setHighlight }) =>
          setHighlight({ keypoints: ['left_wrist','left_elbow','left_shoulder','right_wrist','right_elbow','right_shoulder'], color: '#FFB020' })
      },

      // Chopped: bottom position (green)
      { when: "phase=='chopped'", say: 'Good chop - Lift back up',
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

// Smooth color transitions with a short hold for orange to avoid flicker.
LiftsAndChops.highlights = function ({ setHighlight, features }) {
  const high = LiftsAndChops.liftHigh;
  const low  = LiftsAndChops.chopLow;
  const handsHeight = features.handsHeightNorm;

  // Determine phase-like state using thresholds (mirrors spec logic)
  const isLifted  = Number.isFinite(handsHeight) && handsHeight >= high;
  const isChopped = Number.isFinite(handsHeight) && handsHeight <= low;

  // Choose which side to highlight based on hand position
  const s = features.handsXNormSigned;
  const side = Number.isFinite(s) ? (s > 0 ? 'right' : s < 0 ? 'left' : null) : null;
  const pts = side
    ? [`${side}_wrist`, `${side}_elbow`, `${side}_shoulder`]
    : ['left_wrist','left_elbow','left_shoulder','right_wrist','right_elbow','right_shoulder'];

  // Color with orange hold
  let desired = '#66FF00';
  if (!isLifted && !isChopped) desired = '#FFB020';

  if (!this._hl) this._hl = { lastColor: null, lastTs: 0 };
  const now = Date.now();
  const HOLD_MS = 250;
  const { lastColor, lastTs } = this._hl;
  if (lastColor === '#FFB020' && now - lastTs < HOLD_MS) desired = '#FFB020';
  if (desired !== lastColor) { this._hl.lastColor = desired; this._hl.lastTs = now; }

  setHighlight({ keypoints: pts, color: desired });
};
  
  export default LiftsAndChops;
  