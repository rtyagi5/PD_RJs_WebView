// ---------------------------------------------
// dtw/specToReference.js
// Converts hand-coded exercise specs into DTW reference JSON objects.
// Generates synthetic template frames by sweeping primary features
// through their expected ranges during a rep cycle.
// ---------------------------------------------
import { computeFeatureRanges } from './referenceSchema.js';

/**
 * Generate a synthetic reference from an exercise mapping config.
 *
 * @param {Object} config - Exercise-specific mapping configuration
 * @param {string} config.name - Exercise name (must match registry key)
 * @param {string} config.mode - 'rep' | 'time'
 * @param {string} config.side - 'both' | 'left' | 'right' | 'alternating'
 * @param {string} config.detector - 'movenet' | 'mediapipe'
 * @param {Array}  config.phases - Phase definitions with feature sweeps
 * @param {Object} config.repCycle - { start, effort, return } or legacy { from, to }
 * @param {Object} config.feedback - Feedback config (phase, form, range, tempo)
 * @param {Object} [config.timing] - Timing overrides
 * @param {Object} [config.staticFeatures] - Features that stay constant (e.g. trunk angle for posture)
 * @param {number} [config.templateLength] - Frames per template (default 60)
 * @returns {Object} Reference JSON
 */
export function generateReference(config) {
  const templateLength = config.templateLength || 60;
  const phases = config.phases;

  // Calculate total "weight" for proportional phase sizing
  const totalWeight = phases.reduce((s, p) => s + (p.weight || 1), 0);

  // Build template frames
  const template = [];
  let frameIdx = 0;

  for (const phaseDef of phases) {
    const phaseFrames = Math.round(templateLength * (phaseDef.weight || 1) / totalWeight);

    for (let i = 0; i < phaseFrames && frameIdx < templateLength; i++) {
      const t = phaseFrames > 1 ? i / (phaseFrames - 1) : 0; // 0..1 within this phase
      const features = {};

      // Sweep primary features from start to end values
      if (phaseDef.features) {
        for (const [key, sweep] of Object.entries(phaseDef.features)) {
          if (typeof sweep === 'object' && 'from' in sweep && 'to' in sweep) {
            // Interpolate with optional easing
            const eased = sweep.easing === 'sine'
              ? 0.5 - 0.5 * Math.cos(Math.PI * t)
              : t; // linear
            features[key] = sweep.from + eased * (sweep.to - sweep.from);
          } else if (typeof sweep === 'number') {
            features[key] = sweep; // constant
          }
        }
      }

      // Apply static features (e.g. trunk stays ~170° throughout)
      if (config.staticFeatures) {
        for (const [key, val] of Object.entries(config.staticFeatures)) {
          if (!(key in features)) features[key] = val;
        }
      }

      // Mirror L/R for bilateral and alternating exercises
      // (universalFeatures always produces side-specific keys like hipAngleL/R)
      if (config.side === 'both' || config.side === 'alternating' || !config.side) {
        mirrorFeatures(features);
      }

      template.push({
        frame: frameIdx,
        features,
        phase: phaseDef.id,
      });

      frameIdx++;
    }
  }

  // Fill remaining frames if rounding left us short
  while (template.length < templateLength) {
    const last = template[template.length - 1];
    template.push({ ...last, frame: template.length });
  }

  const featureRanges = computeFeatureRanges(template);

  return {
    name: config.name,
    side: config.side || 'both',
    mode: config.mode || 'rep',
    detector: config.detector || 'movenet',
    template,
    featureRanges,
    repCycle: config.repCycle,
    feedback: config.feedback || { phase: {} },
    highlightKeypoints: config.highlightKeypoints || null,
    minRomPct: config.minRomPct ?? null,
    primaryFeature: config.primaryFeature || null,
    startCue: config.startCue || null,
    framing: config.framing || null,
    timing: {
      fps: 30,
      repDurationMs: config.timing?.repDurationMs || 2000,
      dwellMs: config.timing?.dwellMs || 100,
      refractoryMs: config.timing?.refractoryMs || 300,
      matchThreshold: config.timing?.matchThreshold || 0.45,
      ...(config.timing || {}),
    },
  };
}

/**
 * Mirror single-sided features to both L and R.
 * If features contain a key without L/R suffix but a bilateral version exists,
 * copy the value to both sides.
 */
