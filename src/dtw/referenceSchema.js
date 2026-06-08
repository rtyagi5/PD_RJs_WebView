// ---------------------------------------------
// dtw/referenceSchema.js
// Reference JSON schema definition + validation + sample.
// Each exercise = one reference object stored as JSON.
// ---------------------------------------------

/**
 * Validates a reference object and returns { valid, errors }.
 * @param {Object} ref - The reference object to validate
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateReference(ref) {
  const errors = [];

  if (!ref) { return { valid: false, errors: ['Reference is null/undefined'] }; }
  if (!ref.name || typeof ref.name !== 'string') errors.push('Missing or invalid "name"');
  if (!['rep', 'time'].includes(ref.mode)) errors.push('"mode" must be "rep" or "time"');
  if (!Array.isArray(ref.template) || ref.template.length < 2) {
    errors.push('"template" must be an array with at least 2 frames');
  }

  // Template frames
  if (Array.isArray(ref.template)) {
    for (let i = 0; i < ref.template.length; i++) {
      const f = ref.template[i];
      if (!f || typeof f.features !== 'object') {
        errors.push(`template[${i}] missing "features" object`);
      }
      if (typeof f.phase !== 'string') {
        errors.push(`template[${i}] missing "phase" string`);
      }
    }
  }

  // Phases: must have at least 2 distinct phases for rep mode
  if (ref.mode === 'rep') {
    const phases = new Set((ref.template || []).map(f => f.phase));
    if (phases.size < 2) errors.push('Rep mode requires at least 2 distinct phases in template');

    const rc = ref.repCycle;
    const hasNewFormat = rc && rc.start && rc.effort;
    const hasLegacyFormat = rc && rc.from && rc.to;
    if (!hasNewFormat && !hasLegacyFormat) {
      errors.push('Rep mode requires "repCycle" with {start, effort, return} or legacy {from, to}');
    }
  }

  // Feedback: must have at least phase feedback
  if (!ref.feedback || !ref.feedback.phase || typeof ref.feedback.phase !== 'object') {
    errors.push('Missing "feedback.phase" object');
  }

  // Feature ranges (auto-computed, but validate if present)
  if (ref.featureRanges && typeof ref.featureRanges !== 'object') {
    errors.push('"featureRanges" must be an object if provided');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Compute feature ranges (min/max) from a template.
 * Used for normalization during DTW matching.
 * @param {Array} template - Array of { features: { ... } } frames
 * @returns {Object} { featureKey: { min, max, range } }
 */
export function computeFeatureRanges(template) {
  const ranges = {};
  for (const frame of template) {
    for (const [key, val] of Object.entries(frame.features)) {
      if (!Number.isFinite(val)) continue;
      if (!ranges[key]) ranges[key] = { min: val, max: val };
      else {
        ranges[key].min = Math.min(ranges[key].min, val);
        ranges[key].max = Math.max(ranges[key].max, val);
      }
    }
  }
  // Add range span
  for (const key of Object.keys(ranges)) {
    ranges[key].range = ranges[key].max - ranges[key].min;
  }
  return ranges;
}

/**
 * Extract distinct phases in order of first appearance from template.
 * @param {Array} template
 * @returns {string[]}
 */
export function extractPhaseOrder(template) {
  const seen = new Set();
  const order = [];
  for (const frame of template) {
    if (!seen.has(frame.phase)) {
      seen.add(frame.phase);
      order.push(frame.phase);
    }
  }
  return order;
}

/**
 * Sample reference JSON structure (for documentation).
 */
export const SAMPLE_REFERENCE = {
  name: 'BicepCurls',
  side: 'both',         // 'left' | 'right' | 'both' | 'alternating'
  mode: 'rep',           // 'rep' | 'time'
  detector: 'movenet',   // 'movenet' | 'mediapipe'

  // Movement pattern: one complete rep cycle
  // Each frame has universal features + phase label
  template: [
    { frame: 0,  features: { elbowAngleL: 158, elbowAngleR: 155, trunkAngleL: 172, trunkAngleR: 170 }, phase: 'lowered' },
    { frame: 15, features: { elbowAngleL: 110, elbowAngleR: 108, trunkAngleL: 171, trunkAngleR: 169 }, phase: 'transition' },
    { frame: 30, features: { elbowAngleL: 52,  elbowAngleR: 50,  trunkAngleL: 170, trunkAngleR: 168 }, phase: 'raised' },
    { frame: 45, features: { elbowAngleL: 105, elbowAngleR: 103, trunkAngleL: 171, trunkAngleR: 170 }, phase: 'transition' },
    { frame: 60, features: { elbowAngleL: 156, elbowAngleR: 154, trunkAngleL: 172, trunkAngleR: 170 }, phase: 'lowered' },
  ],

  // Auto-computed from template (min/max per feature)
  featureRanges: {
    elbowAngleL: { min: 52, max: 158, range: 106 },
    elbowAngleR: { min: 50, max: 155, range: 105 },
    trunkAngleL: { min: 170, max: 172, range: 2 },
    trunkAngleR: { min: 168, max: 170, range: 2 },
  },

  // Rep cycle definition
  repCycle: { start: 'lowered', effort: 'raised', return: 'lowered' },

  // PT-provided feedback (4 categories)
  feedback: {
    phase: {
      lowered: 'Curl your arm up',
      raised: 'Nice — lower slowly with control',
      transition: 'Keep going',
    },
    form: [
      { bodyPart: 'back', say: 'Keep your back straight' },
      { bodyPart: 'shoulder', say: "Don't shrug your shoulders" },
    ],
    range: {
      tooLittle: 'Try to curl a bit higher',
      tooMuch: "That's far enough",
    },
    tempo: {
      tooFast: 'Slow down, control the movement',
      holdCue: 'Hold at the top for a moment',
    },
  },

  // Timing metadata (extracted from reference video)
  timing: {
    fps: 30,
    repDurationMs: 2000,   // typical duration of one rep in reference
    dwellMs: 100,          // minimum time in a phase before transition
    refractoryMs: 300,     // cooldown after rep count
  },
};
