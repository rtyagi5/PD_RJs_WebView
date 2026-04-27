# Rehab Ranger™ — CLAUDE.md

> This file gives Claude Code full context about the Rehab Ranger™ pose detection and exercise tracking system. Read this before touching any code.

---

## Project Identity

**Rehab Ranger™** is a real-time, AI-powered physical therapy exercise tracker for stroke rehabilitation. It runs as a React SPA embedded as a WebView inside mobile/web PT platforms. It uses device cameras to:

- Detect body poses via TensorFlow.js MoveNet and MediaPipe
- Count exercise repetitions using DTW template matching or hand-coded phase machines
- Provide real-time rule-based feedback on form and ROM
- Report session data back to the host app via `postMessage`

**Brand rule:** Always write "Rehab Ranger™" (with superscripted ™) whenever the project name appears in documentation or comments.

---

## Architecture at a Glance

```
Host App (mobile/web)
  └── WebView (this project — React SPA)
        ├── Camera → Pose Detector (MoveNet / MediaPipe)
        ├── Feature Extraction (universal 30+ features OR per-spec)
        ├── Exercise Engine
        │     ├── DTW PhaseMachine (Level 3 — primary)
        │     └── Hand-coded PhaseMachine (Level 1 — fallback)
        ├── Patient Baseline (adaptive ROM per patient)
        ├── Session State Machine (LOADING→COACHING→ACTIVE→COMPLETED)
        ├── Canvas renderer (skeleton overlays + HUD)
        └── postMessage bridge → Host App
```

**Key design principle:** No cloud inference. No LLMs. All pose detection and exercise logic runs 100% client-side in the browser using TensorFlow.js WebGL backend or MediaPipe WASM.

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 18 (Create React App) |
| Pose Detection | TF.js MoveNet (17 kp) + MediaPipe Pose Landmarker (33 kp) |
| Styling | TailwindCSS 4 |
| State | React hooks + refs (no Redux — 30-60fps perf loop) |
| Testing | Jest + React Testing Library |
| Build | react-scripts (CRA) |
| Deployment | GitHub Pages, embedded as WebView |
| Communication | `window.ReactNativeWebView.postMessage()` / `window.parent.postMessage()` |

Key packages: `@tensorflow/tfjs`, `@tensorflow-models/pose-detection`, `@mediapipe/tasks-vision`, `react-webcam`, `jwt-decode`, `axios@1.9.0`

---

## Directory Structure

```
src/
├── App.js                         # Entry: JWT decode, exercise selection, routing
├── ExerciseTracker_refactored.js  # Main component: detection loop, canvas, HUD, postMessage
├── SessionStateMachine.js         # States: LOADING→COACHING→COUNTDOWN→ACTIVE→INACTIVE→COMPLETED
├── PoseQuality.js                 # Pose quality checks: distance, angle, visibility, lighting
├── CoachingOverlay.js             # Canvas coaching messages + target box
├── detectors.js                   # MoveNet + MediaPipe detector factories
├── features.js                    # Legacy per-spec feature computation (Level 1)
├── phase_machine.js               # Level 1 hand-coded PhaseMachine
├── registry.js                    # Maps exercise names → hand-coded spec files
├── utilities.js                   # Canvas drawing: drawKeypoints, drawSkeleton, drawCanvas
├── config.js                      # Backend API URLs (tenant-based)
├── VideoRecorder.js               # Optional video recording
├── SkeletonRecorder.js            # Optional skeleton-only recording
│
├── specs/                         # 16 hand-coded exercise specs (Level 1)
│   ├── SideArmRaise.spec.js
│   ├── BicepCurls.spec.js
│   └── ... (16 total)
│
└── dtw/                           # DTW engine (Level 3 — primary)
    ├── index.js
    ├── universalFeatures.js       # 30+ computed features from any pose
    ├── dtwEngine.js               # Online Subsequence DTW algorithm
    ├── DTWPhaseMachine.js         # Drop-in PhaseMachine replacement
    ├── specToReference.js         # Declarative configs → synthetic references
    ├── referenceSchema.js         # Reference JSON schema + validation
    ├── referenceRegistry.js       # In-memory reference cache
    ├── bootstrapReferences.js     # Auto-generates all 16 refs at startup
    ├── PatientBaseline.js         # Adaptive ROM baselines per patient (localStorage)
    ├── videoFeatureExtractor.js   # Feature extraction from uploaded reference videos
    ├── ReferenceExtractor.js      # PT tool: upload video → annotate → export .ref.json
    ├── ValidationPage.js          # Browser validation UI at /dtw-validation
    ├── validateDTW.js             # Synthetic validation logic
    ├── validateDTW.test.js        # Jest: headless validation of all 16 exercises
    └── references/                # Video-extracted .ref.json files (override synthetic)
        ├── index.js
        └── Left Side Arm Raise.ref.json
```

