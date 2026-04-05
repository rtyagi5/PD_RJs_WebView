---
name: dtw-engine
description: DTW exercise engine, reference generation, rep counting, exercise configs. Use when working on src/dtw/, adding exercises, debugging rep detection, or modifying DTWPhaseMachine.
---

# SKILL: DTW Exercise Engine

> Load this skill when working on `src/dtw/` — the DTW template matching system, exercise configs, reference generation, or rep detection logic.

---

## What This System Does

The DTW (Dynamic Time Warping) engine is the Level 3 exercise engine. It replaces 200-line hand-coded exercise specs with ~20 lines of declarative config per exercise, using Online Subsequence DTW to match live pose feature streams against synthetic or video-extracted reference templates.

**Files:**
- `src/dtw/dtwEngine.js` — `OnlineSubsequenceDTW` class
- `src/dtw/DTWPhaseMachine.js` — Drop-in PhaseMachine replacement
- `src/dtw/specToReference.js` — `EXERCISE_CONFIGS` + `generateReference()`
- `src/dtw/universalFeatures.js` — `computeUniversalFeatures(keypoints)`
- `src/dtw/PatientBaseline.js` — Adaptive ROM baseline per patient
- `src/dtw/validateDTW.test.js` — Jest headless validation (always run after changes)

---

## Core Concepts

### Feature Vector (from universalFeatures.js)

Every frame produces a named feature object. Key features and their formulas:

| Feature | Formula | Notes |
|---------|---------|-------|
| `shoulderAngleL/R` | atan2 angle at shoulder joint | ear→shoulder→elbow |
| `elbowAngleL/R` | atan2 angle at elbow joint | shoulder→elbow→wrist |
| `hipAngleL/R` | atan2 angle at hip joint | shoulder→hip→knee |
| `kneeAngleL/R` | atan2 angle at knee joint | hip→knee→ankle |
| `trunkAngleL/R` | vertical alignment of torso | ear→shoulder→hip |
| `wristHeightNormL/R` | (hip.y − wrist.y) / torsoLen | normalized, 0=hip level |
| `kneeLiftNormL/R` | (hip.y − knee.y) / hipAnkleLen | for marches |
| `ankleAngleToeL/R` | ankle→toe pitch | needs MediaPipe |
| `footPitchNormL/R` | (toe.y − heel.y) / shankLen | for dorsiflexion |
| `handsHeightNorm` | bilateral hand height | for LiftsAndChops |
| `*Min/*Max/*Avg` | bilateral aggregates | skipped in side-specific exercises |

**Critical:** All features return `NaN` when required keypoints are below `MIN_CONFIDENCE = 0.3`. Never throw on missing keypoints. The DTW engine skips NaN features during distance computation.

**EMA smoothing** (α ≈ 0.5) is applied to all features before passing to the exercise engine. Do not apply EMA inside `universalFeatures.js` — it happens in `ExerciseTracker_refactored.js`.

### Exercise Config Schema

```js
// In src/dtw/specToReference.js → EXERCISE_CONFIGS
ExerciseName: {
  name: 'ExerciseName',           // Must match registry key exactly
  mode: 'rep',                    // 'rep' | 'time'
  side: 'both',                   // 'left' | 'right' | 'both' | 'alternating'
  detector: 'movenet',            // 'movenet' | 'mediapipe'
  highlightKeypoints: ['shoulder', 'elbow', 'wrist'],  // body part names, no L/R suffix
  phases: [
    {
      id: 'phaseName',            // Unique phase identifier
      weight: 1,                  // Relative frame count in synthetic reference (higher = longer phase)
      features: {
        featureName: { from: 0, to: 90 },  // Feature sweep across this phase
      }
    },
    // ... more phases
  ],
  repCycle: {
    from: 'startPhaseName',       // Phase where rep begins
    to: 'effortPhaseName',        // Phase where rep peaks
  },
  staticFeatures: {               // Features that should NOT change during exercise
    trunkAngle: 172,              // e.g., trunk stays upright
  },
  feedback: {
    startPhase: ["Ready position message"],
    effortPhase: ["Good — keep going"],
    returnPhase: ["Lower slowly"],
    form: {
      trunkAngle: { low: "Stand up straight", high: "Don't lean back" },
    },
  },
}
```

### Reference Generation (`generateReference`)

`generateReference(config)` converts a config to a 60-frame synthetic template:
1. Allocates frames proportionally by phase `weight`
2. Interpolates features from `from` to `to` with optional sine easing
3. For `alternating` exercises, mirrors generic keys (e.g., `hipAngle`) to `hipAngleL`/`hipAngleR`
4. Computes feature ranges for normalization

Video-extracted `.ref.json` files in `src/dtw/references/` override synthetic references.

### Online Subsequence DTW (`dtwEngine.js`)

