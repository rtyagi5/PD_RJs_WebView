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
    { id: 'lowered', enter: 'shoulderAngle > 0 && shoulderAngle < 45', dwellMs: 100 },
    { id: 'raised', enter: 'shoulderAngle >= 65 && shoulderAngle <= 100', dwellMs: 100 }
    ],
    rep: { from: 'raised', to: 'lowered' },
    // feedback: [
    // { when: 'shoulderAngle > 100', say: 'Arm raise too high' },
    // { when: "phase=='lowered' && reps==0", say: 'Good start position' },
    // { when: "phase=='raised'", say: 'Arm up detected' },
    // { when: 'Number.isNaN(shoulderAngle)', say: 'Make sure all key points are visible' }
    // ],
    // highlights({ setHighlight, features }) {
    // const { side = 'left' } = features; // adapter adds side
    // setHighlight({ keypoints: [`${side}_shoulder`, `${side}_elbow`, `${side}_wrist`, `${side}_hip`], color: '#66FF00' });
    // }
    feedback: [
        { when: 'shoulderAngle > 100', say: 'Arm raise too high',
          highlight: ({ setHighlight, features }) => setHighlight({ 
            keypoints: [`${features.side}_shoulder`, `${features.side}_elbow`, `${features.side}_wrist`, `${features.side}_hip`],
            color: '#FFA500'
          })
        },
        { when: "phase=='raised'", say: 'Arm up detected',
          highlight: ({ setHighlight, features }) => setHighlight({
            keypoints: [`${features.side}_shoulder`, `${features.side}_elbow`, `${features.side}_wrist`, `${features.side}_hip`],
            color: '#66FF00'
          })
        },
        { when: "phase=='lowered'", say: 'Lowered',
          highlight: ({ setHighlight, features }) => setHighlight({
            keypoints: [`${features.side}_shoulder`, `${features.side}_elbow`, `${features.side}_wrist`, `${features.side}_hip`],
            color: '#FF4D4D'
          })
        },
        { when: 'Number.isNaN(shoulderAngle)', say: 'Make sure all key points are visible' }
      ],
      
    };
    export default SideArmRaise;