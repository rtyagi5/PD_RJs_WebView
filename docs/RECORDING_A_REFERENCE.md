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
| **Resolution above ~1280 wide buys nothing** | The extractor caps processing at `PROCESSING_MAX_WIDTH` (`src/captureConfig.js`), so a 4K take is downscaled before pose detection. Recording higher is harmless, just pointless. See below for why the cap exists. |
| **One unbroken take** | Cuts and zoom changes destroy phase shape. An edited library clip is unusable for this even if it looks fine. |
| **Fixed camera, fixed distance** | Every feature is a 2D image-space measurement. A camera that moves changes the numbers without the body changing. |
| **Camera level — not tilted sideways** | See below. This is the one setup error that silently fabricates signal rather than just adding noise. |
| **Body roughly half the frame height** | `PoseQuality.IDEAL_BODY_RATIO` is 0.50, tolerances +0.20 / −0.30. |
| **Plain background, even lighting** | For foot exercises especially: MediaPipe will latch onto a chair leg and smear the heel and toe along it. The `footValid` guard catches the worst of it by discarding the frame, but a clean background means fewer discarded frames. |
| **Whole body in frame, including feet** | Even for upper-body exercises — `trunkAngle` and `hipAngle` are used as posture references. |
| **5–8 reps** | The template is the average across reps, resampled to 60 frames. More reps average out jitter. |
| **Deliberate tempo** | The velocity filter masks primary-feature jumps above 20 units per frame as artefacts. Fast reps on a low-fps capture can trip it. |

## Levelling the camera

Roll — the phone tilted sideways — affects the two classes of feature completely differently.

**Angle features are immune.** `kneeAngle`, `shoulderAngle`, `elbowAngle`, `hipAngle` and
`trunkAngle` are three-point angles, which are mathematically invariant to image rotation as well as
to scale and position. Tilt the phone 20° and they do not move.

**Normalized height features are not.** These take a raw vertical difference and normalise only the
magnitude:

```
footPitchNorm = (foot_index.y - heel.y) / shank
kneeLiftNorm  = max(0, hip.y - knee.y) / hipAnkleLen
```

Dividing by a limb length cancels distance, but the numerator assumes the image y-axis points along
gravity. Since the heel-to-toe vector is roughly `0.65 x shank`, a camera rolled by θ injects about
`0.65 x sin(θ)` into `footPitchNorm`:

| Roll | Spurious `footPitchNorm` |
| --- | --- |
| 5° | 0.057 |
| 10° | 0.113 |
| 15° | 0.168 |

Real dorsiflexion produces 0.05–0.15. **A 10° tilt fabricates a signal the size of the entire
movement.** For the four foot exercises this is not a rounding error, it is the measurement.

`PoseQuality.checkCameraRoll` now rejects a tilted setup in every view — measuring off the shoulder
line facing the camera, and off the trunk axis side-on, where the shoulders foreshorten and the
shoulder line is useless. The default limit is 12°, tightened to 8° for the four foot exercises.

Note it cannot distinguish a rolled camera from a leaning patient — from one 2D view those are the
same thing — which is why it says "Level your camera or straighten up" and rejects rather than
silently de-rotating.

For a reference recording this matters more than for a patient session: a patient's baseline is
their own, so their idiosyncrasies wash out, but **a roll error in the reference is baked into the
template as the correct shape and every patient is then compared against it.** Use a tripod or a
stable prop, check the level with your camera app's grid, and do not touch it between reps.

## Resolution, and why the extractor deliberately throws pixels away

Neither detector sees your video. Both crop their own region of interest around the person and
resize it before inference — MoveNet to **192x192**, MediaPipe/BlazePose to **256x256**. The subject
therefore fills the model input regardless of how far away they stand, and the foot is a small fixed
fraction of it either way. A `footPitchNorm` swing of 0.05-0.15 comes out as roughly a **3-10 pixel**
vertical difference between heel and foot_index.

That has a consequence for recording. A phone camera app records at 1080p or better; a live patient
session captures at `PROCESSING_MAX_WIDTH`. Extracting at native resolution would build the template
from landmark quality no live session can reproduce, making the template systematically unreachable —
the same failure as a reference whose feature scale does not match the live one.

So `videoFeatureExtractor` runs pose on a canvas capped at the same width live capture requests. You
will see it say so:

```
[VideoExtractor] processing at 1280x720 (source 1920x1080) to match live capture
```

This equalises pixel *count*, not image *quality* — a rear camera recording is still sharper than a
front-camera live frame, and nothing in the pipeline can close that gap. Record in good light so the
difference stays small.

## Foot exercises: the setup check is stricter now

The four foot exercises declare `framing.requireFoot`, so `PoseQuality.checkFootTracking` must see
**one complete foot** — knee, ankle, heel and foot_index on the same side — before the session
starts. One is enough: side-on, the far foot is legitimately occluded.

It also tests the geometry, because MediaPipe reports a synthetic confidence of `1.0` for these
landmarks, which makes a presence check nearly meaningless. Heel-to-toe span must be at most 90% of
shank length; a real foot is 60-70%. Past that, the model has almost certainly latched onto a
vertical chair leg and smeared both keypoints along it. If you see

> Move your foot away from the chair legs so it can be tracked

move the chair, do not move the camera. This is the single most common way a foot recording is
wasted, and it now fails during setup instead of silently producing false reps.

## Also record a live capture, so the features can be measured

A reference video tells you the shape of the movement. It does not tell you whether the engine can
*see* it. For that, run the same exercise live through the dev server so `KeypointRecorder` writes a
`.jsonl` of raw keypoints to `captures/`, then:

```
yarn test:ci --testPathPattern=analyzeCapture
```

It prints heel-to-toe span in pixels, the real on-device frame rate, and the signal-to-noise of
`footPitchNorm`, `ankleAngleToe` and `ankleAngleHeel` computed from identical frames. That last
comparison is the evidence for whether a foot exercise should change its primary feature — a
question that has already been answered wrongly once from guessed numbers.

Two things to know before you try:

- Recording is off by default. Do **not** edit `.env`, which is committed — create `.env.local`
  (gitignored, and higher precedence in CRA) containing `REACT_APP_ALLOW_SKELETON_RECORDING=true`.
- The file is only flushed on the completion path, so **finish the set**. An aborted session leaves
  nothing behind.

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
