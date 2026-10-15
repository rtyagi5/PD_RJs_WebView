# Engine notes — open decisions, action items, validation status

A running log of things that need a **human decision**, things that need **engineering work**, and
where on-device validation actually stands. Kept so none of it has to be re-derived from memory.

Companion documents:
- [BASELINE_ASSESSMENT_RESEARCH.md](BASELINE_ASSESSMENT_RESEARCH.md) — literature review: which joints a baseline assessment should measure, and what a phone camera can actually support
- [APP_AND_BACKEND_ISSUES.md](APP_AND_BACKEND_ISSUES.md) — three defects outside the pose engine (grey launch screen, video playback, the side=left default), for hand-off
- [MOVEMENT_BASELINE_PLAN.md](MOVEMENT_BASELINE_PLAN.md) — cross-repo plan to replace the 2-rep calibration with an occasional per-joint baseline session
- [CLINICAL_GUARDRAILS.md](CLINICAL_GUARDRAILS.md) — every safety cap, its provenance, and the PT sign-off table
- [RECORDING_A_REFERENCE.md](RECORDING_A_REFERENCE.md) — how to record and extract a reference
- [BASELINE_SYNC_CONTRACT.md](BASELINE_SYNC_CONTRACT.md) — the per-patient baseline store

Last updated **2026-10-11**.

---

## How a reference reaches the engine

Worth stating once, because it determines whether an extraction has any effect.

Precedence, lowest to highest (`bootstrapReferences.js`):

1. **Synthetic** — generated from `EXERCISE_CONFIGS` in `specToReference.js`. Always registered first.
2. **Video-extracted** — every `*.ref.json` in `src/dtw/references/`, auto-discovered by webpack's
   `require.context` and registered with `source: 'video'`, **overriding the synthetic one**.
3. **API / cached** — `fetchAndCacheReference()` would prefer a reference served by the backend
   (7-day `localStorage` cache in front of it).

**Today, level 3 does not exist.** There is no `GET /exercise-service/references/:exerciseName` route
in `rehab-backend` — `src/dtw/references/index.js` documents the table and endpoints as a request to
the backend developer, and they have not been built. So the `.ref.json` files in the repo are what
runs, on device included. Confirmed from a device log:

```
[Bootstrap] Loaded video reference: "WallPushUp" (overrides synthetic)
[Bootstrap] Registered 16 synthetic + 15 video-extracted DTW references
```

Two consequences:

- A re-extraction only takes effect once the new `.ref.json` is **in `src/dtw/references/`**. The dev
  server picks it up on rebuild; no deploy needed for the USB loop.
- `timing` is deliberately **not** taken from a recording — `[Bootstrap] "X" — ignoring timing from
  the .ref.json; these come from EXERCISE_CONFIGS`. Same for every field in `CANONICAL_FIELDS`
  (`clinicalCaps`, `framing`, `minRomPct`, `mode`, `side`, `detector`, `highlightKeypoints`,
  `primaryFeature*`). A recording supplies **phase shape and feature ranges**, nothing else.

---

## Open decisions

### 1. What should `side` mean for a bilateral exercise?

**Status: undecided. Nothing has been changed. This is the one that needs an owner.**

Found while debugging a BicepCurls session where right-arm curls counted no reps and left-arm curls
counted normally.

The chain, end to end:

```ts
// rehab-backend — packages/exercises/src/modules/activities/exercise/service.ts:120
side: exerciseData?.side,
...
if (!tokenData?.side) {
  delete tokenData.side;        // no side on the exercise record -> claim omitted entirely
}
```

```js
// Posedetection_ReactJS_WebView — src/App.js:71
setSide(sideFromURL ?? "left"); // absent -> invent "left"
```

So for an exercise with no side on its record — which is what you would expect for "Bicep Curls" —
the backend correctly omits the claim and **the pose app silently turns that into `left`**. The
device log showed `side=left` for a session nobody had assigned to the left arm.

