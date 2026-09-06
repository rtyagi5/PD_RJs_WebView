# Rehab Ranger™ — Pose Detection WebView

Real-time, AI-powered physical therapy exercise tracker for stroke rehabilitation.
A React SPA embedded as a WebView inside mobile/web PT platforms: it reads the
device camera, counts exercise repetitions, gives live form feedback, and reports
session data back to the host app.

**All inference runs client-side.** No cloud, no LLMs — TensorFlow.js (WebGL) and
MediaPipe (WASM), both served from this origin.

---

## Quick start

```bash
yarn install
yarn start          # http://localhost:3000
```

The app normally expects a JWT in the URL. For local work, `.env` sets
`REACT_APP_DEVELOPMENT_MODE=true`, which skips the token/backend entirely and
starts the configured exercise immediately:

```env
REACT_APP_DEVELOPMENT_MODE=true
REACT_APP_DEFAULT_EXERCISE=SideArmRaise
REACT_APP_DEFAULT_REPS=5
REACT_APP_DEFAULT_SIDE=left
```

This flag is never set in production builds, so the block is inert once deployed.

### Commands

| Command | What it does |
|---|---|
| `yarn start` | Dev server |
| `yarn test` | Jest in watch mode |
| `yarn test:ci` | Single run (what CI executes) |
| `yarn build` | Production build |
| `yarn deploy` | Publish to GitHub Pages |

> `src/specs/*.spec.js` are **exercise configs, not tests**. `package.json` narrows
> Jest's `testMatch` to `*.test.js` so they aren't collected as empty suites.

---

## Architecture

```
Camera frame
  → detectors.js          MoveNet (17 kp) or MediaPipe (33 kp → 17 + 4 foot points)
  → universalFeatures.js  30 features: joint angles, normalised heights, L/R + aggregates
  → EMA smoothing         features.js
  → SessionStateMachine   LOADING → COACHING → COUNTDOWN → ACTIVE → COMPLETED
  → DTWPhaseMachine       template matching + rep counting + feedback
  → canvas overlay + postMessage to the host app
```

### Two engines, one interface

Both expose `.step(features)`:

- **`DTWPhaseMachine`** (`src/dtw/`) — the engine in use. Matches live motion
  against a 60-frame reference template with online subsequence DTW.
- **`PhaseMachine`** (`src/phase_machine.js` + `src/specs/`) — the original
  hand-coded rule engine. It only runs if an exercise has *no* registered DTW
  reference. Since `bootstrapAllReferences()` seeds all 16 at startup, this is a
  fallback safety net, not the live path.

### Rep counting

A three-state cycle: `idle → sawStart → sawEffort → rep`. To advance, the primary
joint must move at least `minRomPct` of the template range **in the same direction
as the template's effort phase**, sustained for 100 ms. To count, the patient must
return near the start position, and a refractory timer blocks the next rep.

Defences added in response to live bugs: a 20°/frame velocity filter, a
"block-and-reset" so a refractory-suppressed rep can't fire late, and a foot-span
sanity check that rejects MediaPipe latching onto chair legs.

### Safety feedback

Each exercise declares `clinicalCaps` in `src/dtw/specToReference.js` — absolute
limits such as `{ shoulderAngle: { max: 95 } }`. Exceeding one raises the exercise's
`feedback.range.tooMuch` message at the **highest** priority, above the post-rep
number announcement. Once a patient baseline has locked, `PatientBaseline.checkSafety`
is consulted as a second source.

Caps marked `TODO clinical review` were derived from template geometry and should be
confirmed by a clinician; `SideArmRaise` (95°) and `LongArcQuad` (178°) carry over
real thresholds from the original hand-coded specs.

---

## Reference templates

Each exercise needs a template. There are three sources, highest priority last:

1. **Synthetic** — generated at startup from `EXERCISE_CONFIGS` in
   `src/dtw/specToReference.js`. Always available.
2. **Video-extracted** — a `.ref.json` in `src/dtw/references/`, auto-bundled.
3. **API** — published to the backend, fetched and cached per session (7-day TTL).

