# Rehab Ranger™ — Architecture Dump

> Prepared for external review. Describes the repository as it currently stands on
> branch `feature/posedetection_engine_v1`.

---

## Summary

**Pose model (live):** TF.js **MoveNet SinglePose Lightning** (17 COCO keypoints) for 12 of
16 exercises; **MediaPipe Pose Landmarker Full** (33 landmarks, remapped to 17 + 4 foot
points) for the 4 calf-raise/dorsiflexion exercises needing heel and toe. Both run
on-device — TF.js on WebGL (CPU fallback), MediaPipe on locally-served WASM.

**Segmentation engine (live):** `DTWPhaseMachine` — online subsequence DTW against a
60-frame template, wrapping a three-state rep cycle (`idle → sawStart → sawEffort`). An
older rule-based `PhaseMachine` still exists but is **unreachable**: every exercise has a
registered DTW reference, so the fallback branch never executes.

**Skeleton recordings:** **None exist.** Both "recorders" encode a canvas to `video/webm`
via `MediaRecorder` — pixels, not joints. No keypoint stream is persisted, so there are
**no timestamps and no confidence scores** to review. The only per-frame artifact is a DTW
template holding *derived* angles, not keypoints.

**Baseline tracking:** **Exists** (`src/dtw/PatientBaseline.js`) — calibrates over the
first 2 reps, locks per-feature ROM, persists to `localStorage`, classifies each rep, and
compares against the previous session. Not greenfield.

> ⚠️ **Uncommitted work.** `origin/main` is at the older v0 state. Items marked
> **[v1, uncommitted]** below exist only in the working tree. A fresh clone will not show
> them. See §8.

---

## 1. Pipeline trace — one camera frame

All stages run **on-device in the browser**. No frame, keypoint, or feature ever leaves
the device. The only network traffic is: a JWT/activity fetch at session start, an
optional reference-template fetch, and one summary POST at session end.

| # | Stage | File | Function |
|---|---|---|---|
| 1 | Capture | `ExerciseTracker_refactored.js` | `<Webcam>` (react-webcam) → `webcamRef.current.video` |
| 2 | Loop scheduling | `ExerciseTracker_refactored.js` | `loop()` via `requestAnimationFrame` |
| 3 | Inference | `detectors.js` | `estimatePoses(video)` |
| 4 | Keypoint output | `detectors.js` | MoveNet native; MediaPipe via `kpFromName()` |
| 5 | Smoothing | `features.js` | `EMA.nextWithDt()` (applied in `loop()`) |
| 6 | Normalization | `dtw/universalFeatures.js` | `torsoLen` / `shankLen` / `hipAnkleLen` divisors |
| 7 | Feature extraction | `dtw/universalFeatures.js` | `computeUniversalFeatures(kps)` → 30 features |
| 8 | Session gating | `SessionStateMachine.js` + `PoseQuality.js` | `step()` / `runAllChecks()` |
| 9 | Rep segmentation | `dtw/DTWPhaseMachine.js` | `step()` |
| 10 | Template matching / quality | `dtw/dtwEngine.js` | `OnlineSubsequenceDTW.step()` |
| 11 | Feedback selection | `dtw/DTWPhaseMachine.js` | `_pickFeedback()` |
| 12 | Render | `utilities.js` + `CoachingOverlay.js` | `drawCanvas()`, `drawCoachingMessages()` |
| 13 | Report to host | `utilities.js` | `sendUpdates()` → `postMessage` |

### Narrative

**Capture → inference.** The render loop is `requestAnimationFrame`-driven, but inference
is **fire-and-forget**: a new `estimatePoses()` call starts only if none is in flight, and
the canvas always draws the most recently completed result. This decouples render rate
from inference rate — on mobile, inference can take 100–300 ms without stalling the canvas.
A consequence worth noting for a reviewer: **the pose used for a given painted frame may
be one or more frames stale**, and the feature stream is therefore not uniformly sampled.

**Keypoint output format.** Both detectors converge on the same shape:

```js
[{ keypoints: [{ name: 'left_shoulder', x: 412.7, y: 233.1, score: 0.87 }, ...] }]
```

Coordinates are **pixel space** in the source video's resolution. MoveNet emits exactly
17; MediaPipe emits 21 (the same 17 in COCO order, plus `left_heel`, `right_heel`,
`left_foot_index`, `right_foot_index`). MediaPipe's native normalized `[0,1]` coordinates
are multiplied up to pixels at `detectors.js:kpFromName`, and its `visibility` becomes
`score` — defaulting to `1.0` when absent, which means **a MediaPipe keypoint can carry a
confidence of 1.0 that was never actually measured.**

**Smoothing.** Each finite feature passes through a per-key EMA with an FPS-adaptive
alpha (`nextWithDt`, α≈0.35 at 30 fps, recomputed as `1-(1-α)^(dt/33)`), so smoothing
half-life stays constant on slow devices. Non-finite inputs are ignored rather than
poisoning the filter. Smoothing is applied to the **feature vector**, not to raw keypoints.

**Normalization.** Happens inside feature extraction — see §7.

**Feature extraction.** `computeUniversalFeatures` returns a fixed 30-key vector every
frame regardless of exercise; the DTW engine decides which keys matter. Any feature whose
source keypoints are missing or low-confidence is `NaN` and is skipped downstream.

**Rep segmentation and quality.** `DTWPhaseMachine.step()` filters velocity spikes, feeds
`PatientBaseline`, calls `OnlineSubsequenceDTW.step()` for phase/quality, then runs its own
cycle state machine to decide whether a rep counts. Quality is `1 − nearestNeighbourDistance`,
clamped to `[0,1]`.

**Feedback.** `_pickFeedback()` returns a single string by priority: clinical-cap breach →
rep number → alternating-leg warning → form → range → phase cue. That string is drawn on
the canvas and forwarded to the host app.

---

## 2. Pose model

| | MoveNet | MediaPipe |
|---|---|---|
| Variant | SinglePose **Lightning** | Pose Landmarker **Full** (`pose_landmarker_full.task`) |
| Keypoints | 17 (COCO) | 33 → remapped to 17 + 4 foot = **21** |
| Runtime | TF.js, **WebGL** (falls back to CPU) | **WASM**, served from `public/mediapipe/wasm/` |
| Asset | `public/models/movenet/model.json` (~4.8 MB) | `pose_landmarker_full.task` (9.4 MB) + ~19 MB WASM |
| Used by | 12 exercises | 4 (CalfRaises ×2, Dorsiflexion ×2) |
| Version pinned? | No explicit version recorded | No explicit version recorded |

Selection is per-exercise via the `detector` field in `EXERCISE_CONFIGS`, resolved by
`createPoseDetector(kind)`. There is **no WebGPU path** and no native/mobile inference —
everything runs inside the WebView.

**`src/detectors.js` (complete, verbatim):**

```js
// detectors.js
import * as posedetection from '@tensorflow-models/pose-detection';
import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import * as tf from '@tensorflow/tfjs';

/**
 * Select the fastest TF.js backend the device actually supports.
 * WebGL is required for usable frame rates, but some in-app WebViews and older
 * devices don't expose it — previously that threw and left the patient staring at
 * a frozen "Initializing…" screen. Falling back to CPU is slow but functional.
 */
async function selectBackend() {
  for (const backend of ['webgl', 'cpu']) {
    try {
      if (await tf.setBackend(backend)) {
        await tf.ready();
        if (backend !== 'webgl') {
          console.warn(`[TF] WebGL unavailable — running on "${backend}". Expect reduced frame rate.`);
        }
        return backend;
      }
    } catch (err) {
      console.warn(`[TF] backend "${backend}" failed to initialise:`, err?.message || err);
    }
  }
  throw new Error('No usable TensorFlow.js backend (tried webgl, cpu)');
}

export async function createMoveNet() {
    await selectBackend();
    console.log('[TF] backend:', tf.getBackend(), '| webgl version:', tf.ENV.get('WEBGL_VERSION'));
  const det = await posedetection.createDetector(
    posedetection.SupportedModels.MoveNet,
    {
      modelType: posedetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
      modelUrl:
        window.location.hostname === 'localhost'
          ? `/models/movenet/model.json`
          : `${process.env.PUBLIC_URL}/models/movenet/model.json`,
    }
  );
  return {
    async estimatePoses(video) {
      const poses = await det.estimatePoses(video);
      // Already returns {keypoints:[{name,x,y,score}]} in your app’s format.
      return poses;
    },
    async dispose() { await det?.dispose?.(); }
  };
}

export async function createMediaPipePose() {
    // Load the WASM runtime from our own origin (public/mediapipe/wasm, copied from
    // the installed @mediapipe/tasks-vision package). Previously this came from a
    // jsdelivr CDN pinned to 0.10.0 while the package was 0.10.22 — a version skew
    // plus the only network dependency in an otherwise fully offline pipeline.
    // The CDN remains as a fallback for the case where the assets are missing.
    const localWasm = `${process.env.PUBLIC_URL || ''}/mediapipe/wasm`;
    let vision;
    try {
      vision = await FilesetResolver.forVisionTasks(localWasm);
    } catch (err) {
      console.warn('[MediaPipe] Local WASM unavailable, falling back to CDN:', err?.message || err);
      vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm'
      );
    }

    const model = `${process.env.PUBLIC_URL || ''}/mediapipe/pose_landmarker_full.task`;
    const landmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: model },
      runningMode: "VIDEO",
      numPoses: 1,
    });
  
    // MediaPipe indices ➜ names (33)
    const MP_NAMES = [
      'nose','left_eye_inner','left_eye','left_eye_outer','right_eye_inner','right_eye','right_eye_outer',
      'left_ear','right_ear','mouth_left','mouth_right',
      'left_shoulder','right_shoulder','left_elbow','right_elbow','left_wrist','right_wrist',
      'left_pinky','right_pinky','left_index','right_index','left_thumb','right_thumb',
      'left_hip','right_hip','left_knee','right_knee','left_ankle','right_ankle',
      'left_heel','right_heel','left_foot_index','right_foot_index'
    ];
  
    // MoveNet/COCO 17-order your app expects
    const MOVENET_17 = [
      'nose',
      'left_eye', 'right_eye',
      'left_ear', 'right_ear',
      'left_shoulder','right_shoulder',
      'left_elbow','right_elbow',
      'left_wrist','right_wrist',
      'left_hip','right_hip',
      'left_knee','right_knee',
      'left_ankle','right_ankle'
    ];
  
    // Map MP name -> MP index
    const MP_IDX = Object.fromEntries(MP_NAMES.map((n,i)=>[n,i]));
  
    // Helper to read/scale one MP landmark
    function kpFromName(lm, videoW, videoH, name) {
      const i = MP_IDX[name];
      const p = lm[i] || {};
      // MP gives normalized coords; scale to pixels for your pipeline
      return {
        name,
        x: (p.x ?? 0) * videoW,
        y: (p.y ?? 0) * videoH,
        // Use visibility if present, else 1.0 to keep present() happy
        score: (typeof p.visibility === 'number' ? p.visibility : 1.0)
      };
    }
  
    return {
      async estimatePoses(video) {
        const ts = performance.now();
        const out = landmarker.detectForVideo(video, ts);
        const lm = out?.landmarks?.[0];
        if (!lm) return [{ keypoints: [] }];
  
        const w = video.videoWidth || video.width || 1;
        const h = video.videoHeight || video.height || 1;
  
        // 1) First 17 keypoints in MoveNet order (fixes your renderer)
        const keypoints17 = MOVENET_17.map(n => kpFromName(lm, w, h, n));
  
        // 2) Append MediaPipe-only feet we need for calves
        const extras = ['left_heel','right_heel','left_foot_index','right_foot_index']
          .map(n => kpFromName(lm, w, h, n));
  
        const keypoints = [...keypoints17, ...extras];
  
        return [{ keypoints }];
      },
      async dispose() { try { landmarker?.close?.(); } catch {} }
    };
}

export async function createPoseDetector(kind = 'movenet') {
  return kind === 'mediapipe' ? createMediaPipePose() : createMoveNet();
}
```

