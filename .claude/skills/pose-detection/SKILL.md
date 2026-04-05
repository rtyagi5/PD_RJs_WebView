---
name: pose-detection
description: Pose detection frame pipeline, keypoint access, feature extraction, EMA smoothing, skeleton visualization. Use when working on detectors.js, universalFeatures.js, utilities.js, or PoseQuality.js.
---
# SKILL: Pose Detection, Feature Extraction & Canvas Rendering

> Load this skill when working on `detectors.js`, `universalFeatures.js`, `features.js`, `utilities.js`, `PoseQuality.js`, or any code touching the camera frame pipeline, keypoint data, or canvas overlay.

---

## Frame Pipeline (End-to-End)

Every animation frame (~30-60fps):

```
Camera Frame (webcam)
    ↓
Pose Detector (MoveNet or MediaPipe)
    ↓ → [{ keypoints: [{ name, x, y, score }] }]
Session State Machine
    ↓ → COACHING | COUNTDOWN | ACTIVE | INACTIVE | COMPLETED
Feature Extraction
    ↓ → DTW: computeUniversalFeatures() → 30+ named features
    ↓ → Spec: computeFeaturesForExercise() → exercise-specific features
EMA Smoothing (α ≈ 0.5, applied in ExerciseTracker_refactored.js)
    ↓ → smoothed feature object
Exercise Engine (.step(features))
    ↓ → { phase, quality, repCount, feedback }
Canvas Draw (utilities.js)
    ↓ → skeleton overlay + keypoint dots + HUD
postMessage to Host App (throttled — state changes only)
```

---

## Detector Setup (`detectors.js`)

### MoveNet SinglePose Lightning
```js
const detector = await poseDetection.createDetector(
  poseDetection.SupportedModels.MoveNet,
  { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING }
);
const poses = await detector.estimatePoses(videoElement);
// Returns: [{ keypoints: [{ name, x, y, score }], score }]
```

### MediaPipe Pose Landmarker
```js
// Used for CalfRaises, Dorsiflexion — needs heel + foot_index keypoints
// MediaPipe's 33 landmarks are normalized to MoveNet's 17-name format
// Extra foot keypoints appended after index 16
```

### When to Use Which Detector

| Use MoveNet | Use MediaPipe |
|-------------|--------------|
| All upper-body exercises | CalfRaisesSeated |
| Marches, Squats, SitToStand | CalfRaisesStanding |
| Lunges, StepUps | SeatedDorsiflexion |
| Default choice | StandingDorsiflexion |
| (17 kp, faster) | (33 kp, needs heel/foot_index) |

The detector is declared in `EXERCISE_CONFIGS[exerciseName].detector` and initialized at exercise start.

---

## Keypoint Access Patterns

### Getting a Keypoint Safely

```js
const MIN_CONFIDENCE = 0.3;

function getKeypoint(keypoints, name) {
  const kp = keypoints.find(k => k.name === name);
  return kp && kp.score >= MIN_CONFIDENCE ? kp : null;
}

// Usage
const leftShoulder = getKeypoint(keypoints, 'left_shoulder');
if (!leftShoulder) return NaN; // Graceful degradation
```

### Angle Calculation (3-point atan2)

```js
function calculateAngle(a, b, c) {
  // b is the vertex joint
  const radians = Math.atan2(c.y - b.y, c.x - b.x)
                - Math.atan2(a.y - b.y, a.x - b.x);
  let angle = Math.abs(radians * (180 / Math.PI));
  if (angle > 180) angle = 360 - angle;
  return angle; // Returns 0-180 degrees
}

// Example: elbow angle (shoulder → elbow → wrist)
const elbowAngleL = calculateAngle(leftShoulder, leftElbow, leftWrist);
```

### Normalized Height Features

```js
// wristHeightNorm: how high wrist is relative to hip, normalized by torso length
function wristHeightNorm(wrist, hip, shoulder) {
  const torsoLen = Math.abs(shoulder.y - hip.y);
  if (torsoLen < 10) return NaN; // Guard against near-zero torso length
  return (hip.y - wrist.y) / torsoLen; // Positive = above hip
}

// kneeLiftNorm: knee lift for marches
function kneeLiftNorm(knee, hip, ankle) {
  const hipAnkleLen = Math.abs(hip.y - ankle.y);
  if (hipAnkleLen < 10) return NaN;
  return (hip.y - knee.y) / hipAnkleLen; // Positive = knee above hip level
}
```

### Confidence Threshold

`MIN_CONFIDENCE = 0.3` is intentionally lower than the standard 0.5 recommendation. This accommodates stroke patients who may have partially occluded or hard-to-detect keypoints due to limited mobility or seated positions.

**Do not raise this globally.** If you need higher confidence for clinical scoring, pass a separate threshold as a parameter.

---

## EMA Smoothing

Applied in `ExerciseTracker_refactored.js` before passing features to the exercise engine:

```js
const ALPHA = 0.5; // Tune: higher = more responsive, lower = smoother

function smoothFeatures(prev, curr) {
  const smoothed = {};
  for (const key of Object.keys(curr)) {
    const c = curr[key];
    const p = prev[key];
    if (isNaN(c)) {
      smoothed[key] = NaN; // Propagate NaN — don't smooth in a bad value
    } else if (isNaN(p) || p === undefined) {
      smoothed[key] = c; // First valid value — no smoothing yet
    } else {
      smoothed[key] = ALPHA * c + (1 - ALPHA) * p;
    }
  }
  return smoothed;
}
```

Do NOT move EMA inside `universalFeatures.js`. It belongs in the tracking loop.

---

## Pose Quality Checks (`PoseQuality.js`)

Four checks run before exercise starts. All P0 checks must pass to enter COUNTDOWN.

