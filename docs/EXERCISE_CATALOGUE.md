# Exercise catalogue — clinical specification

The per-exercise source of truth. Every row the engine relies on is recorded here, so the
backend exercise records, the clinician-facing catalogue and the pose engine can be checked
against one document instead of against each other.

**Status: engineering fields are filled in from code. Clinical fields are blank and need a
clinician.** Nothing in the blank sections has been guessed.

Generated from `src/dtw/specToReference.js` (EXERCISE_CONFIGS) and
`src/dtw/references/*.ref.json` on **2026-10-11**. Regenerate rather than hand-edit the
engineering tables; put human decisions in the **Needs a decision** blocks.

Companions: [NOTES.md](NOTES.md) (open decisions and action items) ·
[CLINICAL_GUARDRAILS.md](CLINICAL_GUARDRAILS.md) (safety caps and PT sign-off)

---

## Which layer owns which field

This is the distinction that has caused the most confusion, so it is stated once up front.
A recorded reference supplies **only** phase shape and feature ranges. Everything else is
policy in code, overlaid on top of the recording at load time (`CANONICAL_FIELDS`).

| Field | Lives in | Changing it needs |
| --- | --- | --- |
| Phase shape, feature ranges | the `.ref.json` recording | a re-extraction |
| `side`, `mode`, `detector`, `framing`, `minRomPct`, `timing`, `clinicalCaps`, `highlightKeypoints` | `EXERCISE_CONFIGS` in code | a code change (no re-extraction) |
| Target reps, assigned side, schedule | the **backend exercise record / assignment** | a catalogue or clinician change |
| Display name, clinical purpose, contraindications | **nowhere yet** | this document |

> The engine keys on the names below (e.g. `SeatedMarch`). The platform has separately used
> human names that embed a side — there is a `"Left Side Arm Raise"` reference in the repo — so the
> mapping from a catalogue entry to an engine key is itself undocumented. See **Open vocabulary**.

---

## Summary

| Exercise (engine key) | Side | Mode | View | Detector | Primary feature | Safety cap | Reference |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `BicepCurls` | both | rep | front | movenet | `elbowAngleR` | `elbowAngle min 5` | yes |
| `CalfRaisesSeated` | both | rep | side | mediapipe | `ankleAngleToeL` | `footPitchNorm max 0.36` | yes |
| `CalfRaisesStanding` | both | rep | side | mediapipe | `ankleAngleToeL` | `footPitchNorm max 0.22` | yes |
| `LiftsAndChops` | both | rep | front | movenet | `handsHeightNorm` | `handsHeightNorm max 1.3` | yes |
| `LongArcQuad` | both | rep | side | movenet | `kneeAngleL` | `kneeAngle max 178` | yes |
| `MiniLunges` | both | rep | side | movenet | `kneeAngleL` | `kneeAngle min 90` | yes |
| `MiniSquats` | both | rep | side | movenet | `kneeAngleMin` | `kneeAngle min 100` | yes |
| `SeatedDorsiflexion` | both | rep | side | mediapipe | `ankleAngleToe (base)` | `ankleAngleToe min 95` | yes |
| `SeatedMarch` | alternating | rep | front | movenet | `kneeLiftNormMax` | `kneeLiftNorm max 0.7`, `hipAngle min 5` | yes |
| `SideArmRaise` | both | rep | front | movenet | _auto-picked_ | `shoulderAngle max 95` | yes |
| `SitToStand` | both | rep | front | movenet | `kneeAngleL` | `kneeAngle max 180` | yes |
| `StandingDorsiflexion` | both | rep | side | mediapipe | `ankleAngleToeL` | `footPitchNorm min -0.11` | yes |
| `StandingMarch` | alternating | rep | front | movenet | `hipAngleMin` | `kneeLiftNorm max 0.5`, `hipAngle min 45` | yes |
| `StandingStraightUp` | both | time | front | movenet | _auto-picked_ | `kneeAngle max 182` | **missing** |
| `StepUps` | both | rep | diagonal | movenet | `kneeAngleL` | `kneeAngle min 95`, `kneeLiftNorm max 0.4` | yes |
| `WallPushUp` | both | rep | side | movenet | `elbowAngleR` | `elbowAngle min 75` | yes |

