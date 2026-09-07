# Clinical guardrails — intent, provenance, and what still needs signing

**Status: none of the values in this document have clinical sign-off.**
This is the evidence pack for that review, not the outcome of one. No cap value is changed by this
document.

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

Caps are enforced in `DTWPhaseMachine._capBreaches()`. A breach flags the rep and speaks a warning;
it does not block counting. See the commit that introduced flagging for why.

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
| Verdict | **Well-founded.** The most defensible cap in the set. |

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
| SeatedMarch | `hipAngle: { min: 50 }` | 130° |
| StandingMarch | `hipAngle: { min: 45 }` | 135° |

**Flag.** Both exceed the AAOS normal hip flexion of **0–120°**. As written they would only trigger
beyond what a healthy hip achieves, so they cannot fire protectively. Note the seated case starts
near 90° of flexion by definition, so the usable margin is smaller than it appears. Both also carry
`kneeLiftNorm` caps (0.45 / 0.50) with no clinical unit.

### Elbow — `BicepCurls`, `WallPushUp`

| Exercise | Coded | Implied flexion | Norm |
| --- | --- | --- | --- |
| BicepCurls | `min: 40` | 140° | AAOS elbow flexion 0–150° |
| WallPushUp | `min: 75` | 105° | as above |

Both inside normal range. The BicepCurls comment ("do not jam your forearm") suggests the intent is
end-range compression rather than ROM per se — worth confirming.

### Ankle — `CalfRaisesSeated`, `CalfRaisesStanding`, `SeatedDorsiflexion`, `StandingDorsiflexion`

| Exercise | Coded | Direction |
| --- | --- | --- |
| CalfRaises ×2 | `footPitchNorm: { max: 0.22 }` | plantarflexion ceiling |
| SeatedDorsiflexion | `footPitchNorm: { min: −0.12 }` | dorsiflexion floor |
| StandingDorsiflexion | `footPitchNorm: { min: −0.11 }` | dorsiflexion floor |

**No published norm is applicable** — these are dimensionless ratios. For reference only, ankle ROM
in able-bodied adults is roughly 50° plantarflexion to 20° dorsiflexion, with normal dorsiflexion
variously reported as 0–16.5° non-weight-bearing and 7.1–34.7° weight-bearing; 0–15° is the usual
functional-gait requirement.

Two things make this the weakest group:
- Post-stroke plantarflexor spasticity and contracture routinely reduce dorsiflexion well below
  normal, so a floor set from healthy geometry is the wrong shape of constraint entirely.
- These are the four MediaPipe exercises, where `visibility` defaults to `1.0` when the model omits
  it (`detectors.js:194`), so the keypoints these caps depend on can carry unearned confidence.

**These four should be calibrated from measured `footPitchNorm` distributions before review**, not
argued from literature. That is exactly what the WI-1 captures are for.

---

## What has to happen before any of this is a clinical claim

1. **Calibrate the four normalized-ratio caps** against measured captures across several people and
   camera setups. Until then they are geometry, not safety.
2. **Resolve the knee-extension inconsistency** (180 / 178 / 182) with one reviewed value.
3. **Re-derive the hip caps** so they can actually fire below normal hip flexion.
4. **Quantify projection error** — measure the same movement from the declared `framing.view` and
   from a deliberately wrong angle, and record how far the reading moves. That number bounds every
   claim the product can make.
5. **Have a licensed PT sign the table below**, with attribution recorded in the repo.

Until 1–5 are done: present ROM as tracking and trending, never as measurement. "Your range improved
8° from baseline" is defensible; "your shoulder flexion is 142°" is not.

## Sign-off

| Exercise | Cap | Reviewer | Date | Decision (keep / change to / remove) |
| --- | --- | --- | --- | --- |
| SideArmRaise | `shoulderAngle max 95` | | | |
| BicepCurls | `elbowAngle min 40` | | | |
| MiniSquats | `kneeAngle min 100` | | | |
| SitToStand | `kneeAngle max 180` | | | |
| LongArcQuad | `kneeAngle max 178` | | | |
| SeatedMarch | `kneeLiftNorm max 0.45`, `hipAngle min 50` | | | |
| StandingMarch | `kneeLiftNorm max 0.50`, `hipAngle min 45` | | | |
| MiniLunges | `kneeAngle min 90` | | | |
| LiftsAndChops | `handsHeightNorm max 1.3` | | | |
| StepUps | `kneeAngle min 95`, `kneeLiftNorm max 0.40` | | | |
| WallPushUp | `elbowAngle min 75` | | | |
| CalfRaisesSeated | `footPitchNorm max 0.22` | | | |
| CalfRaisesStanding | `footPitchNorm max 0.22` | | | |
| SeatedDorsiflexion | `footPitchNorm min −0.12` | | | |
| StandingDorsiflexion | `footPitchNorm min −0.11` | | | |
| StandingStraightUp | `kneeAngle max 182` | | | |

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