| Check | Priority | Logic | Message |
|-------|----------|-------|---------|
| Distance | P0 | `noseToAnkleRatio / frameHeight` in target range | "Step back" / "Come closer" |
| Camera angle | P0 | Left-right shoulder y-delta < threshold | "Face the camera" |
| Visibility | P0 | Required keypoints for exercise all above confidence | "Show your [body part]" |
| Lighting | P1 | Average score of all visible keypoints > threshold | "Improve lighting" |

During ACTIVE state, only Visibility check runs → triggers INACTIVE if key keypoints lost >15 frames.

### Writing a New Pose Quality Check

```js
function checkCustomCondition(keypoints, exerciseConfig) {
  // Must return: { passed: bool, message: string | null }
  const kp = getKeypoint(keypoints, 'left_shoulder');
  if (!kp) return { passed: false, message: "Show your left shoulder" };
  // ... condition logic
  return { passed: true, message: null };
}
```

---

## Skeleton Visualization (`utilities.js`)

### Drawing Keypoints

```js
function drawKeypoints(keypoints, ctx, colorMap) {
  // colorMap: { keypointName: color }
  // Default color: aqua (#00FFFF)
  // Tracked + good quality: green (#66FF00)
  // Tracked + poor quality: orange (#FFB020)
  for (const kp of keypoints) {
    if (kp.score < MIN_CONFIDENCE) continue;
    const color = colorMap[kp.name] || '#00FFFF';
    ctx.beginPath();
    ctx.arc(kp.x, kp.y, 5, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
  }
}
```

### Drawing Skeleton Edges

COCO edge pairs (both endpoints must exceed confidence to draw):
```js
const SKELETON_EDGES = [
  ['left_shoulder', 'right_shoulder'],   // torso
  ['left_shoulder', 'left_hip'],
  ['right_shoulder', 'right_hip'],
  ['left_hip', 'right_hip'],
  ['left_shoulder', 'left_elbow'],       // left arm
  ['left_elbow', 'left_wrist'],
  ['right_shoulder', 'right_elbow'],     // right arm
  ['right_elbow', 'right_wrist'],
  ['left_hip', 'left_knee'],             // left leg
  ['left_knee', 'left_ankle'],
  ['right_hip', 'right_knee'],           // right leg
  ['right_knee', 'right_ankle'],
];
```

### Highlight Logic (DTW mode)

```js
// highlightKeypoints from config: e.g., ['shoulder', 'elbow', 'wrist']
// Expanded at runtime based on active side
function expandHighlights(parts, side) {
  const expanded = [];
  for (const part of parts) {
    if (side === 'left' || side === 'both' || side === 'alternating') {
      expanded.push(`left_${part}`);
    }
    if (side === 'right' || side === 'both' || side === 'alternating') {
      expanded.push(`right_${part}`);
    }
  }
  return expanded;
}

// Color assignment
const colorMap = {};
for (const name of expandedHighlights) {
  colorMap[name] = dtwQuality > 0.7 ? '#66FF00' : '#FFB020';
}
// Non-highlighted keypoints default to '#00FFFF' in drawKeypoints
```

---

## Adding a New Feature to universalFeatures.js

Template for a new bilateral feature:

```js
// In computeUniversalFeatures(keypoints):

// 1. Get required keypoints (return NaN on failure)
const leftHip    = getKeypoint(keypoints, 'left_hip');
const leftKnee   = getKeypoint(keypoints, 'left_knee');
const leftAnkle  = getKeypoint(keypoints, 'left_ankle');
const rightHip   = getKeypoint(keypoints, 'right_hip');
const rightKnee  = getKeypoint(keypoints, 'right_knee');
const rightAnkle = getKeypoint(keypoints, 'right_ankle');

// 2. Compute per side
features.myFeatureL = (leftHip && leftKnee && leftAnkle)
  ? computeMyFeature(leftHip, leftKnee, leftAnkle)
  : NaN;

features.myFeatureR = (rightHip && rightKnee && rightAnkle)
  ? computeMyFeature(rightHip, rightKnee, rightAnkle)
  : NaN;

// 3. Optional: bilateral aggregates (skip when side-specific exercise)
features.myFeatureMin = Math.min(features.myFeatureL, features.myFeatureR);
features.myFeatureMax = Math.max(features.myFeatureL, features.myFeatureR);
```

**Naming convention:** `featureNameL` / `featureNameR` for bilateral. `featureName` for bilateral aggregate. `featureNameLR` never used — use L/R suffixes.

**Aggregate features** (`*Min`, `*Max`, `*Avg`) MUST follow the `*Min`/`*Max`/`*Avg` suffix pattern exactly. The side-aware DTW filter skips these by name pattern when a specific side is active.

---

## Performance Rules for the Hot Path

The detection loop runs 30-60fps. These rules apply to all code in the frame pipeline:

1. **No async/await in the render loop** — async pose detection is awaited outside `requestAnimationFrame`. Use a `running` guard flag.

2. **No state setter on every frame** — only call `setState` on meaningful transitions (rep count changes, phase changes, feedback changes).

3. **No postMessage on every frame** — throttle to state changes only.

4. **Wrap all tf.* operations in tf.tidy()** — every tensor created in the hot path must be cleaned up.

5. **No new object allocation in the inner loop** — reuse feature objects where possible.

6. **Canvas clear before redraw** — `ctx.clearRect(0, 0, width, height)` at start of each draw call.

```js
// Correct guard pattern for detection loop
const runningRef = useRef(false);

async function detectFrame() {
  if (runningRef.current) return; // Skip if still processing
  runningRef.current = true;
  try {
    const poses = await detector.estimatePoses(videoRef.current);
    // ... process
  } finally {
    runningRef.current = false;
  }
  requestAnimationFrame(detectFrame);
}
```
