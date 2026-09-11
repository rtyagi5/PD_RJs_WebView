// ---------------------------------------------
// PoseQuality.js
// Pure functions for pre-exercise coaching checks:
//   distance, camera angle, keypoint visibility, lighting.
// No React dependencies — call from the detection loop.
// ---------------------------------------------

import { kp, present } from './features';

// ── Global defaults ──────────────────────────────────────────────────────────
export const IDEAL_BODY_RATIO   = 0.50;  // body height ≈ 50 % of frame height (calibrated for mobile, phone on table 3-5 ft away)
export const DISTANCE_TOL_CLOSE = 0.20;  // ratio > ideal + this → "too close"  (max: 0.70)
export const DISTANCE_TOL_FAR   = 0.30;  // ratio < ideal - this → "too far"    (min: 0.20 — allows normal standing distance)
export const MIN_CONFIDENCE     = 0.3;   // per-keypoint visibility threshold
export const LIGHTING_THRESHOLD = 0.25;
export const MAX_ROLL_DEG        = 12;   // camera tilt beyond this rejects the setup  // avg score below this → poor lighting
// Heel↔toe span may not exceed this fraction of shank length. Mirrors the
// footValid guard in dtw/universalFeatures.js so setup and runtime agree.
export const FOOT_SPAN_MAX_RATIO = 0.9;

// Which failing check the patient is told about first. Single source of truth:
// both the spoken/among-message selection (SessionStateMachine) and the on-canvas
// coaching text (CoachingOverlay) use this, so they can never disagree.
export const CHECK_PRIORITY = ['visibility', 'foot', 'distance', 'angle', 'lighting'];