---

## Per exercise

### BicepCurls

| | |
| --- | --- |
| Engine key | `BicepCurls` |
| Side | `both` |
| Mode | `rep` |
| Detector | `movenet` |
| Camera view | `front` |
| Setup instruction | "Face the camera, arms visible at your sides" |
| Start cue | `{"left":"Curl your left arm up toward your shoulder","right":"Curl your right arm up toward your shoulder","both":"Curl your arms up toward your shoulders"}` |
| Primary feature | `elbowAngleR` (pinned during extraction) |
| ROM gate | `minRomPct 0.4` of the template range |
| Rep duration | 2000 ms (default) |
| Safety cap | `elbowAngle min 5` |
| Highlighted joints | `shoulder`, `elbow`, `wrist` |
| Phases | `lowered` (w1) → `curling` (w2) → `raised` (w1) → `lowering` (w2) |
| Rep cycle | `lowered → raised → lowered` |
| Reference | recorded, 6 reps averaged, recorded side `right` |
| Cap vs demonstration | `elbowAngleL` reaches 11.93 — inside |

**Needs a decision** (not in code anywhere):

- Display name (patient- and clinician-facing): 
- Clinical purpose / target impairment: 
- Starting position and equipment: 
- Default target reps or hold duration: 
- Is this assigned per-side, or bilaterally? 
- Progression / regression: 
- Contraindications: 

### CalfRaisesSeated

| | |
| --- | --- |
| Engine key | `CalfRaisesSeated` |
| Side | `both` |
| Mode | `rep` |
| Detector | `mediapipe` |
| Camera view | `side` |
| Setup instruction | "Sit at the edge of the chair, active foot in front of you (NOT next to chair leg)" |
| Start cue | "Push up onto your toes, then lower your heels" |
| Primary feature | `ankleAngleToeL` (pinned during extraction) |
| ROM gate | `minRomPct 0.65` of the template range |
| Rep duration | 2000 ms (default) |
| Safety cap | `footPitchNorm max 0.36` |
| Highlighted joints | `knee`, `ankle`, `heel`, `foot_index` |
| Phases | `lowered` (w1) → `raising` (w2) → `raised` (w1) → `lowering` (w2) |
| Rep cycle | `lowered → raised → lowered` |
| Reference | recorded, 7 reps averaged, recorded side `left` |
| Cap vs demonstration | `footPitchNormL` reaches 0.30 — inside |

**Needs a decision** (not in code anywhere):

- Display name (patient- and clinician-facing): 
- Clinical purpose / target impairment: 
- Starting position and equipment: 
- Default target reps or hold duration: 
- Is this assigned per-side, or bilaterally? 
- Progression / regression: 
- Contraindications: 

### CalfRaisesStanding

| | |
| --- | --- |
| Engine key | `CalfRaisesStanding` |
| Side | `both` |
| Mode | `rep` |
| Detector | `mediapipe` |
| Camera view | `side` |
| Setup instruction | "Stand sideways to the camera, exercising foot toward the camera" |
| Start cue | "Rise up onto your toes, then lower your heels slowly" |
| Primary feature | `ankleAngleToeL` (pinned during extraction) |
| ROM gate | `minRomPct 0.65` of the template range |
| Rep duration | 2000 ms (default) |
| Safety cap | `footPitchNorm max 0.22` |
| Highlighted joints | `knee`, `ankle`, `heel`, `foot_index` |
| Phases | `lowered` (w1) → `raising` (w2) → `raised` (w1) → `lowering` (w2) |
| Rep cycle | `lowered → raised → lowered` |
| Reference | recorded, 6 reps averaged, recorded side `left` |
| Cap vs demonstration | `footPitchNormL` reaches 0.21 — inside |

**Needs a decision** (not in code anywhere):

- Display name (patient- and clinician-facing): 
- Clinical purpose / target impairment: 
- Starting position and equipment: 
- Default target reps or hold duration: 
- Is this assigned per-side, or bilaterally? 
- Progression / regression: 
- Contraindications: 