---

## 3. Segmentation engines — REAL CODE

### 3.1 Shared interface

Both engines expose the same duck-typed method, which is how they are interchangeable:

```js
engine.step({ t, features, now, say, setHighlight })
  → { phase, repDelta, repCount, feedback, done, timeHeldMs?, timeRemainingMs?, ... }
```

`DTWPhaseMachine` returns a superset (adds `quality`, `templatePosition`, `deviations`,
`repClassification`, `repSummary`, `activeSide`). It also synthesises a `.spec` object so
downstream code written against the legacy engine keeps working.

### 3.2 Engine selection

From `src/ExerciseTracker_refactored.js`:

```js
    // Choose engine: DTWPhaseMachine (if reference exists) or PhaseMachine (hand-coded spec)
    const ref = getReference(exerciseType);
    const patientId = activityData?.patient?.id || activityData?.userId || activityData?.activity || null;
    let eng;
    if (ref) {
      // Feed the engine the exact universal keys this exercise reports, so each
      // counted rep can carry a per-rep min/max ROM summary to the host app.
      const summaryFeatures = (METRIC_MAP[exerciseType] || [])
        .flatMap(m => resolveMetricKeys(m, side));
      eng = new DTWPhaseMachine(ref, { targetReps, targetSeconds, patientId, side, summaryFeatures });
      // Which template is actually driving rep counting matters a lot when validating
      // a newly recorded reference — 'synthetic' means the recording is NOT in use.
      const src = ref.source || 'synthetic';
      console.log(
        `[Engine] DTW mode for ${exerciseType} — reference source: ${src.toUpperCase()}`,
        patientId ? `(patient: ${patientId})` : '(no patient)'
      );
    } else {
      console.warn(
        `[Engine] No DTW reference for "${exerciseType}" — falling back to legacy PhaseMachine. ` +
        `None of the recent fixes (startCue, side-aware cues, mobile ROM tuning) apply on this path. ` +
        `Check spelling against EXERCISE_CONFIGS keys in src/dtw/specToReference.js.`
      );
      eng = new PhaseMachine(spec, { targetReps, targetSeconds });
    }
    setEngine(eng);
```

**`bootstrapAllReferences()` runs at module load and registers a reference for all 16
exercises**, so `getReference()` always returns truthy and the `else` branch is dead. See §8.

### 3.3 Where the DTW template comes from

```
EXERCISE_CONFIGS[name]          declarative phases: feature sweeps {from, to, easing}
        │                       (src/dtw/specToReference.js)
        ▼ generateReference()
60-frame synthetic template     frames allocated per phase by `weight`, values
        │                       interpolated (linear or sine ease)
        ▼ mirrorFeatures()      generic `kneeAngle` → kneeAngleL / kneeAngleR / kneeAngleMin
        ▼ computeFeatureRanges()  per-feature {min, max, range}
        ▼ registerReference()   in-memory registry, tagged source:'synthetic'
```

Two overrides can replace the synthetic template, **both keyed by exact exercise name**:

1. A `.ref.json` in `src/dtw/references/` (webpack `require.context`), tagged `source:'video'`.
2. A backend-published reference fetched per session (7-day localStorage TTL), tagged `source:'api'`.

**Currently 0 of 16 exercises use a real recorded template** — every live session runs on
the synthetic sine-swept template. The one `.ref.json` present is orphaned (§8).

### 3.4 `src/dtw/dtwEngine.js` — complete, verbatim

