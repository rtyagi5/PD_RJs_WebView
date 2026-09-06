# Rehab Ranger™ — Project Overview

*Shared for evaluation and discussion. Please treat as confidential and do not
redistribute. This is a high-level summary; implementation detail is intentionally
out of scope.*

---

## What we're building

Rehab Ranger™ is a real-time exercise tracker for physical rehabilitation, with an
initial focus on stroke recovery. A patient opens an exercise on their phone or tablet,
props it up, and performs the movement. The app watches through the camera, counts
repetitions, and coaches them through the set — the way a therapist would if they were
standing in the room.

It runs embedded inside partner physical-therapy platforms, so patients reach it through
the app their clinic already gave them rather than installing anything new. Session
results flow back to the clinic, so a therapist can see what actually happened between
appointments instead of relying on a paper log.

We currently support **16 distinct exercises** spanning upper body, lower body, seated,
and standing positions.

---

## Why it's an interesting engineering problem

**Everything runs on the patient's device.** No video is uploaded, no frames are sent to a
server, and there is no cloud inference anywhere in the loop. That's a deliberate privacy
posture, and it makes the engineering considerably harder: the entire vision pipeline has
to hold a usable frame rate inside a mobile WebView, on whatever hardware the patient
happens to own.

**Our users are the hard case.** Most fitness-tracking software is built and tuned for
healthy adults with full range of motion in good lighting. Our users may have limited
mobility on one side, may be seated, may be partially occluded by a chair or a walking
frame, and are often in a poorly lit living room. A system that only works on an
able-bodied demo is worthless here.

**Getting a rep count right is genuinely difficult.** Camera-based motion data is noisy.
Keypoints jitter, drop out, and occasionally attach themselves to background objects.
Naive threshold-crossing produces double counts, phantom reps, and missed reps in roughly
equal measure. A meaningful amount of our engineering effort goes into distinguishing real
human movement from measurement artefacts — and into doing that without setting the bar so
high that a patient with restricted movement stops getting credit for real effort.

**Clinical correctness matters.** This is not a step counter. If the system tells someone
their form is fine when it isn't, or counts a rep they didn't complete, that has real
consequences for their recovery. Decisions that would be judgement calls in consumer
software are decisions we take carefully here.

---

## How it works, at a high level

```
Camera
  ↓   on-device pose estimation
Body position (joint locations, per frame)
  ↓   signal conditioning and normalization
Movement measurements (joint angles, relative positions)
  ↓   readiness checks — framing, distance, visibility
Exercise engine — segments the movement, counts reps, evaluates form
  ↓
Live visual feedback on screen  +  structured results to the host app
```

Five things worth understanding about the shape of it:

1. **Pose estimation is off-the-shelf; the analysis is ours.** We use established
   open-source pose models (Google's MoveNet and MediaPipe) to locate the body in each
   frame. Everything downstream — deciding what a movement *is*, whether a repetition
   happened, and whether the form was acceptable — is our own work.

2. **Measurements are body-relative, not pixel-based.** Raw coordinates depend on the
   patient's height and how far they're sitting from the camera. We normalize against the
   patient's own proportions so the same movement reads the same regardless of body size
   or camera distance.

3. **The session is a state machine, not just a loop.** Before counting anything, the app
   coaches the patient into a workable camera position and confirms the relevant body
   parts are actually visible. It also detects when someone has walked out of frame
   mid-set and pauses cleanly rather than logging nonsense.

4. **Movement recognition is comparison-based.** Rather than hand-coding rules for every
   exercise, the engine compares live movement against a reference pattern for that
   exercise. This is what lets the system scale to new exercises without a bespoke
   implementation each time — and it's the part of the system we consider most valuable.

5. **The system adapts to the individual.** A patient's usable range of motion is
   established from their own performance rather than assumed from a textbook, so
   "a complete repetition" means something different — and more useful — per person.

---

## Tech stack

| Layer | What we use |
|---|---|
| Framework | React 18 (function components, hooks) |
| Language | JavaScript (ES2020+) |
| Pose estimation | TensorFlow.js (WebGL backend) · MediaPipe Tasks Vision (WASM) |
| Rendering | HTML Canvas 2D |
| Styling | Tailwind CSS |
| Testing | Jest + React Testing Library |
| Build | Create React App / react-scripts |
| CI | GitHub Actions |
| Delivery | Static build, embedded as a WebView inside partner mobile apps |

**Notable constraints that shape day-to-day work:**

- **No Redux or heavy state libraries.** The detection loop runs at 30–60 fps; per-frame
  state lives in refs. Re-render cost is a real budget, not a theoretical one.
- **Nothing blocking in the hot path.** No network calls, no synchronous heavy work
  between frames.
- **Degrade, never crash.** Missing or unreliable input is normal, not exceptional. Code
  is expected to handle it as a routine case rather than throwing.
- **Mobile-first performance.** A change that's fine on a development laptop and drops a
  mid-range Android phone to 8 fps is not fine.

---

## Engineering practice

- Core logic is covered by unit tests and runs in CI on every pull request.
- The vision and analysis logic is written as pure functions where possible, so it can be
  tested headlessly without a camera.
- We keep a validation harness that exercises the movement engine end to end without
  hardware, alongside real-device testing — because synthetic tests and real cameras fail
  in very different ways.
- Code review before merge; changes to the analysis engine get particular scrutiny given
  the clinical context.

---

## What a developer would work on

Depending on background and interest, the work falls into a few areas:

- **Movement analysis** — improving accuracy of repetition detection and form evaluation,
  particularly for lower-body and ankle movements where the signal is weakest.
- **Expanding the exercise library** — extending coverage beyond the current 16.
- **Performance** — sustaining frame rate on lower-end mobile hardware.
- **Patient experience** — the on-screen coaching, guidance, and feedback layer, which is
  what determines whether a patient can actually use this unsupervised at home.
- **Clinical data** — what we measure, how we report it, and making it genuinely useful to
  a therapist reviewing a patient's week.

Useful background: strong JavaScript and React; comfort with real-time or signal-heavy
code; any exposure to computer vision, motion capture, biomechanics, or DSP is a
significant plus but not a prerequisite. Interest in the healthcare problem matters more
than a specific résumé line.

---

## What this document doesn't cover

Deliberately omitted: the movement-recognition algorithm and its tuning, how reference
patterns are produced, our feature definitions, the specific parameters that make
detection robust, the integration contract with partner platforms, backend services, and
the repository itself.

Happy to go through all of it properly — that conversation just needs a mutual NDA in
place first. If the above is the kind of problem you'd want to spend time on, that's the
natural next step.