### LiftsAndChops

| | |
| --- | --- |
| Engine key | `LiftsAndChops` |
| Side | `both` |
| Mode | `rep` |
| Detector | `movenet` |
| Camera view | `front` |
| Setup instruction | "Face the camera, full upper body in frame" |
| Start cue | "Lift hands up across your body, then chop down" |
| Primary feature | `handsHeightNorm` (pinned during extraction) |
| ROM gate | `minRomPct 0.55` of the template range |
| Rep duration | 2000 ms (default) |
| Safety cap | `handsHeightNorm max 1.3` |
| Highlighted joints | `shoulder`, `elbow`, `wrist` |
| Phases | `low` (w1) → `lifting` (w2) → `high` (w1) → `chopping` (w2) |
| Rep cycle | `low → high → low` |
| Reference | recorded, 8 reps averaged, recorded side `right` |
| Cap vs demonstration | `handsHeightNorm`: cap cannot resolve to any feature present — **dead** |

**Needs a decision** (not in code anywhere):

- Display name (patient- and clinician-facing): 
- Clinical purpose / target impairment: 
- Starting position and equipment: 
- Default target reps or hold duration: 
- Is this assigned per-side, or bilaterally? 
- Progression / regression: 
- Contraindications: 

### LongArcQuad

| | |
| --- | --- |
| Engine key | `LongArcQuad` |
| Side | `both` |
| Mode | `rep` |
| Detector | `movenet` |
| Camera view | `side` |
| Setup instruction | "Sit sideways to the camera, exercising leg toward the camera" |
| Start cue | `{"left":"Straighten your left leg out in front","right":"Straighten your right leg out in front","both":"Straighten your leg out in front"}` |
| Primary feature | `kneeAngleL` (pinned during extraction) |
| ROM gate | `minRomPct 0.25` of the template range (default) |
| Rep duration | 2000 ms (default) |
| Safety cap | `kneeAngle max 178` |
| Highlighted joints | `hip`, `knee`, `ankle` |
| Phases | `flexed` (w1) → `extending` (w2) → `extended` (w1) → `flexing` (w2) |
| Rep cycle | `flexed → extended → flexed` |
| Reference | recorded, 8 reps averaged, recorded side `left` |
| Cap vs demonstration | `kneeAngleL` reaches 169.86 — inside |

**Needs a decision** (not in code anywhere):

- Display name (patient- and clinician-facing): 
- Clinical purpose / target impairment: 
- Starting position and equipment: 
- Default target reps or hold duration: 
- Is this assigned per-side, or bilaterally? 
- Progression / regression: 
- Contraindications: 

### MiniLunges

| | |
| --- | --- |
| Engine key | `MiniLunges` |
| Side | `both` |
| Mode | `rep` |
| Detector | `movenet` |
| Camera view | `side` |
| Setup instruction | "Stand sideways to the camera, lead leg toward the camera" |
| Start cue | `{"left":"Step forward with your left leg into a lunge","right":"Step forward with your right leg into a lunge","both":"Step forward into a lunge — use the same leg for every rep"}` |
| Primary feature | `kneeAngleL` (pinned during extraction) |
| ROM gate | `minRomPct 0.45` of the template range |
| Rep duration | 2000 ms (default) |
| Safety cap | `kneeAngle min 90` |
| Highlighted joints | `hip`, `knee`, `ankle` |
| Phases | `standing` (w1) → `lunging` (w2) → `lunged` (w1) → `rising` (w2) |
| Rep cycle | `standing → lunged → standing` |
| Reference | recorded, 6 reps averaged, recorded side `right` |
| Cap vs demonstration | `kneeAngleL` reaches 112.25 — inside |

**Needs a decision** (not in code anywhere):

- Display name (patient- and clinician-facing): 
- Clinical purpose / target impairment: 
- Starting position and equipment: 
- Default target reps or hold duration: 
- Is this assigned per-side, or bilaterally? 
- Progression / regression: 
- Contraindications: 

### MiniSquats

