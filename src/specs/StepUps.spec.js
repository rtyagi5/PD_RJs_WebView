// ---------------------------------------------
// specs/StepUps.spec.js
// ---------------------------------------------
const StepUps = {
    name: 'StepUps',
    // Pick the leg from the UI (left/right). If "both", we’ll accept either leg.
    side: 'either',
    mode: 'rep',
    primaryMetric: 'ankleLiftNormLead', // how high the lead ankle is vs the other ankle
    dwellMs: 140,
    refractoryMs: 300,
  
    // Thresholds (tweak these for sensitivity)
    // "ankleLiftNorm" is normalized by lead leg length (hip–ankle).
    // 0.10–0.12 ≈ small step, 0.15–0.20 ≈ higher step.
    ankleLiftNormUp:   0.12,  // enter "raised" when lead ankle is clearly higher
    ankleLiftNormDown: 0.05,  // return to "lowered" when back near level
    kneeExtendedUp:    165,   // at the top, lead knee mostly straight
    kneeFlexedDown:    150,   // at the bottom, allow some flexion without flapping
  
    phases: [
      {
        id: 'lowered',
        enter:
          "(" +
          " (Number.isFinite(ankleLiftNormLead) && ankleLiftNormLead <= ankleLiftNormDown) ||" +
          " (Number.isFinite(kneeAngleLead) && kneeAngleLead <= kneeFlexedDown)" +
          ")"
      },
      {
        id: 'raised',
        enter:
          "(" +
          " (Number.isFinite(ankleLiftNormLead) && ankleLiftNormLead >= ankleLiftNormUp) &&" +
          " (!Number.isFinite(kneeAngleLead) || kneeAngleLead >= kneeExtendedUp)" +
          ")"
      },
    ],
  
    // Count when stepping up
    rep: { from: 'lowered', to: 'raised' },
  
    feedback: [
      {
        when: "phase=='lowered'",
        say: 'Step up',
        highlight: ({ setHighlight, features }) => {
          const s = features.side === 'right' ? 'right'
                : features.side === 'left'  ? 'left'
                : (features.ankleLiftNormL ?? 0) >= (features.ankleLiftNormR ?? 0) ? 'left' : 'right';
          setHighlight({ keypoints: [`${s}_hip`, `${s}_knee`, `${s}_ankle`], color: '#FFB020' });
        }
      },
      {
        when: "phase=='raised'",
        say: 'Stand tall',
        highlight: ({ setHighlight, features }) => {
          const s = features.side === 'right' ? 'right'
                : features.side === 'left'  ? 'left'
                : (features.ankleLiftNormL ?? 0) >= (features.ankleLiftNormR ?? 0) ? 'left' : 'right';
          setHighlight({ keypoints: [`${s}_hip`, `${s}_knee`, `${s}_ankle`], color: '#66FF00' });
        }
      },
    ],
  
    // Compute: knee angles per side; ankle height difference between legs (normalized)
    // We also expose "lead" versions (based on the requested side; or pick the higher one if side=='both').
    computeExtraFeatures: ({ kps, side, utils }) => {
      const sides = ['left', 'right'];
      const kneeAngle = {};
      const ankleLiftNorm = {}; // how much side's ankle is higher than the *other* ankle
  
      const kpOrNull = (n) => utils.kp(kps, n);
      const finite = (v) => Number.isFinite(v);
  
      // helpers
      const legLen = (s, hip, ankle) =>
        (utils.present(hip) && utils.present(ankle))
          ? Math.max(utils.calculateDistance(hip, ankle), 1e-6)
          : 1e-6;
  
      const K = {};
      for (const s of sides) {
        const hip   = kpOrNull(`${s}_hip`);
        const knee  = kpOrNull(`${s}_knee`);
        const ankle = kpOrNull(`${s}_ankle`);
  
        kneeAngle[s] =
          (utils.present(hip) && utils.present(knee) && utils.present(ankle))
            ? utils.angle(hip, knee, ankle)
            : NaN;
  
        // compare this side's ankle to the *other* ankle height
        const o = s === 'left' ? 'right' : 'left';
        const oAnkle = kpOrNull(`${o}_ankle`);
  
        const L = legLen(s, hip, ankle);
        // y grows downward; if our ankle is higher, (other.y - our.y) > 0
        ankleLiftNorm[s] =
          (utils.present(ankle) && utils.present(oAnkle))
            ? Math.max(0, oAnkle.y - ankle.y) / L
            : NaN;
      }
  
      // Lead selection for HUD/logic
      let lead = (side === 'left' || side === 'right') ? side : null;
      if (!lead) {
        // If 'both', pick whichever ankle is higher right now
        const l = ankleLiftNorm.left, r = ankleLiftNorm.right;
        if (finite(l) || finite(r)) {
          lead = (r > l) ? 'right' : 'left';
        } else {
          lead = 'left';
        }
      }
  
      const ankleLiftNormMax =
        [ankleLiftNorm.left, ankleLiftNorm.right].filter(finite).reduce((a, b) => Math.max(a, b), NaN);
  
      return {
        kneeAngleL: kneeAngle.left, kneeAngleR: kneeAngle.right,
        kneeAngleLead: lead === 'right' ? kneeAngle.right : kneeAngle.left,
  
        ankleLiftNormL: ankleLiftNorm.left, ankleLiftNormR: ankleLiftNorm.right,
        ankleLiftNormMax,
        ankleLiftNormLead: lead === 'right' ? ankleLiftNorm.right : ankleLiftNorm.left,
      };
    },
  };
  
  export default StepUps;
  