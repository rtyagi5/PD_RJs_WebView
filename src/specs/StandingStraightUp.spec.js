// ---------------------------------------------
// specs/StandingStraightUp.spec.js
// ---------------------------------------------
const StandingStraightUp = {
    name: 'StandingStraightUp',
    side: 'both',                   // evaluate both sides; fuse below
    primaryMetric: 'trunkAngleMin', // HUD shows worst (lower) trunk angle
    dwellMs: 120,
    refractoryMs: 300,

    // Time-based (no targetMs here—engine will get it dynamically)
    mode: 'time',
    time: {
        accumulate: true,   // allow re-entries to add up
        graceMs: 300        // brief dips allowed
        // targetPhase defaults to rep.to ("straight")
    },
  
    // “Straight” targets
    standKneeUp: 170,               // knees ~extended
    standTrunkUp: 170,              // hip in line with shoulder/ankle (≈upright)
    standHipOverAnkleMax: 0.10,     // hips stacked over ankles (normalized)
  
    // “Not-straight” indicators
    slumpKnee: 160,                 // noticeable knee flexion
    slumpTrunk: 165,                // trunk not fully upright
    slumpHipOverAnkleMax: 0.15,     // hips too far behind/ahead
  
    phases: [
      {
        id: 'not_straight',
        enter:
          "(Number.isFinite(kneeAngleMin) && kneeAngleMin < slumpKnee) || " +
          "(Number.isFinite(trunkAngleMin) && trunkAngleMin < slumpTrunk) || " +
          "(Number.isFinite(hipAnkleDxNormMax) && hipAnkleDxNormMax > slumpHipOverAnkleMax)"
      },
      {
        id: 'straight',
        enter:
          "( (!Number.isFinite(kneeAngleMax)        || kneeAngleMax        >= standKneeUp) && " +
          "  (!Number.isFinite(trunkAngleMin)       || trunkAngleMin       >= standTrunkUp) && " +
          "  (!Number.isFinite(hipAnkleDxNormMax)   || hipAnkleDxNormMax   <= standHipOverAnkleMax) )"
      },
    ],
  
    // Count the correction (stand tall)
    rep: { from: 'not_straight', to: 'straight' },
  
    feedback: [
      // Straight (target) -> green
      { when: "phase=='straight'", say: 'Upright - Hold steady',
        highlight: ({ setHighlight }) =>
          setHighlight({
            keypoints: ['left_shoulder','left_hip','left_knee','left_ankle',
                        'right_shoulder','right_hip','right_knee','right_ankle'],
            color: '#66FF00'
          })
      },
      // Not straight (needs correction) -> red
      { when: "phase=='not_straight'", say: 'Stand tall',
        highlight: ({ setHighlight }) =>
          setHighlight({
            keypoints: ['left_shoulder','left_hip','left_knee','left_ankle',
                        'right_shoulder','right_hip','right_knee','right_ankle'],
            color: '#FF3B30'
          })
      },
      // Transition (neither straight nor not_straight) -> orange
      { when: "!(phase=='straight' || phase=='not_straight')", say: 'Keep going',
        highlight: ({ setHighlight }) =>
          setHighlight({
            keypoints: ['left_shoulder','left_hip','left_knee','left_ankle',
                        'right_shoulder','right_hip','right_knee','right_ankle'],
            color: '#FFB020'
          })
      },
      { when: "Number.isFinite(hipAnkleDxNormMax) && hipAnkleDxNormMax > 0.20",
        say: 'Bring hips over ankles'
      },
    ],
  
    // Compute both sides; fuse conservative metrics
    computeExtraFeatures: ({ kps, utils }) => {
      const sides = ['left','right'];
      const knee = {};         // knee extension angle: hip-knee-ankle
      const trunk = {};        // trunk angle: shoulder-hip-ankle (fallback to shoulder-hip-knee)
      const hipAnkleDxNorm = {}; // |hip.x-ankle.x| normalized by shoulder-hip
  
      for (const s of sides) {
        const hip      = utils.kp(kps, `${s}_hip`);
        const kneeKP   = utils.kp(kps, `${s}_knee`);
        const ankle    = utils.kp(kps, `${s}_ankle`);
        const shoulder = utils.kp(kps, `${s}_shoulder`);
  
        knee[s] =
          (utils.present(hip) && utils.present(kneeKP) && utils.present(ankle))
            ? utils.angle(hip, kneeKP, ankle)
            : NaN;
  
        trunk[s] =
          (utils.present(shoulder) && utils.present(hip) && utils.present(ankle))
            ? utils.angle(shoulder, hip, ankle)
            : (utils.present(shoulder) && utils.present(hip) && utils.present(kneeKP))
                ? utils.angle(shoulder, hip, kneeKP)
                : NaN;
  
        hipAnkleDxNorm[s] =
          (utils.present(hip) && utils.present(ankle) && utils.present(shoulder))
            ? Math.abs(hip.x - ankle.x) / Math.max(utils.calculateDistance(shoulder, hip), 1e-6)
            : NaN;
      }
  
      const finite = v => Number.isFinite(v);
      const knees   = [knee.left, knee.right].filter(finite);
      const trunks  = [trunk.left, trunk.right].filter(finite);
      const offsets = [hipAnkleDxNorm.left, hipAnkleDxNorm.right].filter(finite);
  
      const kneeAngleMin = knees.length ? Math.min(...knees) : NaN;
      const kneeAngleMax = knees.length ? Math.max(...knees) : NaN;
      const trunkAngleMin = trunks.length ? Math.min(...trunks) : NaN;
      const hipAnkleDxNormMax = offsets.length ? Math.max(...offsets) : NaN;
  
      return {
        kneeAngleL: knee.left,   kneeAngleR: knee.right,
        kneeAngleMin, kneeAngleMax,
        trunkAngleL: trunk.left, trunkAngleR: trunk.right,
        trunkAngleMin,
        hipAnkleDxNormL: hipAnkleDxNorm.left, hipAnkleDxNormR: hipAnkleDxNorm.right,
        hipAnkleDxNormMax,
      };
    },
  };

