# Movement Baseline — what the literature says the assessment should measure

**Research input for a clinical decision. Not clinical advice, and not a substitute for PT
sign-off.** Compiled 2026-10-14 to give a physical therapist something concrete to react to, rather
than a blank page.

Companion to [MOVEMENT_BASELINE_PLAN.md](MOVEMENT_BASELINE_PLAN.md) (the engineering plan) and
[CLINICAL_GUARDRAILS.md](CLINICAL_GUARDRAILS.md) (what our measurements can and cannot claim).

> **This is a different question from D1 in [HANDOFF.md](HANDOFF.md).** D1 is the *canonical
> joint-key list* — the literal strings (`hipAngleMin` vs `hipFlexAngle`) that two codebases
> disagree on. That is an engineering task with no clinical content. **This** document is the
> clinical question: which joints and movements a baseline assessment should contain.

---

## 1. The clinical gold standard already exists

The **Fugl-Meyer Assessment (FMA)** is the stroke-specific standard for motor impairment. It is
performance-based, stroke-specific, and has five domains: motor function, sensory function, balance,
**joint range of motion**, and joint pain.

| | |
| --- | --- |
| Motor score | 0–100 (66 upper extremity + 34 lower extremity) |
| **Joint ROM domain** | **0–44 points, across 8 joints** |
| Scoring | 3-point ordinal per item — 0 = cannot perform, 1 = partial, 2 = full |
| Joints covered | shoulder, elbow, forearm, wrist, hand, hip, knee, ankle |

Two things follow for us:

1. **There is no need to invent an assessment.** A validated instrument exists, is widely used in
   stroke trials, and already has a ROM domain. The design question is which *subset* of it a phone
   camera can honestly support.
2. **The FMA is ordinal, not goniometric.** It scores "cannot / partial / full", not degrees. That
   is a much weaker claim than a measured angle — and notably closer to what our system can actually
   defend. Worth considering whether the Movement Baseline should report **bands** rather than
   degrees.

---

## 2. What actually goes wrong after a stroke

This determines which joints are worth assessing at all.

**About 52% of people develop at least one major contracture within six months of stroke**, and
contractures can develop fully within four weeks.

The joints most commonly affected:

| Joint / motion | Why it matters |
| --- | --- |
| **Ankle dorsiflexion** | Limited DF is one of the main causes of functional limitation after stroke. Passive DF in stroke is roughly **half** that of healthy adults. Drives foot drop and gait |
| **Shoulder external rotation** | Part of the hemiplegic shoulder picture; post-stroke shoulder problems reported from **7% to 81%**, with greater active shoulder motion associated with lower incidence |
| **Elbow extension** | Flexor synergy; a common contracture |
| **Forearm supination** | Common contracture |
| **Wrist and finger extension** | Common contracture |
| **Hip internal rotation** | Common contracture |

**Note the collision with our hardware**: three of the six most commonly contractured motions —
forearm supination, wrist extension, finger extension — are **not measurable by body-pose models at
exercise distance**. MoveNet and BlazePose give one wrist keypoint and no forearm rotation. Section
5 deals with this honestly.

---

## 3. What a phone camera can actually measure

This is the constraint that should shape the assessment set, and the evidence is mixed by joint.

### Where markerless pose estimation does well

- MediaPipe against goniometer ground truth in healthy volunteers: **R² = 0.988, MAPE 1.54%** —
  but in controlled conditions.
- Stroke gait parameters: correlations **≥ 0.92** for most parameters, dropping to **0.40–0.66**
  for swing time.

### Where it does not

A 2025 validation specifically on **elbow ROM in a clinical population**:

| Measurement | Markerless error | Physician visual estimate |
| --- | --- | --- |
| Elbow **flexion** | 5.1° (HSMR) / 7.3° (RTMW) | 5.4° |
| Elbow **extension** | 7.8° / 6.5° | 5.2° |

The authors' conclusion: **neither markerless method reached clinically acceptable accuracy for
elbow extension.** Flexion was roughly as good as a physician eyeballing it — which is a fair
benchmark, but not goniometry.

Three failure modes they identify map exactly onto what we have measured ourselves:

1. **Out-of-plane motion** — substantial errors when participants internally rotated the upper arm.
   (We measured the same thing: front-view hip angle during a seated march implied ~167° of hip
   flexion against an AAOS normal of 120°.)
2. **Biomechanical model limits** at end-range and hyperextension.
3. **Laboratory conditions** — uniform lighting, minimal background clutter. A patient's living
   room is neither.

A broader review is blunter: *accurately quantifying angular metrics such as range of motion would
require much more tracking precision than current open-source pose estimation models offer.*

### The camera setup that validation used

Worth copying, because it is a published, defensible spec:

> RGB camera at **0.9 m height**, facing the **sagittal plane on the affected side**, at **3 m**
> distance, 30 fps.

This independently supports the camera-pitch check added on 2026-10-14 — camera **height** is a
real experimental variable, not a detail, and ours was previously unchecked.

---

## 4. The number that should govern the whole design