function mirrorFeatures(features) {
  const bilateral = [
    ['shoulderAngle', 'shoulderAngleL', 'shoulderAngleR', 'shoulderAngleMin'],
    ['elbowAngle', 'elbowAngleL', 'elbowAngleR', 'elbowAngleMin'],
    ['hipAngle', 'hipAngleL', 'hipAngleR', 'hipAngleMin'],
    ['kneeAngle', 'kneeAngleL', 'kneeAngleR', 'kneeAngleMin'],
    ['trunkAngle', 'trunkAngleL', 'trunkAngleR', 'trunkAngleMin'],
    ['ankleAngleToe', 'ankleAngleToeL', 'ankleAngleToeR'],
    ['ankleAngleHeel', 'ankleAngleHeelL', 'ankleAngleHeelR'],
    ['wristHeightNorm', 'wristHeightNormL', 'wristHeightNormR'],
    ['kneeLiftNorm', 'kneeLiftNormL', 'kneeLiftNormR', 'kneeLiftNormMax'],
    ['footPitchNorm', 'footPitchNormL', 'footPitchNormR', 'footPitchNormAvg'],
    ['hipToAnkleNorm', 'hipToAnkleNormL', 'hipToAnkleNormR'],
  ];

  for (const [generic, left, right, agg] of bilateral) {
    if (generic in features) {
      const val = features[generic];
      features[left] = val;
      features[right] = val;
      if (agg) features[agg] = val;
      delete features[generic];
    }
  }
}

// ─── Exercise-specific configurations ────────────────────