The engine then honoured it, which is correct behaviour in general: this is a stroke product,
hemiparesis affects one side, and most exercises genuinely are assigned to the affected limb. The
`side` claim exists for exactly that. The defect is the **default**, which invents clinical
information nobody supplied.

Supporting evidence that the vocabulary was never settled:

- `packages/exercises/src/modules/exercises/schema.ts:37` is a bare `side: string` — no enum, no
  validation. `"Both"`, `"BOTH"`, `"bilateral"` or a typo all flow through and land on the default.
- `src/dtw/references/index.js` documents the intended vocabulary as
  `'left' | 'right' | 'both' | 'alternating'`, but only in a comment, for a table that does not exist.
- The platform has historically encoded side into exercise **names** instead — there is a
  `"Left Side Arm Raise"` reference in the repo.

#### Three layers, and only one is really a code bug

| Layer | State | Owner |
| --- | --- | --- |
| **Exercise catalogue** — what `side` should hold for a bilateral exercise | No agreed vocabulary. **This is the blocker.** | Product / clinical, not engineering |
| **Pose app** — `?? "left"` guesses when nothing was supplied | The actual bug. One line. | Pose-detection app |
| **Backend** — passes through, validates nothing | No bug, but a gap: an enum would stop typos reaching the default | Backend, not urgent |

Decide the catalogue question first. If the answer is *"absent means both"*, only the pose app
changes. If it is *"bilateral exercises must say so explicitly"*, only catalogue data changes and the
default never fires.

#### And then: what counts as a rep when it IS bilateral?

| | Both arms together | One arm only | Needs |
| --- | --- | --- | --- |
| **A. Either arm** — *currently live* | counts | **also counts** | nothing |
| **B. Both arms must move** | counts | rejected | a new `elbowAngleMax` aggregate |

Current behaviour is **A**: a `side: 'both'` reference resolves its pin to an aggregate
(`elbowAngleMin`, "whichever elbow is more bent"), chosen direction-aware from the template. This
makes both-arm and single-arm curls count. It fixed the reported symptom but it is **not** the same
as "both arms must move", and a patient curling only their good arm gets full credit.

**B** needs `elbowAngleMax = max(elbowAngleL, elbowAngleR)` — the *straighter* arm — which does not
exist; `universalFeatures` computes only `*Min` for angles. Weigh one failure mode before choosing
it: the straighter arm then gates every rep, so for a hemiparetic patient the affected arm is the
limiter. The baseline adapts down to what that arm can do, so it mostly self-corrects — **but if the
affected arm barely moves, its range is near zero and no rep ever counts, silently.** Any
implementation of B should degrade to A rather than count nothing.

> Deliberately **not** changed: the *auto-picker* (used when a reference has no pin) still filters to
> the assigned side for bilateral exercises, so `SideArmRaise` — `side: 'both'`, no pin — would also
> miss a raise on the unassigned arm. Same bug class, but SideArmRaise is already validated and this
> was not worth a silent behaviour change.

### 2. Should a short rep be recorded as lower quality?

**Status: decided in principle, not implemented.**

Decision taken: a stroke patient with limited range must **not** be told their rep was poor merely
for being short. But a rep that falls well short of **that patient's own baseline** is worth
distinguishing from a full one.

The good news is that this classification **already exists** and is being fed the wrong number:

```js
// PatientBaseline.onRepDetected
if (repAnalysis.romPct >= (1 - this.tolerance)) {   // TOLERANCE = 0.30 -> 70% of own baseline
  this.reps.completed++;
  return { completed: true, flagged: false, ... };
} else {
  this.reps.attempts++;                              // short of their own baseline
  return { completed: false, flagged: false, ... };
}
```

So the three states are already distinguishable, and the counters
`{ completed, attempts, flagged, total }` are already tracked:

| | Meaning |
| --- | --- |
| `completed: true` | full movement for this patient |
| `completed: false, flagged: false` | tried, fell short of their own baseline |
| `completed: false, flagged: true` | breached a safety cap |