Minimal clinically important difference (MCID) for ROM in **chronic stroke**:

| Joint | MCID (affected side) |
| --- | --- |
| Knee, sagittal ROM | **8.48°** |
| Hip, flexion–extension | **5.81°** |
| Shoulder, ankle | **not established in stroke** |

Put that beside the measurement error from §3 — roughly **5–8°** for a well-conditioned joint under
laboratory conditions:

| Joint | MCID | Our likely error | Verdict |
| --- | --- | --- | --- |
| Knee | 8.48° | ~5–8° | **Marginal** — real change is detectable, but only just |
| Hip | 5.81° | ~5–8° | **Below the noise floor** — error is as large as the effect |
| Shoulder | unknown | large excursion, in-plane → likely best case | Plausible |
| Ankle | unknown | worst case (see §5) | Not defensible today |

**This is the single most important finding in this document.** For the hip, the measurement error
is comparable to the clinically meaningful difference — so "your hip range improved" is not a
defensible claim from a single phone camera, at any amount of software polish.

It does **not** mean the baseline is useless. It means:

- The baseline is sound as an **operational threshold** (scaling each patient's rep gate), which is
  what it already does well, and which tolerates a few degrees of error.
- It is **not** sound as a clinical progress measurement for every joint. Report trend and
  direction, with a change threshold set above measurement error — not a degree count.

That matches what `CLINICAL_GUARDRAILS.md` already requires: *present ROM as tracking and trending,
never as measurement.*

---

## 5. The ankle problem

Ankle dorsiflexion is simultaneously **the most clinically important** motion in this list and **the
one we measure worst**.

Clinically: limited DF is a main driver of post-stroke functional limitation, passive DF is about
half of healthy, and plantarflexor spasticity routinely reduces it further.

Technically, from our own measurements (`CLINICAL_GUARDRAILS.md`):

- Both detectors resize their person-ROI before inference (MoveNet 192×192, BlazePose 256×256), so
  the foot occupies a small fixed fraction of model input **no matter how close the patient stands**.
- A 0.05–0.15 `footPitchNorm` swing is roughly a **3–10 pixel** vertical difference between the two
  least reliable landmarks in the model.
- `footPitchNorm` is a vertical image difference, so camera roll injects about **0.11 at 10°** of
  tilt against a real signal of 0.05–0.15.
- MediaPipe defaults `visibility` to 1.0 when the model omits it, so these keypoints can carry
  unearned confidence.

**Recommendation:** include ankle dorsiflexion in the assessment because it matters clinically, but
record it as **observed/not observed with a confidence flag**, not as a degree value — and flag it
to the PT as the measurement most in need of either a different method (a side-on close-up trial at
a fixed distance) or acceptance that it is qualitative.

---

## 6. Proposed assessment set

Ranked by *clinical importance × measurability*. Every row needs PT review; the right-hand columns
are what engineering can honestly support.

| # | Trial | Joint / motion | View | Our feature | Confidence | Clinical basis |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Arm raise to the side, slow | shoulder abduction | front **and** side | `shoulderAngleL/R` | **High** — large excursion, large joint, in-plane | Hemiplegic shoulder, 7–81% incidence |
| 2 | Elbow bend and straighten | elbow flexion / **extension** | side (sagittal, affected side) | `elbowAngleL/R` | **Medium** flexion, **Low** extension | Elbow extension is a common contracture; extension is where markerless failed |
| 3 | Seated knee extension | knee, open chain | side | `kneeAngleL/R` | **Medium-high** | MCID 8.48° is near our resolution |
| 4 | Sit to stand / partial squat | knee, closed chain | side | `kneeAngleL/R`, `kneeAngleMin` | **Medium-high** | Weight-bearing differs from open chain |
| 5 | Seated knee lift | hip flexion | **side** (never front) | `hipAngleL/R` | **Low** — MCID below our error | Hip IR/flexion contracture common |
| 6 | Toes up / heel up, seated | ankle DF/PF, non-weight-bearing | side, close | `ankleAngleToe`, `footPitchNorm` | **Low** — qualitative only | Most common and most functionally important |
| 7 | Toes up / heel up, standing | ankle DF/PF, weight-bearing | side, close | as above | **Low** — qualitative only | WB and NWB differ by more than double |
| 8 | Quiet standing | trunk / posture | front and side | `trunkAngle`, `trunkAngleMin` | **Medium** | Genu recurvatum affects 40–68% of post-stroke walkers |

**That is 8 trials, several with two views — realistically 10–12 captures.** Not the "5–6 exercises"
originally imagined. Worth knowing before promising a patient a short session.

### Setup to specify, from the validation literature

- camera at roughly **chest height (~0.9 m)**, which our new `checkCameraPitch` now checks
- **sagittal view on the affected side** for all the limb-flexion trials
- **~3 m** distance
- even lighting, uncluttered background — both named as limits of the lab validation

---

## 7. What we should not pretend to assess

Stating these explicitly is what keeps the product honest:

| Motion | Why not |
| --- | --- |
| Forearm supination / pronation | No forearm rotation in any body-pose model. **A common post-stroke contracture we simply cannot see** |
| Wrist extension | One wrist keypoint, no hand orientation |
| Finger extension | Not in the body-pose skeleton at all |
| Shoulder **external rotation** | Rotation about the limb's long axis is invisible to a 2D projection. **Named as a most-common contracture** |
| Hip internal rotation | Same reason |
| Spasticity / tone | Requires passive movement by a clinician (Modified Ashworth). Not observable from a patient moving themselves |

Four of the six most commonly contractured motions after stroke are in this table. **The Movement
Baseline therefore cannot be presented as a complete ROM assessment.** It is a partial, camera-based
screen of the motions a phone can see — which is still useful, and much better than calibrating from
the first two reps of a treatment set, but it is not the FMA.

---

## 8. Questions for the PT

Framed so they can be answered quickly, with our constraint attached to each.

1. **Is an ordinal band (cannot / partial / full, as the FMA scores it) more defensible than a
   degree value for our purposes?** Our measurement error is 5–8°, and hip MCID is 5.81°.
2. **Is a standing weight-bearing ankle trial worth the fall risk** for the population, given we can
   only report it qualitatively?
3. **Which single joint matters most** if the assessment must be short? Literature points to ankle
   dorsiflexion, which is our weakest measurement — we would value a second opinion.
4. **Should the assessment capture the unaffected side as a within-patient reference?** MCID data is
   reported separately for affected (8.48° knee) and unaffected (6.81°) sides, implying both are
   routinely measured.
5. **Re-assessment interval** — 90 days proposed. Reasonable for chronic stroke?
6. **Is it acceptable to omit forearm, wrist and hand entirely** (§7), or does that make the
   baseline clinically misleading?

---

## Sources

- Fugl-Meyer Assessment — [Shirley Ryan AbilityLab](https://www.sralab.org/rehabilitation-measures/fugl-meyer-assessment-motor-recovery-after-stroke) · [StrokEngine](https://strokengine.ca/en/assessments/fugl-meyer-assessment-of-sensorimotor-recovery-after-stroke-fma/) · [Gladstone et al., critical review (SAGE)](https://journals.sagepub.com/doi/pdf/10.1177/154596802401105171) · [Fugl-Meyer Assessment of Sensorimotor Function After Stroke (Stroke/AHA)](https://www.ahajournals.org/doi/10.1161/strokeaha.110.592766)
- Contracture prevalence after stroke — [Half of the adults who present to hospital with stroke develop at least one contracture within six months (J Physiother)](https://www.sciencedirect.com/science/article/pii/S1836955312700711) · [Incidence of contractures by joint](https://www.researchgate.net/figure/Incidence-proportion-of-contractures-by-joint-as-measured-with-the-contracture-scale_tbl2_221838960) · [WHO clinical guideline on stroke rehabilitation](https://extranet.who.int/ncdccs/Data/MNG_D1_2.%20Rehabilitation%20guideline%20of%20Stroke.pdf)
- Ankle dorsiflexion after stroke — [Ankle joint mobilization, dorsiflexion and gait: systematic review and meta-analysis](https://www.researchgate.net/publication/350142117_The_Effects_of_Ankle_Joint_Mobilization_on_Dorsiflexion_Range_and_Gait_Parameters_in_Chronic_Stroke_Survivors_A_Systematic_Review_and_Meta-analysis) · [Floss band, ankle ROM, balance and gait in chronic stroke](https://doi.org/10.3390/healthcare12232384)
- Markerless pose estimation validity — [Validation of markerless human pose estimation for clinical assessment of elbow ROM (PLOS ONE)](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0353801) · [Reliability and validity for hip and knee ROM (PMC11783685)](https://pmc.ncbi.nlm.nih.gov/articles/PMC11783685/) · [Markerless joint angle estimation using MediaPipe (Springer)](https://link.springer.com/article/10.1007/s11042-026-21256-z) · [Assessment of monocular pose estimation models for clinical movement analysis (Scientific Reports)](https://www.nature.com/articles/s41598-025-22626-7) · [Shoulder abduction angle with posture-estimation AI (PMC10416158)](https://pmc.ncbi.nlm.nih.gov/articles/PMC10416158/)
- MCID for ROM in stroke — [Estimating MCID for knee ROM after stroke (J Clin Med)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7602397/) · [Establishing MCID for sagittal hip ROM in chronic stroke (PMC8443407)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8443407/) · [MCID of the lower-extremity Fugl-Meyer in chronic stroke](https://www.researchgate.net/publication/301343626_Minimal_clinically_important_difference_of_the_lower-extremity_fugl-meyer_assessment_in_chronic-stroke)
- Telerehabilitation assessment batteries — [Group telerehabilitation for balance and mobility after stroke (PMC12785289)](https://pmc.ncbi.nlm.nih.gov/articles/PMC12785289) · [H-GRASP upper limb home exercise program (PMC5399812)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5399812/) · [Telerehabilitation therapeutic exercise in chronic stroke, RCT protocol (Life)](https://doi.org/10.3390/life15121905)
