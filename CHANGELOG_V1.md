# Rehab Ranger™ — `feature/posedetection_engine_v1` Change Log

**Purpose of this document.** A complete handoff record of every change made on this
branch, with the reasoning behind each one. Written so another engineer (or another
Claude instance) can pick the work up cold without re-deriving why anything was done.

| | |
|---|---|
| Branch | `feature/posedetection_engine_v1` (cut from `feature/posedetection_engine_v0`, which was identical to `origin/main` at `4302b15`) |
| Baseline | Last PR merged was **#8** (`2390839`) |
| Commits | **None.** All work is uncommitted in the working tree |
| Scope | 23 files modified, 18 files added (+776 / −250 lines, excluding binaries) |
| Test status | **182 tests / 10 suites, all passing.** Was effectively 0 (see §2.3) |
| DTW validation | **16 / 16 exercises PASS.** Was 15 / 16 (see §2.1) |

---

## 0. How this work started

The user reported two regressions in behaviour that used to work:

1. Joint angles were no longer reaching the mobile app / backend for storage.
2. "Negative motion" feedback — e.g. *don't raise above 90° on a side arm raise* — had
   stopped firing.

Investigation traced **both** to the same root cause, which is the single most important
thing to understand about this codebase:

> **The repo contains two complete generations of exercise-recognition engine, and the
> newer one silently took over everything without the older one's contracts being
> migrated.**

- **Gen 1 (hand-coded):** `src/specs/*.spec.js` + `phase_machine.js` + `features.js`.
  Explicit rules per exercise. Features had bare names: `shoulderAngle`, `armAngle`.
- **Gen 2 (DTW):** `src/dtw/`. Compares live motion to a reference template. Features are
  universal and side-suffixed: `shoulderAngleL`, `shoulderAngleR`, `elbowAngleMin`.

The switch happens at `ExerciseTracker_refactored.js`:

```js
const isDTW = engine instanceof DTWPhaseMachine;
const feat = isDTW ? computeUniversalFeaturesFromPoses(poses) : computeFeaturesForExercise(...);
```

Because `bootstrapAllReferences()` registers a DTW reference for **all 16** exercises at
import time, `isDTW` is *always* true. Gen 1 never runs. Anything still pointing at Gen 1
names or Gen 1 rules had quietly stopped working.

---

## 1. Regression fixes

### 1.1 Joint angles not reaching the host app

**Symptom.** The backend stopped receiving per-exercise angle metrics.

**Root cause.** `METRIC_MAP` still named Gen 1 keys that Gen 2 never produces:

| METRIC_MAP named | Exists in universal features? |
|---|---|
| `armAngle` | No — the universal name is `elbowAngle*` |
| `hipFlexAngleMin` | No — it is `hipAngleMin` |
| `elbowOffsetMax` | No |
| `ankleLiftNormLead`, `kneeAngleLead` | No |
| `degRaiseDynamic`, `startAngle`, `activeSide`, `pitchUp`, `pitchDown` … | No — Gen 1 spec-local values |

`pickExerciseMetrics` looked each key up, got `undefined`, and `sendUpdates` silently
skipped undefined values. **No error, no warning — the fields just vanished.**

A prior commit (`f88089c`, "angle syncing fix") had added an L/R-suffix fallback that
rescued `shoulderAngle → shoulderAngleL`, which is why the problem looked partial rather
than total.

**Fix.**

- Extracted metric logic into a new module **`src/metrics.js`** (exports `METRIC_MAP`,
  `BILATERAL_BASE_FEATURES`, `resolveMetricKeys`, `pickExerciseMetrics`, `pretty`,
  `prettyNum`, `_resetMetricWarnings`). It previously lived inside the 800-line tracker
  component, which made it untestable.
- Rewrote `METRIC_MAP` to use **universal feature keys only**. Entries are either a
  bilateral base name (`kneeAngle`, resolved to `kneeAngleL`/`kneeAngleR` at runtime by
  active side) or a verbatim aggregate (`kneeAngleMin`, `handsHeightNorm`).