---

## Keypoints Reference

### MoveNet 17 (COCO format)
```
Index  Name              Body Region
0      nose              face
1      left_eye          face
2      right_eye         face
3      left_ear          face
4      right_ear         face
5      left_shoulder     upper body ← SAR, BicepCurls, WallPushUp
6      right_shoulder    upper body
7      left_elbow        upper body
8      right_elbow       upper body
9      left_wrist        upper body
10     right_wrist       upper body
11     left_hip          lower body ← SitToStand, Marches, Squats
12     right_hip         lower body
13     left_knee         lower body
14     right_knee        lower body
15     left_ankle        lower body
16     right_ankle       lower body
```

MediaPipe adds: heel, foot_index (left/right) — required for CalfRaises, Dorsiflexion exercises.

### Confidence Threshold
`MIN_CONFIDENCE = 0.3` — keypoints below this are treated as absent.

> **Note:** 0.3 is lower than the general best-practice recommendation of 0.5. This is intentional for stroke patients who may have limited mobility causing partial occlusion. For clinical scoring mode, consider raising to 0.5–0.7.

---

## Core Systems

### 1. Pose Detection (`detectors.js`)

Two detectors, both return `[{ keypoints: [{ name, x, y, score }] }]`:

| Detector | Keypoints | Use When |
|----------|-----------|----------|
| MoveNet SinglePose Lightning | 17 (COCO) | All upper-body and most lower-body exercises |
| MediaPipe Pose Landmarker | 33 (incl. foot) | CalfRaises, Dorsiflexion — needs heel/foot_index |

Per-exercise detector is declared in `EXERCISE_CONFIGS[exerciseName].detector`.

### 2. Feature Extraction

**DTW mode** (`universalFeatures.js`):
- Computes 30+ features: joint angles, normalized heights, knee lift, foot pitch, bilateral aggregates
- All features degrade gracefully to `NaN` when keypoints are missing
- DTW engine skips NaN features during distance calculation
- EMA smoothing is applied before passing to the exercise engine

**Level 1 mode** (`features.js` + spec file):
- Each spec defines its own `computeExtraFeatures()` for exercise-specific features
- Only active when DTW reference is not available for the exercise

### 3. DTW Exercise Engine (`dtw/`)

The primary engine for all 16 exercises:

1. **Config** (`specToReference.js`) — ~20 lines per exercise describing phases as feature sweeps
2. **Reference** — synthetic 60-frame template auto-generated at startup; video-extracted `.ref.json` overrides it
3. **Online Subsequence DTW** (`dtwEngine.js`) — rolling cost matrix, weighted Euclidean distance, feature normalization
4. **Output per frame:** `{ phase, quality (0-1), templatePosition (0-1), cycleComplete }`
5. **Rep counting** (`DTWPhaseMachine.js`) — 3-state machine: `idle → sawStart → sawEffort → rep counted`

**Rep gate:** ROM must exceed `minRomForRep` (25% of reference range). Refractory period: 300ms.

**Side-aware filtering:** When `side: 'left'`, right-side features and aggregate (Min/Max/Avg) features are skipped in DTW distance computation.

### 4. Hand-Coded Engine (`phase_machine.js` + `specs/`)