| | |
| --- | --- |
| Engine key | `MiniSquats` |
| Side | `both` |
| Mode | `rep` |
| Detector | `movenet` |
| Camera view | `side` |
| Setup instruction | "Stand sideways to the camera, either side OK" |
| Start cue | "Begin squatting — bend your knees" |
| Primary feature | `kneeAngleMin` (pinned during extraction) |
| ROM gate | `minRomPct 0.4` of the template range |
| Rep duration | 2000 ms (default) |
| Safety cap | `kneeAngle min 100` |
| Highlighted joints | `hip`, `knee`, `ankle` |
| Phases | `standing` (w1) → `lowering` (w2) → `squatting` (w1) → `rising` (w2) |
| Rep cycle | `standing → squatting → standing` |
| Reference | recorded, 7 reps averaged, recorded side `right` |
| Cap vs demonstration | `kneeAngleL` reaches 120.32 — inside |

**Needs a decision** (not in code anywhere):

- Display name (patient- and clinician-facing): 
- Clinical purpose / target impairment: 
- Starting position and equipment: 
- Default target reps or hold duration: 
- Is this assigned per-side, or bilaterally? 
- Progression / regression: 
- Contraindications: 

### SeatedDorsiflexion

| | |
| --- | --- |
| Engine key | `SeatedDorsiflexion` |
| Side | `both` |
| Mode | `rep` |
| Detector | `mediapipe` |
| Camera view | `side` |
| Setup instruction | "Sit at the edge of the chair, active foot in front of you (NOT next to chair leg)" |
| Start cue | `{"left":"Pull your left toes up toward you, then lower","right":"Pull your right toes up toward you, then lower","both":"Pull your toes up toward you, then lower"}` |
| Primary feature | `ankleAngleToe` (family pinned; side auto) |
| ROM gate | `minRomPct 0.8` of the template range |
| Rep duration | 2000 ms (default) |
| Safety cap | `ankleAngleToe min 95` |
| Highlighted joints | `knee`, `ankle`, `heel`, `foot_index` |
| Phases | `lowered` (w1) → `dorsiflexing` (w2) → `raised` (w1) → `lowering` (w2) |
| Rep cycle | `lowered → raised → lowered` |
| Reference | recorded, 2 reps averaged, recorded side `right` |
| Cap vs demonstration | `ankleAngleToeR` reaches 104.65 — inside |

**Needs a decision** (not in code anywhere):

- Display name (patient- and clinician-facing): 
- Clinical purpose / target impairment: 
- Starting position and equipment: 
- Default target reps or hold duration: 
- Is this assigned per-side, or bilaterally? 
- Progression / regression: 
- Contraindications: 

### SeatedMarch

| | |
| --- | --- |
| Engine key | `SeatedMarch` |
| Side | `alternating` |
| Mode | `rep` |
| Detector | `movenet` |
| Camera view | `front` |
| Setup instruction | "Face the camera, both legs visible" |
| Start cue | "Lift your knees one at a time, alternating" |
| Primary feature | `kneeLiftNormMax` (pinned during extraction) |
| ROM gate | `minRomPct 0.5` of the template range |
| Rep duration | 2000 ms (default) |
| Safety cap | `kneeLiftNorm max 0.7`, `hipAngle min 5` |
| Highlighted joints | `hip`, `knee`, `ankle` |
| Phases | `resting` (w1) → `lifting` (w2) → `lifted` (w1) → `lowering` (w2) |
| Rep cycle | `resting → lifted → resting` |
| Reference | recorded, 8 reps averaged, recorded side `both` |
| Cap vs demonstration | `kneeLiftNormMax` reaches 0.72 — **past the cap by 0.02**<br>`hipAngleMin` reaches 12.74 — inside |

**Needs a decision** (not in code anywhere):

- Display name (patient- and clinician-facing): 
- Clinical purpose / target impairment: 
- Starting position and equipment: 
- Default target reps or hold duration: 
- Is this assigned per-side, or bilaterally? 
- Progression / regression: 
- Contraindications: 

### SideArmRaise