```js
// ---------------------------------------------
// dtw/dtwEngine.js
// Online Subsequence DTW for real-time exercise matching.
// Matches a live stream of feature vectors against a reference template.
// ---------------------------------------------

/**
 * Compute weighted Euclidean distance between two feature vectors.
 * Only compares features that are finite in BOTH vectors.
 * Angles are weighted higher than normalized positions (more reliable from pose detection).
 *
 * @param {Object} a - Feature vector { key: value }
 * @param {Object} b - Feature vector { key: value }
 * @param {Object} featureRanges - { key: { min, max, range } } for normalization
 * @param {Object} [weights] - Optional per-feature weights
 * @returns {number} distance (0 = identical, higher = more different)
 */
export function featureDistance(a, b, featureRanges, weights, side) {
  let sumSq = 0;
  let count = 0;
  const fin = Number.isFinite;

  for (const key of Object.keys(b)) {
    // Side-aware filtering
    if (side === 'alternating') {
      // Alternating exercises: skip per-side L/R features; compare only bilateral
      // aggregates (Min/Max/Avg) so whichever leg is active drives the match.
      if (key.endsWith('L') || key.endsWith('R')) continue;
    } else if (side) {
      // Single-side exercise: skip opposite side AND aggregates (polluted by inactive side)
      if (side === 'left' && key.endsWith('R')) continue;
      if (side === 'right' && key.endsWith('L')) continue;
      if (key.endsWith('Min') || key.endsWith('Max') || key.endsWith('Avg')) continue;
    }

    const va = a[key];
    const vb = b[key];
    if (!fin(va) || !fin(vb)) continue;

    // Normalize by feature range so all features contribute equally.
    // Floor of 10 prevents static features (range≈0) from dominating the distance.
    const range = featureRanges?.[key]?.range;
    const norm = Math.max(range || 0, 10);
    const w = weights?.[key] ?? 1;

    const diff = (va - vb) / norm;
    sumSq += w * diff * diff;
    count++;
  }

  return count > 0 ? Math.sqrt(sumSq / count) : Infinity;
}

/**
 * OnlineSubsequenceDTW — streaming DTW that finds repeating matches
 * of a template pattern within a continuous live stream.
 *
 * Based on the Spring/SDTW algorithm:
 * - Maintains a rolling cost matrix (1 row = current frame vs all template frames)
 * - When cost at the last template frame drops below threshold → match found (rep)
 * - Tracks the best-aligned position in the template → current phase
 *
 * Key properties:
 * - Handles variable movement speeds (DTW's core strength)
 * - O(T) per frame where T = template length (~60 frames = trivial)
 * - No window constraint needed for short templates
 */
export class OnlineSubsequenceDTW {
  /**
   * @param {Object} config
   * @param {Array} config.template - Array of { features: {...}, phase: string }
   * @param {Object} config.featureRanges - { key: { min, max, range } }
   * @param {number} [config.matchThreshold=0.5] - Max normalized distance for a rep match
   * @param {number} [config.refractoryFrames=15] - Min frames between rep detections
   * @param {Object} [config.weights] - Optional per-feature weights
   */
  constructor({ template, featureRanges, matchThreshold = 0.5, refractoryFrames = 15, weights, side }) {
    this.template = template;
    this.T = template.length;
    this.featureRanges = featureRanges;
    this.matchThreshold = matchThreshold;
    this.refractoryFrames = refractoryFrames;
    this.weights = weights || null;
    this.side = side || null; // 'left', 'right', or null (both)

    // DTW cost row: cost[j] = best alignment cost ending at template frame j
    // We only need the previous row and current row (space optimization)
    this.prevRow = new Float64Array(this.T).fill(Infinity);
    this.currRow = new Float64Array(this.T).fill(Infinity);

    // Track the best alignment position and its cost
    this.bestTemplateIdx = 0;    // which template frame we're best aligned to
    this.bestCost = Infinity;
    this.framesSinceMatch = this.refractoryFrames; // start ready

    // Per-feature deviation tracking (for feedback)
    this.lastDeviations = {};

    // Running state
    this.frameCount = 0;
  }

  /**
   * Process one new frame from the live stream.
   *
   * @param {Object} liveFeatures - Universal feature vector for current frame
   * @returns {{
   *   phase: string,          - Current phase (from template alignment)
   *   templatePosition: number, - 0..1 progress through template cycle
   *   matchCost: number,      - How well current frame matches aligned template frame
   *   cycleComplete: boolean, - True if a full cycle (rep) was just detected
   *   deviations: Object,     - Per-feature deviation from reference
   *   quality: number,        - 0..1 quality score (1 = perfect match)
   * }}
   */
  step(liveFeatures) {
    this.frameCount++;
    this.framesSinceMatch++;

    // Compute distance from live frame to every template frame
    const distances = new Float64Array(this.T);
    for (let j = 0; j < this.T; j++) {
      distances[j] = featureDistance(
        liveFeatures,
        this.template[j].features,
        this.featureRanges,
        this.weights,
        this.side
      );
    }

    // Update DTW cost matrix (one new row)
    // Subsequence DTW: cost[0] can start fresh from any live frame
    // cost[j] = distance[j] + min(prevRow[j], prevRow[j-1], currRow[j-1])
    for (let j = 0; j < this.T; j++) {
      if (j === 0) {
        // Can start a new alignment from any live frame
        this.currRow[j] = distances[j];
      } else {
        // Standard DTW recurrence:
        // - prevRow[j]   = insertion (live frame skipped in template)
        // - prevRow[j-1] = match (both advance)
        // - currRow[j-1] = deletion (template frame skipped)
        const insertion = this.prevRow[j];
        const match     = this.prevRow[j - 1];
        const deletion  = this.currRow[j - 1];
        this.currRow[j] = distances[j] + Math.min(insertion, match, deletion);
      }
    }

    // Phase detection: use RAW distances (nearest-neighbor) to find which
    // template frame the user most resembles RIGHT NOW.
    // This avoids the accumulated-cost bias that makes bestIdx stick to position 0.
    let nnIdx = 0;
    let nnDist = distances[0];
    for (let j = 1; j < this.T; j++) {
      if (distances[j] < nnDist) {
        nnDist = distances[j];
        nnIdx = j;
      }
    }

    // Tie-breaking matters for held positions. A hold phase repeats the SAME feature
    // values across many template frames, and the adjacent transition phases start/end
    // on those same values — so a patient holding the pose ties exactly against a band
    // of frames spanning [end of transition_in .. hold .. start of transition_out].
    // Taking the first minimum (the loop above) always lands on the transition frame,
    // so the hold phase is never reported and time-mode never accumulates.
    // Resolve exact ties to the MIDDLE of the tied band, which sits inside the hold.
    // Unique minima (the normal case during movement) are unaffected.
    const tieBand = [];
    const tieEps = Math.max(1e-9, Math.abs(nnDist) * 1e-6);
    for (let j = 0; j < this.T; j++) {
      if (Math.abs(distances[j] - nnDist) <= tieEps) tieBand.push(j);
    }
    if (tieBand.length > 1) {
      nnIdx = tieBand[Math.floor(tieBand.length / 2)];
    }

    this.bestTemplateIdx = nnIdx;
    this.bestCost = nnDist;

    // Cycle detection: still uses accumulated DTW cost at end of template
    // (correct for detecting when a full template traversal has occurred)
    const endCost = this.currRow[this.T - 1] / this.T; // normalize by template length
    const cycleComplete = (
      endCost < this.matchThreshold &&
      this.framesSinceMatch >= this.refractoryFrames
    );

    if (cycleComplete) {
      this.framesSinceMatch = 0;
      // Reset the DTW matrix to allow detecting the next rep cleanly
      this.prevRow.fill(Infinity);
      this.currRow.fill(Infinity);
    }

    // Compute per-feature deviations for feedback (against nearest-neighbor frame)
    const alignedFrame = this.template[nnIdx];
    const deviations = {};
    for (const [key, refVal] of Object.entries(alignedFrame.features)) {
      const liveVal = liveFeatures[key];
      if (Number.isFinite(refVal) && Number.isFinite(liveVal)) {
        // Use same floor as distance calculation so static features (range≈0) don't
        // produce inflated normalizedDelta values and trigger false form warnings.
        const range = Math.max(this.featureRanges?.[key]?.range || 0, 10);
        deviations[key] = {
          live: liveVal,
          reference: refVal,
          delta: liveVal - refVal,
          normalizedDelta: (liveVal - refVal) / range,
        };
      }
    }
    this.lastDeviations = deviations;

    // Quality: 1 = perfect, 0 = terrible. Based on distance to nearest frame.
    const alignedDist = nnDist;
    const quality = Math.max(0, Math.min(1, 1 - alignedDist));

    // Swap rows for next iteration
    const tmp = this.prevRow;
    this.prevRow = this.currRow;
    this.currRow = tmp;
    this.currRow.fill(Infinity);

    return {
      phase: alignedFrame.phase,
      templatePosition: nnIdx / (this.T - 1),  // 0..1
      matchCost: alignedDist,
      cycleComplete,
      deviations,
      quality,
    };
  }

  /**
   * Reset the DTW state (e.g., on exercise restart).
   */
  reset() {
    this.prevRow.fill(Infinity);
    this.currRow.fill(Infinity);
    this.bestTemplateIdx = 0;
    this.bestCost = Infinity;
    this.framesSinceMatch = this.refractoryFrames;
    this.lastDeviations = {};
    this.frameCount = 0;
  }
}

/**
 * Offline DTW: compute full DTW alignment between two sequences.
 * Used for quality scoring after a rep is complete, and for
 * reference extraction (aligning multiple reps to find the average).
 *
 * @param {Array} seq1 - Array of feature objects
 * @param {Array} seq2 - Array of feature objects
 * @param {Object} featureRanges - For normalization
 * @returns {{ cost: number, path: Array<[number, number]> }}
 */
export function fullDTW(seq1, seq2, featureRanges) {
  const N = seq1.length;
  const M = seq2.length;

  // Cost matrix
  const cost = Array.from({ length: N }, () => new Float64Array(M).fill(Infinity));

  // Fill first cell
  cost[0][0] = featureDistance(seq1[0], seq2[0], featureRanges);

  // Fill first row
  for (let j = 1; j < M; j++) {
    cost[0][j] = cost[0][j - 1] + featureDistance(seq1[0], seq2[j], featureRanges);
  }

  // Fill first column
  for (let i = 1; i < N; i++) {
    cost[i][0] = cost[i - 1][0] + featureDistance(seq1[i], seq2[0], featureRanges);
  }

  // Fill rest
  for (let i = 1; i < N; i++) {
    for (let j = 1; j < M; j++) {
      const d = featureDistance(seq1[i], seq2[j], featureRanges);
      cost[i][j] = d + Math.min(cost[i - 1][j], cost[i - 1][j - 1], cost[i][j - 1]);
    }
  }

  // Backtrack to find optimal path
  const path = [];
  let i = N - 1, j = M - 1;
  path.push([i, j]);
  while (i > 0 || j > 0) {
    if (i === 0) { j--; }
    else if (j === 0) { i--; }
    else {
      const candidates = [
        { cost: cost[i - 1][j - 1], i: i - 1, j: j - 1 },
        { cost: cost[i - 1][j],     i: i - 1, j: j },
        { cost: cost[i][j - 1],     i: i,     j: j - 1 },
      ];
      const best = candidates.reduce((a, b) => a.cost <= b.cost ? a : b);
      i = best.i;
      j = best.j;
    }
    path.push([i, j]);
  }
  path.reverse();

  return {
    cost: cost[N - 1][M - 1] / path.length, // normalized by path length
    path,
  };
}
```

### 3.5 `src/dtw/DTWPhaseMachine.js` — complete, verbatim

