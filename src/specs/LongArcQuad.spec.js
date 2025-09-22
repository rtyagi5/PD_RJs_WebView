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
      // Hyperextension guardrail (red)
      { when: 'Number.isFinite(kneeAngle) && kneeAngle > laqAngleExtended', say: "Don't hyperextend",
        highlight: ({ setHighlight, features }) =>
          setHighlight({ keypoints: [`${features.side}_hip`,`${features.side}_knee`,`${features.side}_ankle`], color: '#FF3B30' })
      },
      // Extended (green)
      { when: "phase=='extended'", say: 'Extended - Lower slightly',
        highlight: ({ setHighlight, features }) =>
          setHighlight({ keypoints: [`${features.side}_hip`,`${features.side}_knee`,`${features.side}_ankle`], color: '#66FF00' })
      },
      // Transition (orange)
      { when: "!(phase=='flexed' || phase=='extended')", say: 'Keep going',
        highlight: ({ setHighlight, features }) =>
          setHighlight({ keypoints: [`${features.side}_hip`,`${features.side}_knee`,`${features.side}_ankle`], color: '#FFB020' })
      },
      // Flexed (green)
      { when: "phase=='flexed'",   say: 'Start Position - Extend your knee',
        highlight: ({ setHighlight, features }) =>
          setHighlight({ keypoints: [`${features.side}_hip`,`${features.side}_knee`,`${features.side}_ankle`], color: '#66FF00' })
      },
      // Optional guardrails
      { when: "!Number.isFinite(kneeAngle) && !Number.isFinite(hipToAnkleNorm)", say:  'Keep hip, knee and ankle visible' },
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
  
  // Smooth color transitions with a short orange hold to avoid flicker.
  LongArcQuad.highlights = function ({ setHighlight, features }) {
    const side = features.side || 'left';
    const angle = features.kneeAngle;
    const hipToAnkleNorm = features.hipToAnkleNorm;
    const pts = [`${side}_hip`,`${side}_knee`,`${side}_ankle`];

    const flexA = LongArcQuad.laqAngleFlexed;
    const extA  = LongArcQuad.laqAngleExtended;
    const flexD = LongArcQuad.laqDistFlexed;
    const extD  = LongArcQuad.laqDistExtended;

    // Determine states from either angle or distance fallback
    const finite = (v) => Number.isFinite(v);
    const isFlexed = (finite(angle) && angle <= flexA) || (!finite(angle) && finite(hipToAnkleNorm) && hipToAnkleNorm <= flexD);
    const isExtended = (finite(angle) && angle >= extA) || (!finite(angle) && finite(hipToAnkleNorm) && hipToAnkleNorm >= extD);

    let desired = '#66FF00'; // green default
    if (finite(angle) && angle > extA) desired = '#FF3B30'; // red when hyperextended
    else if (!isFlexed && !isExtended) desired = '#FFB020'; // orange in transition

    if (!this._hl) this._hl = { lastColor: null, lastTs: 0 };
    const now = Date.now();
    const HOLD_MS = 250;
    const { lastColor, lastTs } = this._hl;
    if (lastColor === '#FFB020' && now - lastTs < HOLD_MS) desired = '#FFB020';
    if (desired !== lastColor) { this._hl.lastColor = desired; this._hl.lastTs = now; }

    setHighlight({ keypoints: pts, color: desired });
  };
  
  export default LongArcQuad;
  