The console logs which one is live:

```
[Engine] DTW mode for SideArmRaise — reference source: SYNTHETIC
```

> **The name must be a canonical exercise id** (an `EXERCISE_CONFIGS` key such as
> `SideArmRaise`). References are looked up by that exact key, so a file named
> "Left Side Arm Raise" registers under a key nothing ever requests and silently
> never loads. Bootstrap now warns loudly when this happens.

### Recording a reference (PT portal)

```bash
yarn start   # then open http://localhost:3000/reference-extractor
```

No login required. Six steps: upload video → extract features → confirm rep
boundaries → label phases → write feedback → export.

1. Pick the exercise from the **dropdown** (free text is not accepted — that is
   what produced the orphaned reference above). Detector and mode auto-fill.
2. Record 5+ clean reps, well lit, framed per that exercise's `framing`
   instruction. Calf-raise and dorsiflexion need the feet clearly visible
   (MediaPipe), and the active foot **in front of** the chair, not beside a chair leg.
3. Export, drop the `.ref.json` into `src/dtw/references/`, restart the dev server.
4. Confirm `[Bootstrap] Loaded video reference: "<name>" (overrides synthetic)` and
   that the engine log now reports `source: VIDEO`.
5. Run the exercise in dev mode and sanity-check rep counting and feedback.

---

## Host app contract

**Inbound** — JWT in the URL query string:

```json
{ "exercise": "SideArmRaise", "reps": 10, "side": "left",
  "tenant": "clinic_name", "activityId": "abc123" }
```

**Outbound** — `window.ReactNativeWebView.postMessage(...)`, or
`window.parent.postMessage(...)` when embedded in an iframe.

```jsonc
{
  "fps": 30,
  "repCount": 3,
  "feedback": "Good — lower slowly",
  "exerciseType": "SideArmRaise",
  "completionStatusRef": false,
  "sessionState": "active",

  // Live angles, named by universal feature key (side-explicit)
  "shoulderAngleL": 88,
  "elbowAngleL": 170,

  // Present only on the frame a rep is counted
  "repSummary": {
    "rep": 3,
    "features": { "shoulderAngleL": { "min": 31, "max": 89 } }
  }
}
```

Which angle fields an exercise reports is defined by `METRIC_MAP` in
`src/metrics.js`. **Field names are universal feature keys** (`shoulderAngleL`),
not the legacy bare names (`shoulderAngle`, `armAngle`) — a test enforces that every
entry resolves to a real feature, since a silent mismatch here is what previously
stopped angle data reaching the backend.

Sends are throttled to frames where the feedback text changes, **plus** a forced
send on every counted rep so `repSummary` is never dropped.

---

## Validation

```bash
yarn test:ci                                          # full suite
yarn start  # → http://localhost:3000/dtw-validation  (visual)
```

The synthetic suite drives all 16 exercises through generated sequences and asserts
rep counts. Note its limit: **it generates test data from the same templates it
validates**, so it cannot catch real-world failures (keypoint noise, camera framing,
one motion resembling another). Those need webcam testing against a real reference.

### Debugging in the browser console

| Prefix | Source | Shows |
|---|---|---|
| `[Engine]` | ExerciseTracker | Engine chosen + reference source |
| `[DTW-diag]` | DTWPhaseMachine | Phase, cycle state, quality, ROM (every 60 frames) |
| `[DTW]` | DTWPhaseMachine | Rep counted + classification |
| `[Features]` | universalFeatures | Keypoint confidence (every 60 frames) |
| `[Bootstrap]` | bootstrapReferences | Which references registered |
| `[Metrics]` | metrics.js | A METRIC_MAP key that resolves to nothing |

---

## Conventions

- **No Redux.** The detection loop runs at 30–60 fps; state is hooks + refs.
- **No cloud inference.** Never add a network call to the hot path.
- **Graceful degradation.** Missing keypoints yield `NaN`; DTW skips NaN features.
  Never throw on a missing keypoint.
- **Side-aware everywhere.** Filter by the active side before comparing features.
- **Throttle postMessage.** Send on meaningful change, never every frame.