**Why it does not work today.** `_analyzeRep` averages `romPct` across **every** baseline feature —
elbow, shoulder, hip, knee, trunk, wrist — not the one the exercise is about:

```js
for (const [key, b] of Object.entries(this.baseline)) {
  const romPct = Math.min(1.5, repRange / b.range);
  totalRomPct += romPct; featureCount++;
}
const avgRomPct = totalRomPct / featureCount;
```

A third-range curl, averaged with a normally-moving trunk and shoulders, lands above 70% and passes.
Measured on device — note it does not track effort at all:

| Logged primary-feature rom | reported `romPct` |
| --- | --- |
| 70.0° | 83% |
| 81.0° | 92% |
| 108.6° | 92% |
| 132.9° | 96% |

**The fix is narrow:** make `romPct` reflect the primary feature rather than the mean of everything.
Then the existing 70%-of-baseline rule starts doing what it was designed to do, with no new concepts.

Two things to settle first:

- **The first two reps always count as completed.** `CALIBRATION_REPS = 2` plus
  `CALIBRATION_MIN_FRAMES = 60`; during calibration every rep returns
  `romPct: 1.0, details: { calibrating: true }`. The baseline is therefore set from the patient's
  first two reps of the session — **if those two are small, the bar stays small all session.**
- **A second, separate baseline effect**: `minRomForRep` (whether a rep counts *at all*) also adapts,
  and is clamped so it can only ever get **easier**:
  `[DTW] ROM gate 66.6 -> 59.6 (baseline-locked)`. Do not confuse it with the 70% tolerance above.

### 3. Clinical caps need a PT signature

See [CLINICAL_GUARDRAILS.md](CLINICAL_GUARDRAILS.md). **No cap in the engine came from research** —
all were set from template geometry. The two most worth a clinician's time:

- `SideArmRaise` `shoulderAngle max 95` — a genuine impingement limit, and the *demonstration*
  overshoots it by 4.71°. Keep the cap, re-record the reference.
- `WallPushUp` `elbowAngle min 75` — overshoots by 5.84°. How deep is safe is a clinical question.

### 4. Camera-pitch threshold is uncalibrated

`checkCameraPitch` (`PoseQuality.js`) measures apparent torso length as a multiple of shoulder width;
camera pitch is what moves it. `MIN_TORSO_SHOULDER_RATIO = 0.70` is **a guess**, so the check is
**advisory and does not block a session** — a blocking check on a guessed threshold can lock a
patient out. It reports its measured ratio on every setup. Collect ratios from known-good and
known-bad placements, set a real limit, then promote it into `p0Good`.

### 5. Half reps count on BicepCurls

`minRomPct: 0.40` × 166.42° range = a **66.6°** gate, which the baseline then lowers to 59.6°.
Measured reps of 67.7–135.2° all counted. Raising `minRomPct` would reject half curls — but it is
also the number that lets a limited-ROM patient get credit. Related to decision 2.

### 6. Spoken-cue policy

Two unresolved items from earlier device sessions:

- **56 of 60 phase cues are suppressed** by the speech-duration guard (a cue longer than its phase
  window is dropped). Options: shorten the cues, let a cue run into the next phase, or drop the guard
  for phase cues specifically.
- **A cap breach colours the whole skeleton red**, deliberately — the in-code rationale is that *"the
  limb at fault is rarely where the patient is looking, and a safety warning that has to be hunted
  for is not a warning."* Preference expressed for highlighting only the active limb. One-line change.

---

## Action items

Engineering work that is already decided — no further input needed.

