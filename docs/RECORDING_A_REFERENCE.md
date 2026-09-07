# Recording a reference video

A reference template teaches the engine the **shape** of a movement — the order of its phases and
their relative proportions. That is all it teaches. It must not carry range-of-motion magnitudes:
those come from each patient's own baseline (`dtw/romGate.js`), and safe limits from `clinicalCaps`
(`docs/CLINICAL_GUARDRAILS.md`). One demonstrator's range is not a patient's, and is certainly not a
population boundary.

Because only shape matters, the demonstrator does not need to be a patient, and does not need
clinically perfect form. The recording needs to be *legible*.

## Before you record

Pick the exercise and check its declared framing in `EXERCISE_CONFIGS`
(`src/dtw/specToReference.js`) — `framing.view` is `front` or `side`, and the runtime enforces it
with `PoseQuality`. Record from the view the app will ask the patient to use, or the extracted
features will not correspond to live ones.

| Requirement | Why |
| --- | --- |
| **One unbroken take** | Cuts and zoom changes destroy phase shape. An edited library clip is unusable for this even if it looks fine. |
| **Fixed camera, fixed distance** | Every feature is a 2D image-space measurement. A camera that moves changes the numbers without the body changing. |
| **Body roughly half the frame height** | `PoseQuality.IDEAL_BODY_RATIO` is 0.50, tolerances +0.20 / −0.30. |
| **Plain background, even lighting** | For foot exercises especially: MediaPipe will latch onto a chair leg and smear the heel and toe along it. The `footValid` guard catches the worst of it by discarding the frame, but a clean background means fewer discarded frames. |
| **Whole body in frame, including feet** | Even for upper-body exercises — `trunkAngle` and `hipAngle` are used as posture references. |
| **5–8 reps** | The template is the average across reps, resampled to 60 frames. More reps average out jitter. |
| **Deliberate tempo** | The velocity filter masks primary-feature jumps above 20 units per frame as artefacts. Fast reps on a low-fps capture can trip it. |

## The one that actually matters

**Rest fully at the start posture between reps, and hold for about a second.**

Phase labelling now works by finding where the movement *settles* — frames near the rest value get
the start phase, frames near the extreme get the effort phase. If the movement never dwells at
either end, there is nothing to anchor to and the labeller will refuse rather than guess.

Hold briefly at the top of the movement too. And record complete cycles: the existing historical
recording in `__fixtures__/` is unusable precisely because it captured a hold at the top and a
descent, with no ascent, so a third of the phase structure is simply missing.

## Extracting

1. `yarn start`, then open `http://localhost:3000/reference-extractor`.
2. **Upload** the video file. The extractor takes a file — it does not record from a camera.
3. Pick the exercise from the dropdown. Phases, rep cycle and detector are filled in from the
   canonical config; do not hand-edit the phase names, or the reference stops being comparable to
   the synthetic one it replaces.
4. **Extract Features**. Sample FPS 15 is usually enough; raise it for fast movements.
5. **Check the rep boundaries.** Auto-detection is peak/valley on the primary feature and it does
   get this wrong. Fix the boundaries before continuing — though note that phase labelling no longer
   depends on where a rep was cut, so this mainly affects how clean the averaged template is.
6. **Check the frames-per-phase readout in step 4.** Every phase must be non-zero. A phase with no
   frames means the clip never covers that part of the movement, and its coaching cues will never
   fire. Widen the posture band for a noisy clip; re-record if a phase is genuinely absent.
7. Fill in feedback cues, then **Export**. Export is refused if the reference fails
   `checkPhaseSeparation` — the message says which posture pair could not be separated.
8. **Download** the `.ref.json` and drop it into `src/dtw/references/`. Do not use Publish; it posts
   to a backend, which this workflow deliberately avoids.

## Verifying it is actually in use

Restart the dev server and check the console:

```
[Engine] DTW mode for SideArmRaise — reference source: VIDEO
```

`SYNTHETIC` means the file is not being used. The startup warnings say why — either the `name` is
not a canonical `EXERCISE_CONFIGS` key, or the phase separation check rejected it.

Then run the exercise on the phone through the USB loop and confirm reps count and `[DTW-diag]`
shows clean `sawStart → sawEffort → rep` cycles.