- Payload field names are now the **resolved** key (`shoulderAngleL`), so the host app
  receives side-explicit data instead of an ambiguous `shoulderAngle`.
- `pickExerciseMetrics` now logs a **one-time dev warning** when a key resolves to
  nothing, instead of dropping it silently.
- `utilities.js → sendUpdates` had to change too: its whitelist was keyed on the *base*
  names, so once the payload carried resolved keys the filter would have dropped
  everything. It now expands each entry to every key it could resolve to.

**Rationale for the naming choice.** The user was offered "keep legacy names via a
translation layer" vs "migrate to universal names" and chose migration. It is the honest
option: `armAngle` was a Gen 1 concept that no longer exists, and a translation layer
would have preserved a fiction. **This is a breaking change to the host contract** — the
mobile/backend team must update field names. Documented in `README.md`.

**Permanent guard.** `src/metrics.test.js` asserts that *every* `METRIC_MAP` entry resolves
against `UNIVERSAL_FEATURE_KEYS`. This class of bug cannot silently recur.

### 1.2 Per-rep ROM history (new capability)

**Problem found while fixing 1.1.** Updates are throttled to frames where the feedback
*text* changes. So even for keys that resolved correctly, the backend received arbitrary
instantaneous snapshots — never a per-rep range. There was no rep-level angle history at
all.

**Fix.** `DTWPhaseMachine` now accepts a `summaryFeatures` option (the resolved universal
keys for that exercise), tracks min/max for each across the in-flight rep cycle, and emits
on the frame a rep counts:

```jsonc
"repSummary": { "rep": 3, "features": { "shoulderAngleL": { "min": 31, "max": 89 } } }
```

The tracker **forces a send** when `repDelta > 0`, bypassing the feedback-change throttle,
so a rep summary can never be dropped. `sendUpdates`' dedup key already includes
`repCount`, so it passes through.

### 1.3 Overshoot / "don't go too far" feedback never fired

**Symptom.** Raising above ~95° on a side arm raise produced no warning.

**Root cause — four compounding problems:**

1. `feedback.range.tooMuch` was defined for **only 1 of 16** exercises. `_pickFeedback`
   requires it to be truthy, so overshoot was *structurally impossible* for the other 15.
2. For SideArmRaise, the synthetic template swept `shoulderAngle` **30° → 150°**.
   `_detectOvershoot` fires at `range.max + 0.2 × range` = `150 + 24` = **174°** — not
   physically reachable. The legacy spec fired at **>95°**.
3. The real PT recording that encodes a ~94° max is registered under the name
   `"Left Side Arm Raise"` while lookups use the key `"SideArmRaise"` — so it never loads.
4. `PatientBaseline.checkSafety()` — the safety envelope — was defined but had **zero call
   sites** anywhere in the codebase.

A fifth issue was found while fixing these: after each rep, `_pickFeedback` returned the
bare rep number for **3000 ms**, which is longer than a typical rep cycle. Even a working
corrective cue would rarely have surfaced.

**Fix — approach chosen by the user: "clinical caps + patient baseline".**

- Added a new **`clinicalCaps`** field to all 16 `EXERCISE_CONFIGS` entries — absolute,
  side-generic, clinician-reviewable limits, e.g. `{ shoulderAngle: { max: 95 } }`.
  Resolved to concrete L/R (and aggregate) keys in the `DTWPhaseMachine` constructor.
- Added `feedback.range.tooMuch` to **all 16** exercises (was 1).
- New `_exceedsClinicalCap(features)` checks caps every frame, **and** consults
  `PatientBaseline.checkSafety` once the baseline has locked — wiring in the dead method.
- **Moved safety to the top of the feedback priority ladder**, above the rep number.
  A patient exceeding a clinical limit must hear it immediately.
- Reduced the rep-announce window from 3000 ms to **1200 ms** (`REP_ANNOUNCE_MS`). The
  adjacent comment had claimed 1.5 s and was stale.
- Retuned the SideArmRaise template from **150° → 90°**, matching both the legacy spec's
  70–95° "raised" band and the real PT recording's 94° max.

