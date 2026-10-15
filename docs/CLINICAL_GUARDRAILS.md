# Clinical guardrails — intent, provenance, and what still needs signing

**Status: none of the values in this document have clinical sign-off.**
This is the evidence pack for that review, not the outcome of one.

## Where these caps did NOT come from

Read this first if anyone has told you these limits came from clinical research. **They did not.**

Every cap value in the engine was set from **template geometry** — the numbers chosen when the
movement templates were authored — and then carried forward unchanged. The literature in
[Sources](#sources) at the end of this document was gathered *afterwards, to review the caps
against*. It is **not** the basis any cap was set from, and no entry in it was used to derive a
specific coded number. Treat that list as the reviewer's reading material, not as citations.

Two caps have since been reset from **measurement** instead of geometry (see
[Change log](#change-log)). Measurement is a better basis than geometry, but it is still not a
clinical basis: it records what one demonstrator did on one recording, not what is safe for a
patient.

The honest one-line summary for a physical therapist: *these are engineering placeholders that
have never been clinically reviewed — please tell us what they should be.*

## Read this before comparing anything to published ROM

Published range-of-motion norms **cannot be pasted into `clinicalCaps`**, for two separate reasons.

### 1. The engine measures included angles, not goniometric ROM

Every angle feature is the three-point angle at the middle joint
(`universalFeatures.js:33-78`):

| Feature | Points | Reads 180° when | Relationship to goniometry |
| --- | --- | --- | --- |
| `shoulderAngle` | hip → shoulder → elbow | arm straight overhead | ≈ abduction angle (arm-at-side ≈ 0-15°) |
| `elbowAngle` | shoulder → elbow → wrist | elbow straight | **flexion = 180 − reading** |
| `hipAngle` | shoulder → hip → knee | trunk and thigh in line | **flexion = 180 − reading** |
| `kneeAngle` | hip → knee → ankle | leg straight | **flexion = 180 − reading** |
| `ankleAngleToe` | knee → ankle → foot_index | — | no clean equivalent |

So `kneeAngle: { min: 100 }` is a **80° flexion** limit, and `kneeAngle: { max: 182 }` permits
**2° of hyperextension**. Reading those numbers as if they were goniometric flexion inverts them.

### 2. Four of the caps have no clinical unit at all

`footPitchNorm`, `kneeLiftNorm`, `handsHeightNorm` and `hipToAnkleNorm` are dimensionless ratios of
pixel distances normalised by a limb segment — e.g.

```
footPitchNorm = (foot_index.y − heel.y) / shank_length
```

There is no published normal value for that quantity, and no conversion to degrees exists without
measured calibration. Literature can supply the *intent* for these ("do not force plantarflexion
past a comfortable end-range"); the *number* can only come from measured feature distributions,
which the WI-1 keypoint captures (`captures/*.jsonl`) now make possible.

### 3. Everything here is 2D image-space

All values are computed from a single camera with unknown intrinsics. Trunk rotation, camera height
and distance all project into the measured angle. Even where the included-angle mapping is clean,
the reading is not goniometry and must never be presented to a patient or clinician as a measured
joint angle. Present ROM as **tracking and trending only**.

---

## Where the current numbers came from

`ARCHITECTURE_DUMP.md:1871-1878` states it directly: caps "were derived from template geometry".
14 of 16 carry a `TODO clinical review` comment. The two that do not — `SideArmRaise` (95°) and
`LongArcQuad` (178°) — were carried over from the earlier hand-coded rule engine in `src/specs/`,
which is itself now dead code. **There is no citation, clinician sign-off, or normative table
anywhere in the repository.**

`git blame` on `src/dtw/specToReference.js` confirms the provenance is a single authoring
session rather than a review process: 13 of the 16 cap values were written in one commit,
`e46af809` ("checkpoint: in-progress DTW engine work before live retest", 2026-09-05).
`SeatedDorsiflexion` changed in `3cccde62` (2026-09-16) when its feature became
`ankleAngleToe`; `CalfRaisesSeated` and the two caps in the [Change log](#change-log) changed
on 2026-10-11.

### What a cap actually does, and what it costs

Enforced in `DTWPhaseMachine._capBreaches()`. A breach does **not** block rep counting, but it is
not cosmetic either — it has three visible effects:

1. the spoken safety warning fires, at the **top** of the feedback priority ladder;
2. the whole skeleton turns red (deliberately whole-body, not just the joint at fault);
3. `_classifyRep` records the rep as an **`attempt`** rather than `completed`:

```js
const flagged = capBreaches.length > 0;
// ... completed: !flagged
```

Effect 3 is the one that matters clinically: a cap set too tight does not merely nag the patient,
it silently rewrites their adherence record. A 10-rep BicepCurls run on device produced 10
`attempt`s and 0 `completed` — including one rep at 100% of target ROM — purely because of a cap.

### A cap is written on one base feature but compared against several keys

`clinicalCaps: { hipAngle: { min: 45 } }` (StandingMarch) does not watch one number. The constructor expands the
base name into every side and aggregate variant the reference has ranges for — `hipAngleL`,
`hipAngleR` and `hipAngleMin` — and a breach on **any** of them counts. Two consequences a
reviewer needs to know:

- On a one-sided session the *resting* limb is still watched, so it can trip a cap on its own.
- A cap whose base feature has **no** sided or aggregate variant expands to keys that do not
  exist, and therefore never fires at all. See "Three caps cannot fire" below.

---

## Measured: every cap against the recording it will judge

Generated from `src/dtw/specToReference.js` and `src/dtw/references/*.ref.json` on
**2026-10-11**, after the two changes in the [Change log](#change-log). "Demonstrated" is the
extreme the recorded reference actually reaches, on the key the cap resolves onto.

A cap that its own demonstration goes past is a defect regardless of what a clinician decides the
number should be: the reference is the movement patients are coached to copy, so copying it
correctly earns the warning and the `attempt`.

| Exercise | Cap as coded | Key actually compared | Demonstrated | Verdict vs demonstration |
| --- | --- | --- | --- | --- |
| BicepCurls | `elbowAngle min 5` | `elbowAngleL` | 11.93 | inside |
| CalfRaisesSeated | `footPitchNorm max 0.36` | `footPitchNormL` | 0.30 | inside |
| CalfRaisesStanding | `footPitchNorm max 0.22` | `footPitchNormL` | 0.21 | inside |
| LiftsAndChops | `handsHeightNorm max 1.3` | — | — | n/a |
| LongArcQuad | `kneeAngle max 178` | `kneeAngleL` | 169.86 | inside |
| MiniLunges | `kneeAngle min 90` | `kneeAngleL` | 112.25 | inside |
| MiniSquats | `kneeAngle min 100` | `kneeAngleL` | 120.32 | inside |
| SeatedDorsiflexion | `ankleAngleToe min 95` | `ankleAngleToeR` | 104.65 | inside |
| SeatedMarch | `kneeLiftNorm max 0.85`<br>`hipAngle min 5` | `kneeLiftNormMax`<br>`hipAngleMin` | 0.72<br>12.74 | inside<br>inside |
| SideArmRaise | `shoulderAngle max 95` | `shoulderAngleL` | 99.71 | **past by 4.71** |
| SitToStand | `kneeAngle max 180` | `kneeAngleL` | 178.05 | inside |
| StandingDorsiflexion | `footPitchNorm min -0.11` | `footPitchNormL` | -0.02 | inside |
| StandingMarch | `kneeLiftNorm max 0.5`<br>`hipAngle min 45` | `kneeLiftNormL`<br>`hipAngleMin` | 0.02<br>103.88 | inert (range ~0)<br>inside |
| StandingStraightUp | `kneeAngle max 182` | — | **no reference recorded** | cannot check |
| StepUps | `kneeAngle min 95`<br>`kneeLiftNorm max 0.4` | `kneeAngleL`<br>`kneeLiftNormL` | 93.68<br>0.00 | **past by 1.32**<br>inert (range ~0) |
| WallPushUp | `elbowAngle min 75` | `elbowAngleL` | 69.16 | **past by 5.84** |

### Three caps cannot fire at all

These are **not** safety limits today, whatever their number says. Changing the number changes
nothing until the underlying feature is fixed.

| Exercise | Cap | Why it cannot fire |
| --- | --- | --- |
| `LiftsAndChops` | `handsHeightNorm max 1.3` | `handsHeightNorm` is a single bilateral feature with no `L`/`R`/aggregate variant, so the cap expands only to `handsHeightNormL` and `handsHeightNormR` — neither of which exists in the reference. **Completely dead.** |
| `StandingMarch` | `kneeLiftNorm max 0.5` | `kneeLiftNorm = max(0, hip.y − knee.y) / hipAnkleLen`. Image y grows downward, so standing — knee below hip — it is clamped to zero. Demonstrated range 0.00–0.02. |
| `StepUps` | `kneeLiftNorm max 0.4` | Same clamp. Demonstrated range 0.00–0.00. |

### One cap has never been checked

`StandingStraightUp` (`kneeAngle max 182`) has no recorded reference yet, so its cap has not been
compared against any demonstration.

---

## Per-exercise review

`Coded` is the current value. `Implied` translates it into clinical terms using the mapping above.
`Norm` is the published reference where one exists. `Flag` is what the reviewer needs to decide.

### Shoulder — `SideArmRaise`, `LiftsAndChops`

| Field | Value |
| --- | --- |
| Coded | `shoulderAngle: { max: 95 }` |
| Implied | Stop at roughly shoulder height |
| Norm | AAOS shoulder abduction 0–180° |
| Rationale | Abduction beyond ~90° without scapular upward rotation and humeral external rotation narrows the subacromial space. In hemiplegia this matters far more than in a healthy shoulder: glenohumeral subluxation affects up to 80% of stroke survivors, and passive or poorly-controlled ROM work is itself a documented mechanism of injury. |
| Demonstrated | `shoulderAngleL` reaches **99.71** — past the cap by 4.71 |
| Verdict | **Well-founded.** The most defensible cap in the set — and the one case where the
recommendation is to keep the cap and **re-record the reference** staying at shoulder height, rather
than loosen it. Left unchanged on 2026-10-11. |

`LiftsAndChops` caps `handsHeightNorm: { max: 1.3 }` instead — a dimensionless ratio with no norm.
It is a diagonal pattern loading the same shoulder; the reviewer should decide whether it needs a
`shoulderAngle` cap alongside, since the ratio does not constrain the shoulder directly.

### Knee extension — `SitToStand`, `LongArcQuad`, `StandingStraightUp`

| Exercise | Coded | Implied |
| --- | --- | --- |
| SitToStand | `kneeAngle: { max: 180 }` | exactly neutral, no hyperextension |
| LongArcQuad | `kneeAngle: { max: 178 }` | stop 2° short of straight |
| StandingStraightUp | `kneeAngle: { max: 182 }` | **allows 2° of hyperextension** |

**Flag — the highest-priority item in this document.** Three caps for the same movement disagree,
and the standing one is the most permissive. Genu recurvatum occurs in **40–68%** of post-stroke
patients who regain walking, is associated with knee pain in the paretic limb, and the atypical
soft-tissue loading is the reason early prevention is recommended. A weight-bearing exercise that
permits hyperextension is the wrong place to be the most lenient. The reviewer should set one value
and apply it consistently, weighted toward the standing case.

### Knee flexion — `MiniSquats`, `MiniLunges`, `StepUps`

| Exercise | Coded | Implied flexion | Norm |
| --- | --- | --- | --- |
| MiniSquats | `min: 100` | 80° | AAOS knee flexion 0–135° |
| MiniLunges | `min: 90` | 90° | as above |
| StepUps | `min: 95` | 85° | as above |

All sit comfortably inside normal range, consistent with "mini" partial-range exercises. Low risk;
the reviewer mainly needs to confirm the intent is depth-limiting rather than safety-limiting.

### Hip flexion — `SeatedMarch`, `StandingMarch`

| Exercise | Coded | Implied flexion |
| --- | --- | --- |
| SeatedMarch | `hipAngle: { min: 5 }` *(was 50)* | 175° |
| StandingMarch | `hipAngle: { min: 45 }` | 135° |

**Flag.** The StandingMarch value exceeds the AAOS normal hip flexion of **0–120°**, so as written
it can only trigger beyond what a healthy hip achieves and cannot fire protectively. Note the
seated case starts near 90° of flexion by definition, so the usable margin is smaller than it
appears.

**SeatedMarch was loosened to a tripwire on 2026-10-11** (see [Change log](#change-log)) because
the old 50 flagged its own demonstration, which reaches 12.74. The deeper problem is that this
reading is not credible for a seated march at all: framing is `front`, so the lifting thigh points
at the camera and foreshortens, and 12.74° implies ~167° of hip flexion. **The reviewer should
decide whether SeatedMarch needs a hip cap at all, or whether the feature should be dropped for
this exercise.**

Both exercises also carry `kneeLiftNorm` caps (0.85 seated / 0.50 standing) with no clinical unit.
The standing one is inert — see [Three caps cannot fire](#three-caps-cannot-fire-at-all).

### Elbow — `BicepCurls`, `WallPushUp`

| Exercise | Coded | Implied flexion | Demonstrated | Norm |
| --- | --- | --- | --- | --- |
| BicepCurls | `min: 5` *(was 40)* | 175° | 11.93 (≈168° flexion) | AAOS elbow flexion 0–150° |
| WallPushUp | `min: 75` | 105° | 69.16 (≈111° flexion) | as above |

**BicepCurls was loosened to a tripwire on 2026-10-11** (see [Change log](#change-log)). The old 40
flagged a full, correct curl — all 10 reps of a device run were downgraded to `attempt`. Two
reasons not to replace it with a normative number:

- Curling carries no injury risk at end-range; the elbow cannot be forced past its own soft-tissue
  stop by the biceps. The original comment ("do not jam your forearm") describes end-range
  compression, not a ROM limit — **the reviewer should confirm whether that concern is real.**
- The demonstrated 11.93° implies ~168° of flexion, **beyond** the AAOS normal maximum of 150°.
  A 2D included angle cannot be compared to a goniometric norm at end-range, where the forearm
  rotates toward the camera and the reading inflates. This is evidence the feature, not the
  movement, is at fault.

If BicepCurls needs a real guardrail it is most likely on **shoulder compensation** (swinging or
hiking the shoulder to generate the curl), not elbow depth. That cap does not exist today.

**WallPushUp is left at 75 and still goes past its own demonstration by 5.84.** Kept deliberately,
pending review: the cap limits how much load passes through the shoulder, which is a real concern
post-stroke. The reviewer should decide the safe depth; if 75 is right, the reference needs
re-recording shallower.

### Ankle — `CalfRaisesSeated`, `CalfRaisesStanding`, `SeatedDorsiflexion`, `StandingDorsiflexion`

| Exercise | Coded | Direction |
| --- | --- | --- |
| `CalfRaisesSeated` | `footPitchNorm: { max: 0.36 }` | plantarflexion ceiling |
| `CalfRaisesStanding` | `footPitchNorm: { max: 0.22 }` | plantarflexion ceiling |
| `SeatedDorsiflexion` | `ankleAngleToe: { min: 95 }` | dorsiflexion floor (angle at the ankle) |
| `StandingDorsiflexion` | `footPitchNorm: { min: −0.11 }` | dorsiflexion floor |

**Updated 2026-10-11.** `SeatedDorsiflexion` has since moved to `ankleAngleToe` (commit
`3cccde62`), and `CalfRaisesSeated` was raised 0.22 → 0.36 to stop it flagging its own
demonstration. The two remain inconsistent with each other and with the standing pair.

**No published norm is applicable** — these are dimensionless ratios. For reference only, ankle ROM
in able-bodied adults is roughly 50° plantarflexion to 20° dorsiflexion, with normal dorsiflexion
variously reported as 0–16.5° non-weight-bearing and 7.1–34.7° weight-bearing; 0–15° is the usual
functional-gait requirement.

Three things make this the weakest group:
- Post-stroke plantarflexor spasticity and contracture routinely reduce dorsiflexion well below
  normal, so a floor set from healthy geometry is the wrong shape of constraint entirely.
- These are the four MediaPipe exercises, where `visibility` defaults to `1.0` when the model omits
  it (`detectors.js:194`), so the keypoints these caps depend on can carry unearned confidence.

- **The measurement is only a few pixels wide.** Both detectors resize their own person-ROI before
  inference (MoveNet to 192x192, BlazePose to 256x256), so the foot occupies a small fixed fraction
  of the model input no matter how close the patient stands — moving nearer does not help, and
  cropping to the foot is impossible because BlazePose localises the person from facial landmarks
  before it can find anything else. A 0.05-0.15 `footPitchNorm` swing is therefore roughly a **3-10
  pixel** vertical difference between the two least reliable landmarks in the model. `captureConfig`
  now requests 1280 rather than accepting Chrome's 640x480 default, which stops that ROI being
  upsampled, but it cannot change the model input size. `src/tools/analyzeCapture.js` measures the
  resulting signal-to-noise directly from a capture; until it has been run on real footage, the
  usable precision of these four features is unknown.
- `footPitchNorm` is a vertical difference in image space, so it is sensitive to camera roll in a
  way the angle features are not. A camera rolled by θ injects roughly `0.65 x sin(θ)` — about 0.11
  at 10° — against a real signal of 0.05–0.15. `checkCameraRoll` now rejects setups beyond 8° for
  these exercises, but even 8° leaves ~0.09 of potential offset. Holding roll to the ~3° that would
  make the measurement trustworthy is not realistic in a home setting.

**These four should be calibrated from measured `footPitchNorm` distributions before review**, not
argued from literature. That is exactly what the WI-1 captures are for.

**On WI-6 Experiment C — the angle-based ankle feature already exists.** It is `ankleAngleToe`
(`universalFeatures.js`, the three-point angle knee→ankle→foot_index), it is already computed,
already `footValid`-gated, and already reported as a metric for all four exercises. Being a
three-point angle it is invariant to camera roll by construction, and it draws on knee and ankle —
two reliable landmarks — rather than on heel and foot_index alone.

It was also **already tried and reverted**, for two different reasons recorded in
`specToReference.js`:

- *Calf raises*: "the foot pivots around the toe — the ankle joint barely flexes (so ankleAngle
  features were producing only 5-15° of real change despite 50° template assumptions)". That is
  physics, and recalibration cannot fix it.
- *Standing*: "template (88→68) doesn't match real standing geometry — actual values land in the
  100-130 range". That is a fabricated template, and a recorded reference fixes exactly it.

Neither objection is recorded against a *dorsiflexion* config, and toes-up against a planted heel is
a genuine ankle rotation, so dorsiflexion is where the switch is plausible. Note it would fix roll
sensitivity but **not** the pixel-count problem above — angular precision is still set by
foot_index's pixel error over a short arm.

Do not decide this from argument. A `.jsonl` capture stores raw keypoints, so `analyzeCapture`
recomputes `footPitchNorm`, `ankleAngleToe` and `ankleAngleHeel` from the *same* frames and compares
their signal-to-noise directly. `ankleAngleHeel` has never been tried and is the natural candidate
for a seated calf raise, where the heel is what actually swings about the toe. Settle it there, then
calibrate — calibrating `footPitchNorm` and then replacing it wastes the work.

Note also that the four foot exercises have **no working velocity filter**: `DTWPhaseMachine` masks
primary-feature jumps above 20 units per frame, and `footPitchNorm`'s entire range is 0.17, so a
chair-leg latch that throws it thirty times past the range passes straight through. Switching the
primary feature to an angle activates that filter for the first time on these exercises.

---

## What has to happen before any of this is a clinical claim

1. **Calibrate the four normalized-ratio caps** against measured captures across several people and
   camera setups. Until then they are geometry, not safety.
2. **Resolve the knee-extension inconsistency** (180 / 178 / 182) with one reviewed value.
3. **Re-derive the hip caps** so they can actually fire below normal hip flexion.
4. **Quantify projection error** — measure the same movement from the declared `framing.view` and
   from a deliberately wrong angle, and record how far the reading moves. That number bounds every
   claim the product can make.
5. **Fix the three caps that cannot fire** — `LiftsAndChops` (expands to keys that do not exist)
   and the two inert `kneeLiftNorm` caps (clamped to zero when standing). An unreviewed cap is a
   problem; a cap that silently does nothing while appearing in this table is worse.
6. **Decide the three caps that still go past their own demonstration** — SideArmRaise (4.71),
   WallPushUp (5.84), StepUps (1.32). For each the choice is: loosen the cap, or re-record the
   reference. StepUps at 1.32 is within measurement noise and can be closed by rounding the cap.
7. **Record a reference for `StandingStraightUp`** so its cap can be checked at all.
8. **Have a licensed PT sign the table below**, with attribution recorded in the repo.

Until 1–8 are done: present ROM as tracking and trending, never as measurement. "Your range improved
8° from baseline" is defensible; "your shoulder flexion is 142°" is not.

## Change log

Changes to cap values, with the basis for each. **No entry here is a clinical decision** — each is
an engineering correction made because the cap was flagging its own reference, and each still needs
review in the [Sign-off](#sign-off) table.

### 2026-10-11 — BicepCurls and SeatedMarch loosened

Requested after a device run in which BicepCurls flagged all 10 reps. Basis for the new values:
the measured demonstration extreme, with headroom, so a patient copying the reference is not
flagged. The other three breaching caps (SideArmRaise, WallPushUp, StepUps) were deliberately
left as they are.

| Exercise | Cap | Was | Now | Demonstrated | Why |
| --- | --- | --- | --- | --- | --- |
| BicepCurls | `elbowAngle` | min 40 | **min 5** | 11.93 | A full curl is the correct movement and carries no injury risk — the elbow cannot be forced past its own soft-tissue stop by curling. Also 11.93° included angle implies ~168° of flexion, beyond the AAOS normal maximum of 150°, so the 2D reading is inflated at end-range and is not comparable to a goniometric norm. 5 is a tripwire for nonsense readings, not a limit. |
| SeatedMarch | `kneeLiftNorm` | max 0.45 | **max 0.85** | 0.72 | Dimensionless ratio with no clinical norm; the only available basis is the measured distribution. 0.85 leaves ~17% headroom above the demonstration. |
| SeatedMarch | `hipAngle` | min 50 | **min 5** | 12.74 | Not trustworthy for this exercise at all: framing is `front`, so the lifting thigh points at the camera and foreshortens. 12.74° implies ~167° of hip flexion against an AAOS normal of 120°. Set to a nonsense tripwire; `kneeLiftNorm` carries the real constraint. |

**Why the SeatedMarch demonstrated values sit outside the per-leg ranges.** This is an
**alternating** exercise, and `buildTemplateFromReps` averages reps positionally (each rep
resampled to 60 frames, frame *t* = mean of frame *t* across reps). At the peak-lift frame one rep
has the left leg up and the next has the right, so the averaged `kneeLiftNormL` / `hipAngleL`
channels are diluted toward the middle (0.42 / 78.8) while the aggregate `max(L,R)` / `min(L,R)`
channels correctly track whichever leg is lifting (0.72 / 12.74). The aggregates are the honest
reading, and they are also what the cap resolves onto, so they are what it must be set against.

Recorded correction: an earlier analysis in this project called the SeatedMarch
`hipAngleMin = 12.74` figure a tracking artefact from an occluded far leg. That was wrong — it is
the correctly-averaged lifting-leg channel. The open question about it is projection error in a
front view, not landmark dropout.

## Sign-off

One row per cap set. A reviewer fills in the last three columns; record attribution here so
the repo carries it.

| Exercise | Cap as coded (2026-10-11) | Reviewer | Date | Decision (keep / change to / remove) |
| --- | --- | --- | --- | --- |
| BicepCurls | `elbowAngle min 5` | | | |
| CalfRaisesSeated | `footPitchNorm max 0.36` | | | |
| CalfRaisesStanding | `footPitchNorm max 0.22` | | | |
| LiftsAndChops | `handsHeightNorm max 1.3` | | | |
| LongArcQuad | `kneeAngle max 178` | | | |
| MiniLunges | `kneeAngle min 90` | | | |
| MiniSquats | `kneeAngle min 100` | | | |
| SeatedDorsiflexion | `ankleAngleToe min 95` | | | |
| SeatedMarch | `kneeLiftNorm max 0.85`, `hipAngle min 5` | | | |
| SideArmRaise | `shoulderAngle max 95` | | | |
| SitToStand | `kneeAngle max 180` | | | |
| StandingDorsiflexion | `footPitchNorm min -0.11` | | | |
| StandingMarch | `kneeLiftNorm max 0.5`, `hipAngle min 45` | | | |
| StandingStraightUp | `kneeAngle max 182` | | | |
| StepUps | `kneeAngle min 95`, `kneeLiftNorm max 0.4` | | | |
| WallPushUp | `elbowAngle min 75` | | | |

## Sources

- AAOS normal ROM values — [goniometer.io ROM chart](https://goniometer.io/range-of-motion),
  [normal ROM values per AAOS (LWW supplementary)](https://cdn-links.lww.com/permalink/prsgo/b/prsgo_8_6_2020_04_17_hendriks_gox-d-20-00155r2_sdc1.pdf)
- Hemiplegic shoulder subluxation and pain —
  [Physiopedia: Hemiplegic Shoulder Subluxation](https://www.physio-pedia.com/Hemiplegic_Shoulder_Subluxation),
  [Clinical and ultrasound evaluation of hemiplegic shoulder pain (PMC11944265)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11944265/),
  [MRI findings in painful hemiplegic shoulder (PMC9705229)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9705229/)
- Genu recurvatum after stroke —
  [Prevalence of genu recurvatum during walking and associated knee pain in chronic hemiplegic stroke patients](https://www.sciencedirect.com/science/article/abs/pii/S1052305716000495),
  [Prevention of genu recurvatum in post-stroke patients using a hinged soft knee orthosis](https://www.sciencedirect.com/science/article/abs/pii/S1934148215001926),
  [Knee hyperextension in stance phase of gait (IJHSR)](https://www.ijhsr.org/IJHSR_Vol.13_Issue.11_Nov2023/IJHSR49.pdf)
- Ankle dorsiflexion norms —
  [Ankle joint dorsiflexion: establishment of a normal range (PubMed 8135911)](https://pubmed.ncbi.nlm.nih.gov/8135911/),
  [Ankle range of motion normal values](https://orthofixar.com/special-test/ankle-range-of-motion/)
- Post-stroke plantarflexor changes —
  [Individualized muscle architecture and contractile properties of ankle plantarflexors and dorsiflexors in post-stroke individuals (Frontiers, 2024)](https://www.frontiersin.org/journals/bioengineering-and-biotechnology/articles/10.3389/fbioe.2024.1453604/full)