Fallback when no DTW reference exists. Each spec defines:
- Phases with string-based `enter` conditions (eval'd at runtime)
- Rep counting: `from` phase → `to` phase
- Feedback rules with priority
- `computeExtraFeatures()` for exercise-specific computed features
- `highlights()` for skeleton coloring

### 5. Patient Baseline (`PatientBaseline.js`)

- **First 2 reps:** Calibration — records patient's personal min/max per feature
- **Persisted:** localStorage (survives sessions)
- **Rep classification:** Within 5% of baseline range = "completed"; otherwise "attempt"
- **Safety envelope:** Gold-standard ranges are max limits only, NOT targets
- **Progress tracking:** Compares current ROM to stored baselines over time

### 6. Session State Machine (`SessionStateMachine.js`)

```
LOADING → COACHING → COUNTDOWN (5s) → ACTIVE → COMPLETED
                ↑                        ↓
                └──────── INACTIVE ←─────┘ (keypoints lost >15 frames)
```

P0 checks (must all pass before COUNTDOWN): distance, camera angle, key keypoint visibility.

### 7. Skeleton Visualization (`utilities.js`)

- **Aqua** — non-tracked body parts (default)
- **Green** (`#66FF00`) — tracked body parts, good DTW quality
- **Orange** (`#FFB020`) — tracked body parts, poor DTW quality (≤ 0.7)

`highlightKeypoints` declared per exercise in `EXERCISE_CONFIGS` — expanded to side-specific names at runtime.

---

## Supported Exercises (16)

| Exercise | Mode | Detector | Key Feature |
|----------|------|----------|-------------|
| SideArmRaise | rep | movenet | shoulderAngle |
| BicepCurls | rep | movenet | elbowAngle |
| MiniSquats | rep | movenet | kneeAngle |
| SitToStand | rep | movenet | kneeAngle, hipToAnkleNorm |
| LongArcQuad | rep | movenet | kneeAngle |
| SeatedMarch | rep (alt) | movenet | kneeLiftNorm, hipAngle |
| StandingMarch | rep (alt) | movenet | kneeLiftNorm, hipAngle |
| MiniLunges | rep | movenet | kneeAngle |
| LiftsAndChops | rep | movenet | handsHeightNorm |
| StepUps | rep | movenet | kneeAngle, kneeLiftNorm |
| WallPushUp | rep | movenet | elbowAngle, shoulderAngle |
| CalfRaisesSeated | rep | mediapipe | ankleAngleToe |
| CalfRaisesStanding | rep | mediapipe | ankleAngleToe |
| SeatedDorsiflexion | rep | mediapipe | footPitchNorm |
| StandingDorsiflexion | rep | mediapipe | footPitchNorm |
| StandingStraightUp | **time** | movenet | kneeAngle, trunkAngle |

Alternating exercises (SeatedMarch, StandingMarch): use `mirrorFeatures` to expand generic keys (e.g., `hipAngle`) to L/R sides.

---

## WebView Communication

### Inbound (Host → WebView)
JWT token in URL query param:
```json
{ "exercise": "SideArmRaise", "reps": 10, "side": "left", "tenant": "clinic_name", "activityId": "abc123" }
```

### Outbound (WebView → Host, every frame)
```js
window.ReactNativeWebView?.postMessage(JSON.stringify({
  fps: 60,
  repCount: 3,
  feedback: "Good — lower slowly",
  exerciseType: "SideArmRaise",
  completionStatusRef: false,
  sessionState: "active",
}));
```

Throttle postMessage — only send on meaningful state changes, not every frame.

### Dev Mode
Set `REACT_APP_DEVELOPMENT_MODE=true` in `.env` to bypass JWT and use env defaults:
```env
REACT_APP_DEFAULT_EXERCISE=StandingMarch
REACT_APP_DEFAULT_REPS=5
REACT_APP_DEFAULT_SIDE=left
```

---

## DTW System — Adding / Modifying Exercises

### Adding a New Exercise (DTW path — preferred)

1. Add config to `EXERCISE_CONFIGS` in `src/dtw/specToReference.js`:
   ```js
   NewExercise: {
     name: 'NewExercise',
     mode: 'rep',              // 'rep' or 'time'
     side: 'both',             // 'left', 'right', 'both', 'alternating'
     detector: 'movenet',      // 'movenet' or 'mediapipe'
     highlightKeypoints: ['shoulder', 'elbow', 'wrist'],
     phases: [
       { id: 'start', weight: 1, features: { shoulderAngle: { from: 30, to: 30 } } },
       { id: 'effort', weight: 2, features: { shoulderAngle: { from: 30, to: 90 } } },
     ],
     repCycle: { from: 'start', to: 'effort' },
     staticFeatures: { trunkAngle: 172 },
     feedback: { effort: ["Good — keep lifting"], ... },
   }
   ```
2. Run validation: `npx react-scripts test --testPathPattern="validateDTW.test" --watchAll=false --verbose`
3. Verify 5/5 reps pass in headless test
4. Live test with webcam

### Validating the DTW System

```bash
# Headless: all 16 exercises
npx react-scripts test --testPathPattern="validateDTW.test" --watchAll=false --verbose

# Browser: visual results at /dtw-validation
yarn start  # then navigate to localhost:3000/dtw-validation
```

Current status: **15/15 rep-mode exercises PASS** (5/5 reps, quality > 0.98).

---

## Active Issues (as of April 2026)

| Issue | Status | Notes |
|-------|--------|-------|
| StandingMarch live rep detection | In progress | Synthetic reference updated (hipAngle 170→60); mirrorFeatures fix applied; awaiting live retest |
| Laptop webcam lower-body keypoints | Known | Ankle confidence often low on laptop webcams. Upper-body exercises work reliably |
| Video-extracted references | Partial | Only SideArmRaise has a video-extracted ref; rest use synthetic |

---

## Development Commands

```bash
yarn install          # Install dependencies
yarn start            # Start dev server (localhost:3000)
yarn build            # Production build
yarn deploy           # Deploy to GitHub Pages
yarn test             # Run all Jest tests
```

### Debugging in Browser Console

| Log prefix | Source file | What it shows |
|------------|-------------|----------------|
| `[Features]` | universalFeatures.js | Keypoint confidence + computed features (every 60 frames) |
| `[DTW-diag]` | DTWPhaseMachine.js | Phase, cycle state, quality, primary feature value (every 60 frames) |
| `[Engine]` | ExerciseTracker_refactored.js | Which engine selected (DTW vs spec) |
| `[Feedback]` | DTWPhaseMachine.js | Phase transitions + feedback messages |

---

## Code Conventions

- **No Redux.** State is React hooks + refs. The detection loop runs at 30-60fps — Redux would add overhead.
- **No cloud inference.** All logic is client-side. Never add API calls to the hot path.
- **Modular engines.** Both `PhaseMachine` and `DTWPhaseMachine` expose the same `.step(features)` interface. Swap via duck-typing.
- **Graceful degradation.** Features return `NaN` for missing keypoints; the DTW engine skips NaNs. Never throw on missing keypoints.
- **Side-aware everywhere.** Before computing angles or comparing features, check the active side and filter accordingly.
- **EMA before exercise engine.** All features pass through exponential moving average smoothing (α ≈ 0.5) before `.step()`.
- **Tensor cleanup.** Every `tf.*` operation in the hot path must be wrapped in `tf.tidy()` or explicitly disposed. Memory leaks crash long sessions.
- **postMessage throttling.** Never send postMessage on every frame. Batch state changes; send on transitions.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `REACT_APP_DEVELOPMENT_MODE` | `true` | Bypass JWT, use env defaults |
| `REACT_APP_DEFAULT_EXERCISE` | `StandingMarch` | Exercise in dev mode |
| `REACT_APP_DEFAULT_REPS` | `5` | Target reps in dev mode |
| `REACT_APP_DEFAULT_SIDE` | `left` | Active side in dev mode |
| `REACT_APP_ALLOW_VIDEO_RECORDING` | `false` | Enable video recording |
| `REACT_APP_ALLOW_SKELETON_RECORDING` | `false` | Enable skeleton-only recording |
| `REACT_APP_TENANT` | `dev` | Tenant for backend API URLs |

---

## Roadmap

| Level | Status | Description |
|-------|--------|-------------|
| Level 1 | ✅ Complete | 16 hand-coded exercise specs |
| Level 2 | ✅ Complete | Declarative configs + adaptive patient baselines |
| Level 3 | 🔄 In Progress | DTW template matching — 15/16 exercises validated |
| Level 4 | 🔮 Future | Family classifiers from accumulated data; scale to 2000+ exercises |

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep — these traverse the graph's EXTRACTED + INFERRED edges instead of scanning files
- After modifying code files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost)