**Why absolute caps rather than template-relative detection.** `_detectOvershoot` triggers
at `range.max + 20% of range`. For any exercise with a wide sweep that lands beyond what a
human can do. A template-relative check can never reliably express "not past 95°" — that is
an absolute clinical fact, so it needed an absolute mechanism. Template-relative detection
is retained as a secondary trigger.

**Cap values and their provenance** (all 16 configs):

| Exercise | Cap | Source |
|---|---|---|
| SideArmRaise | `shoulderAngle.max: 95` | Legacy spec threshold, verbatim |
| LongArcQuad | `kneeAngle.max: 178` | Legacy spec `laqAngleExtended`, verbatim |
| BicepCurls | `elbowAngle.min: 40` | Derived — `TODO clinical review` |
| MiniSquats | `kneeAngle.min: 100` | Derived — `TODO clinical review` |
| SitToStand | `kneeAngle.max: 180` | Derived (hyperextension) — `TODO clinical review` |
| SeatedMarch | `kneeLiftNorm.max: 0.45`, `hipAngle.min: 50` | Derived — `TODO clinical review` |
| StandingMarch | `kneeLiftNorm.max: 0.50`, `hipAngle.min: 45` | Derived — `TODO clinical review` |
| MiniLunges | `kneeAngle.min: 90` | Derived — `TODO clinical review` |
| LiftsAndChops | `handsHeightNorm.max: 1.3` | Derived — `TODO clinical review` |
| StepUps | `kneeAngle.min: 95`, `kneeLiftNorm.max: 0.40` | Derived — `TODO clinical review` |
| WallPushUp | `elbowAngle.min: 75` | Derived — `TODO clinical review` |
| CalfRaisesSeated / Standing | `footPitchNorm.max: 0.22` | Derived — `TODO clinical review` |
| SeatedDorsiflexion | `footPitchNorm.min: -0.12` | Derived — `TODO clinical review` |
| StandingDorsiflexion | `footPitchNorm.min: -0.11` | Derived — `TODO clinical review` |
| StandingStraightUp | `kneeAngle.max: 182` | Derived — `TODO clinical review` |

> **Open item.** Only the two marked "verbatim" carry real clinical thresholds. The rest
> were derived from template geometry and are explicitly marked `TODO clinical review` in
> the source. **These need a clinician to sign off before production.**

---

## 2. Bugs found while writing tests

These were not reported by the user. They surfaced because the modules got their first real
test coverage, and all three are genuine production defects.

### 2.1 Time mode was completely broken

**File:** `src/dtw/dtwEngine.js`

`StandingStraightUp` is the only `mode: 'time'` exercise. It could **never** accumulate hold
time or complete.

**Why.** Nearest-neighbour phase detection took the *first* minimum distance. A hold phase
repeats identical feature values across many template frames, and the adjacent transition
phases start/end on those same values — so a patient holding the pose ties exactly against a
band of frames spanning `[end of transition_in .. hold .. start of transition_out]`. Taking
the first minimum always landed on the **transition** frame, so the hold phase was never
reported, and `timeHeldMs` never advanced.

**Fix.** Resolve exact ties to the **middle** of the tied band, which sits inside the hold.
Unique minima — the normal case during movement — are unaffected. This is why DTW validation
went from 15/16 to **16/16**.

### 2.2 First scored rep always graded "completed"

**File:** `src/dtw/PatientBaseline.js`

`_resetRepBuffer()` was not called during the calibration branch of `onRepDetected`. The
per-rep buffer therefore accumulated across all calibration reps, and the first rep
classified *after* the baseline locked inherited the full calibration min/max — scoring 100%
ROM and grading "completed" regardless of how short it actually was.

**Fix.** Reset the buffer in the calibration branch too. Rep classification is now
trustworthy from the first scored rep onward.

### 2.3 `yarn test` had never passed in this repo

**File:** `package.json`

CRA's default `testMatch` treats every `*.spec.js` as a test suite. But
`src/specs/*.spec.js` are **exercise configuration files, not tests** — all 16 were being
collected as empty suites, failing the run. There was also no `test` script defined.