| # | Item | Blocks | Owner |
| --- | --- | --- | --- |
| A1 | **Re-extract `SeatedMarch`** — `kneeLiftNorm` now normalises by `torsoLen`, so the stored ranges are in stale units | SeatedMarch validation | — |
| A2 | **Re-extract `StandingMarch`** — same unit change | StandingMarch validation | — |
| A3 | **Re-derive the `SeatedMarch` `kneeLiftNorm` cap** from the new extraction; currently a provisional `0.70` | A1 | — |
| A4 | **Extract `StandingStraightUp`** — never done; no reference exists, so its cap has never been checked. Record with 3s freezes at both ends, `kneeAngleMin`, Mode = time | StandingStraightUp validation | — |
| A5 | **Fix the three caps that cannot fire** — see below | — | — |
| A6 | **Align `primaryFeatureBase`** for the MediaPipe foot exercises — still `footPitchNorm` while recordings pin `ankleAngleToe` | — | — |
| A7 | **Build the reference REST endpoints** so references stop being bundled into the webpack build (`src/dtw/references/index.js` has the table and route spec) | Shipping a reference without a frontend deploy | Backend |
| ~~A8~~ | ~~**Serialise `details` in the rep log**~~ — **done 2026-10-11.** `_logRep` now serialises `details` and names any breached cap | — | — |
| A9 | **Tune `minRomPct` for the untuned exercises** — only BicepCurls (0.40), SeatedMarch (0.50), SeatedDorsiflexion (0.80) and now WallPushUp (0.55) are set. The rest inherit the `0.25` default, which on WallPushUp counted an arm waggle as a rep | trustworthy rep counts | — |
| A10 | **Decide whether DTW shape match should gate a rep** — the primary rep path checks range, phase order and timing only; `matchThreshold` guards the *backup* path alone, so a movement with the right joint signature but the wrong shape counts | false positives | — |

### A5 — caps that cannot fire

Not safety limits today, whatever their number says. Changing the number changes nothing until the
underlying feature is fixed.

| Exercise | Cap | Why it cannot fire |
| --- | --- | --- |
| `LiftsAndChops` | `handsHeightNorm max 1.3` | `handsHeightNorm` has no `L`/`R`/aggregate variant, so the cap expands only to `handsHeightNormL` / `handsHeightNormR`, neither of which exists. **Completely dead.** |
| `StandingMarch` | `kneeLiftNorm max 0.5` | `max(0, hip.y − knee.y)` is clamped to zero standing, because the knee stays below the hip. Demonstrated range 0.00–0.02. |
| `StepUps` | `kneeLiftNorm max 0.4` | Same clamp. Demonstrated range 0.00–0.00. |

---

## SCOPED: calibration integrity (items 1 + 3)

**Status: scoped, not implemented.** Agreed 2026-10-11.

### Why this is now the priority

The rep gate is a fraction of the **patient's own** calibrated range, not an absolute
(`romGate.js`: `baselineValue = pct * patientRange`). That is the right design — it is why a
patient with a restricted shoulder is not asked to move like the template. But it means
**every downstream number inherits the quality of the calibration**, and calibration is
currently the least protected part of the session:

| | |
| --- | --- |
| Calibration window | the first **2** reps (`CALIBRATION_REPS = 2`, `CALIBRATION_MIN_FRAMES = 60`) |
| When it runs | inside `ACTIVE`, i.e. **after** setup has stopped being enforced |
| What is checked during `ACTIVE` | `visibility` only — are the keypoints detectable |
| What is NOT checked | distance, camera angle, roll, foot tracking |

So a patient still settling during their first two reps locks a baseline from a bad sample,
and nothing catches it. Measured on device: a WallPushUp calibration captured 88.0° (clean),
but had those two reps been arm-waggles at ~30°, the gate would have locked near 16° and every
subsequent waggle would have counted for the rest of the session.

Two guards, independent of each other. **3** is the direct guard on the failure mode;
**1** stops it being reached.

### Item 1 — enforce position during calibration

Today `SessionStateMachine` runs the full gate in `COACHING` and `COUNTDOWN`:

```js
const allGood = by('distance')?.status === 'good'
  && by('angle')?.status === 'good'
  && by('roll')?.status !== 'rolled'
  && by('visibility')?.status === 'good'
  && by('foot')?.status === 'good';
```