```js
// ---------------------------------------------
// dtw/DTWPhaseMachine.js
// Drop-in replacement for PhaseMachine, driven by DTW reference matching.
// Same .step() interface → no changes needed in ExerciseTracker.
// ---------------------------------------------
import { OnlineSubsequenceDTW } from './dtwEngine.js';
import { computeFeatureRanges, extractPhaseOrder } from './referenceSchema.js';
import { BODY_PART_FEATURE_MAP } from './universalFeatures.js';
import { PatientBaseline } from './PatientBaseline.js';

// How long the bare rep number suppresses all other feedback after a rep counts.
// Was 3000ms, which is longer than a typical rep cycle — corrective cues could
// almost never reach the patient. Safety/overshoot warnings pre-empt this entirely.
const REP_ANNOUNCE_MS = 1200;

// Resolve a startCue against the active side. Accepts either a plain string (returned
// as-is) or an object keyed by side ('left' | 'right' | 'alternating' | 'both').
// Resolution order: exact side match → 'both' → first available variant.
function resolveStartCue(cue, side) {
  if (!cue) return null;
  if (typeof cue === 'string') return cue;
  if (typeof cue === 'object') {
    if (side && cue[side]) return cue[side];
    if (cue.both) return cue.both;
    return cue.left || cue.right || cue.alternating || null;
  }
  return null;
}

export class DTWPhaseMachine {
  /**
   * @param {Object} reference - Reference JSON object (see referenceSchema.js)
   * @param {Object} opts - { targetReps, targetSeconds, patientId, side, summaryFeatures }
   * @param {string[]} opts.summaryFeatures - universal feature keys to capture
   *        per-rep min/max for (drives the `repSummary` payload sent to the host app)
   */
  constructor(reference, { targetReps = 10, targetSeconds, patientId, side, summaryFeatures = [] } = {}) {
    this.reference = reference;
    this.targetReps = targetReps;
    this.patientId = patientId || null;
    this.summaryFeatures = summaryFeatures;

    // Mode
    this.mode = reference.mode === 'time' ? 'time' : 'reps';
    this.isAlternating = reference.side === 'alternating';

    // For alternating exercises, use 'alternating' mode in the DTW engine so it
    // compares only aggregate features (Min/Max/Avg), making both legs visible.
    // The JWT 'side' indicates the affected side but must not restrict rep counting.
    this.side = this.isAlternating ? 'alternating' : (side || null);

    // Compute feature ranges if not provided
    this.featureRanges = reference.featureRanges || computeFeatureRanges(reference.template);

    // Extract phase order and rep cycle (full cycle: start → effort → return)
    this.phaseOrder = extractPhaseOrder(reference.template);
    const rawCycle = reference.repCycle || {};
    // Support both old { from, to } and new { start, effort, return } formats
    this.repCycle = {
      start:  rawCycle.start  ?? rawCycle.from ?? this.phaseOrder[0],
      effort: rawCycle.effort ?? rawCycle.to   ?? this.phaseOrder[1],
      return: rawCycle.return ?? rawCycle.from ?? this.phaseOrder[0],
    };

    // Timing
    const timing = reference.timing || {};
    this.dwellMs = timing.dwellMs ?? 200;
    this.refractoryMs = timing.refractoryMs ?? 300;

    // Time-mode config
    this.targetMs = this.mode === 'time'
      ? (typeof targetSeconds === 'number' ? targetSeconds * 1000
        : (typeof targetReps === 'number' ? targetReps * 1000 : 5000))
      : null;
    this.targetPhaseId = this.repCycle.effort;

    // Build the DTW engine
    this.dtw = new OnlineSubsequenceDTW({
      template: reference.template,
      featureRanges: this.featureRanges,
      matchThreshold: timing.matchThreshold ?? 0.5,
      refractoryFrames: Math.max(5, Math.round((this.refractoryMs / 1000) * (timing.fps || 30))),
      weights: reference.featureWeights || null,
      side: this.side,
    });

    // Feedback config
    this.feedback = reference.feedback || {};
    this.formDeviationThreshold = reference.formDeviationThreshold ?? 0.5;

    // State
    this.phase = null;
    this.prevPhase = null;
    this.repCount = 0;
    this.lastFeedback = '';
    this.refractoryUntil = 0;
    this.lastPhaseEnterAt = 0;
    this._repAnnouncedUntil = 0; // suppress lower-priority feedback for REP_ANNOUNCE_MS after a rep counts

    // Time-mode timers
    this.holdStartMs = null;
    this.accumHoldMs = 0;

    // Rep tracking — full cycle state machine: idle → sawStart → sawEffort → completed
    this.cycleState = 'idle'; // 'idle' | 'sawStart' | 'sawEffort'
    this.effortEnteredAt = 0; // timestamp when arm entered sawEffort (used for time-based return gate)

    // Alternating guardrail: track which side was used per rep
    this.lastActiveSide = null;        // side counted on the previous rep
    this.activeSideDuringCycle = null; // side detected during the current cycle

    // Primary feature ROM tracking: measure actual movement instead of template position.
    // Honor an explicit `reference.primaryFeature` override first (used by bilateral-symmetric
    // exercises like MiniSquats that want side-independent tracking via an aggregate feature).
    // Otherwise fall back to the auto-picker: largest-range feature filtered by active side.
    let bestKey = null;
    let bestRange = 0;
    if (reference.primaryFeature && this.featureRanges[reference.primaryFeature]) {
      bestKey = reference.primaryFeature;
      bestRange = this.featureRanges[reference.primaryFeature].range || 0;
    } else {
      for (const [key, stats] of Object.entries(this.featureRanges)) {
        if (this.isAlternating) {
          // Alternating: primary feature must be an aggregate (Min/Max/Avg) so it
          // captures whichever leg is active rather than one specific side.
          if (key.endsWith('L') || key.endsWith('R')) continue;
        } else if (this.side) {
          if (this.side === 'left' && key.endsWith('R')) continue;
          if (this.side === 'right' && key.endsWith('L')) continue;
          if (key.endsWith('Min') || key.endsWith('Max') || key.endsWith('Avg')) continue;
        }
        if ((stats.range || 0) > bestRange) {
          bestRange = stats.range;
          bestKey = key;
        }
      }
    }
    // Resolve side-generic clinical caps (e.g. { shoulderAngle: { max: 95 } }) into the
    // concrete universal keys to watch. For a single-side session only that side is
    // checked; bilateral/alternating sessions watch both sides plus the aggregate the
    // template actually uses, so a cap still applies when the primary feature is a Min/Max.
    this.clinicalCaps = [];
    const capSource = reference.clinicalCaps || null;
    if (capSource) {
      const AGG_SUFFIX = { Min: 'Min', Max: 'Max', Avg: 'Avg' };
      for (const [base, limits] of Object.entries(capSource)) {
        const keys = [];
        if (this.side === 'left') keys.push(`${base}L`);
        else if (this.side === 'right') keys.push(`${base}R`);
        else keys.push(`${base}L`, `${base}R`);
        // Include whichever aggregate form exists in this reference's ranges.
        for (const suf of Object.keys(AGG_SUFFIX)) {
          if (this.featureRanges[`${base}${suf}`]) keys.push(`${base}${suf}`);
        }
        for (const key of keys) {
          this.clinicalCaps.push({
            key,
            min: Number.isFinite(limits?.min) ? limits.min : null,
            max: Number.isFinite(limits?.max) ? limits.max : null,
          });
        }
      }
    }

    this.primaryFeature = bestKey;
    this.primaryFeatureRange = bestRange;
    this.minRomForRep = (reference.minRomPct ?? 0.25) * bestRange; // % of template range = meaningful movement
    this.cycleFeatureMin = Infinity;
    this.cycleFeatureMax = -Infinity;
    this.cycleSummary = {}; // { <featureKey>: { min, max } } for the in-flight rep
    console.log(`[DTW] Primary feature: ${bestKey} range=${bestRange.toFixed(1)} minROM=${this.minRomForRep.toFixed(1)} side=${this.side}`);

    // Effort-adjacent phases: include transition phases leading to the effort phase
    // so limited-ROM patients who reach transition_up (but not raised) still get reps
    const effortIdx = this.phaseOrder.indexOf(this.repCycle.effort);
    this.effortPhases = new Set([this.repCycle.effort]);
    if (effortIdx > 0) {
      const prevPhase = this.phaseOrder[effortIdx - 1];
      if (prevPhase !== this.repCycle.start && prevPhase !== this.repCycle.return) {
        this.effortPhases.add(prevPhase);
      }
    }

    // Patient baseline (D-phase: adaptive ROM)
    this.patientBaseline = null;
    if (this.patientId) {
      this.patientBaseline = new PatientBaseline(reference.name, this.patientId, {
        referenceRanges: this.featureRanges,
      });
    }

    // Reference start value for the primary feature — used as a guard to prevent
    // counting a rep when the DTW mislabels the return phase while the limb is
    // still mid-range (happens when DTW quality is low and template position drifts).
    // Computed as the mean primary-feature value across all start-phase frames.
    this.refStartValue = null;
    this.refEffortValue = null;
    this.templateDirection = 0; // -1 (effort decreases primary), +1 (increases), 0 (same)
    if (this.primaryFeature && Array.isArray(reference.template) && reference.template.length > 0) {
      const startFrames = reference.template.filter(f => f.phase === this.repCycle.start);
      const startVals = startFrames.map(f => f.features?.[this.primaryFeature]).filter(Number.isFinite);
      if (startVals.length > 0) {
        this.refStartValue = startVals.reduce((a, b) => a + b, 0) / startVals.length;
      }
      const effortFrames = reference.template.filter(f => f.phase === this.repCycle.effort);
      const effortVals = effortFrames.map(f => f.features?.[this.primaryFeature]).filter(Number.isFinite);
      if (effortVals.length > 0) {
        this.refEffortValue = effortVals.reduce((a, b) => a + b, 0) / effortVals.length;
      }
      if (this.refStartValue !== null && this.refEffortValue !== null) {
        this.templateDirection = Math.sign(this.refEffortValue - this.refStartValue);
      }
    }

    // Build a spec-like object for compatibility
    this.spec = {
      name: reference.name,
      mode: this.mode,
      detector: reference.detector || 'movenet',
      phases: this.phaseOrder.map(id => ({ id })),
      rep: { from: this.repCycle.start, to: this.repCycle.effort },
      framing: reference.framing || undefined,
      startCue: resolveStartCue(reference.startCue, this.side) || undefined,
    };

    // One-line health summary — verifies the engine resolved sensible defaults.
    // primaryFeature and minRomForRep are the two most common silent-failure points.
    // Adaptive precision so tiny thresholds (e.g. footPitchNorm) aren't shown as "0.0"
    const fmt = (n) => (n == null ? 'null' : (Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(3)));
    console.log(
      `[DTW] Engine ready: ${reference.name} | mode=${this.mode} side=${this.side} ` +
      `detector=${this.spec.detector} primary=${this.primaryFeature} ` +
      `refStartValue=${fmt(this.refStartValue)} ` +
      `minRomForRep=${fmt(this.minRomForRep)} ` +
      `effortPhases=${[...this.effortPhases].join(',')} ` +
      `repCycle=${this.repCycle.start}->${this.repCycle.effort}->${this.repCycle.return || this.repCycle.start} ` +
      `targetReps=${this.targetReps ?? '—'} targetMs=${this.targetMs ?? '—'} ` +
      `patientBaseline=${this.patientBaseline ? 'on' : 'off'}`
    );
  }

  resetCounters() {
    this.phase = null;
    this.prevPhase = null;
    this.repCount = 0;
    this.lastFeedback = '';
    this.refractoryUntil = 0;
    this.lastPhaseEnterAt = 0;
    this.holdStartMs = null;
    this.accumHoldMs = 0;
    this.cycleState = 'idle';
    this.effortEnteredAt = 0;
    this._movedAwayAt = null;
    this._prevPrimaryValue = null;
    this.cycleFeatureMin = Infinity;
    this.cycleFeatureMax = -Infinity;
    this.cycleSummary = {}; // { <featureKey>: { min, max } } for the in-flight rep
    this.lastActiveSide = null;
    this.activeSideDuringCycle = null;
    this._repAnnouncedUntil = 0;
    this.dtw.reset();
    // Don't reset patient baseline on counter reset — it persists across the session
  }

  /**
   * Same interface as PhaseMachine.step().
   * @param {Object} inputs - { t, features, now, say, setHighlight }
   * @returns {Object} - { phase, repDelta, repCount, feedback, done, timeHeldMs?, timeRemainingMs? }
   */
  step({ t, features, now = performance.now(), say, setHighlight }) {
    // Velocity filter on the primary feature. At typical FPS (10-30), a real exercise
    // motion changes the joint angle by at most ~10° per frame. Single-frame jumps of
    // 25°+ are body-translation artifacts, MediaPipe heel/foot keypoint instability, or
    // background-edge confusion — NOT real motion. Mask such jumps as NaN so they don't
    // pollute movedEnough / nearStart / cycleFeatureMin/Max.
    //
    // _prevPrimaryValue stays at the last GOOD value during a rejection streak so the
    // engine doesn't lose track of the legitimate baseline.
    //
    // Trade-off: at very low FPS (<5), real motion can exceed 25°/frame and get filtered.
    // For rehab-grade exercises at 10+ FPS this is the right cutoff.
    if (this.primaryFeature) {
      const pVal = features[this.primaryFeature];
      const prev = this._prevPrimaryValue;
      if (Number.isFinite(pVal) && Number.isFinite(prev) && Math.abs(pVal - prev) > 20) {
        features = { ...features, [this.primaryFeature]: NaN };
      } else if (Number.isFinite(pVal)) {
        this._prevPrimaryValue = pVal;
      }
    }

    // Feed frame to patient baseline tracker
    if (this.patientBaseline) {
      this.patientBaseline.updateFrame(features);
    }

    // Run DTW matching
    const result = this.dtw.step(features);
    let repDelta = 0;
    let repClassification = null;
    let repSummary = null;

    // Diagnostic: throttled DTW state logging (every 60 frames)
    if (!this._diagFC) this._diagFC = 0;
    if (++this._diagFC % 60 === 0) {
      const pf = this.primaryFeature;
      const pVal = pf && Number.isFinite(features[pf]) ? features[pf].toFixed(1) : 'NaN';
      const range = this.featureRanges[pf];
      const rMin = range ? range.min?.toFixed(1) : '?';
      const rMax = range ? range.max?.toFixed(1) : '?';
      console.log(
        `[DTW-diag] phase=${this.phase || '—'} cycle=${this.cycleState}` +
        ` quality=${(result.quality ?? 0).toFixed(3)} tPos=${(result.templatePosition ?? 0).toFixed(2)}` +
        ` pf=${pf}=${pVal} (ref ${rMin}→${rMax}) rom=${(this.cycleFeatureMax - this.cycleFeatureMin).toFixed(1)}` +
        ` minRom=${this.minRomForRep.toFixed(1)} reps=${this.repCount}`
      );
    }

    // Phase detection with dwell
    const newPhase = result.phase;
    if (!this.phase) {
      this.phase = newPhase;
      this.lastPhaseEnterAt = now;
      // Initialize cycle state on first phase detection
      if (this.mode === 'reps' && this.phase === this.repCycle.start) {
        this.cycleState = 'sawStart';
        this.cycleFeatureMin = Infinity;
        this.cycleFeatureMax = -Infinity;
        this.cycleSummary = {};
        this.activeSideDuringCycle = null;
      }
    } else if (newPhase !== this.phase) {
      if (now - this.lastPhaseEnterAt >= this.dwellMs) {
        this.prevPhase = this.phase;
        this.phase = newPhase;
        this.lastPhaseEnterAt = now;
      }
    }

    // Track actual ROM of primary feature during current cycle
    if (this.cycleState !== 'idle' && this.primaryFeature) {
      const pVal = features[this.primaryFeature];
      if (Number.isFinite(pVal)) {
        this.cycleFeatureMin = Math.min(this.cycleFeatureMin, pVal);
        this.cycleFeatureMax = Math.max(this.cycleFeatureMax, pVal);
      }
    }

    // Track min/max of every reported metric during the cycle, so a counted rep
    // can ship a true per-rep ROM summary to the host app / backend.
    if (this.cycleState !== 'idle') {
      for (const key of this.summaryFeatures) {
        const v = features[key];
        if (!Number.isFinite(v)) continue;
        const cur = this.cycleSummary[key];
        if (cur) {
          cur.min = Math.min(cur.min, v);
          cur.max = Math.max(cur.max, v);
        } else {
          this.cycleSummary[key] = { min: v, max: v };
        }
      }
    }
    const actualRom = this.cycleFeatureMax - this.cycleFeatureMin;
    const romOk = actualRom >= this.minRomForRep;

    // Detect which leg is active during this cycle (alternating guardrail)
    if (this.isAlternating && this.cycleState !== 'idle') {
      const hL = features.hipAngleL;
      const hR = features.hipAngleR;
      // Only assign when one leg is clearly more flexed (>30° difference) to avoid
      // mis-detecting side when both legs are near the resting position
      if (Number.isFinite(hL) && Number.isFinite(hR) && Math.abs(hL - hR) > 30) {
        this.activeSideDuringCycle = hL < hR ? 'left' : 'right';
      }
    }

    // Rep counting (reps mode): full cycle start → effort → return
    // Runs every frame (not just on phase transitions) for responsiveness
    if (this.mode === 'reps') {
      // Two paths to advance idle → sawStart:
      // (a) DTW labels current phase as the start phase, OR
      // (b) Primary feature is at the start position (covers the case where the user
      //     starts at rest before DTW phase has stabilized — common on mobile, fixes
      //     "first rep not detected" on exercises like LiftsAndChops).
      if (this.cycleState === 'idle'
          && (this.phase === this.repCycle.start || this._primaryFeatureNearStart(features))) {
        this.cycleState = 'sawStart';
        this.cycleFeatureMin = Infinity;
        this.cycleFeatureMax = -Infinity;
        this.cycleSummary = {};
        this.activeSideDuringCycle = null;
      }
      if (this.cycleState === 'sawStart') {
        const pVal = this.primaryFeature ? features[this.primaryFeature] : null;
        // Direction-aware gate: motion must be in the SAME direction as the template's
        // effort phase (e.g. CalfRaisesSeated expects footPitchNorm to INCREASE; if the
        // user dorsiflexes or shifts their body and the value DECREASES, that's not a rep).
        // templateDirection is -1 (effort decreases primary), +1 (increases), or 0 (no
        // direction defined — fall back to direction-agnostic).
        // Uses raw feature value directly so fast movements aren't missed when the DTW
        // phase label is too noisy to pass the dwell filter.
        let movedEnough = false;
        if (Number.isFinite(pVal) && this.refStartValue !== null) {
          const delta = pVal - this.refStartValue;
          const sameDirection = this.templateDirection === 0
            || Math.sign(delta) === this.templateDirection;
          movedEnough = sameDirection && Math.abs(delta) >= this.minRomForRep;
        }
        // Phase-label fallback: only when keypoints are missing (pVal=NaN).
        const phaseFallback = !Number.isFinite(pVal) && this.effortPhases.has(this.phase);
        if (movedEnough || phaseFallback) {
          // Hysteresis: require sustained movement for ≥100ms before transitioning.
          // A single-frame keypoint spike won't satisfy this, killing spike-triggered
          // false reps (esp. on BicepCurls where wrist jitter swings elbowAngle 20-30°).
          if (this._movedAwayAt == null) this._movedAwayAt = now;
          if ((now - this._movedAwayAt) >= 100) {
            this.cycleState = 'sawEffort';
            this.effortEnteredAt = now;
            this._movedAwayAt = null;
            // Reset cycle ROM trackers so the spike sample doesn't pollute actualRom.
            this.cycleFeatureMin = Number.isFinite(pVal) ? pVal : Infinity;
            this.cycleFeatureMax = Number.isFinite(pVal) ? pVal : -Infinity;
          }
        } else {
          this._movedAwayAt = null;
        }
      }
      // Rep-gate conditions (excluding refractory). Used both to count a rep AND to
      // detect "would-have-counted" cycles that need to be absorbed during refractory.
      const repGateReady = this.cycleState === 'sawEffort'
          && (now - this.effortEnteredAt) >= 300
          && romOk && this._primaryFeatureNearStart(features);

      if (repGateReady && now >= this.refractoryUntil) {
        // Full cycle complete with meaningful movement — check alternating guardrail
        if (this._alternatingSideOk()) {
          repClassification = this._classifyRep(features, result.quality);
          // Always count the rep — cycleState/time/ROM/refractory gates already validated it.
          // completed vs attempt is metadata for telemetry, not a counting gate.
          this.repCount++;
          repDelta = 1;
          this.lastActiveSide = this.activeSideDuringCycle;
          console.log(`[DTW] Rep ${this.repCount} | classification=${repClassification.completed ? 'completed' : 'attempt'} romPct=${((repClassification.romPct ?? 0) * 100).toFixed(0)}% details=`, repClassification.details);
        }
        console.log(`[DTW] Rep! rom=${actualRom.toFixed(1)} min=${this.minRomForRep.toFixed(1)} reps=${this.repCount} activeSide=${this.activeSideDuringCycle} lastSide=${this.lastActiveSide}`);
        if (repDelta > 0) {
          repSummary = this._buildRepSummary();
          this._repAnnouncedUntil = now + REP_ANNOUNCE_MS;
        }
        this.refractoryUntil = now + this.refractoryMs;
        this.cycleState = 'sawStart'; // ready for next cycle (already at start)
        this.cycleFeatureMin = Infinity;
        this.cycleFeatureMax = -Infinity;
        this.cycleSummary = {};
        this.activeSideDuringCycle = null;
        this._movedAwayAt = null;
      } else if (repGateReady && now < this.refractoryUntil) {
        // Block-and-reset: rep would have counted but refractory blocks it. Reset
        // cycleState anyway so the suppressed sawEffort doesn't carry over and trigger
        // a rep the moment refractory expires. Critical for StepUps where the down
        // motion looks like a complete rep cycle to the engine.
        this.cycleState = 'sawStart';
        this.cycleFeatureMin = Infinity;
        this.cycleFeatureMax = -Infinity;
        this.cycleSummary = {};
        this.activeSideDuringCycle = null;
        this._movedAwayAt = null;
      }
    }

    // Backup: DTW cycle detection can advance the cycle state even without
    // phase transitions (handles edge cases where phase labels are noisy)
    if (result.cycleComplete && repDelta === 0 && this.mode === 'reps' && now >= this.refractoryUntil) {
      // Only count if we've seen at least the effort phase AND meaningful ROM
      if (this.cycleState === 'sawEffort' && romOk && this._primaryFeatureNearStart(features)) {
        if (this._alternatingSideOk()) {
          repClassification = this._classifyRep(features, result.quality);
          // Always count — see primary-path comment above.
          this.repCount++;
          repDelta = 1;
          this.lastActiveSide = this.activeSideDuringCycle;
          console.log(`[DTW-backup] Rep ${this.repCount} | classification=${repClassification.completed ? 'completed' : 'attempt'} romPct=${((repClassification.romPct ?? 0) * 100).toFixed(0)}% details=`, repClassification.details);
        }
        console.log(`[DTW-backup] Rep! rom=${actualRom.toFixed(1)} min=${this.minRomForRep.toFixed(1)} reps=${this.repCount} activeSide=${this.activeSideDuringCycle} lastSide=${this.lastActiveSide}`);
        if (repDelta > 0) {
          repSummary = this._buildRepSummary();
          this._repAnnouncedUntil = now + REP_ANNOUNCE_MS;
        }
        this.refractoryUntil = now + this.refractoryMs;
        // Match the primary rep path: the limb is back at the start position, so the
        // next cycle begins at 'sawStart'. Previously this path reset to 'idle', which
        // meant a rep counted via the backup route required an extra start-phase
        // detection before the next rep could register.
        this.cycleState = 'sawStart';
        this.cycleFeatureMin = Infinity;
        this.cycleFeatureMax = -Infinity;
        this.cycleSummary = {};
        this.activeSideDuringCycle = null;
        this._movedAwayAt = null;
      }
    }

    // Time-mode accounting
    let timeHeldMs = 0;
    let timeRemainingMs = null;

    if (this.mode === 'time' && this.targetPhaseId) {
      const inTarget = this.phase === this.targetPhaseId;

      if (inTarget) {
        if (this.holdStartMs == null) this.holdStartMs = now;
      } else if (this.holdStartMs != null) {
        this.accumHoldMs += now - this.holdStartMs;
        this.holdStartMs = null;
      }

      timeHeldMs = this.accumHoldMs;
      if (this.holdStartMs != null) {
        timeHeldMs += Math.max(0, now - this.holdStartMs);
      }

      timeRemainingMs = Math.max(0, (this.targetMs ?? 0) - timeHeldMs);
      this.repCount = Math.floor(timeHeldMs / 1000); // legacy HUD
    }

    // Feedback (priority: safety cap > rep announce > form > range > tempo > phase)
    const fb = this._pickFeedback(result, features, now);
    this.lastFeedback = fb;

    // Done?
    const done = this.mode === 'time'
      ? (this.targetMs != null ? timeHeldMs >= this.targetMs : false)
      : this.repCount >= this.targetReps;

    return {
      phase: this.phase,
      repDelta,
      repCount: this.repCount,
      feedback: this.lastFeedback,
      done,
      timeHeldMs: this.mode === 'time' ? timeHeldMs : undefined,
      timeRemainingMs: this.mode === 'time' ? Math.max(0, timeRemainingMs ?? 0) : undefined,
      // Extra DTW-specific data (available but not required by ExerciseTracker)
      quality: result.quality,
      templatePosition: result.templatePosition,
      deviations: result.deviations,
      // Patient baseline data
      repClassification,
      // Per-rep ROM summary — non-null only on the frame a rep is counted
      repSummary,
      isCalibrating: this.patientBaseline?.isCalibrating ?? false,
      completedReps: this.patientBaseline?.reps?.completed ?? this.repCount,
      attemptedReps: this.patientBaseline?.reps?.attempts ?? 0,
      totalReps: this.patientBaseline?.reps?.total ?? this.repCount,
      activeSide: this.activeSideDuringCycle,   // null when idle; 'left'/'right' during rep
    };
  }

  /**
   * Snapshot the in-flight cycle's min/max per tracked metric for the rep that
   * just counted. Values are rounded the same way the live payload rounds them.
   * @returns {Object|null} { rep, features: { <key>: { min, max } } }
   */
  _buildRepSummary() {
    const round = (v) => (Math.abs(v) < 2 ? Number(v.toFixed(2)) : Math.round(v));
    const out = {};
    for (const [key, { min, max }] of Object.entries(this.cycleSummary)) {
      if (!Number.isFinite(min) || !Number.isFinite(max)) continue;
      out[key] = { min: round(min), max: round(max) };
    }
    if (!Object.keys(out).length) return null;
    return { rep: this.repCount, features: out };
  }

  /**
   * Guard: primary feature must be near the reference's start position before a rep counts.
   * Prevents false counts when DTW quality is low and the phase label says "lowered/start"
   * while the limb is actually still mid-range (e.g. shoulderAngle=67° labelled "lowered").
   * Tolerance = minRomForRep (25-35% of reference range).
   */
  _primaryFeatureNearStart(features) {
    if (!this.primaryFeature || this.refStartValue == null) return true;
    const pVal = features[this.primaryFeature];
    if (!Number.isFinite(pVal)) return true; // can't verify — give benefit of doubt
    return Math.abs(pVal - this.refStartValue) <= this.minRomForRep;
  }

  /**
   * Returns true if the current rep is on the correct side (alternating guardrail).
   * Non-alternating exercises always return true.
   */
  _alternatingSideOk() {
    if (!this.isAlternating) return true;
    if (!this.activeSideDuringCycle) return true; // couldn't detect side: benefit of doubt
    if (!this.lastActiveSide) return true;         // first rep: any side OK
    return this.activeSideDuringCycle !== this.lastActiveSide;
  }

  /**
   * Absolute safety check, independent of the DTW template.
   *
   * Two sources, either of which flags a violation:
   *  1. `clinicalCaps` from the exercise config — fixed, clinician-reviewable limits.
   *  2. PatientBaseline.checkSafety — the gold-standard envelope, once calibrated.
   *
   * Template-relative overshoot (_detectOvershoot) can't be relied on for this: it
   * triggers at `range.max + 20% of range`, which for a wide sweep lands well beyond
   * anything physically reachable.
   *
   * @returns {boolean} true if any watched feature is outside its safe limit
   */
  _exceedsClinicalCap(features) {
    for (const cap of this.clinicalCaps) {
      const v = features[cap.key];
      if (!Number.isFinite(v)) continue;
      if (cap.max !== null && v > cap.max) return true;
      if (cap.min !== null && v < cap.min) return true;
    }
    // Patient-specific envelope (only meaningful once the baseline has locked).
    if (this.patientBaseline && !this.patientBaseline.isCalibrating) {
      for (const cap of this.clinicalCaps) {
        const v = features[cap.key];
        if (!Number.isFinite(v)) continue;
        const verdict = this.patientBaseline.checkSafety(cap.key, v);
        if (verdict && verdict.safe === false) return true;
      }
    }
    return false;
  }

  _pickFeedback(dtwResult, features, now = performance.now()) {
    const fb = this.feedback;
    const deviations = dtwResult.deviations;

    // 0. Safety ceiling — HIGHEST priority, above the rep announcement. A patient
    // moving past a clinical limit needs to hear it immediately; suppressing it
    // behind the rep number is how "don't raise above 90°" went silent.
    if (this._exceedsClinicalCap(features) && fb.range?.tooMuch) {
      return fb.range.tooMuch;
    }

    // 0a. Rep just counted: announce the number for REP_ANNOUNCE_MS.
    // Uses the caller-supplied clock (same one that set _repAnnouncedUntil) rather
    // than wall time, so the window is consistent and deterministic under test.
    if (now < this._repAnnouncedUntil) {
      return String(this.repCount);
    }

    // 0b. Alternating guardrail: warn when same leg used twice in a row
    if (this.isAlternating && this.cycleState === 'sawEffort'
        && this.activeSideDuringCycle && this.lastActiveSide
        && this.activeSideDuringCycle === this.lastActiveSide) {
      return 'Switch legs — alternate each step!';
    }

    // 1. Form/safety: only check posture during stable phases (lowered/raised).
    // During movement phases the user can't act on posture cues — let phase cues through.
    const isStablePhase = this.cycleState === 'idle' || this.cycleState === 'sawStart';
    if (isStablePhase && fb.form && Array.isArray(fb.form)) {
      for (const formRule of fb.form) {
        const featureKeys = BODY_PART_FEATURE_MAP[formRule.bodyPart] || [];
        for (const key of featureKeys) {
          const dev = deviations[key];
          if (dev && Math.abs(dev.normalizedDelta) > this.formDeviationThreshold) {
            return formRule.say;
          }
        }
      }
    }

    // 2. Range: check if patient isn't reaching far enough or overshooting
    if (fb.range) {
      const pos = dtwResult.templatePosition;
      // Near the peak of the movement (70-100% through template) but quality is low
      if (pos > 0.5 && pos < 0.9 && dtwResult.quality < 0.5 && fb.range.tooLittle) {
        return fb.range.tooLittle;
      }
      // Overshoot detection: features exceed reference range
      if (this._detectOvershoot(deviations) && fb.range.tooMuch) {
        return fb.range.tooMuch;
      }
    }

    // 3. Tempo (future: needs movement speed tracking)

    // 4. Phase feedback (default)
    if (fb.phase && this.phase) {
      return fb.phase[this.phase] || fb.phase.transition || this.lastFeedback;
    }

    return this.lastFeedback || '';
  }

  /**
   * Check if any feature significantly overshoots the reference range.
   */
  _detectOvershoot(deviations) {
    // Only check the primary movement feature — checking all features causes static
    // posture features (trunk/hip with range≈0) to trigger false "too much" warnings.
    if (!this.primaryFeature) return false;
    const dev = deviations[this.primaryFeature];
    if (!dev) return false;
    const range = this.featureRanges[this.primaryFeature];
    if (!range || range.range < 20) return false;
    return dev.live > range.max + 0.2 * range.range
        || dev.live < range.min - 0.2 * range.range;
  }

  /**
   * Classify a detected rep as completed or attempt using PatientBaseline.
   * If no baseline is set, all reps count as completed.
   */
  _classifyRep(features, quality) {
    if (!this.patientBaseline) {
      return { completed: true, quality, romPct: 1.0, details: {} };
    }
    return this.patientBaseline.onRepDetected(features, quality);
  }

  /**
   * Save the patient baseline to localStorage.
   * Call at session end (onComplete).
   */
  saveBaseline() {
    if (this.patientBaseline) {
      this.patientBaseline.saveToStorage();
    }
  }

  /**
   * Get session summary for backend sync.
   */
  getSessionSummary() {
    return this.patientBaseline?.getSessionSummary() || {
      exerciseName: this.reference.name,
      reps: { completed: this.repCount, attempts: 0, total: this.repCount },
    };
  }

  /**
   * Get progress vs previous sessions.
   */
  getProgress() {
    return this.patientBaseline?.getProgress() || null;
  }
}
```