**Fix.** Narrowed `testMatch` to `*.test.js` plus `__tests__/`, and added `test` /
`test:ci` / `lint` scripts. A `jestComment` key documents why, so nobody reverts it.

---

## 3. Test suite (new)

Before: one meaningful test file (`validateDTW.test.js`) and a broken CRA stub
(`App.test.js` asserted on a "learn react" link this app has never rendered).

After: **182 tests across 10 suites**, all pure-logic — no camera or model needed.

| Suite | Tests | Covers |
|---|---|---|
| `src/dtw/DTWPhaseMachine.test.js` | 33 | Rep gates, velocity filter, clinical caps, repSummary, alternating guardrail, feedback priority |
| `src/dtw/universalFeatures.test.js` | 25 | Known-geometry angles, NaN degradation, aggregates, scale invariance, foot sanity check |
| `src/PoseQuality.test.js` | 21 | Distance / angle / visibility / lighting checks, `allGood` excludes lighting |
| `src/SessionStateMachine.test.js` | 20 | Every transition incl. hysteresis and INACTIVE recovery |
| `src/dtw/dtwEngine.test.js` | 20 | `featureDistance` side filtering, NaN skip, range floor; DTW phase tracking, tie-breaking |
| `src/dtw/PatientBaseline.test.js` | 19 | Calibration lock, 70% boundary, checkSafety, storage round-trip |
| `src/metrics.test.js` | 17 | **Every METRIC_MAP key resolves** — the §1.1 regression guard |
| `src/utilities.test.js` | 17 | postMessage payload, dedup, repSummary passthrough, delivery channel, server sync |
| `src/App.test.js` | 5 | Entry paths: no token, manual picker, dev mode |
| `src/dtw/validateDTW.test.js` | 2 | Pre-existing synthetic harness (now 16/16) |

**Two testing gotchas worth knowing:**

1. **CRA sets `resetMocks: true`.** Mock implementations passed to a `jest.mock()` factory
   are stripped before every test. They must be re-installed in `beforeEach`. This cost real
   debugging time on `App.test.js`.
2. **`axios` ships ESM** and Jest does not transform `node_modules`. Any suite that pulls in
   axios transitively must mock it.

> **Known limitation, stated plainly:** `validateDTW` generates its test sequences *from the
> same templates it validates*. 16/16 passing proves the engine is internally consistent — it
> says nothing about real-world accuracy. Every bug the commit history shows being hand-fixed
> (calf-raise/dorsiflexion confusion, chair-leg keypoints, StepUps double-counting) is
> invisible to it. **Live webcam testing is not optional.**

---

## 4. Robustness and infrastructure

| Change | File(s) | Why |
|---|---|---|
| React error boundary + `unhandledrejection` handler | `ErrorBoundary.js` (new), `index.js` | A crash mid-session showed the patient a blank white screen. Now shows a recovery message and notifies the host app. |
| Camera failure messaging | `ExerciseTracker_refactored.js` | `onUserMediaError` was console-only. Now distinguishes *permission denied* from *no camera* — they need different actions from the patient. |
| Detector-init failure messaging | `ExerciseTracker_refactored.js` | Was a bare `console.error`; the patient sat on "Initializing…" forever. |
| WebGL → CPU fallback | `detectors.js` | `tf.setBackend('webgl')` had no try/catch. Some in-app WebViews and older devices don't expose WebGL — the whole app threw. Slow is better than broken. |
| MediaPipe WASM served locally | `detectors.js`, `public/mediapipe/wasm/` | Was loaded from a jsdelivr CDN **pinned to 0.10.0 while the package is 0.10.22** — a version skew *and* the only network dependency in an otherwise offline pipeline. Files copied from `node_modules`; CDN retained as fallback. |
| CI runs tests before deploy | `.github/workflows/deploy.yml` | Workflow was build-only, so engine regressions could ship unnoticed. |
| New PR/branch CI workflow | `.github/workflows/ci.yml` (new) | Deploy workflow only triggers on `main`, so feature branches got no signal at all. |

