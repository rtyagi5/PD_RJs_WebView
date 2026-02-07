// ---------------------------------------------
// PoseQuality.js
// Pure functions for pre-exercise coaching checks:
//   distance, camera angle, keypoint visibility, lighting.
// No React dependencies — call from the detection loop.
// ---------------------------------------------

import { kp, present } from './features';

// ── Global defaults ──────────────────────────────────────────────────────────
export const IDEAL_BODY_RATIO   = 0.65;  // body height ≈ 65 % of frame height
export const DISTANCE_TOL_CLOSE = 0.15;  // ratio > ideal + this → "too close"
export const DISTANCE_TOL_FAR   = 0.20;  // ratio < ideal - this → "too far"
export const MIN_CONFIDENCE     = 0.3;   // per-keypoint visibility threshold
export const LIGHTING_THRESHOLD = 0.25;  // avg score below this → poor lighting

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
// Front-view: centering + shoulder tilt + vertical position.
// Side-view:  shoulder overlap check.
// Returns { status: 'good'|'off_center'|'tilted'|'too_high'|'too_low'|'not_side', message }

export function checkCameraAngle(keypoints, frameW, frameH, view = 'front') {
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
      return { status: 'not_side', message: 'Turn sideways to the camera' };
    }
    return { status: 'good', message: '' };
  }

  // ---- Front-view checks ----

  // Horizontal centering: shoulder midpoint in middle 50 %
  const shMid = midpoint(lSh, rSh);
  const centerX = shMid.x / frameW;
  if (centerX < 0.25 || centerX > 0.75) {
    return { status: 'off_center', message: 'Center yourself in the camera' };
  }

  // Shoulder tilt: should be roughly horizontal
  const dx = Math.abs(lSh.x - rSh.x);
  const dy = Math.abs(lSh.y - rSh.y);
  if (dx > 0 && (dy / dx) > 0.3) {
    return { status: 'tilted', message: 'Level your camera or straighten up' };
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
  const angle      = checkCameraAngle(keypoints, frameW, frameH, view);
  const visibility = checkVisibility(keypoints, framing.requiredKeypoints);
  const lighting   = checkLighting(keypoints);

  const checks = [
    { name: 'distance',   ...distance },
    { name: 'angle',      ...angle },
    { name: 'visibility', ...visibility },
    { name: 'lighting',   ...lighting },
  ];

  // P0 checks (distance, angle, visibility) must all be 'good'.
  // Lighting (P2) is advisory — we still flag it but don't block.
  const p0Good = distance.status === 'good'
    && angle.status === 'good'
    && visibility.status === 'good';

  return { allGood: p0Good, checks };
}