### 3.6 Legacy `PhaseMachine` — summarized (DEAD CODE)

`src/phase_machine.js` (228 lines) is the original rule-based engine, paired with 16
declarative spec files in `src/specs/`. **It is unreachable in the current build.**

- **Interface:** identical `step({ t, features, now, say, setHighlight })`.
- **Phase detection:** each spec phase carries an `enter` string (e.g.
  `"shoulderAngle >= 70 && shoulderAngle <= 95"`). `evalBool()` compiles it with
  `new Function(...featureKeys, 'Math', 'return (expr) ? true : false')` and evaluates it
  against the live feature object. First matching phase wins; a `dwellMs` (default 120 ms)
  must elapse before a different phase is committed.
- **Rep counting:** increments when the phase transitions `rep.from → rep.to`, gated by
  `refractoryMs` (default 300 ms). A `repMode: 'pair'` variant requires alternating sides
  via a spec-supplied `selectActiveSide(features)` before counting.
- **Feedback:** an ordered `feedback[]` array of `{ when, say }` rules, evaluated with the
  same string-eval mechanism; **first match wins**.
- **Notable risk if ever revived:** arbitrary string evaluation via the `Function`
  constructor, with all errors swallowed (a malformed expression silently returns `false`
  rather than raising).

---

## 4. Working vs. broken exercise — REAL CODE

