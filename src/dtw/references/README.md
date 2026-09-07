# Recorded DTW references

Drop a `*.ref.json` here and it is auto-discovered at startup by `index.js`
(webpack `require.context`) and registered by `bootstrapReferences.js`.

Two things must hold for a file here to be used:

1. **Its `name` must be the canonical `EXERCISE_CONFIGS` key** — `SideArmRaise`, not
   `Left Side Arm Raise`. Lookups go through `getReference(exerciseType)` with that exact key.
   A mismatch is caught and warned about at startup.
2. **Its phase labels must separate the rest posture from the effort posture** on the feature the
   engine gates on. Checked by `referenceHealth.checkPhaseSeparation()` at export *and* at load;
   a failure keeps the synthetic template.

Confirm what is actually driving a session:

```
[Engine] DTW mode for <exercise> — reference source: SYNTHETIC | VIDEO | API
```

## Current state: this folder is empty, all 16 exercises run on synthetic templates

There is one historical recording, and it is not usable. Both it and its repaired version now live
in `../__fixtures__/` as test data.

### What was wrong with it

`ReferenceExtractor` used to assign phase labels by **frame position** — first half of the rep got
`phases[0]`, second half got `phases[1]`, with no reference to any feature value. The clip happened
to open on a hold at the top of the movement, so 30 frames with the arm at ~92° were labelled
`lowered`:

| Phase | frames | `shoulderAngleL` mean | min | max |
| --- | --- | --- | --- | --- |
| `lowered` (cycle start) | 30 | **92.4** | 90.1 | 93.8 |
| `raised` (cycle effort) | 30 | 55.3 | **21.4** | **93.9** |

`DTWPhaseMachine` takes `refStartValue` from the start-phase mean and `templateDirection` from
`sign(effortMean − startMean)`. Registered as-is, that would have put `refStartValue` at 92.4
instead of ~24 and flipped `templateDirection` to −1 — so **raising the arm would have been rejected
as wrong-direction motion**, and the exercise would count nothing while every log looked healthy.

### That bug is fixed

`phaseLabeller.js` now labels from the signal: frames near the rest value get the start phase,
frames near the extreme get the effort phase, and the runs between are assigned by slope. Which end
is "rest" comes from the canonical config, because it is not inferable from a recording —
SideArmRaise rests **low** (30° → 90°) while SeatedDorsiflexion rests **high** (0.12 → −0.05).

Re-labelling the old file with it produces a correct reference — `startMean` 24.3, `effortMean`
92.1, direction +1, health check passes — and it counts 5/5 reps in the engine, matching synthetic.
That repaired file is `../__fixtures__/rescued-side-arm-raise.ref.json`.

### Why it is still not registered

The recording is a **half cycle**. Re-labelled, its frames fall out as:

```
raised: 36    transition_down: 16    lowered: 8    transition_up: 0
```

The clip holds at the top, lowers, and stops — there is no ascent. `extractPhaseOrder` would
therefore build a 3-phase engine, the `transition_up` coaching cues would never fire, and the phase
proportions would be wrong even though rep counting is unaffected. That is a regression in coaching
in exchange for no gain in counting, so the synthetic template stays.

## Recording one that works

See `../../../docs/RECORDING_A_REFERENCE.md`. The short version:

- One unbroken take, fixed camera, no cuts or zoom — edits destroy phase shape.
- Framing matching that exercise's `framing.view`, body about half the frame height.
- 5–8 reps, deliberate tempo, **resting fully at the start posture between reps** so the labeller
  has a plateau at both ends to anchor on.
- `/reference-extractor` → upload → extract → check reps → check the per-phase frame counts are all
  non-zero → export → **Download** → drop the file here.

## What a recording is and is not for

A reference supplies **phase shape** — the ordering and relative proportions of a movement, which
generalise across bodies. It must **not** supply ROM magnitude, which does not generalise: one
demonstrator's range is not a patient's, and certainly not a population boundary. Magnitudes come
from the patient's own baseline via `romGate.js`, and safe limits from `clinicalCaps` (see
`docs/CLINICAL_GUARDRAILS.md`). Conflating the three is the design error that made limited-ROM reps
uncountable in the first place.