// Default keypoints every exercise needs visible
const DEFAULT_REQUIRED_KPS = [
  'left_shoulder', 'right_shoulder',
  'left_hip', 'right_hip',
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// ── Check: Distance ──────────────────────────────────────────────────────────
// Measures apparent body height (nose → ankle midpoint) relative to frame height.
// Returns { status: 'good'|'too_close'|'too_far'|'unknown', message, ratio }

export function checkDistance(keypoints, frameW, frameH, overrides = {}) {
  const ideal = overrides.idealBodyRatio ?? IDEAL_BODY_RATIO;
  const tolClose = overrides.distanceToleranceClose ?? DISTANCE_TOL_CLOSE;
  const tolFar   = overrides.distanceToleranceFar   ?? DISTANCE_TOL_FAR;

  const nose   = kp(keypoints, 'nose');
  const lAnkle = kp(keypoints, 'left_ankle');
  const rAnkle = kp(keypoints, 'right_ankle');

  // Need nose + at least one ankle
  const hasNose  = present(nose, MIN_CONFIDENCE);
  const hasLAnk  = present(lAnkle, MIN_CONFIDENCE);
  const hasRAnk  = present(rAnkle, MIN_CONFIDENCE);

  if (!hasNose || (!hasLAnk && !hasRAnk)) {
    return { status: 'unknown', message: 'Stand so your full body is visible', ratio: NaN };
  }

  const ankle = (hasLAnk && hasRAnk)
    ? midpoint(lAnkle, rAnkle)
    : (hasLAnk ? lAnkle : rAnkle);

  const bodyHeight = Math.abs(ankle.y - nose.y);
  const ratio = bodyHeight / frameH;

  if (ratio > ideal + tolClose) {
    return { status: 'too_close', message: 'Step back from the camera', ratio };
  }
  if (ratio < ideal - tolFar) {
    return { status: 'too_far', message: 'Move closer to the camera', ratio };
  }
  return { status: 'good', message: '', ratio };
}

// ── Check: Camera Angle / Framing ────────────────────────────────────────────
// Front-view:    centering + shoulder tilt + vertical position.
// Side-view:     shoulder overlap check (shoulderGap < 0.12).
// Diagonal-view: shoulderGap in 0.08–0.22 range (between front and side).
// `customInstruction` (optional) replaces the generic messaging — used to provide
// per-exercise guidance like "Sit sideways with active leg toward camera".
// Returns { status: 'good'|'off_center'|'tilted'|'too_high'|'too_low'|'not_side'|'not_diagonal', message }

/**
 * Reject a tilted camera.
 *
 * Why this is its own check: the angle features (kneeAngle, shoulderAngle, ...)
 * are three-point angles, which are invariant to image rotation — a tilted phone
 * does not move them. But several features take a raw vertical difference and
 * only normalise the magnitude:
 *
 *     footPitchNorm = (foot_index.y - heel.y) / shank
 *     kneeLiftNorm  = max(0, hip.y - knee.y) / hipAnkleLen
 *
 * Those assume the image y-axis is aligned with gravity. Since the heel-to-toe
 * vector is roughly 0.65 x shank, a camera rolled by theta injects about
 * 0.65 x sin(theta) into footPitchNorm: ~0.11 at 10 degrees, against a real
 * dorsiflexion signal of 0.05-0.15. A tilted phone can therefore fabricate a
 * whole movement out of nothing.
 *
 * We detect and reject rather than de-rotate: from a single 2D view a rolled
 * camera and a leaning patient are indistinguishable, so silently "correcting"
 * would rotate away real trunk lean. The message names both possibilities.
 *
 * @param {Array}  keypoints
 * @param {string} view       'front' | 'side' | 'diagonal'
 * @param {Object} [overrides] framing overrides; `maxRollDeg` tightens the limit
 */
export function checkCameraRoll(keypoints, view = 'front', overrides = {}) {
  const limit = Number.isFinite(overrides.maxRollDeg) ? overrides.maxRollDeg : MAX_ROLL_DEG;

  const lSh  = kp(keypoints, 'left_shoulder');
  const rSh  = kp(keypoints, 'right_shoulder');
  const lHip = kp(keypoints, 'left_hip');
  const rHip = kp(keypoints, 'right_hip');
  const hasSh  = present(lSh, MIN_CONFIDENCE) && present(rSh, MIN_CONFIDENCE);
  const hasHip = present(lHip, MIN_CONFIDENCE) && present(rHip, MIN_CONFIDENCE);

  let rollDeg = null;
  let reference = null;

  // Front-on: the shoulder line is the best horizontal reference, because the
  // two shoulders are well separated and the angle is well conditioned.
  if (view === 'front' && hasSh) {
    const dx = Math.abs(lSh.x - rSh.x);
    const dy = Math.abs(lSh.y - rSh.y);
    if (dx > 1e-6) {
      rollDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
      reference = 'shoulders';
    }
  }

  // Side and diagonal: the shoulders foreshorten to almost no separation, so the
  // shoulder line is degenerate and its angle is meaningless. Use the trunk
  // axis, which is near vertical for a seated or standing patient. This is the
  // case that was previously unchecked — and it covers all four foot exercises,
  // which are exactly the ones that depend on the roll-sensitive features.
  if (rollDeg === null && hasSh && hasHip) {
    const shMid = midpoint(lSh, rSh);
    const hipMid = midpoint(lHip, rHip);
    const dx = Math.abs(shMid.x - hipMid.x);
    const dy = Math.abs(shMid.y - hipMid.y);
    if (dy > 1e-6) {
      rollDeg = (Math.atan2(dx, dy) * 180) / Math.PI;
      reference = 'trunk';
    }
  }

  if (rollDeg === null) {
    return { status: 'unknown', message: '', rollDeg: null, reference: null, limit };
  }
  if (rollDeg > limit) {
    return {
      status: 'rolled',
      message: 'Level your camera or straighten up',
      rollDeg, reference, limit,
    };
  }
  return { status: 'good', message: '', rollDeg, reference, limit };
}

export function checkCameraAngle(keypoints, frameW, frameH, view = 'front', customInstruction) {
  const lSh  = kp(keypoints, 'left_shoulder');
  const rSh  = kp(keypoints, 'right_shoulder');
  const lHip = kp(keypoints, 'left_hip');
  const rHip = kp(keypoints, 'right_hip');

  const hasSh  = present(lSh, MIN_CONFIDENCE) && present(rSh, MIN_CONFIDENCE);
  const hasHip = present(lHip, MIN_CONFIDENCE) && present(rHip, MIN_CONFIDENCE);

  if (!hasSh) {
    return { status: 'unknown', message: 'Make sure your shoulders are visible' };
  }

  if (view === 'side') {
    // Shoulders should be close together (foreshortened) in a side view
    const shoulderGap = Math.abs(lSh.x - rSh.x) / frameW;
    if (shoulderGap > 0.12) {
      return { status: 'not_side', message: customInstruction || 'Turn sideways to the camera' };
    }
    return { status: 'good', message: '' };
  }

  if (view === 'diagonal') {
    // 45° angle → cos(45°) × shoulder-span ≈ 70% of full width.
    // Wide gap (≥0.22) means user is too front-on; tiny gap (<0.08) means too side-on.
    const shoulderGap = Math.abs(lSh.x - rSh.x) / frameW;
    if (shoulderGap > 0.22) {
      return { status: 'not_diagonal', message: customInstruction || 'Angle yourself slightly toward the camera' };
    }
    if (shoulderGap < 0.08) {
      return { status: 'not_diagonal', message: customInstruction || 'Turn slightly toward the camera' };
    }
    return { status: 'good', message: '' };
  }

  // ---- Front-view checks ----

  // Horizontal centering (mirrored camera: left on screen = patient's right)
  const shMid = midpoint(lSh, rSh);
  const centerX = shMid.x / frameW;
  if (centerX < 0.25) {
    return { status: 'off_center_left', message: 'Move to your left' };
  }
  if (centerX > 0.75) {
    return { status: 'off_center_right', message: 'Move to your right' };
  }
  if (centerX < 0.35) {
    return { status: 'off_center_left', message: 'Slightly move to your left' };
  }
  if (centerX > 0.65) {
    return { status: 'off_center_right', message: 'Slightly move to your right' };
  }

  // Shoulder tilt: delegated so roll has exactly one implementation.
  const roll = checkCameraRoll(keypoints, 'front');
  if (roll.status === 'rolled') {
    return { status: 'tilted', message: roll.message };
  }

  // Vertical centering: hip midpoint in middle 60 % of frame
  if (hasHip) {
    const hipMid = midpoint(lHip, rHip);
    const centerY = hipMid.y / frameH;
    if (centerY < 0.20) {
      return { status: 'too_low', message: 'Raise the camera or step back' };
    }
    if (centerY > 0.80) {
      return { status: 'too_high', message: 'Lower the camera or step back' };
    }
  }

  return { status: 'good', message: '' };
}

// ── Check: Required Keypoint Visibility ──────────────────────────────────────
// Returns { status: 'good'|'missing', message, missing[] }

export function checkVisibility(keypoints, requiredKeypoints) {
  const required = requiredKeypoints || DEFAULT_REQUIRED_KPS;
  const missing = required.filter(name => {
    const k = kp(keypoints, name);
    return !present(k, MIN_CONFIDENCE);
  });

  if (missing.length > 0) {
    // Build a human-friendly list of missing body parts
    const parts = [...new Set(missing.map(n => n.replace(/^(left|right)_/, '')))];
    const readable = parts.join(', ').replace(/_/g, ' ');
    return { status: 'missing', message: `Make sure your ${readable} are visible`, missing };
  }
  return { status: 'good', message: '', missing: [] };
}

// ── Check: Foot tracking ──────────────────────────────────────────
// Only runs for exercises that declare `framing.requireFoot`. Opt-in because the
// twelve MoveNet exercises have no heel/foot_index keypoints at all — COCO-17
// stops at the ankle — so this would reject every one of them.
//
// Two things checkVisibility cannot do here:
//
//  1. It requires EVERY listed keypoint. All four foot exercises are side-on
//     with one foot toward the camera, so the far foot is legitimately
//     occluded. This asks for one COMPLETE foot instead, either side.
//
//  2. It leans on `score`, and MediaPipe's wrapper substitutes a synthetic 1.0
//     when the model omits `visibility` (detectors.js), so a presence test on
//     foot keypoints passes even when the landmarks are nonsense. This adds the
//     geometric plausibility test instead: MediaPipe routinely latches onto a
//     vertical chair leg and smears heel and foot_index along it, which blows
//     the heel↔toe span far past any real foot. A real foot is 60-70% of shank.
//
// Catching that at setup lets the patient move the chair before the set starts,
// rather than discovering it as false reps afterwards.
//
// Returns { status: 'good'|'no_foot'|'implausible', message, side, spanRatio }

const FOOT_GROUPS = [
  { side: 'left',  knee: 'left_knee',  ankle: 'left_ankle',  heel: 'left_heel',  toe: 'left_foot_index'  },
  { side: 'right', knee: 'right_knee', ankle: 'right_ankle', heel: 'right_heel', toe: 'right_foot_index' },
];

export function checkFootTracking(keypoints, overrides = {}) {
  if (!overrides.requireFoot) return { status: 'good', message: '', side: null, spanRatio: NaN };

  const maxRatio = Number.isFinite(overrides.footSpanMaxRatio)
    ? overrides.footSpanMaxRatio
    : FOOT_SPAN_MAX_RATIO;

  // Which foot the exercise actually measures. A one-sided exercise must verify
  // THAT foot, not any foot.
  //
  // This gate used to accept the first complete foot it found. Measured on
  // device: a patient sat side-on with their right toward the camera while the
  // activity was configured for 'left'. The right foot tracked at 0.98
  // confidence and satisfied the gate; the left - the far, occluded one - was at
  // 0.65, and the engine counted ten reps off a foot it could barely see. A
  // session that looks clean and is measuring the wrong limb is worse than one
  // that refuses to start.
  const wanted = overrides.side === 'left' || overrides.side === 'right'
    ? overrides.side
    : null;
  const groups = wanted ? FOOT_GROUPS.filter(g => g.side === wanted) : FOOT_GROUPS;
  const sideWord = wanted ? `${wanted} ` : '';

  let sawCompleteFoot = false;
  let worst = { side: null, spanRatio: NaN };

  for (const g of groups) {
    const knee  = kp(keypoints, g.knee);
    const ankle = kp(keypoints, g.ankle);
    const heel  = kp(keypoints, g.heel);
    const toe   = kp(keypoints, g.toe);

    const complete = [knee, ankle, heel, toe].every(k => present(k, MIN_CONFIDENCE));
    if (!complete) continue;

    const shank = Math.hypot(knee.x - ankle.x, knee.y - ankle.y);
    const span  = Math.hypot(heel.x - toe.x, heel.y - toe.y);
    if (!(shank > 0)) continue;

    sawCompleteFoot = true;
    const spanRatio = span / shank;

    // Good enough: for a one-sided exercise this is the measured foot.
    if (spanRatio <= maxRatio) {
      return { status: 'good', message: '', side: g.side, spanRatio };
    }
    if (!Number.isFinite(worst.spanRatio) || spanRatio > worst.spanRatio) {
      worst = { side: g.side, spanRatio };
    }
  }

  if (!sawCompleteFoot) {
    return {
      status: 'no_foot',
      message: `Make sure your whole ${sideWord}foot is in view, from knee to toes`,
      side: null,
      spanRatio: NaN,
    };
  }

  return {
    status: 'implausible',
    message: `Move your ${sideWord}foot away from the chair legs so it can be tracked`,
    side: worst.side,
    spanRatio: worst.spanRatio,
  };
}

// ── Check: Lighting ──────────────────────────────────────────────────────────
// Returns { status: 'good'|'poor', message, avgScore }

export function checkLighting(keypoints) {
  const scores = (keypoints || [])
    .filter(k => k?.score != null)
    .map(k => k.score);
  const avgScore = scores.length > 0
    ? scores.reduce((a, b) => a + b, 0) / scores.length
    : 0;

  if (avgScore < LIGHTING_THRESHOLD) {
    return { status: 'poor', message: 'Improve lighting or move to a brighter area', avgScore };
  }
  return { status: 'good', message: '', avgScore };
}

// ── Aggregate: Run All Checks ────────────────────────────────────────────────
// Returns { allGood, checks: [{ name, status, message, ...extras }] }

export function runAllChecks(keypoints, frameW, frameH, spec) {
  const framing = spec?.framing || {};
  const view = framing.view || 'front';

  const distance   = checkDistance(keypoints, frameW, frameH, framing);
  const angle      = checkCameraAngle(keypoints, frameW, frameH, view, framing.instruction);
  const roll       = checkCameraRoll(keypoints, view, framing);
  const visibility = checkVisibility(keypoints, framing.requiredKeypoints);
  const foot       = checkFootTracking(keypoints, { ...framing, side: spec?.side });
  const lighting   = checkLighting(keypoints);

  const checks = [
    { name: 'distance',   ...distance },
    { name: 'angle',      ...angle },
    { name: 'roll',       ...roll },
    { name: 'visibility', ...visibility },
    { name: 'foot',       ...foot },
    { name: 'lighting',   ...lighting },
  ];

  // P0 checks (distance, angle, visibility) must all be 'good'.
  // Lighting (P2) is advisory — we still flag it but don't block.
  // 'unknown' does not block: when the keypoints needed to judge roll are absent,
  // the visibility check is the one that should stop the session, not this.
  const p0Good = distance.status === 'good'
    && angle.status === 'good'
    && roll.status !== 'rolled'
    && visibility.status === 'good'
    && foot.status === 'good';

  return { allGood: p0Good, checks };
}