export const EXERCISE_CONFIGS = {
  SideArmRaise: {
    name: 'SideArmRaise',
    mode: 'rep',
    side: 'both',
    detector: 'movenet',
    framing: { view: 'front', instruction: 'Face the camera, full upper body in frame' },
    startCue: {
      left: 'Raise your left arm out to the side',
      right: 'Raise your right arm out to the side',
      both: 'Raise both arms out to the sides',
    },
    highlightKeypoints: ['shoulder', 'elbow', 'wrist'],
    phases: [
      {
        id: 'lowered', weight: 1,
        features: {
          shoulderAngle: { from: 30, to: 30 },
          elbowAngle: { from: 160, to: 160 },
        },
      },
      {
        id: 'transition_up', weight: 2,
        features: {
          shoulderAngle: { from: 30, to: 150, easing: 'sine' },
          elbowAngle: { from: 160, to: 155 },
        },
      },
      {
        id: 'raised', weight: 1,
        features: {
          shoulderAngle: { from: 150, to: 150 },
          elbowAngle: { from: 155, to: 155 },
        },
      },
      {
        id: 'transition_down', weight: 2,
        features: {
          shoulderAngle: { from: 150, to: 30, easing: 'sine' },
          elbowAngle: { from: 155, to: 160 },
        },
      },
    ],
    repCycle: { from: 'lowered', to: 'raised' },
    staticFeatures: { trunkAngle: 172, kneeAngle: 175, hipAngle: 170 },
    feedback: {
      phase: {
        lowered: 'Raise your arm out to the side',
        transition_up: 'Keep going',
        raised: 'Good — lower slowly',
        transition_down: 'Lower slowly',
      },
      form: [{ bodyPart: 'trunk', say: 'Keep your back straight' }],
      range: { tooLittle: 'Try to raise a bit higher', tooMuch: "That's high enough" },
      tempo: { tooFast: 'Slow down, control the movement' },
    },
  },

  BicepCurls: {
    name: 'BicepCurls',
    mode: 'rep',
    side: 'both',
    detector: 'movenet',
    framing: { view: 'front', instruction: 'Face the camera, arms visible at your sides' },
    startCue: {
      left: 'Curl your left arm up toward your shoulder',
      right: 'Curl your right arm up toward your shoulder',
      both: 'Curl your arms up toward your shoulders',
    },
    // Higher than default 0.25 — wrist keypoint is the noisiest in the upper-body chain,
    // and a few-pixel jitter swings elbowAngle 20-30°. Tighter ROM gate prevents
    // single-spike false reps. 0.40 still allows a half-curl (~42° ROM) to count.
    minRomPct: 0.40,
    highlightKeypoints: ['shoulder', 'elbow', 'wrist'],
    phases: [
      {
        id: 'lowered', weight: 1,
        features: { elbowAngle: { from: 158, to: 158 } },
      },
      {
        id: 'curling', weight: 2,
        features: { elbowAngle: { from: 158, to: 52, easing: 'sine' } },
      },
      {
        id: 'raised', weight: 1,
        features: { elbowAngle: { from: 52, to: 52 } },
      },
      {
        id: 'lowering', weight: 2,
        features: { elbowAngle: { from: 52, to: 158, easing: 'sine' } },
      },
    ],
    repCycle: { from: 'lowered', to: 'raised' },
    staticFeatures: { trunkAngle: 172, shoulderAngle: 25, kneeAngle: 175 },
    feedback: {
      phase: { lowered: 'Curl your arm up', raised: 'Nice — lower slowly with control' },
      form: [
        { bodyPart: 'back', say: 'Keep your back straight' },
        { bodyPart: 'shoulder', say: "Don't shrug your shoulders" },
      ],
      range: { tooLittle: 'Try to curl a bit higher' },
      tempo: { tooFast: 'Slow down, control the movement' },
    },
  },

  MiniSquats: {
    name: 'MiniSquats',
    mode: 'rep',
    side: 'both',
    detector: 'movenet',
    // Side-facing gives a much cleaner kneeAngle measurement (knee moves in the camera plane,
    // not toward/away from it). Either side toward camera is fine — primary is kneeAngleMin
    // which falls back to whichever knee is visible (see minF in universalFeatures.js).
    framing: { view: 'side', instruction: 'Stand sideways to the camera, either side OK' },
    startCue: 'Begin squatting — bend your knees',
    // Track the more-bent knee so either side facing the camera works. minF returns the
    // visible knee when the other is occluded (NaN), giving graceful degradation.
    primaryFeature: 'kneeAngleMin',
    // Knee keypoint can jump when occluded by torso; require a clear squat (>20°)
    minRomPct: 0.40,
    highlightKeypoints: ['hip', 'knee', 'ankle'],
    phases: [
      {
        id: 'standing', weight: 1,
        features: { kneeAngle: { from: 170, to: 170 }, hipToAnkleNorm: { from: 2.0, to: 2.0 } },
      },
      {
        id: 'lowering', weight: 2,
        features: { kneeAngle: { from: 170, to: 120, easing: 'sine' }, hipToAnkleNorm: { from: 2.0, to: 1.6 } },
      },
      {
        id: 'squatting', weight: 1,
        features: { kneeAngle: { from: 120, to: 120 }, hipToAnkleNorm: { from: 1.6, to: 1.6 } },
      },
      {
        id: 'rising', weight: 2,
        features: { kneeAngle: { from: 120, to: 170, easing: 'sine' }, hipToAnkleNorm: { from: 1.6, to: 2.0 } },
      },
    ],
    repCycle: { from: 'standing', to: 'squatting' },
    staticFeatures: { trunkAngle: 165, shoulderAngle: 20 },
    feedback: {
      phase: { standing: 'Bend your knees to squat', squatting: 'Good — stand back up' },
      form: [{ bodyPart: 'back', say: 'Keep your back straight' }, { bodyPart: 'knee', say: 'Keep knees over toes' }],
      range: { tooLittle: 'Try to squat a bit deeper' },
      tempo: { tooFast: 'Slow down' },
    },
  },

  SitToStand: {
    name: 'SitToStand',
    mode: 'rep',
    side: 'both',
    detector: 'movenet',
    framing: { view: 'front', instruction: 'Face the camera, chair and full body visible' },
    startCue: 'Stand up from the chair',
    highlightKeypoints: ['hip', 'knee', 'ankle'],
    phases: [
      {
        id: 'seated', weight: 1,
        features: { kneeAngle: { from: 90, to: 90 }, hipToAnkleNorm: { from: 1.2, to: 1.2 } },
      },
      {
        id: 'rising', weight: 2,
        features: { kneeAngle: { from: 90, to: 165, easing: 'sine' }, hipToAnkleNorm: { from: 1.2, to: 2.0 } },
      },
      {
        id: 'standing', weight: 1,
        features: { kneeAngle: { from: 165, to: 165 }, hipToAnkleNorm: { from: 2.0, to: 2.0 } },
      },
      {
        id: 'sitting', weight: 2,
        features: { kneeAngle: { from: 165, to: 90, easing: 'sine' }, hipToAnkleNorm: { from: 2.0, to: 1.2 } },
      },
    ],
    repCycle: { from: 'seated', to: 'standing' },
    staticFeatures: { trunkAngle: 160 },
    feedback: {
      phase: { seated: 'Stand up', standing: 'Good — sit back down slowly' },
      form: [{ bodyPart: 'back', say: 'Keep your back straight as you rise' }],
      range: { tooLittle: 'Try to stand up fully' },
      tempo: { tooFast: 'Slow and controlled' },
    },
  },

  LongArcQuad: {
    name: 'LongArcQuad',
    mode: 'rep',
    side: 'both',
    detector: 'movenet',
    framing: { view: 'side', instruction: 'Sit sideways to the camera, exercising leg toward the camera' },
    startCue: {
      left: 'Straighten your left leg out in front',
      right: 'Straighten your right leg out in front',
      both: 'Straighten your leg out in front',
    },
    highlightKeypoints: ['hip', 'knee', 'ankle'],
    phases: [
      {
        id: 'flexed', weight: 1,
        features: { kneeAngle: { from: 90, to: 90 }, hipToAnkleNorm: { from: 1.2, to: 1.2 } },
      },
      {
        id: 'extending', weight: 2,
        features: { kneeAngle: { from: 90, to: 165, easing: 'sine' }, hipToAnkleNorm: { from: 1.2, to: 1.9 } },
      },
      {
        id: 'extended', weight: 1,
        features: { kneeAngle: { from: 165, to: 165 }, hipToAnkleNorm: { from: 1.9, to: 1.9 } },
      },
      {
        id: 'flexing', weight: 2,
        features: { kneeAngle: { from: 165, to: 90, easing: 'sine' }, hipToAnkleNorm: { from: 1.9, to: 1.2 } },
      },
    ],
    repCycle: { from: 'flexed', to: 'extended' },
    staticFeatures: { trunkAngle: 160, hipAngle: 90 },
    feedback: {
      phase: { flexed: 'Straighten your leg', extended: 'Good — bend slowly' },
      form: [{ bodyPart: 'back', say: 'Sit tall' }],
      range: { tooLittle: 'Try to straighten more' },
      tempo: { tooFast: 'Slow down' },
    },
  },

  SeatedMarch: {
    name: 'SeatedMarch',
    mode: 'rep',
    side: 'alternating',
    // Bumped from 0.35 — first-set double-counts traced to hipAngle drift during calibration.
    minRomPct: 0.50,
    detector: 'movenet',
    framing: { view: 'front', instruction: 'Face the camera, both legs visible' },
    startCue: 'Lift your knees one at a time, alternating',
    highlightKeypoints: ['hip', 'knee', 'ankle'],
    phases: [
      {
        id: 'resting', weight: 1,
        features: { kneeLiftNorm: { from: 0, to: 0 }, hipAngle: { from: 90, to: 90 } },
      },
      {
        id: 'lifting', weight: 2,
        features: { kneeLiftNorm: { from: 0, to: 0.25, easing: 'sine' }, hipAngle: { from: 90, to: 70 } },
      },
      {
        id: 'lifted', weight: 1,
        features: { kneeLiftNorm: { from: 0.25, to: 0.25 }, hipAngle: { from: 70, to: 70 } },
      },
      {
        id: 'lowering', weight: 2,
        features: { kneeLiftNorm: { from: 0.25, to: 0, easing: 'sine' }, hipAngle: { from: 70, to: 90 } },
      },
    ],
    repCycle: { from: 'resting', to: 'lifted' },
    staticFeatures: { trunkAngle: 168 },
    feedback: {
      phase: { resting: 'Lift your knee', lifted: 'Good — lower slowly' },
      form: [{ bodyPart: 'trunk', say: 'Sit tall, no leaning' }],
      range: { tooLittle: 'Try to lift a bit higher' },
      tempo: { tooFast: 'Slow and steady' },
    },
  },

  StandingMarch: {
    name: 'StandingMarch',
    mode: 'rep',
    side: 'alternating',
    minRomPct: 0.35, // Require 35% of hipAngle range (~38°) to reject settling noise at exercise start
    detector: 'movenet',
    framing: { view: 'front', instruction: 'Face the camera, full body visible' },
    startCue: 'March in place, lifting knees alternately',
    highlightKeypoints: ['hip', 'knee', 'ankle'],
    phases: [
      {
        id: 'resting', weight: 1,
        features: { kneeLiftNorm: { from: 0, to: 0 }, hipAngle: { from: 170, to: 170 } },
      },
      {
        id: 'lifting', weight: 2,
        features: { kneeLiftNorm: { from: 0, to: 0.3, easing: 'sine' }, hipAngle: { from: 170, to: 60 } },
      },
      {
        id: 'lifted', weight: 1,
        features: { kneeLiftNorm: { from: 0.3, to: 0.3 }, hipAngle: { from: 60, to: 60 } },
      },
      {
        id: 'lowering', weight: 2,
        features: { kneeLiftNorm: { from: 0.3, to: 0, easing: 'sine' }, hipAngle: { from: 60, to: 170 } },
      },
    ],
    repCycle: { from: 'resting', to: 'lifted' },
    staticFeatures: { trunkAngle: 172, kneeAngle: 170 },
    feedback: {
      phase: { resting: 'March — lift your knee', lifted: 'Good — lower your foot' },
      form: [{ bodyPart: 'trunk', say: 'Stand tall' }],
      range: { tooLittle: 'Lift your knee higher' },
      tempo: { tooFast: 'Slow and controlled' },
    },
  },

  MiniLunges: {
    name: 'MiniLunges',
    mode: 'rep',
    side: 'both',
    detector: 'movenet',
    // Mobile body-weight shift during a R-lunge contaminates the L knee keypoint by
    // 15-25°, crossing the default 15° gate and double-counting alternating lunges.
    // 0.45 raises the gate to 27°, comfortably above the contamination band while
    // still allowing real partial lunges (range is 60°).
    minRomPct: 0.45,
    framing: { view: 'side', instruction: 'Stand sideways to the camera, lead leg toward the camera' },
    startCue: {
      left: 'Step forward with your left leg into a lunge',
      right: 'Step forward with your right leg into a lunge',
      both: 'Step forward into a lunge — use the same leg for every rep',
    },
    highlightKeypoints: ['hip', 'knee', 'ankle'],
    phases: [
      {
        id: 'standing', weight: 1,
        features: { kneeAngle: { from: 170, to: 170 } },
      },
      {
        id: 'lunging', weight: 2,
        features: { kneeAngle: { from: 170, to: 110, easing: 'sine' } },
      },
      {
        id: 'lunged', weight: 1,
        features: { kneeAngle: { from: 110, to: 110 } },
      },
      {
        id: 'rising', weight: 2,
        features: { kneeAngle: { from: 110, to: 170, easing: 'sine' } },
      },
    ],
    repCycle: { from: 'standing', to: 'lunged' },
    staticFeatures: { trunkAngle: 172 },
    feedback: {
      phase: { standing: 'Step forward and bend', lunged: 'Good — push back up' },
      form: [{ bodyPart: 'back', say: 'Keep your back upright' }, { bodyPart: 'knee', say: 'Knee over ankle, not past toes' }],
      range: { tooLittle: 'Bend a little deeper' },
      tempo: { tooFast: 'Slow and controlled' },
    },
  },

  LiftsAndChops: {
    name: 'LiftsAndChops',
    mode: 'rep',
    side: 'both',
    detector: 'movenet',
    framing: { view: 'front', instruction: 'Face the camera, full upper body in frame' },
    startCue: 'Lift hands up across your body, then chop down',
    // Wrist-derived feature is jittery on mobile. 0.55 tightens nearStart band so
    // rep counts closer to actual bottom (not mid-descent), and raises the bar
    // for re-entering sawEffort from a bouncy descent.
    minRomPct: 0.55,
    // 500ms refractory blocks within-cycle double-counts even if a bounce sneaks
    // past the ROM gate. Lift-chop cycles are ~1-2s so this doesn't block real reps.
    timing: { refractoryMs: 500 },
    highlightKeypoints: ['shoulder', 'elbow', 'wrist'],
    phases: [
      {
        id: 'low', weight: 1,
        features: { handsHeightNorm: { from: 0.1, to: 0.1 }, handsXNorm: { from: -0.3, to: -0.3 } },
      },
      {
        id: 'lifting', weight: 2,
        features: { handsHeightNorm: { from: 0.1, to: 0.9, easing: 'sine' }, handsXNorm: { from: -0.3, to: 0.3 } },
      },
      {
        id: 'high', weight: 1,
        features: { handsHeightNorm: { from: 0.9, to: 0.9 }, handsXNorm: { from: 0.3, to: 0.3 } },
      },
      {
        id: 'chopping', weight: 2,
        features: { handsHeightNorm: { from: 0.9, to: 0.1, easing: 'sine' }, handsXNorm: { from: 0.3, to: -0.3 } },
      },
    ],
    repCycle: { from: 'low', to: 'high' },
    staticFeatures: { trunkAngle: 170, kneeAngle: 168 },
    feedback: {
      phase: { low: 'Lift hands up and across', high: 'Good — chop back down' },
      form: [{ bodyPart: 'back', say: 'Keep core engaged' }],
      range: { tooLittle: 'Reach a bit higher' },
      tempo: { tooFast: 'Slow and controlled' },
    },
  },

  StepUps: {
    name: 'StepUps',
    mode: 'rep',
    side: 'both',
    detector: 'movenet',
    framing: { view: 'diagonal', instruction: 'Stand at a 45° angle to the camera, step toward you' },
    startCue: {
      left: 'Step up leading with your left leg, then step back down',
      right: 'Step up leading with your right leg, then step back down',
      both: 'Step up onto the step, then step back down',
    },
    // Knee/ankle keypoints can spike when occluded by the step itself.
    minRomPct: 0.40,
    // One full step-up rep = up + down. The knee bends DEEPLY twice per rep (lifting
    // up, lowering back) — without this guard the engine counts each bend as a separate
    // rep. 2500ms covers the step-down duration for typical pacing. Combined with the
    // block-and-reset behavior in DTWPhaseMachine, the down-motion's "rep" is absorbed.
    timing: { refractoryMs: 2500 },
    highlightKeypoints: ['hip', 'knee', 'ankle'],
    phases: [
      {
        id: 'ground', weight: 1,
        features: { kneeAngle: { from: 170, to: 170 }, kneeLiftNorm: { from: 0, to: 0 } },
      },
      {
        id: 'stepping_up', weight: 2,
        features: { kneeAngle: { from: 170, to: 120, easing: 'sine' }, kneeLiftNorm: { from: 0, to: 0.15 } },
      },
      {
        id: 'up', weight: 1,
        features: { kneeAngle: { from: 120, to: 165 }, kneeLiftNorm: { from: 0.15, to: 0.2 } },
      },
      {
        id: 'stepping_down', weight: 2,
        features: { kneeAngle: { from: 165, to: 170, easing: 'sine' }, kneeLiftNorm: { from: 0.2, to: 0 } },
      },
    ],
    repCycle: { from: 'ground', to: 'up' },
    staticFeatures: { trunkAngle: 170 },
    feedback: {
      phase: { ground: 'Step up onto the step', up: 'Good — step back down' },
      form: [{ bodyPart: 'back', say: 'Stay upright' }, { bodyPart: 'knee', say: 'Control the descent' }],
      range: { tooLittle: 'Push all the way up' },
      tempo: { tooFast: 'Slow and steady' },
    },
  },

  WallPushUp: {
    name: 'WallPushUp',
    mode: 'rep',
    side: 'both',
    detector: 'movenet',
    framing: { view: 'side', instruction: 'Stand sideways to the camera, facing the wall' },
    startCue: 'Lower your chest toward the wall, then push back',
    highlightKeypoints: ['shoulder', 'elbow', 'wrist'],
    phases: [
      {
        id: 'extended', weight: 1,
        features: { elbowAngle: { from: 165, to: 165 }, shoulderAngle: { from: 50, to: 50 } },
      },
      {
        id: 'lowering', weight: 2,
        features: { elbowAngle: { from: 165, to: 90, easing: 'sine' }, shoulderAngle: { from: 50, to: 40 } },
      },
      {
        id: 'flexed', weight: 1,
        features: { elbowAngle: { from: 90, to: 90 }, shoulderAngle: { from: 40, to: 40 } },
      },
      {
        id: 'pushing', weight: 2,
        features: { elbowAngle: { from: 90, to: 165, easing: 'sine' }, shoulderAngle: { from: 40, to: 50 } },
      },
    ],
    repCycle: { from: 'extended', to: 'flexed' },
    staticFeatures: { trunkAngle: 168, kneeAngle: 175 },
    feedback: {
      phase: { extended: 'Bend your elbows toward the wall', flexed: 'Push back out' },
      form: [{ bodyPart: 'back', say: 'Keep body straight — no sagging' }],
      range: { tooLittle: 'Try bending a bit more' },
      tempo: { tooFast: 'Slow and controlled' },
    },
  },

  CalfRaisesSeated: {
    name: 'CalfRaisesSeated',
    mode: 'rep',
    side: 'both',
    detector: 'mediapipe',
    // Critical: place the active foot in FRONT of the chair, not beside a chair leg.
    // MediaPipe routinely mistakes vertical chair legs for foot_index/heel keypoints,
    // which causes wild ankle-angle swings and false reps.
    framing: { view: 'side', instruction: 'Sit at the edge of the chair, active foot in front of you (NOT next to chair leg)' },
    startCue: 'Push up onto your toes, then lower your heels',
    // 0.65 + dwell tightens the gate. Real calf raise sweeps ankleAngleToe ~20°,
    // so 13° threshold (was 10°) still allows partial reps but rejects more chair-leg noise.
    minRomPct: 0.65,
    // 400ms dwell requires sustained phase positioning, filtering transient glitches.
    timing: { dwellMs: 400 },
    highlightKeypoints: ['knee', 'ankle', 'heel', 'foot_index'],
    // footPitchNorm = (toe.y - heel.y) / shankLen directly measures heel elevation.
    // For a seated calf raise, the foot pivots around the toe — the ankle joint barely
    // flexes (so ankleAngle features were producing only 5-15° of real change despite
    // 50° template assumptions). footPitchNorm captures the actual physical motion
    // (heel rising above toe level) and produces opposite signs for calf raise (POSITIVE)
    // vs dorsiflexion (NEGATIVE) — combined with direction-aware movedEnough it cleanly
    // discriminates the two motions and rejects body-translation noise.
    phases: [
      {
        id: 'lowered', weight: 1,
        features: { footPitchNorm: { from: 0.0, to: 0.0 } },
      },
      {
        id: 'raising', weight: 2,
        features: { footPitchNorm: { from: 0.0, to: 0.12, easing: 'sine' } },
      },
      {
        id: 'raised', weight: 1,
        features: { footPitchNorm: { from: 0.12, to: 0.12 } },
      },
      {
        id: 'lowering', weight: 2,
        features: { footPitchNorm: { from: 0.12, to: 0.0, easing: 'sine' } },
      },
    ],
    repCycle: { from: 'lowered', to: 'raised' },
    staticFeatures: { kneeAngle: 90, hipAngle: 90, trunkAngle: 168 },
    feedback: {
      phase: { lowered: 'Push up onto your toes', raised: 'Good — lower your heels slowly' },
      form: [{ bodyPart: 'back', say: 'Sit tall' }],
      range: { tooLittle: 'Try to push a bit higher' },
      tempo: { tooFast: 'Slow and controlled' },
    },
  },

  CalfRaisesStanding: {
    name: 'CalfRaisesStanding',
    mode: 'rep',
    side: 'both',
    detector: 'mediapipe',
    framing: { view: 'side', instruction: 'Stand sideways to the camera, exercising foot toward the camera' },
    startCue: 'Rise up onto your toes, then lower your heels slowly',
    // Same fix as the seated variant: ankleAngleToe template (88→68) doesn't match real
    // standing geometry — actual values land in the 100-130 range, way outside the template.
    // footPitchNorm directly measures heel elevation (0 flat → +0.12 on toes), independent
    // of body posture and stance, and produces opposite signs vs dorsiflexion/body-shift.
    minRomPct: 0.65,
    highlightKeypoints: ['knee', 'ankle', 'heel', 'foot_index'],
    phases: [
      {
        id: 'lowered', weight: 1,
        features: { footPitchNorm: { from: 0.0, to: 0.0 } },
      },
      {
        id: 'raising', weight: 2,
        features: { footPitchNorm: { from: 0.0, to: 0.12, easing: 'sine' } },
      },
      {
        id: 'raised', weight: 1,
        features: { footPitchNorm: { from: 0.12, to: 0.12 } },
      },
      {
        id: 'lowering', weight: 2,
        features: { footPitchNorm: { from: 0.12, to: 0.0, easing: 'sine' } },
      },
    ],
    repCycle: { from: 'lowered', to: 'raised' },
    staticFeatures: { kneeAngle: 175, hipAngle: 170, trunkAngle: 172 },
    feedback: {
      phase: { lowered: 'Rise up onto your toes', raised: 'Good — lower slowly' },
      form: [{ bodyPart: 'back', say: 'Stand tall' }, { bodyPart: 'knee', say: 'Keep knees straight' }],
      range: { tooLittle: 'Push a bit higher on your toes' },
      tempo: { tooFast: 'Slow and controlled' },
    },
  },

  SeatedDorsiflexion: {
    name: 'SeatedDorsiflexion',
    mode: 'rep',
    side: 'both',
    detector: 'mediapipe',
    // Critical: place the active foot in FRONT of the chair, not beside a chair leg.
    // MediaPipe routinely mistakes vertical chair legs for foot_index keypoints, which
    // causes wild footPitchNorm swings and false reps.
    framing: { view: 'side', instruction: 'Sit at the edge of the chair, active foot in front of you (NOT next to chair leg)' },
    startCue: {
      left: 'Pull your left toes up toward you, then lower',
      right: 'Pull your right toes up toward you, then lower',
      both: 'Pull your toes up toward you, then lower',
    },
    // 0.80 + dwell tightens the gate aggressively. footPitchNorm is the noisiest
    // feature in the system (only 2 keypoints, both prone to chair-leg / occlusion
    // confusion). Patient must dorsiflex ~80% of full range AND hold each phase
    // for 400ms — together these reject most spurious noise.
    minRomPct: 0.80,
    timing: { dwellMs: 400 },
    highlightKeypoints: ['knee', 'ankle', 'heel', 'foot_index'],
    phases: [
      {
        id: 'lowered', weight: 1,
        features: { footPitchNorm: { from: 0.12, to: 0.12 } },
      },
      {
        id: 'dorsiflexing', weight: 2,
        features: { footPitchNorm: { from: 0.12, to: -0.05, easing: 'sine' } },
      },
      {
        id: 'raised', weight: 1,
        features: { footPitchNorm: { from: -0.05, to: -0.05 } },
      },
      {
        id: 'lowering', weight: 2,
        features: { footPitchNorm: { from: -0.05, to: 0.12, easing: 'sine' } },
      },
    ],
    repCycle: { from: 'lowered', to: 'raised' },
    staticFeatures: { kneeAngle: 90, hipAngle: 90, trunkAngle: 168 },
    feedback: {
      phase: { lowered: 'Lift your toes up', raised: 'Nice — lower slowly' },
      form: [{ bodyPart: 'trunk', say: 'Sit tall' }],
      range: { tooLittle: 'Try to pull your toes up more' },
      tempo: { tooFast: 'Slow and controlled' },
    },
  },

  StandingDorsiflexion: {
    name: 'StandingDorsiflexion',
    mode: 'rep',
    side: 'both',
    detector: 'mediapipe',
    framing: { view: 'side', instruction: 'Stand sideways to the camera, exercising foot toward the camera, clear floor area' },
    startCue: {
      left: 'Pull your left toes up, keeping heel down',
      right: 'Pull your right toes up, keeping heel down',
      both: 'Pull your toes up, keeping heels down',
    },
    // 0.80 + dwell tightens the gate aggressively. Standing version is even more prone
    // to body-sway-induced auto-counting because micro-balance adjustments shift the
    // foot keypoints. Patient must dorsiflex ~80% of full range AND hold each phase
    // for 400ms — only sustained, deliberate motion counts.
    minRomPct: 0.80,
    timing: { dwellMs: 400 },
    highlightKeypoints: ['knee', 'ankle', 'heel', 'foot_index'],
    phases: [
      {
        id: 'lowered', weight: 1,
        features: { footPitchNorm: { from: 0.10, to: 0.10 } },
      },
      {
        id: 'dorsiflexing', weight: 2,
        features: { footPitchNorm: { from: 0.10, to: -0.04, easing: 'sine' } },
      },
      {
        id: 'raised', weight: 1,
        features: { footPitchNorm: { from: -0.04, to: -0.04 } },
      },
      {
        id: 'lowering', weight: 2,
        features: { footPitchNorm: { from: -0.04, to: 0.10, easing: 'sine' } },
      },
    ],
    repCycle: { from: 'lowered', to: 'raised' },
    staticFeatures: { kneeAngle: 170, hipAngle: 165, trunkAngle: 170 },
    feedback: {
      phase: { lowered: 'Lift your toes up', raised: 'Nice — lower slowly' },
      form: [{ bodyPart: 'trunk', say: 'Stand tall' }],
      range: { tooLittle: 'Pull your toes up more' },
      tempo: { tooFast: 'Slow and controlled' },
    },
  },

  StandingStraightUp: {
    name: 'StandingStraightUp',
    mode: 'time',
    side: 'both',
    detector: 'movenet',
    framing: { view: 'front', instruction: 'Face the camera, full body visible' },
    startCue: 'Stand tall — straight back, knees straight, hold the position',
    highlightKeypoints: ['shoulder', 'hip', 'knee', 'ankle'],
    phases: [
      {
        id: 'not_straight', weight: 1,
        features: { kneeAngle: { from: 150, to: 150 }, trunkAngle: { from: 155, to: 155 }, hipAngle: { from: 150, to: 150 } },
      },
      {
        id: 'straightening', weight: 1,
        features: { kneeAngle: { from: 150, to: 175 }, trunkAngle: { from: 155, to: 175 }, hipAngle: { from: 150, to: 175 } },
      },
      {
        id: 'straight', weight: 3,
        features: { kneeAngle: { from: 175, to: 175 }, trunkAngle: { from: 175, to: 175 }, hipAngle: { from: 175, to: 175 } },
      },
      {
        id: 'relaxing', weight: 1,
        features: { kneeAngle: { from: 175, to: 150 }, trunkAngle: { from: 175, to: 155 }, hipAngle: { from: 175, to: 150 } },
      },
    ],
    repCycle: { from: 'not_straight', to: 'straight' },
    staticFeatures: {},
    timing: { repDurationMs: 5000 },
    feedback: {
      phase: { not_straight: 'Stand up tall and straight', straight: 'Great — hold this position' },
      form: [{ bodyPart: 'back', say: 'Push your shoulders back' }, { bodyPart: 'knee', say: 'Straighten your knees' }],
      range: {},
      tempo: {},
    },
  },
};

/**
 * Generate all references from the exercise configs.
 * @returns {Object} Map of { exerciseName: referenceObject }
 */
export function generateAllReferences() {
  const refs = {};
  for (const [name, config] of Object.entries(EXERCISE_CONFIGS)) {
    refs[name] = generateReference(config);
  }
  return refs;
}
