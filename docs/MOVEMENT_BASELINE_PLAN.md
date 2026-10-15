# Movement Baseline — cross-repo implementation plan

**Status: proposal for review. No code has been written.** Intended for hand-off to the
backend / full-stack developer alongside the engine changes already made.

Spans all three repos: `Posedetection_ReactJS_WebView` (the pose engine, deployed as
`rehab-fe`'s `pd-detection`), `rehab-backend`, and `mobile-app`.

Written 2026-10-12. Companion: [NOTES.md](NOTES.md) · [CLINICAL_GUARDRAILS.md](CLINICAL_GUARDRAILS.md)

---

## The idea

Replace *"the first two reps of every exercise are the baseline"* with a dedicated, occasional
session that captures each joint's usable range under controlled conditions, and use that as the
reference every treatment exercise is scaled against.

**Why the current design needs replacing.** Today the baseline is both the ruler and is measured by
the thing it rules. A patient who performs small reps gets a small baseline, which makes small reps
score as full. Two consequences:

- A patient whose range **declines** is silently re-normalised. The gate drops with them, every rep
  still reports `completed`, and the decline never surfaces.
- "Your range improved 12°" is unsupportable, because the denominator moves every session.

A separate assessment breaks that loop. It also lets one shoulder capture serve `SideArmRaise`,
`LiftsAndChops` and `WallPushUp`, instead of calibrating the same shoulder three times from three
different warm-ups.

## Naming

"Range of Motion Assessment" asserts a clinical measurement this system cannot support — see
[CLINICAL_GUARDRAILS.md](CLINICAL_GUARDRAILS.md), which is explicit that these are 2D single-camera
readings with unknown intrinsics and must be presented as *tracking and trending only*.

Proposed instead:

| Context | Name |
| --- | --- |
| Code | **`protocolBaseline`** — already the term in `romGate.js`; do not rename |
| Clinician / product | **Movement Baseline** |
| Patient-facing | **"Movement Check"**, or "Let's set your starting point" |

Patient-facing copy must not report a joint angle as a measurement. "Your starting point is set" is
defensible; "your shoulder abduction is 96°" is not.

---

## What already exists — read this first

Three discoveries that change the shape of the work. **Most of the concept is already built, twice,
in two places that do not know about each other.**

### 1. The pose engine already prefers a protocol baseline

The resolution order is implemented and tested, specifically so this work is additive:

```js
// romGate.js — "Resolution order: protocol baseline > in-session calibration > template range."
const protocolRange = lockedRangeFor(protocolBaseline, primaryFeature);
```

```js
// DTWPhaseMachine.js:984
protocolBaseline: null, // WI-4 supplies this; resolver already prefers it.
```

`lockedRangeFor` already accepts a `.jointRanges` shape, and `romGate.test.js` asserts the
precedence. **The consuming seam is finished — it is passed `null`.**

### 2. The backend already has a per-joint capability system, in use

`packages/exercises/src/modules/engine/` contains a parallel implementation of the same idea:

- `activities/exercise/assessment.schema.ts` — collection `exercise-assessments`, keyed
  `(patient, exerciseType)`, holding `expectedConfig` and `currentConfig` as `{ [joint]: {start, end} }`,
  plus a `locked` flag.
- `core/targetResolver.ts` — `resolveCapabilityOrDefault()` returns `{ baseline, current, source: 'assessment' }`,
  falling back to hardcoded `exerciseExpectedConfig[exerciseType]` defaults.
- `resolveTarget()` — `{ min: max * targetConfig.minPercent, max: max * targetConfig.maxPercent }`.
  **This is the same "percentage of the patient's own capability" idea as the pose engine's
  `minRomPct × patientRange`.**
- `services/exercise-aggregate.service.ts` — widens the patient's range as they improve:
  `if (observedMax > currentConfig[joint].end + 2) currentConfig[joint].end += inc`.

### 3. The two systems duplicate each other and cannot interoperate

| | Pose engine | Backend |
| --- | --- | --- |
| Store | `localStorage` (`PatientBaseline` / `BaselineStore`) | MongoDB `exercise-assessments` |
| Shape | per-exercise, per-feature `{min, max, range}` | per-exercise, per-joint `{start, end}` × expected/current |
| Where the baseline comes from | the first 2 reps of the session | `expectedConfig` seeded from hardcoded defaults; `currentConfig` widened from observed maxima |
| Used for | the rep ROM gate, and `completed` vs `attempt` | `resolveTarget` targets and rolling aggregates |
| Progression | re-locks every session | increments `currentConfig[joint].end` |
| Knows about the other | no | no |

**And the feature vocabularies diverge**, which is a hard blocker before any data can flow:

| Backend key (`exerciseExpectedConfig`) | Pose engine key (`universalFeatures`) |
| --- | --- |
| `armAngle` | **does not exist** |
| `hipFlexAngleMin` | `hipAngleMin` |
| `hipToKneeNormMax` | `hipToAnkleNormL` / `...R` |
| `kneeAngleMax` | **does not exist** — only `kneeAngleMin` |
| `shoulderAngle` | `shoulderAngleL` / `...R` / `shoulderAngleMin` |

This is the same class of problem as the unresolved `side` vocabulary
([NOTES.md](NOTES.md#1-what-should-side-mean-for-a-bilateral-exercise)): two layers inventing names
independently, with no shared contract and no validation.

> **Conclusion for the developer:** this is less "build a new feature" and more "unify two existing
> half-implementations behind one source of truth, then add a capture flow". Scope the reconciliation
> first — it is the part that will surprise people.

---

## Target architecture

```
Movement Baseline session  (one-off, then periodic)
        |
        v
  per-joint ranges, captured under enforced setup, in the view each joint needs
        |
        v
  SERVER = system of record  (per patient, versioned, with expiry)
        |
        +---> pose engine      : protocolBaseline -> rep ROM gate        (seam exists)
        +---> backend engine   : capability -> resolveTarget             (exists, re-pointed)
        +---> admin portal     : clinician review, override, trend
        +---> mobile app       : "baseline needed / expired" state
```

Precedence stays as already implemented: **protocol > in-session calibration > template.**

Two rules that must hold, or the circularity returns:

1. **In-session calibration must never overwrite the protocol baseline.** It may supply a gate where
   no protocol value exists; it must not become the progress ruler.
2. **Separate the two jobs.** The protocol baseline is the *measurement* (progress, reporting,
   clinician view). The rep gate is an *operational threshold*. One number serving both is how we
   got here.

---

## Work breakdown by repo

### A. `rehab-backend` — storage, assignment, expiry

| # | Item | Notes |
| --- | --- | --- |
| B1 | **Decide the joint-range model.** Extend `exercise-assessments` from `(patient, exerciseType)` to a per-joint record, or add a new `patient-joint-baselines` collection | Per-joint is the point of the exercise; keying by `exerciseType` keeps the duplication |
| B2 | **Build the baseline endpoints.** Already specified in [BASELINE_SYNC_CONTRACT.md](BASELINE_SYNC_CONTRACT.md) and never built: `GET/PUT /api/v1/patients/:id/baseline` returning `{ protocolBaseline, exerciseBaselines[], updatedAt, version }`, with `ifUnmodifiedSince` → 409 | The contract already distinguishes protocol from per-exercise. Follow it |
| B3 | **Reconcile the feature vocabulary.** One canonical key list, owned in one place, validated on write | Blocking for everything else. See the divergence table above |
| B4 | **Assessment assignment.** A way to assign the baseline session — a program of assessment activities, or a distinct activity kind | `programs/service.ts` and `activities/exercise/service.ts` already mint signed WebView URLs |
| B5 | **Carry the session kind in the JWT.** `activities/exercise/service.ts:112-127` mints `{ tenant, activity, patient, reps, exerciseType, side }` — add e.g. `sessionKind: 'baseline'` | Note the existing `if (!tokenData?.side) delete tokenData.side` pattern |
| B6 | **Expiry and cadence.** `capturedAt` + `expiresAt`, and a rule for when a baseline is stale enough to prompt re-assessment | Clinical input needed on the interval |
| B7 | **Re-point `resolveCapabilityOrDefault`** at the protocol baseline, keeping `exerciseExpectedConfig` as the last-resort default | Makes the backend read the shared source instead of its own |
| B8 | **Decide what `currentConfig` widening means** once a protocol baseline exists | Today the backend silently widens the patient's range when they exceed it, which is a second re-normalisation loop |

### B. Pose engine (`Posedetection_ReactJS_WebView` → `rehab-fe` `pd-detection`)

Two separable pieces. **The second is much smaller than the first and can ship first.**

**B.1 — Consume the baseline (small, seam exists)**

| # | Item |
| --- | --- |
| P1 | Fetch the protocol baseline at session start (next to the existing `fetchAndCacheReference` / `assigned-exercises` call in `App.js`) |
| P2 | Pass it into `DTWPhaseMachine` and through `_refreshRomGate` → `resolveRomGate({ protocolBaseline })`, replacing the hardcoded `null` at `DTWPhaseMachine.js:984` |
| P3 | Map the canonical joint keys onto `universalFeatures` keys (depends on B3) |
| P4 | Report the resolved source in the log — `rom-source=protocol` already prints |

**B.2 — Capture the baseline (the new flow)**

| # | Item |
| --- | --- |
| P5 | New session mode driven by the `sessionKind` claim: an assessment runner rather than a rep counter |
| P6 | Per-trial loop: instruct → enforce setup → capture → validate → record min/max, with multiple trials per joint and a defensible aggregate (best? median? — clinical input) |
| P7 | **Enforce setup throughout.** The [calibration-integrity scope](NOTES.md#scoped-calibration-integrity-items-1--3) items 1 and 3 are *prerequisites* here, not optional: an assessment that captures noise poisons every exercise that reads it |
| P8 | Support more than one view per joint (front / side / diagonal) within a trial |
| P9 | POST the result via B2 |

### C. `mobile-app` — patient entry point

Likely **no native code**: the assessment is a WebView session like every other exercise.

| # | Item |
| --- | --- |
| M1 | Surface the Movement Check — dashboard card or an entry in `screens/ExerciseScreens/ExerciseList.js` |
| M2 | Launch through the existing flow: `ExerciseOnCamera.js:77` already does `resolveExerciseUrl(exerciseDetails.url)` |
| M3 | Handle the "baseline needed / expired" state returned by B6 |
| M4 | **Product decision:** block treatment exercises until a baseline exists, or allow them with the template fallback and a visible notice |

### D. `rehab-fe` admin portal — clinician side

| # | Item |
| --- | --- |
| A1 | Assign / re-assign a Movement Check |
| A2 | Review the captured baseline, and the trend across captures |
| A3 | **Clinician override.** A goniometer reading from a PT should beat a camera capture. This is also the mitigation for the 2D measurement limitation |

---

## The assessment set — proposal, needs clinical sign-off

> **Superseded in detail by [BASELINE_ASSESSMENT_RESEARCH.md](BASELINE_ASSESSMENT_RESEARCH.md)**, which grounds this set in the stroke literature and in published markerless-pose validity data. Read that first.

Joints the current 16 exercises actually depend on: **shoulder, elbow, hip, knee, ankle, trunk.**

Posture does not transfer, so some joints need more than one trial. Weight-bearing vs
non-weight-bearing ankle dorsiflexion differs by more than double (0–16.5° vs 7.1–34.7° — see the
guardrails doc), and seated knee extension is not the same movement as a standing squat.

| # | Trial | Joint | View | Serves |
| --- | --- | --- | --- | --- |
| 1 | Arm raise to the side | shoulder | front **and** side | `SideArmRaise`, `LiftsAndChops`, `WallPushUp` |
| 2 | Elbow curl | elbow | front | `BicepCurls`, `WallPushUp` |
| 3 | Seated knee lift | hip | **side** | `SeatedMarch`, `StandingMarch`, `StepUps` |
| 4 | Seated knee extension | knee (open chain) | side | `LongArcQuad` |
| 5 | Partial squat | knee (closed chain) | side | `MiniSquats`, `MiniLunges`, `SitToStand`, `StepUps` |
| 6 | Toes up / heel up, seated | ankle (non-weight-bearing) | side | `SeatedDorsiflexion`, `CalfRaisesSeated` |
| 7 | Toes up / heel up, standing | ankle (weight-bearing) | side | `StandingDorsiflexion`, `CalfRaisesStanding` |
| 8 | Quiet standing | trunk | front and side | `StandingStraightUp` |

Note trial 3 is deliberately **side** view: we measured front-view hip angle foreshortening badly
during a seated march (12.74° implying ~167° of hip flexion against an AAOS normal of 120°).

**So "5–6 exercises" is realistically 7–8 trials, several with two views.** Worth knowing before
promising the patient a short session.

### Features no assessment can produce

`kneeLiftNorm`, `footPitchNorm`, `handsHeightNorm` and `hipToAnkleNorm` are dimensionless ratios of
pixel distances. There is no joint-range equivalent, so those exercises keep in-session calibration
regardless — hence the three-tier fallback rather than a replacement.

---

## Data contract sketch

Shaped to what `romGate.lockedRangeFor` already accepts (`.jointRanges`):

```json
{
  "patientId": "...",
  "schema": 1,
  "capturedAt": "2026-10-12T14:02:11Z",
  "expiresAt": "2027-01-12T00:00:00Z",
  "capturedBy": "self",
  "jointRanges": {
    "shoulderAngleL": {
      "min": 18.2, "max": 96.4, "range": 78.2,
      "view": "front", "trials": 3, "quality": "good"
    }
  },
  "deviceInfo": { "model": "SM-A366", "detector": "movenet", "captureWidth": 480 }
}
```

`quality` matters: a trial that failed its setup checks must be recorded as such rather than
silently averaged in.

---

## Open questions — for the developer and the clinician

1. **Two separate questions here, with different owners.** They are easy to conflate:

   - **(a) Which joints matter for a stroke patient, and which movement tests them?**
     A *clinical* question. Needs a PT. The eight trials proposed above are an engineering
     guess derived from what the current 16 exercises happen to measure — not a clinical
     protocol, and they should not be treated as one.
   - **(b) What are those joints *called* in code?** (B3) A purely *engineering* question:
     the literal dictionary keys. The backend writes `hipFlexAngleMin`, the pose engine
     reads `hipAngleMin`; the backend writes `armAngle` and `kneeAngleMax`, neither of
     which exists in the pose engine at all. No data can cross that boundary until one list
     is canonical and validated on write. **This is the blocking item, and it belongs to the
     developer, not the clinician.**
2. **Does a clinician's goniometer reading override the camera capture?** Recommend yes.
3. ~~**Re-assessment cadence**~~ — **decided: 90 days baseline, plus a manual trigger in the admin dashboard, plus the progress trigger below.**
4. **No baseline yet: block, or fall back to template?** (M4)
5. **A patient exceeds their baseline mid-programme — then what?** The backend currently widens
   `currentConfig` silently. If the protocol baseline is the progress ruler, that should probably
   raise a re-assessment prompt instead of quietly moving the ruler.
6. **May the assessment show the patient any numbers at all?** Given the 2D caveat, recommend
   trends and relative change only.
7. **Best, median, or mean across trials?** Affects whether a single good effort or a typical effort
   sets the reference.

---

## Re-assessment: cadence and the progress trigger

**Decided 2026-10-12.** Three routes to a re-assessment, in increasing order of interest:

1. **Time** — 90 days since `capturedAt`. A floor, not the main mechanism.
2. **Manual** — a clinician triggers one from the admin dashboard at any time.
3. **Progress trigger** — the system notices the patient has drifted from their baseline and
   *offers* a re-assessment.

### The drift detector already exists

This is the part worth knowing before anyone designs it. `exercise-aggregate.service.ts`
already compares observed performance against the stored range, and it is more careful than a
first pass would be:

```js
const observedMax = agg.avgLast3?.ROM          // average of the last 3 sessions, not one

if (observedMax !== undefined &&
    observedMax > currentConfig[joint].end + 2) {   // 2-unit deadband
  const inc = Math.min(observedMax - currentConfig[joint].end, 8);  // capped per update
  currentConfig[joint].end += inc;
  updated = true;
}
```

A 3-session average, a deadband and a per-update cap — the smoothing a drift trigger needs is
already there. **What it does with the signal is the problem: it silently widens the stored
range.** That is precisely the re-normalisation loop this whole plan exists to break — the ruler
moves to match the patient, so improvement becomes invisible.

**The change is therefore small and mostly a redirection:** keep the detector, stop it moving
the ruler, and raise a flag instead.

### Four things the trigger has to get right

**1. Improvement and measurement error are indistinguishable from this signal alone.**
A 20° "improvement" can be real recovery, a different camera angle, better lighting, a new
phone, or standing closer. Measured this session: a camera moved to the floor inflated
`kneeLiftNorm` by about 2.4x. Guards: require the drift to hold across sessions (the
`avgLast3` average already helps), require the setup checks to have passed on those
sessions, and only compare captures taken in the **same view with the same detector**.

**2. The flag must not assert a new number.** "Your baseline has improved from 50° to 70°"
claims a measurement the data cannot support, for a reason that is structural rather than about
accuracy: a treatment exercise is deliberately **sub-maximal** — a mini squat is not a test of
maximum knee flexion. So observed ROM during treatment is a floor on capability, never the
capability itself. The honest message is *"something has changed — worth re-measuring"*, and the
new number comes from the re-assessment, not from the trigger. This is also the strongest
argument for keeping a real assessment session rather than inferring everything from treatment.

**3. Improvement and decline are not symmetric, and must not be handled the same way.**
The same detector catches both, and decline is the clinically urgent case — but telling a stroke
patient directly that their range has decreased can do harm without a clinician framing it.

| Direction | Who sees it |
| --- | --- |
| Improvement | Patient, caregiver and clinician. This is the motivational moment, and adherence is the problem the product exists to solve |
| Decline | **Clinician only.** Never surfaced directly to the patient |

**4. Who may actually trigger a re-assessment.** If a patient can self-trigger on an inflated
reading, they re-baseline against an artefact and the gate becomes permanently too hard — their
reps stop counting and adherence collapses. That is a real harm path, not a theoretical one.
Recommend: the patient may *request*, the clinician *approves*. A clinician may always trigger
directly.

### Threshold units

Express the threshold as a **percentage of the baseline range**, not in degrees. Degrees do not
apply to the ratio features (`kneeLiftNorm`, `footPitchNorm`, `handsHeightNorm`), and a
fixed 10° means something very different on a 99° elbow sweep than on a 4.8° standing
dorsiflexion. The threshold also needs the **direction** of improvement per feature, since for
some an improving value falls (elbow flexion) and for others it rises (shoulder abduction) —
`featureDirections` in `specToReference.js` already carries this for some exercises and
would need completing.

## Risks

| Risk | Note |
| --- | --- |
| **Clinical over-claim** | The biggest one. An artefact named "assessment" that outputs joint angles crosses the line the guardrails doc draws. Mitigate with naming, patient-facing copy, and A3 clinician override |
| **Divergence while building** | Two baseline systems exist today; both are live. Any delay to B3/B7 lets them drift further |
| **Patient fatigue** | 7–8 trials is not short. One-off plus periodic, not per-session |
| **Staleness** | A 90-day-old baseline on an improving patient makes the gate too easy — the opposite of the current bug, but still wrong |
| **Stalled assessment** | If enforced setup (P7) cannot be satisfied while performing the movement, the trial never completes. Needs the retry bound from the calibration-integrity scope |
| **False progress trigger** | Drift from a camera change reads as recovery. Mitigated by same-view comparison and multi-session persistence, never eliminated |
| **Patient self-triggering on an artefact** | Re-baselining against an inflated reading makes the gate permanently too hard and reps stop counting. Clinician approval is the guard |

## Suggested sequencing

| Phase | Work | Why here |
| --- | --- | --- |
| **0** | B3 — reconcile the feature vocabulary. No code | Blocks everything. Cheapest thing to get wrong early |
| **1** | B1, B2 — model and endpoints | Server is the system of record |
| **2** | P1–P4 — pose engine reads the baseline | **Small, and shippable before any capture flow exists**: a clinician-entered baseline becomes usable immediately |
| **3** | B7, B8 — backend reads the shared source | Ends the duplication |
| **4** | P5–P9 — the capture flow | The largest piece |
| **5** | M1–M4, A1–A3 | Patient and clinician surfaces |
| **6** | B6 — expiry, and the progress trigger (redirect the existing widening in `exercise-aggregate.service.ts` from silently moving the range to raising a flag) | Needs real captures to tune the threshold |

Phase 2 is the useful early win: it ends the circularity for any patient whose baseline is entered
by a clinician, without waiting for the camera assessment to be built.