and then in `ACTIVE` drops to `visibility` alone.

**Change.** Keep the full gate while the baseline is still calibrating, then drop to the
current `visibility`-only behaviour once it locks.

| Where | What |
| --- | --- |
| `ExerciseTracker_refactored.js:669` | pass `calibrating: !!engine.patientBaseline?.isCalibrating` into the existing `sm.step({...})` call — the tracker already holds both objects, so nothing new is wired |
| `SessionStateMachine.js` `ACTIVE` branch | when `calibrating` is true, require the full `allGood` set instead of `visibility` alone |
| `ExerciseTracker_refactored.js:842` | when the calibration gate fails, **skip `engine.step()`** for that frame so bad geometry never enters `featureStats`, and surface the highest-priority failing check as the message |

**Deliberately NOT a state transition.** Bouncing to `COACHING` mid-calibration would leave
already-counted calibration reps in place while discarding the frames — a worse state than
either. Pausing the engine step keeps the rep count and the baseline consistent with each other.

**`pitch` must stay out of this gate.** `MIN_TORSO_SHOULDER_RATIO` is uncalibrated (open
decision 4), and including it would let a guessed threshold block a session. Use exactly the
five checks already proven to pass in `COACHING`.

### Item 3 — refuse to lock an implausible baseline

`_lockBaseline()` currently locks unconditionally once the rep and frame counts are met:

```js
_advanceCalibration() {
  if (!this.isCalibrating || this.isLocked) return;
  this.calibrationRepsCompleted++;
  if (this.calibrationRepsCompleted >= this.calibrationReps &&
      this.calibrationFrames >= CALIBRATION_MIN_FRAMES) {
    this._lockBaseline();
  }
}
```

**Change.** Before locking, check the **primary feature's** captured range against the
absolute noise floor already defined in `romGate.js`:

```js
export const ROM_FLOORS = { angle: 8, ratio: 0.02 };
```

If the captured range is below `absoluteFloorFor(primaryFeature)`, the calibration recorded
noise rather than movement — **do not lock**. Keep calibrating and log why.

Using the existing floor matters: it is the project's own stated noise threshold, so this
introduces **no new guessed number**. It is also deliberately permissive — a genuinely
restricted patient is well above 8° of elbow or knee travel, so real limitation still locks
a small, honest baseline. That is the whole point of the baseline and must not be rejected.

**Retry bound.** After `MAX_CALIBRATION_ATTEMPTS` (propose 3× `calibrationReps`), stop retrying
and fall back to the **template** gate (`source: 'template'` in `resolveRomGate`) rather than
locking a bad baseline or calibrating forever. The template gate is a worse fit for a
restricted patient but it is at least a known quantity.

**Needs `PatientBaseline` to know its primary feature.** It is constructed with
`{ referenceRanges: this.featureRanges }` only (`DTWPhaseMachine.js:414`), so
`primaryFeature` has to be passed in alongside it.

### Tests

- A calibration whose primary-feature range is below the floor does not lock; one just above it does.
- A genuinely limited range (small but above the floor) **does** lock — guards against over-rejection.
- After the retry bound, the gate resolves with `source: 'template'`.
- During calibration, a frame failing `distance` or `angle` does not reach `updateFrame`.
- After lock, the same failing frame **is** stepped (current behaviour preserved).
- `pitch` status `'oblique'` never blocks a calibration frame.

### Risk

Item 1 makes the engine stricter during the first two reps of **every** exercise, including
the ones already validated. The failure mode to watch for is a patient who cannot clear the
setup gate while also performing the movement — e.g. a side-view exercise where reaching for
the wall moves them out of the `distance` band. That would stall calibration indefinitely,
which is why the retry bound in item 3 is a prerequisite rather than an optional extra.

### Out of scope