---

## 5. Reference portal and dev workflow

**The name-key trap.** `ReferenceExtractor` had a **free-text** exercise-name input. Whatever
the PT typed became the registry key. The runtime looks references up by the exact
`EXERCISE_CONFIGS` key, so a file named `"Left Side Arm Raise"` registers under a key nothing
ever requests — it loads, logs success, and is never used.

**Consequence:** *0 of 16 exercises currently run on a real recorded reference.* Every live
session uses the synthetic sine-swept template, whose phase boundaries were authored by hand,
not measured from anyone.

**Fixes:**

- Replaced the free-text field with a **dropdown of canonical `EXERCISE_CONFIGS` keys**.
  Selecting one auto-fills detector and mode from that exercise's own config.
- Export is **blocked** for a non-canonical name.
- `bootstrapReferences` now **warns loudly** and skips when a `.ref.json` name is not a known
  exercise id, instead of registering it into the void.
- References are tagged with a `source` field (`synthetic` / `video` / `api`), and the engine
  logs it: `[Engine] DTW mode for SideArmRaise — reference source: SYNTHETIC`. Essential when
  validating a newly recorded reference — *synthetic* means the recording is not in use.
- **Re-enabled the dev-mode block in `App.js`** (lines 28–44 were fully commented out). Gated
  by `REACT_APP_DEVELOPMENT_MODE`, so production is unaffected. Without it the app requires a
  JWT and a live backend, making local testing of a recorded reference impossible.

**Recording workflow** (documented in `README.md`): `yarn start` →
`localhost:3000/reference-extractor` → upload video → confirm rep boundaries → label phases →
write feedback → export → drop the `.ref.json` into `src/dtw/references/` → restart → confirm
the log reports `source: VIDEO`.

---

## 6. Cleanup

| Change | File | Why |
|---|---|---|
| `REACT_APP_API_BASE_URL` now actually read; missing-tenant guard | `config.js` | The env var was documented in `.env` but never read. A missing tenant produced `https://undefined.rehabranger.ai/...` and failed as an opaque network error. |
| Shared `CHECK_PRIORITY` constant | `PoseQuality.js`, `SessionStateMachine.js`, `CoachingOverlay.js` | The list `['visibility','distance','angle','lighting']` was hand-duplicated in two files. Changing one and not the other would desync the coaching message from the box colour. |
| Removed dead `makeEMA()` | `features.js` | Byte-identical duplicate of the `EMA` class, zero callers. |
| Removed superseded pair-counting block | `phase_machine.js` | Commented-out earlier implementation sitting directly above the active one. |
| Unified backup rep-path cycle reset | `DTWPhaseMachine.js` | Primary rep path reset `cycleState` to `'sawStart'`, the backup path to `'idle'` — an asymmetry that made a rep counted via the backup route need an extra start detection before the next rep. |
| Stale comments corrected | `PatientBaseline.js`, `universalFeatures.js` | Header claimed "within 5% of baseline" (real value 30%); docstring claimed "~22 features" (real count 30). |
| Real `README.md` | `README.md` | Was 100% CRA boilerplate. Now documents architecture, the rep-counting rules, the reference workflow, and the **new postMessage contract**. |

---

## 7. New files

**Source (2 + 8 test suites):** `src/metrics.js`, `src/ErrorBoundary.js`, and the eight new
test files listed in §3.

**Infrastructure (1):** `.github/workflows/ci.yml`

**Binaries (4):** `public/mediapipe/wasm/*` — ~19 MB total.

**Documentation (3):**

- `ARCHITECTURE_DUMP.md` — 1,881 lines, written for an **external code reviewer**. Contains
  verbatim source of the live engines. Structured answer to: what pose model, what
  segmentation engine, what the recording format contains, whether baseline tracking exists.
- `PROJECT_OVERVIEW.md` — written for a **prospective developer who has not signed an NDA**.
  Deliberately omits the algorithm, all tuning constants, feature definitions, the integration
  contract, and known weaknesses.