| | |
| --- | --- |
| Engine key | `SideArmRaise` |
| Side | `both` |
| Mode | `rep` |
| Detector | `movenet` |
| Camera view | `front` |
| Setup instruction | "Face the camera, full upper body in frame" |
| Start cue | `{"left":"Raise your left arm out to the side","right":"Raise your right arm out to the side","both":"Raise both arms out to the sides"}` |
| Primary feature | _auto-picked by widest range_ |
| ROM gate | `minRomPct 0.25` of the template range (default) |
| Rep duration | 2000 ms (default) |
| Safety cap | `shoulderAngle max 95` |
| Highlighted joints | `shoulder`, `elbow`, `wrist` |
| Phases | `lowered` (w1) → `transition_up` (w2) → `raised` (w1) → `transition_down` (w2) |
| Rep cycle | `lowered → raised → lowered` |
| Reference | recorded, ? reps averaged, recorded side — |
| Cap vs demonstration | `shoulderAngleL` reaches 99.71 — **past the cap by 4.71** |

**Needs a decision** (not in code anywhere):

- Display name (patient- and clinician-facing): 
- Clinical purpose / target impairment: 
- Starting position and equipment: 
- Default target reps or hold duration: 
- Is this assigned per-side, or bilaterally? 
- Progression / regression: 
- Contraindications: 

### SitToStand

| | |
| --- | --- |
| Engine key | `SitToStand` |
| Side | `both` |
| Mode | `rep` |
| Detector | `movenet` |
| Camera view | `front` |
| Setup instruction | "Face the camera, chair and full body visible" |
| Start cue | "Stand up from the chair" |
| Primary feature | `kneeAngleL` (pinned during extraction) |
| ROM gate | `minRomPct 0.25` of the template range (default) |
| Rep duration | 2000 ms (default) |
| Safety cap | `kneeAngle max 180` |
| Highlighted joints | `hip`, `knee`, `ankle` |
| Phases | `seated` (w1) → `rising` (w2) → `standing` (w1) → `sitting` (w2) |
| Rep cycle | `seated → standing → seated` |
| Reference | recorded, 6 reps averaged, recorded side `right` |
| Cap vs demonstration | `kneeAngleL` reaches 178.05 — inside |

**Needs a decision** (not in code anywhere):

- Display name (patient- and clinician-facing): 
- Clinical purpose / target impairment: 
- Starting position and equipment: 
- Default target reps or hold duration: 
- Is this assigned per-side, or bilaterally? 
- Progression / regression: 
- Contraindications: 

### StandingDorsiflexion

| | |
| --- | --- |
| Engine key | `StandingDorsiflexion` |
| Side | `both` |
| Mode | `rep` |
| Detector | `mediapipe` |
| Camera view | `side` |
| Setup instruction | "Stand sideways to the camera, exercising foot toward the camera, clear floor area" |
| Start cue | `{"left":"Pull your left toes up, keeping heel down","right":"Pull your right toes up, keeping heel down","both":"Pull your toes up, keeping heels down"}` |
| Primary feature | `ankleAngleToeL` (pinned during extraction) |
| ROM gate | `minRomPct 0.8` of the template range |
| Rep duration | 2000 ms (default) |
| Safety cap | `footPitchNorm min -0.11` |
| Highlighted joints | `knee`, `ankle`, `heel`, `foot_index` |
| Phases | `lowered` (w1) → `dorsiflexing` (w2) → `raised` (w1) → `lowering` (w2) |
| Rep cycle | `lowered → raised → lowered` |
| Reference | recorded, 6 reps averaged, recorded side `left` |
| Cap vs demonstration | `footPitchNormL` reaches -0.02 — inside |

**Needs a decision** (not in code anywhere):

- Display name (patient- and clinician-facing): 
- Clinical purpose / target impairment: 
- Starting position and equipment: 
- Default target reps or hold duration: 
- Is this assigned per-side, or bilaterally? 
- Progression / regression: 
- Contraindications: 

### StandingMarch