**Algorithm:** Rolling cost matrix maintaining the best path from any start point in the template.

Per frame, `engine.step(liveFeatures)` returns:
```js
{
  templatePosition: 0.65,    // 0-1: where in the rep cycle we are
  phase: 'lifting',          // Current phase label
  quality: 0.87,             // 0-1: match quality (1 = perfect)
  cycleComplete: false,       // true when full template traversed
  primaryFeatureValue: 85.3, // value of the primary tracking feature
}
```

**Feature normalization:** Each feature is divided by its range in the reference template so that a 1° angle change and a 0.01 normalized height change contribute equally to distance.

**Side-aware filtering:** When `side !== 'both'`:
- Skip opposite-side features (`*R` features when side is `left`)
- Skip aggregate features (`*Min`, `*Max`, `*Avg`) — polluted by inactive side
- Only compare active-side features and side-neutral features

### Rep Counting State Machine (`DTWPhaseMachine.js`)

```
idle ──▶ sawStart ──▶ sawEffort ──▶ [rep counted] ──▶ idle
           ↑                               │
           └───────────────────────────────┘ (refractory 300ms)
```

- `idle → sawStart`: DTW phase enters `repCycle.from`
- `sawStart → sawEffort`: DTW phase enters `repCycle.to` (or adjacent transition phase)
- `sawEffort → rep counted`: Returns to start phase AND `primaryFeatureROM >= minRomForRep (25% of range)` AND 300ms elapsed

---

## How to Add or Modify an Exercise

### Adding (DTW path — always preferred)

1. Add config to `EXERCISE_CONFIGS` in `specToReference.js`
2. Choose the right detector: use `mediapipe` only for CalfRaises / Dorsiflexion (needs heel/foot)
3. Define phases as feature sweeps — keep it simple (2-4 phases is enough)
4. Set `repCycle.from` = resting phase, `repCycle.to` = peak/effort phase
5. Set `staticFeatures` for any joint that should stay stable (trunk, non-working knee, etc.)
6. Add `feedback` messages per phase and per form violation
7. Run validation: `npx react-scripts test --testPathPattern="validateDTW.test" --watchAll=false --verbose`
8. Verify 5/5 reps pass with quality > 0.8

### Modifying an Existing Config

When DTW phase detection is wrong (wrong phase labels) or rep counting is off:
1. Check `[DTW-diag]` console logs — shows phase, quality, templatePosition
2. Check `[Features]` logs — shows actual feature values vs expected ranges
3. Adjust phase feature ranges to match real patient ROM
4. Re-run validation after changes

### Alternating Exercises (SeatedMarch, StandingMarch)

- Set `side: 'alternating'`
- Use GENERIC feature names in config (e.g., `hipAngle`, `kneeLiftNorm`) — not `hipAngleL`
- `generateReference()` will mirror them to L/R automatically
- `DTWPhaseMachine` handles alternating side tracking

---

## Common Failure Patterns

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Rep not counted | `primaryFeatureROM < minRomForRep` | Widen feature range in config; check patient is doing full ROM |
| Rep double-counted | Refractory period too short | Check 300ms refractory is working; increase if needed |
| Wrong phase labels | Feature ranges don't match real patient values | Check `[Features]` logs; adjust config ranges |
| Orange skeleton (poor quality) | Live features far from template | Check `[DTW-diag]` quality; verify correct features are tracked |
| Alternating exercise not counting both sides | `mirrorFeatures` not called | Verify `side: 'alternating'` and generic feature keys in config |
| Inactive arm polluting DTW | Aggregate features not skipped | Verify side-aware filtering logic for `*Min/*Max/*Avg` features |
| NaN features crashing | Keypoints below confidence | Confirm NaN guard in distance function; check `MIN_CONFIDENCE` |

---

## Validation Workflow

Always run after any change to configs, dtwEngine, or DTWPhaseMachine:

```bash
# Headless Jest
npx react-scripts test --testPathPattern="validateDTW.test" --watchAll=false --verbose

# Visual browser validation
yarn start
# Navigate to: localhost:3000/dtw-validation
```

Target: **5/5 reps per exercise, quality > 0.8**. Current baseline: 15/15 exercises pass at quality > 0.98.

---

## Patient Baseline Integration

`PatientBaseline.js` tracks ROM per patient, stored in `localStorage`:

```js
baseline.recordFrame(features, phase)    // Call during ACTIVE state
baseline.classifyRep(peakFeatures)       // Returns 'completed' | 'attempt'
baseline.isCalibrated()                  // False until 2 reps recorded
baseline.getProgress()                   // Compare to previous sessions
```

- Calibration: first 2 reps set the personal baseline
- Rep gate: within 5% of baseline range = "completed"; otherwise "attempt"
- Safety: gold-standard ranges from reference serve as max limits only

Do NOT change the 5% tolerance without clinical input.