Re-checking position throughout `ACTIVE` (option 2) — deferred until the pitch threshold is
calibrated, since that is the check most likely to fire mid-set. Also noted but not changed:
a rep that **breached a clinical cap still advances calibration**
(`PatientBaseline.js:124`), so an unsafe rep contributes to the baseline. The in-code
rationale is that "a rep that crossed a limit is still a rep they performed", which is
defensible for the rep count but questionable for the ROM baseline. Open question, not a fix.
---

## Validation status

On-device, over the USB loop (`adb reverse tcp:3000` **and** `tcp:8081`).

| Exercise | Reference | Run on device | Notes |
| --- | --- | --- | --- |
| `SideArmRaise` | yes | **yes** | 10/10 reps. Demonstration overshoots its own cap by 4.71° — see decision 3 |
| `BicepCurls` | yes | **yes** | Cap loosened 40 → 5; either arm now counts. Half reps still count (decision 5) |
| `SeatedMarch` | yes | **yes — failed** | Every rep flagged by a cap breach caused by the `kneeLiftNorm` normaliser. Needs A1 + A3 before re-testing |
| `SeatedDorsiflexion` | yes | **yes** | The reference the cycle checks were calibrated against |
| `LiftsAndChops` | yes | partial | Ran, but its cap is dead (A5) and a video playback error was seen |
| `WallPushUp` | yes | **yes — 2 bugs found** | The cap **did** fire but was never spoken (fixed, D). An arm waggle counted as a rep: the `0.25` default gate was 22° of a 99° movement — `minRomPct` now 0.55. Re-test |
| `StandingMarch` | yes | not yet | Blocked on A2 |
| `MiniSquats` | yes | not yet | |
| `MiniLunges` | yes | not yet | |
| `SitToStand` | yes | not yet | |
| `LongArcQuad` | yes | not yet | |
| `StepUps` | yes | not yet | Demonstration 1.32° past its cap — measurement noise |
| `CalfRaisesSeated` | yes | not yet | Cap raised 0.22 → 0.36 to stop it flagging its own demonstration |
| `CalfRaisesStanding` | yes | not yet | |
| `StandingDorsiflexion` | yes | not yet | 4.84° range; measured 17.7× signal-to-wobble, in line with the others |
| `StandingStraightUp` | **no** | not yet | Blocked on A4 |

---

## Changes made 2026-10-11

For traceability. All verified against 559 passing tests and a clean served bundle.

| Change | File | Why |
| --- | --- | --- |
| `BicepCurls` cap `elbowAngle` 40 → 5 | `specToReference.js` | Flagged a full, correct curl; all 10 device reps logged as `attempt` |
| `SeatedMarch` caps `kneeLiftNorm` 0.45 → 0.70, `hipAngle` 50 → 5 | `specToReference.js` | Both flagged their own demonstration |
| `kneeLiftNorm` normalised by `torsoLen`, not hip→ankle distance | `universalFeatures.js` | The old denominator **collapsed as the knee rose**, double-counting the lift. Measured: `hipAnkLen` 131 → 59 at peak lift, inflating a 0.38 lift to 0.834 |
| `reference.side === 'both'` resolves its pin to a direction-aware aggregate | `DTWPhaseMachine.js` | `'both'` was being dropped; only `'alternating'` was handled |
| `checkCameraPitch` added, advisory | `PoseQuality.js` | Camera **height** was entirely unchecked |
| Caps doc rewritten with provenance + measured audit | `CLINICAL_GUARDRAILS.md` | The caps were widely assumed to come from research; they do not |
| `_logRep` names the breached cap and serialises `details` | `DTWPhaseMachine.js` | "the cap did not fire" and "the cap fired silently" were indistinguishable in the log |
| A breach during a rep is announced at rep end (`BREACH_ANNOUNCE_MS`) | `DTWPhaseMachine.js` | Breaches are accumulated for classification but speech asked about the **current** frame, so a brief dip downgraded the rep silently |
| `WallPushUp` `minRomPct` 0.25 (default) → **0.55** | `specToReference.js` | The gate was 22° of a 99° movement; straightening and bending the arms counted as reps |