**Working:** `BicepCurls` — upper body, MoveNet, large unambiguous signal.
**Poor:** `SeatedDorsiflexion` — ankle flexion, MediaPipe-dependent, smallest signal-to-noise
ratio in the system.

### 4.1 `BicepCurls` — verbatim from `src/dtw/specToReference.js`

```js
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
    // Legacy spec treated elbowAngle <= 75 as a complete curl; below ~40° the
    // forearm is jammed against the biceps with no useful load. TODO clinical review.
    clinicalCaps: { elbowAngle: { min: 40 } },
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
      range: { tooLittle: 'Try to curl a bit higher', tooMuch: "That's high enough — don't jam your forearm" },
      tempo: { tooFast: 'Slow down, control the movement' },
    },
  },
```

### 4.2 `SeatedDorsiflexion` — verbatim from `src/dtw/specToReference.js`

```js
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
    // Dorsiflexion drives footPitchNorm NEGATIVE (toes up), so the ceiling is a `min`.
    // Target is -0.05; past -0.12 the patient is lifting the whole leg rather than
    // dorsiflexing the ankle. TODO clinical review.
    clinicalCaps: { footPitchNorm: { min: -0.12 } },
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
      range: { tooLittle: 'Try to pull your toes up more', tooMuch: "That's far enough — keep your heel down" },
      tempo: { tooFast: 'Slow and controlled' },
    },
  },
```