| | |
| --- | --- |
| Engine key | `StandingMarch` |
| Side | `alternating` |
| Mode | `rep` |
| Detector | `movenet` |
| Camera view | `front` |
| Setup instruction | "Face the camera, full body visible" |
| Start cue | "March in place, lifting knees alternately" |
| Primary feature | `hipAngleMin` (pinned during extraction) |
| ROM gate | `minRomPct 0.35` of the template range |
| Rep duration | 2000 ms (default) |
| Safety cap | `kneeLiftNorm max 0.5`, `hipAngle min 45` |
| Highlighted joints | `hip`, `knee`, `ankle` |
| Phases | `resting` (w1) → `lifting` (w2) → `lifted` (w1) → `lowering` (w2) |
| Rep cycle | `resting → lifted → resting` |
| Reference | recorded, 8 reps averaged, recorded side `right` |
| Cap vs demonstration | `kneeLiftNormL` reaches 0.02 — **inert, range ~0**<br>`hipAngleMin` reaches 103.88 — inside |

**Needs a decision** (not in code anywhere):

- Display name (patient- and clinician-facing): 
- Clinical purpose / target impairment: 
- Starting position and equipment: 
- Default target reps or hold duration: 
- Is this assigned per-side, or bilaterally? 
- Progression / regression: 
- Contraindications: 

### StandingStraightUp

| | |
| --- | --- |
| Engine key | `StandingStraightUp` |
| Side | `both` |
| Mode | `time` — held posture, not counted reps |
| Detector | `movenet` |
| Camera view | `front` |
| Setup instruction | "Face the camera, full body visible" |
| Start cue | "Stand tall — straight back, knees straight, hold the position" |
| Primary feature | _auto-picked by widest range_ |
| ROM gate | `minRomPct 0.25` of the template range (default) |
| Rep duration | 5000 ms |
| Safety cap | `kneeAngle max 182` |
| Highlighted joints | `shoulder`, `hip`, `knee`, `ankle` |
| Phases | `not_straight` (w1) → `straightening` (w1) → `straight` (w3) → `relaxing` (w1) |
| Reference | **none recorded** — the engine falls back to the synthetic template |

**Needs a decision** (not in code anywhere):

- Display name (patient- and clinician-facing): 
- Clinical purpose / target impairment: 
- Starting position and equipment: 
- Default target reps or hold duration: 
- Is this assigned per-side, or bilaterally? 
- Progression / regression: 
- Contraindications: 

### StepUps

| | |
| --- | --- |
| Engine key | `StepUps` |
| Side | `both` |
| Mode | `rep` |
| Detector | `movenet` |
| Camera view | `diagonal` |
| Setup instruction | "Stand at a 45° angle to the camera, step toward you" |
| Start cue | `{"left":"Step up leading with your left leg, then step back down","right":"Step up leading with your right leg, then step back down","both":"Step up onto the step, then step back down"}` |
| Primary feature | `kneeAngleL` (pinned during extraction) |
| ROM gate | `minRomPct 0.4` of the template range |
| Rep duration | 2000 ms (default) |
| Safety cap | `kneeAngle min 95`, `kneeLiftNorm max 0.4` |
| Highlighted joints | `hip`, `knee`, `ankle` |
| Phases | `ground` (w1) → `stepping_up` (w2) → `up` (w1) → `stepping_down` (w2) |
| Rep cycle | `ground → up → ground` |
| Reference | recorded, 3 reps averaged, recorded side `right` |
| Cap vs demonstration | `kneeAngleL` reaches 93.68 — **past the cap by 1.32**<br>`kneeLiftNormL` reaches 0.00 — **inert, range ~0** |

**Needs a decision** (not in code anywhere):

- Display name (patient- and clinician-facing): 
- Clinical purpose / target impairment: 
- Starting position and equipment: 
- Default target reps or hold duration: 
- Is this assigned per-side, or bilaterally? 
- Progression / regression: 
- Contraindications: 

### WallPushUp