// Smooth color transitions with a short orange hold to avoid flicker across micro dips.
StandingStraightUp.highlights = function ({ setHighlight, features }) {
  const pts = ['left_shoulder','left_hip','left_knee','left_ankle',
               'right_shoulder','right_hip','right_knee','right_ankle'];

  const {
    kneeAngleMin, kneeAngleMax,
    trunkAngleMin,
    hipAnkleDxNormMax,
    standKneeUp = StandingStraightUp.standKneeUp,
    standTrunkUp = StandingStraightUp.standTrunkUp,
    standHipOverAnkleMax = StandingStraightUp.standHipOverAnkleMax,
    slumpKnee = StandingStraightUp.slumpKnee,
    slumpTrunk = StandingStraightUp.slumpTrunk,
    slumpHipOverAnkleMax = StandingStraightUp.slumpHipOverAnkleMax,
  } = features;

  const f = (v) => Number.isFinite(v);
  const isNotStraight = (f(kneeAngleMin) && kneeAngleMin < slumpKnee) ||
                        (f(trunkAngleMin) && trunkAngleMin < slumpTrunk) ||
                        (f(hipAnkleDxNormMax) && hipAnkleDxNormMax > slumpHipOverAnkleMax);
  const isStraight = (!f(kneeAngleMax)      || kneeAngleMax      >= standKneeUp) &&
                     (!f(trunkAngleMin)     || trunkAngleMin     >= standTrunkUp) &&
                     (!f(hipAnkleDxNormMax) || hipAnkleDxNormMax <= standHipOverAnkleMax);

  let desired;
  if (isNotStraight) desired = '#FF3B30';        // red when not straight
  else if (isStraight) desired = '#66FF00';      // green when straight
  else desired = '#FFB020';                      // orange in transition

  if (!this._hl) this._hl = { lastColor: null, lastTs: 0 };
  const now = Date.now();
  const HOLD_MS = 250;
  const { lastColor, lastTs } = this._hl;
  if (lastColor === '#FFB020' && now - lastTs < HOLD_MS) desired = '#FFB020';
  if (desired !== lastColor) { this._hl.lastColor = desired; this._hl.lastTs = now; }

  setHighlight({ keypoints: pts, color: desired });
};

export default StandingStraightUp;