### 4.3 Side-by-side

| | **BicepCurls** (works) | **SeatedDorsiflexion** (poor) |
|---|---|---|
| Detector | MoveNet (17 kp) | **MediaPipe** (needs heel + foot_index) |
| Keypoints in the chain | shoulder → elbow → wrist | knee → ankle → heel/foot_index |
| Primary feature | `elbowAngleL/R` | `footPitchNormL/R` |
| Feature definition | angle(shoulder, elbow, wrist), **degrees** | (toe.y − heel.y) / shankLen, **unitless ratio** |
| Template sweep | 158° → 52° (**106° of range**) | 0.12 → −0.05 (**0.17 of range**) |
| `minRomPct` | 0.40 → ~42° required | **0.80** → ~0.14 required |
| `dwellMs` | 200 (default) | **400** |
| `refractoryMs` | 300 (default) | 300 (default) |
| Framing | front | side |
| Clinical cap | `elbowAngle.min = 40` | `footPitchNorm.min = −0.12` |
| Extra guards needed | velocity filter only | velocity filter + **`footValid` chair-leg guard** + direction-aware gate |

**Why the second one is structurally harder:**

1. **Keypoint availability.** Elbow angle uses three of the most reliably-detected COCO
   joints. Foot pitch depends on `heel` and `foot_index`, which exist *only* in MediaPipe
   and are among its least stable landmarks.
2. **Signal magnitude.** The curl produces ~106° of unambiguous change. Real dorsiflexion
   moves `footPitchNorm` by roughly 0.05–0.15 — a range comparable to the keypoint noise
   floor. A commit comment records that the earlier angle-based formulation yielded only
   "5–15° of real signal against 50° template assumptions."
3. **Background confusion.** MediaPipe latches onto vertical chair legs as foot landmarks.
   `universalFeatures.js` therefore invalidates all foot features whenever heel↔toe span
   exceeds 90% of shank length — a guard no upper-body exercise requires.
4. **Feature collision.** Calf raises and dorsiflexion drive the *same* feature in
   *opposite* directions. This is why the engine carries `templateDirection` and a
   direction-aware ROM gate: without it, a calf raise satisfies the dorsiflexion gate.
5. **Compensating thresholds.** `minRomPct: 0.80` and `dwellMs: 400` are noise
   suppression, but they raise the bar for genuine reps — a stroke patient with limited
   ankle ROM may be unable to clear 80% of template range, so real reps go uncounted.
   This is a direct sensitivity/specificity trade-off with no good setting.
6. **Never validated against a real recording.** Like all 16, this runs on a synthetic
   sine-swept template. Its phase boundaries were authored, not measured.

---

## 5. Recording format — REAL SAMPLE

### 5.1 Do we record skeleton sessions? **No.**

`src/VideoRecorder.js` and `src/SkeletonRecorder.js` both capture a `<canvas>` stream and
encode it with `MediaRecorder`:

```js
const canvasStream = hiddenCanvasRef.current.captureStream(30); // 30 FPS
mediaRecorderRef.current = new MediaRecorder(canvasStream, { mimeType: supported });
...
const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
```

- `VideoRecorder` → webcam frames + skeleton overlay, as **`video/webm`**.
- `SkeletonRecorder` → skeleton drawing only, as **`video/webm`**.

Both produce **pixels**. The keypoint stream is computed, drawn, and discarded every
frame. **No joint coordinates, confidences, or timestamps are ever persisted.** A
repo-wide search for `*.json` / `*.jsonl` / `*.ndjson` / `*.csv` outside `node_modules`
and `build` returns only the MoveNet model weights and one reference template.

### 5.2 The only per-frame data artifact

`src/dtw/references/Left Side Arm Raise.ref.json` — a DTW reference template, not a
session recording. It stores **derived features**, not keypoints. Below are frames 0–2,
consecutive and unedited:

```json
[
  {
    "frame": 0,
    "features": {
      "shoulderAngleL": 92.27824851634078,
      "shoulderAngleR": 23.232834364258487,
      "elbowAngleL": 173.47038200256665,
      "elbowAngleR": 156.65407911397733,
      "hipAngleL": 172.03168182447175,
      "hipAngleR": 172.9187754748656,
      "kneeAngleL": 177.93877319978796,
      "kneeAngleR": 178.40018181519434,
      "trunkAngleL": 171.0364624472865,
      "trunkAngleR": 172.16542598041258,
      "wristHeightNormL": 0.9978577818469542,
      "wristHeightNormR": 0.05078779686854992,
      "kneeLiftNormL": 0,
      "kneeLiftNormR": 0,
      "hipToAnkleNormL": 1.1604268773464161,
      "hipToAnkleNormR": 1.1144263616074797,
      "handsHeightNorm": 0.5243227893577522,
      "handsXNorm": 0.6020287852645041,
      "shoulderAngleMin": 23.232834364258487,
      "elbowAngleMin": 156.65407911397733,
      "hipAngleMin": 172.03168182447175,
      "kneeAngleMin": 177.93877319978796,
      "trunkAngleMin": 171.0364624472865,
      "kneeLiftNormMax": 0
    },
    "phase": "lowered"
  },
  {
    "frame": 1,
    "features": {
      "shoulderAngleL": 90.26671723816021,
      "shoulderAngleR": 23.32814365905302,
      "elbowAngleL": 174.02362786793304,
      "elbowAngleR": 157.16596930556466,
      "hipAngleL": 173.8702972974464,
      "hipAngleR": 172.64806383842915,
      "kneeAngleL": 177.61081861846802,
      "kneeAngleR": 176.86013706288566,
      "trunkAngleL": 172.71576445612092,
      "trunkAngleR": 171.17327439500716,
      "wristHeightNormL": 0.9939294923341474,
      "wristHeightNormR": 0.04295988322049858,
      "kneeLiftNormL": 0,
      "kneeLiftNormR": 0,
      "hipToAnkleNormL": 1.174268021630584,
      "hipToAnkleNormR": 1.1282130752883257,
      "handsHeightNorm": 0.5184446877773231,
      "handsXNorm": 0.6420852245531947,
      "shoulderAngleMin": 23.32814365905302,
      "elbowAngleMin": 157.16596930556466,
      "hipAngleMin": 172.43023570316228,
      "kneeAngleMin": 176.86013706288566,
      "trunkAngleMin": 171.17327439500716,
      "kneeLiftNormMax": 0
    },
    "phase": "lowered"
  },
  {
    "frame": 2,
    "features": {
      "shoulderAngleL": 90.08924213113536,
      "shoulderAngleR": 23.354507762845863,
      "elbowAngleL": 173.21491271181972,
      "elbowAngleR": 158.743572832498,
      "hipAngleL": 173.7235964251912,
      "hipAngleR": 172.50836033932964,
      "kneeAngleL": 178.3622028294993,
      "kneeAngleR": 178.0656058487907,
      "trunkAngleL": 172.92976565067113,
      "trunkAngleR": 171.6032950883249,
      "wristHeightNormL": 1.0047398314289986,
      "wristHeightNormR": 0.03352480780147644,
      "kneeLiftNormL": 0,
      "kneeLiftNormR": 0,
      "hipToAnkleNormL": 1.1879831867898203,
      "hipToAnkleNormR": 1.1430585293257944,
      "handsHeightNorm": 0.5191323196152375,
      "handsXNorm": 0.6408029055326935,
      "shoulderAngleMin": 23.354507762845863,
      "elbowAngleMin": 158.743572832498,
      "hipAngleMin": 172.50836033932964,
      "kneeAngleMin": 177.76068148114655,
      "trunkAngleMin": 171.6032950883249,
      "kneeLiftNormMax": 0
    },
    "phase": "lowered"
  }
]
```

Top-level metadata on the same file:

```json
{ "name": "Left Side Arm Raise", "side": "left", "mode": "rep", "detector": "movenet",
  "timing": { "fps": 15, "repDurationMs": 11000, "dwellMs": 100, "refractoryMs": 300 } }
```

### 5.3 Explicit verdict on the four requested items