| | |
| --- | --- |
| Engine key | `WallPushUp` |
| Side | `both` |
| Mode | `rep` |
| Detector | `movenet` |
| Camera view | `side` |
| Setup instruction | "Stand sideways to the camera, facing the wall" |
| Start cue | "Lower your chest toward the wall, then push back" |
| Primary feature | `elbowAngleR` (pinned during extraction) |
| ROM gate | `minRomPct 0.25` of the template range (default) |
| Rep duration | 2000 ms (default) |
| Safety cap | `elbowAngle min 75` |
| Highlighted joints | `shoulder`, `elbow`, `wrist` |
| Phases | `extended` (w1) → `lowering` (w2) → `flexed` (w1) → `pushing` (w2) |
| Rep cycle | `extended → flexed → extended` |
| Reference | recorded, 7 reps averaged, recorded side `left` |
| Cap vs demonstration | `elbowAngleL` reaches 69.16 — **past the cap by 5.84** |

**Needs a decision** (not in code anywhere):

- Display name (patient- and clinician-facing): 
- Clinical purpose / target impairment: 
- Starting position and equipment: 
- Default target reps or hold duration: 
- Is this assigned per-side, or bilaterally? 
- Progression / regression: 
- Contraindications: 

---

## Open vocabulary

Three naming questions that have never been settled. Each causes a real defect today.

### 1. What values may `side` take?

The backend schema is a bare `side: string` with no enum
(`packages/exercises/src/modules/exercises/schema.ts:37`). The engine recognises
`'left' | 'right' | 'both' | 'alternating'`. An unrecognised or absent value becomes
`"left"` in the pose app (`src/App.js:71`), which silently turns a bilateral exercise
into a left-limb one. Full write-up in [NOTES.md](NOTES.md#1-what-should-side-mean-for-a-bilateral-exercise).

### 2. How does a catalogue entry map to an engine key?

The engine looks up `SeatedMarch`; the platform has used `"Left Side Arm Raise"`. There is no
recorded mapping, and a mismatch means the engine silently falls back to its synthetic template
instead of the recorded reference — the extractor carries a comment about exactly this
(`ReferenceExtractor.js:947`).

### 3. Who owns target reps?

Reps come from the assignment via the JWT, not from this catalogue. A per-exercise *default*
does not exist anywhere. Worth deciding whether the catalogue should carry one.

### 4. Two exercises are labelled `both` but are physically one limb at a time

`StepUps` and `MiniLunges` both carry `side: 'both'`, but neither is a bilateral movement: a step-up
drives one leg, and a lunge puts one leg forward. `SeatedMarch` and `StandingMarch`, which are the
same shape of movement, are correctly labelled `alternating`.

This surfaced when `side: 'both'` started resolving a pinned feature to an aggregate. The engine now
watches these:

| Exercise | Pinned in the reference | Engine watches | Effect |
| --- | --- | --- | --- |
| `BicepCurls` | `elbowAngleR` | `elbowAngleMin` | correct — both arms curl |
| `WallPushUp` | `elbowAngleR` | `elbowAngleMin` | correct — both arms push |
| `StepUps` | `kneeAngleL` | `kneeAngleMin` | **accidentally better** — tracks the stepping leg rather than always the left |
| `MiniLunges` | `kneeAngleL` | `kneeAngleMin` | **accidentally better** — tracks the front leg rather than always the left |

The last two now behave more correctly than before, but for the wrong reason: they are being treated
as bilateral when they are really unilateral or alternating. If either is reclassified to
`alternating`, the engine would additionally enforce that consecutive reps change side — which is
right for a march, and probably wrong for a set of step-ups on one leg.

**Decide per exercise** whether it is bilateral (both limbs together), alternating (sides must
change), or sided (one limb per assignment). The `Is this assigned per-side, or bilaterally?` line in
each section above is where that answer belongs.

### 5. `SideArmRaise` and `SeatedDorsiflexion` still resolve to one side

Neither reference pins a feature, so the *auto-picker* runs instead — and it still filters to the
assigned side for a `both` exercise. `SideArmRaise` watches `shoulderAngleL` for a left session, so a
right-arm raise counts nothing. Same bug class as BicepCurls, left alone deliberately because
`SideArmRaise` is the one exercise already validated end to end. See
[NOTES.md](NOTES.md#1-what-should-side-mean-for-a-bilateral-exercise).