- `docs/pipeline.html` — a visual explainer (SVG flow diagrams) tracing one camera frame end
  to end, annotated with the owning file/function at each stage.

---

## 8. Notable findings a successor should know

1. **~2,000 lines of the repo are unreachable.** `phase_machine.js` + all 16
   `src/specs/*.spec.js`. `getReference()` always returns a template, so the fallback branch
   never executes. Do not spend time reading or "fixing" them.
2. **No skeleton recordings exist.** `VideoRecorder` and `SkeletonRecorder` both encode a
   canvas to `video/webm` via `MediaRecorder` — **pixels, not joints**. No keypoint stream is
   ever persisted. There is no dataset in this repo that could be used to re-run segmentation
   offline, re-score sessions, or train anything.
3. **The one reference file has no timestamps, no confidence scores, and no coordinates** — it
   stores *derived* angles and ratios only, with an integer frame index.
4. **MediaPipe confidence can be synthetic.** `visibility` defaults to `1.0` when the model
   omits it, so a "fully confident" foot keypoint may never have been measured.
5. **`PatientBaseline` is device-local.** localStorage only, never synced. A patient switching
   phones starts calibration over.
6. **Tempo feedback is declared in all 16 configs and never surfaced** — `_pickFeedback` has a
   `// 3. Tempo (future...)` placeholder.
7. **`serviceWorker.js` exists but is never registered.** Offline support is off.

### `CLAUDE.md` is now stale in several places

The project's own `CLAUDE.md` predates this work. Verified inaccuracies:

| CLAUDE.md says | Reality |
|---|---|
| "Within 5% of baseline range = completed" | `TOLERANCE = 0.30` → **≥70%** of baseline ROM |
| "EMA smoothing (α ≈ 0.5)" | α = **0.35** (0.4 for normalized features) |
| "Every `tf.*` operation must be wrapped in `tf.tidy()`" | **Zero** `tf.tidy` calls exist anywhere in `src/` |
| "15/15 rep-mode exercises PASS" | **16/16** now pass (time mode fixed — §2.1) |
| CalfRaises key feature: `ankleAngleToe` | Now **`footPitchNorm`** |
| "Only SideArmRaise has a video-extracted ref" | That ref is **orphaned**; 0 of 16 are in use |
| Rep gate "25% of reference range" | 0.25 is only the *default*; most exercises override via `minRomPct` |

**Recommend updating `CLAUDE.md` before the next session.**

---

## 9. Open decisions before committing

1. **~19 MB of WASM binaries.** Committing `public/mediapipe/wasm/` makes the repo
   permanently heavier. Alternative: a `postinstall` script copying from `node_modules`.
   Deliberate choice needed, not a default.
2. **Three docs are audience-specific.** `ARCHITECTURE_DUMP.md`, `PROJECT_OVERVIEW.md` and
   `docs/pipeline.html` may belong in a separate commit — or outside the repo entirely.
3. **`.claude/settings.local.json`** picked up incidental permission changes. Probably should
   not be in the PR.
4. **Breaking host-app change.** The postMessage field names changed to universal keys. The
   mobile/backend team must ship in coordination. Contract is in `README.md`.
5. **Clinical caps need sign-off.** 14 of 16 are marked `TODO clinical review` (§1.3).
6. **No live webcam validation has been done** on any of this. The synthetic suite cannot
   substitute (§3).

---

## 10. Verifying this branch

```bash
yarn test:ci        # 182 tests, 10 suites, all pass; DTW validation 16/16
yarn build          # succeeds; only pre-existing lint warnings remain
```

Live check for the two regressions:

1. `yarn start` with `REACT_APP_DEVELOPMENT_MODE=true` and
   `REACT_APP_DEFAULT_EXERCISE=SideArmRaise`.
2. Raise the arm above ~95° → the **"That's high enough"** cue should appear immediately,
   interrupting the rep number.
3. Complete 3 reps → console / postMessage should show 3 `repSummary` payloads carrying
   `shoulderAngleL` min/max.
4. Console should report `[Engine] ... reference source: SYNTHETIC`.