| | Item | Present? | Detail |
|---|---|---|---|
| **(a)** | Per-frame timestamp | ❌ **Absent** | Only an integer `frame` index. `timing.fps: 15` permits deriving an approximate time (`frame / 15`), but no wall-clock or monotonic timestamp is stored. Actual inter-frame intervals are lost. |
| **(b)** | Per-keypoint confidence | ❌ **Absent** | No keypoints are stored at all, so no `score` survives. Confidence is consumed at extraction time (as a `> 0.3` gate producing `NaN`) and then discarded. |
| **(c)** | Coordinate space | ❌ **Absent / N/A** | No coordinates are stored. Values are already derived: angles in **degrees**, and unitless **ratios** normalized by torso/shank/hip-ankle length. Neither pixel nor normalized image space is recoverable. |
| **(d)** | Model version | ⚠️ **Partial** | `detector: "movenet"` names the model *family*. The variant (SinglePose Lightning), the model file version, and the TF.js version are all unrecorded. |

**Consequence for a reviewer:** there is currently no dataset in this repository that
could be used to re-run segmentation offline, re-score past sessions with a changed
algorithm, compare models, or train anything. Any such work requires building a raw
keypoint-capture path first.

---

## 6. Baseline / progress tracking

**Not greenfield — `src/dtw/PatientBaseline.js` exists and is live** whenever a
`patientId` can be resolved from the JWT (`activityData.patient.id`, `.userId`, or
`.activity`). It is instantiated inside the `DTWPhaseMachine` constructor.

**What it stores.** Per feature, a locked `{ min, max, range, mean }` — the patient's own
demonstrated ROM, not a gold standard. Plus a `sessionHistory[]` and running rep tallies
`{ completed, attempts, total }`.

**Where.** `localStorage`, key `dtw_baseline_<patientId>_<exerciseName>`, holding
`{ baseline, sessionHistory, savedAt }`. All access is wrapped in `try/catch`, so private
browsing or a quota error degrades silently. **Device-local only — nothing syncs to a
backend**, so a patient switching phones starts over.

**How it calibrates.** Every frame feeds `updateFrame()` into running per-feature min/max
while `isCalibrating`. `onRepDetected()` increments a counter; once **2 reps** *and*
**60 frames** have elapsed, `_lockBaseline()` freezes the ranges and calibration ends.
During calibration all reps are recorded as completed.

**How it scores.** After locking, each rep's ROM is compared to the baseline range per
feature and averaged into `romPct` (capped at 150%). A rep is **completed** when
`romPct >= 1 - TOLERANCE` with `TOLERANCE = 0.30` — i.e. **≥70% of the patient's own
baseline ROM**; otherwise it is an **attempt**. Both still count toward `repCount`;
the classification is telemetry, not a gate.

**Progress.** `getProgress()` diffs the current locked baseline against the most recent
stored session and reports per-feature percentage change (changes under 1% are ignored).

**Safety envelope.** `checkSafety(key, value)` flags a value more than 25% of range beyond
the gold-standard reference. **[v1, uncommitted]** it is now consulted by
`_exceedsClinicalCap`; on `main` it has no callers at all.

---

## 7. Normalization & camera handling

### 7.1 Torso-length normalization — present

`src/dtw/universalFeatures.js` derives three body-scale reference lengths per frame and
divides positional features by them, making those features invariant to subject size and
camera distance:

```js
const torsoLenL = (P(Ls) && P(Lh)) ? Math.max(D(Ls, Lh), 1e-6) : NaN;   // shoulder→hip
const shankLenL = (P(Lk) && P(La)) ? Math.max(D(Lk, La), 1e-6) : NaN;   // knee→ankle
const hipAnkleLenL = (P(Lh) && P(La)) ? Math.max(D(Lh, La), 1e-6) : NaN; // hip→ankle
```

Applied as: `wristHeightNorm` and `handsHeightNorm` ÷ `torsoLen`; `kneeLiftNorm` and
`hipToAnkleNorm` ÷ `hipAnkleLen`; `footPitchNorm` ÷ `shankLen`; `handsXNorm` ÷ shoulder
width. The `1e-6` floor prevents divide-by-zero. Joint **angles** need no normalization —
they are inherently scale-invariant, which is why most exercises key off an angle.

There is **no temporal normalization** (no resampling to a fixed rate) — DTW absorbs
speed variation instead.

### 7.2 Camera position and framing — present, pre-exercise

`src/PoseQuality.js` runs four checks every frame, aggregated by `runAllChecks()`:

| Check | Function | Threshold |
|---|---|---|
| Distance | `checkDistance` | body height ≈ **0.50** of frame; too close > 0.70, too far < 0.20 |
| Camera angle | `checkCameraAngle` | `side`: shoulder x-gap ≤ 0.12 · `diagonal`: 0.08–0.22 · `front`: centred 0.25–0.75, shoulder tilt < 0.3 |
| Visibility | `checkVisibility` | required keypoints must exceed `MIN_CONFIDENCE = 0.3` |
| Lighting | `checkLighting` | mean keypoint score ≥ **0.25** (advisory only) |

`SessionStateMachine` blocks the COUNTDOWN→ACTIVE transition until distance, angle, and
visibility are all good (lighting is explicitly non-blocking) and 30 stable frames plus a
3 s minimum coaching period have elapsed. Every exercise declares its expected view:

```js
framing: { view: 'side', instruction: 'Sit at the edge of the chair, active foot in front of you (NOT next to chair leg)' }
```

A target box and prioritized coaching text are drawn during the COACHING state.

**Important limitation:** these are **entry gates**, not continuous corrections. Nothing
compensates for camera angle *during* the exercise — a subject at 30° off-axis produces
foreshortened angles that are silently treated as real. There is no 3D lifting, no camera
extrinsics estimation, and no per-view template variant.

### 7.3 Mirroring

The canvas carries CSS `transform: scaleX(-1)` for a selfie view; `withUnmirroredText()`
counter-transforms before drawing text. Note that **left/right keypoint labels are model
labels, not screen positions** — the patient's left appears on screen-right.

---

## 8. Known dead code, flags, and abandoned paths

### 8.1 Unreachable code

| Item | Why it is dead |
|---|---|
| `src/phase_machine.js` + all 16 `src/specs/*.spec.js` | `bootstrapAllReferences()` registers a DTW reference for every exercise, so the `PhaseMachine` fallback branch never runs. **~2,000 lines of dead logic.** |
| `window.__DEBUG_CRS`, `__DEBUG_SDF`, `__DEBUG_SDF_ST`, `__DBG_ML`, `__LOG_ANGLES` | Debug toggles that live *inside* those dead spec files. Setting them has no effect. |
| `src/serviceWorker.js` | Fully implemented but never imported or registered in `index.js`. Offline support is **off**. |
| `src/dtw/references/Left Side Arm Raise.ref.json` | Registered under the literal name `"Left Side Arm Raise"` while lookups use the key `"SideArmRaise"`. Never loads. **0 of 16 exercises use a recorded reference.** |
| `tempo` feedback | Declared in all 16 configs; `_pickFeedback` has a `// 3. Tempo (future...)` placeholder and never emits it. |
| `fullDTW()` in `dtwEngine.js` | Offline-only; used by reference extraction, not by the live loop. |

### 8.2 Environment flags

| Flag | Declared in `.env`? | Read in `src/`? | Notes |
|---|---|---|---|
| `REACT_APP_DEVELOPMENT_MODE` | ✅ (`true`) | ✅ | Bypasses JWT/backend entirely. **[v1] Re-enabled** — the block was fully commented out on `main`. |
| `REACT_APP_DEFAULT_EXERCISE` / `_REPS` / `_SIDE` | ✅ | ✅ | Only meaningful under dev mode. |
| `REACT_APP_ALLOW_VIDEO_RECORDING` / `_SKELETON_RECORDING` | ✅ | ✅ | Dev-mode path only. In the JWT path the flags come from the activity API; the manual start form hardcodes both to `true`. |
| `REACT_APP_TENANT` | ✅ | ✅ | Used by the reference-extractor tool and as a tenant fallback. |
| `REACT_APP_API_BASE_URL` | commented out | ✅ **[v1]** | Was documented but never read on `main`; now overrides the hardcoded `rehabranger.ai`. |
| `REACT_APP_DEFAULT_SECONDS`, `REACT_APP_DEFAULT_TIME_S` | ❌ **not declared** | ✅ | Read for time-mode targets but absent from `.env` — always `undefined` in practice. |

`window.__validateDTW` / `window.__validateExercise` are **live** console hooks for the
synthetic validation harness, not dead code.

### 8.3 Uncommitted v1 work (not on `origin/main`)

A reviewer cloning the repository will **not** see these:

- `src/metrics.js` — `METRIC_MAP` migrated to universal feature keys; on `main` it still
  names legacy keys (`armAngle`, `hipFlexAngleMin`, …) that the DTW feature set never
  produces, so most angle telemetry silently never reaches the host app.
- `clinicalCaps` on all 16 configs + `_exceedsClinicalCap` + top-priority safety feedback.
  On `main`, `feedback.range.tooMuch` exists for only 1 of 16 exercises and its trigger
  threshold is physically unreachable, so overshoot warnings never fire.
- `repSummary` per-rep ROM telemetry.
- Ten Jest suites (~182 tests). On `main` the only real test is the synthetic DTW
  validation, and `yarn test` fails outright because CRA's `testMatch` collects the 16
  `src/specs/*.spec.js` config files as empty suites.
- `ErrorBoundary.js`, camera/model failure messaging, WebGL→CPU fallback, locally served
  MediaPipe WASM, canonical-name dropdown in the reference-extractor portal, CI test gate.

### 8.4 Caveats a reviewer should weigh

1. **All 16 exercises run on synthetic templates.** Phase boundaries and thresholds were
   authored by hand, never measured from a real performance.
2. **The synthetic validation suite is self-referential.** It generates test sequences
   *from the same templates it validates*, so a 16/16 pass says the engine is internally
   consistent — not that it works on real video.
3. **`clinicalCaps` values marked `TODO clinical review`** were derived from template
   geometry. Only `SideArmRaise` (95°) and `LongArcQuad` (178°) carry thresholds inherited
   from the original hand-coded specs.
4. **MediaPipe confidence can be synthetic** — `visibility` defaults to `1.0` when the
   model omits it, so a "fully confident" foot keypoint may be unmeasured.
5. **Baseline data is device-local** and never synced.
