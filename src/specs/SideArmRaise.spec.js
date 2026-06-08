// ---------------------------------------------
// specs/SideArmRaise.spec.js
// ---------------------------------------------
const SideArmRaise = {
    name: 'SideArmRaise',
    side: 'either',
    primaryMetric: 'shoulderAngle', // <— NEW
    dwellMs: 120,
    refractoryMs: 300,
    phases: [
    { id: 'lowered', enter: 'shoulderAngle > 0 && shoulderAngle < 30', dwellMs: 100 },
    // add a small hysteresis on the upper bound to reduce flicker between transition and raised
    { id: 'raised', enter: 'shoulderAngle >= 70 && shoulderAngle <= 95', dwellMs: 100 }
    ],
    rep: { from: 'raised', to: 'lowered' },
    // Updated feedback and highlight color transitions:
    // - lowered: green
    // - transition (between 45 and 65): orange
    // - raised (65-100): green
    // - too high (>100): red
    feedback: [
        // Too high
        { when: 'Number.isFinite(shoulderAngle) && shoulderAngle > 95', say: 'Raised too high - lower your arm',
          highlight: ({ setHighlight, features }) => setHighlight({
            keypoints: [`${features.side}_shoulder`, `${features.side}_elbow`, `${features.side}_wrist`, `${features.side}_hip`],
            color: '#FF3B30' // red
          })
        },
        // Raised (in target)
        { when: "phase=='raised'", say: 'Raised - Lower your arm',
          highlight: ({ setHighlight, features }) => setHighlight({
            keypoints: [`${features.side}_shoulder`, `${features.side}_elbow`, `${features.side}_wrist`, `${features.side}_hip`],
            color: '#66FF00' // green
          })
        },
        // Transition zone between lowered and raised
        { when: 'Number.isFinite(shoulderAngle) && shoulderAngle >= 30 && shoulderAngle < 70', say: 'Keep going',
          highlight: ({ setHighlight, features }) => setHighlight({
            keypoints: [`${features.side}_shoulder`, `${features.side}_elbow`, `${features.side}_wrist`, `${features.side}_hip`],
            color: '#FFB020' // orange
          })
        },
        // Lowered (start position)
        { when: "phase=='lowered'", say: 'Start Position - Raise your arm',
          highlight: ({ setHighlight, features }) => setHighlight({
            keypoints: [`${features.side}_shoulder`, `${features.side}_elbow`, `${features.side}_wrist`, `${features.side}_hip`],
            color: '#66FF00' // green
          })
        },
        { when: 'Number.isNaN(shoulderAngle)', say: 'Make sure all key points are visible' }
      ],

    // Dedicated highlights function with hysteresis + short hold for orange to avoid flicker.
    // This runs every frame; feedback above still sets messages.
    highlights({ setHighlight, features }) {
      const side = features.side || 'left';
      const angle = features.shoulderAngle;
      const pts = [`${side}_shoulder`, `${side}_elbow`, `${side}_wrist`, `${side}_hip`];

      // Module-scoped memory (attached to object) to hold last color and timestamp
      if (!this._hl) this._hl = { lastColor: null, lastTs: 0 };
      const now = Date.now();

      let desired = '#66FF00'; // default green
      if (Number.isFinite(angle)) {
        if (angle > 95) desired = '#FF3B30'; // red
        else if (angle >= 30 && angle < 70) desired = '#FFB020'; // orange (transition)
        else if (angle >= 70 && angle <= 95) desired = '#66FF00'; // green (raised)
        else /* <30 */ desired = '#66FF00'; // green (lowered)
      }

      // Hold orange at least 250ms to make it visually noticeable in both directions
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
    }
    
  };
  export default SideArmRaise;