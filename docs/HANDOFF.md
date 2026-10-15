# Rehab Ranger — engineering hand-off

**Prepared 2026-10-14, after an on-device test round of 13 of the 16 exercises.**

One consolidated document for the backend, mobile and admin-portal developers. Each part is
self-contained; send a part to the person who owns it.

Deep-dive companions, all in `Posedetection_ReactJS_WebView/docs/`:
`NOTES.md` · `EXERCISE_CATALOGUE.md` · `CLINICAL_GUARDRAILS.md` · `MOVEMENT_BASELINE_PLAN.md` ·
`APP_AND_BACKEND_ISSUES.md` · `BASELINE_SYNC_CONTRACT.md` · `RECORDING_A_REFERENCE.md`

---

## Verdict: is this ready for a beta patient?

**The rep counting is close. The data layer is not. Do not ship to a beta patient yet.**

What works: all 16 exercises have a recorded reference, reps count on-device, spoken cues fire,
safety caps fire and are logged, and 13 of 16 ran end-to-end in one sitting.

Four things would each independently spoil a beta:

| | Blocker | Impact on a beta patient |
| --- | --- | --- |
| **B1** | Every session runs as `side=left` regardless of the exercise | A right-side exercise counts **zero reps**. Measured on `LongArcQuad` |
| **B2** | Exercise demo videos do not play | Patient cannot see how to do the movement |
| **B3** | Grey screen for several seconds on every launch | Looks broken before they start |
| **B4** | 7 of 16 exercises send joint data the backend cannot match | No progress tracking, so no notifications |

B1–B3 are small fixes. B4 is a naming reconciliation, also small, but nothing proceeds without it.

**The honest summary:** a patient could physically complete a session today, but roughly half the
exercises would record nothing usable, and any right-sided exercise would frustrate them
immediately.

---

## Your understanding was right

You said: *"we made a couple of changes in terms of variables, identifiers, and those need to be
followed in the backend services and the DB as well."*

**Correct, and the problem is larger than the changes we made.** There are now **three** independent
definitions of each exercise, using three different vocabularies, none validated against the others:

| Where | What it defines | Example |
| --- | --- | --- |
| `Posedetection/src/dtw/specToReference.js` | features, caps, ROM gates | `hipAngleMin` |
| `rehab-backend/.../engine/schemas/exercises-schema/*.json` | per-joint ROM / Accuracy / Improvement metrics | `hipFlexAngle` |
| `rehab-backend/.../utils/service.ts` `exerciseExpectedConfig` | expected joint ranges | `hipFlexAngleMin` |

Nothing validates that these agree. They do not.

---

## Part 1 — Backend (largest share)

### 1.1 Joint names do not match, so 7 of 16 exercises record nothing

The backend computes `ROM_<joint>`, `Accuracy_<joint>` and `Improvement_<joint>` per exercise from
`engine/schemas/exercises-schema/*.json`. For seven exercises, the joint named there **is never sent
by the pose engine, because it does not exist**:

| Exercise | Backend expects | Pose engine actually sends |
| --- | --- | --- |
| `SideArmRaise` | `shoulderAngle`, **`armAngle`** | `shoulderAngle`, `elbowAngle` |
| `SeatedMarch` | **`hipFlexAngle`** | `kneeLiftNorm`, `kneeLiftNormMax`, `hipAngle`, `hipAngleMin` |
| `StandingMarch` | **`hipFlexAngle`** | `kneeLiftNorm`, `kneeLiftNormMax`, `hipAngle`, `hipAngleMin` |
| `SeatedDorsiflexion` | **`footPitchDelta`** | `footPitchNorm`, `ankleAngleToe`, `trunkAngleMin` |
| `StandingDorsiflexion` | **`footPitchDelta`** | `footPitchNorm`, `ankleAngleToe`, `trunkAngleMin` |
| `CalfRaisesSeated` | **`ankleAngle`** | `footPitchNorm`, `ankleAngleToe`, `ankleAngleHeel` |
| `CalfRaisesStanding` | **`activeToeAngle`** | `footPitchNorm`, `ankleAngleToe`, `ankleAngleHeel` |

`armAngle`, `hipFlexAngle`, `footPitchDelta`, `activeToeAngle` and `ankleAngle` **do not exist in
the pose engine's feature set at all.** The other 9 exercises are fine.

**Consequence: for those seven, ROM, Accuracy and Improvement all silently compute nothing.** No
progress data, therefore no progress notifications. This is the single highest-value fix in this
document.

**Action:** agree one canonical joint-key list, own it in one place, and validate on write. The pose
engine's `UNIVERSAL_FEATURE_KEYS` (`src/dtw/universalFeatures.js`) is the natural source of truth,
because it is the only layer that actually measures anything.

### 1.2 Per-rep data is sent and silently dropped

The pose engine posts these to `/activities/exercise-data`, and **no backend code reads any of
them**:

| Field | What it carries |
| --- | --- |
| `repSummary` | per-rep min/max for every tracked feature — the most clinically useful payload we produce |
| `completedReps` / `attemptedReps` / `totalReps` | the completed-vs-attempt split |
| `completionRate` | adherence |

Only `data.updates` is consumed (stored as `metadata`, and fed to `extractJointArrays`).

**Action:** persist `repSummary` per rep. Without it there is no per-rep angle history, only
session-level aggregates.

### 1.3 `kneeLiftNorm` changed meaning — historical values are not comparable

We changed its normaliser from the hip-to-ankle distance to torso length, because the old
denominator **collapsed as the knee rose**, double-counting the lift (measured: the normaliser more
than halved at peak lift, inflating a real 0.38 reading to 0.834).

**Action:** any stored `kneeLiftNorm` / `kneeLiftNormMax` value recorded before 2026-10-14 is in the
old units and must not be trended against new ones. `exerciseExpectedConfig` entries for
`SeatedMarch` (`kneeLiftNormMax: {start: 0.3, end: 0.6}`) need re-deriving.

### 1.4 Exercise videos do not play

`packages/users/src/modules/files/service.ts` advertises `Accept-Ranges: bytes` but **never reads
the `Range` header**, and buffers each whole file into memory (`s3.getObject().promise()`). One
video is 48 MB. Reproduced off-device: full GETs truncate at random points; mid-file range requests
return **zero bytes**. Video players use ranged requests exclusively, so playback cannot work.

**Action:** redirect to a presigned S3 URL instead of proxying bytes. Also re-encode the videos —
48 MB for a demo clip is not viable on cellular. Full detail in `APP_AND_BACKEND_ISSUES.md` §2.

### 1.5 `side` is unconstrained, and the default is harmful

`packages/exercises/src/modules/exercises/schema.ts:37` is a bare `side: string` with no enum. When
it is empty the backend correctly omits the JWT claim — and the pose app then defaults it to
`"left"`. Every one of the 13 test sessions ran `side=left`, including an exercise displayed as
**"Side Arm Raise (Right)"**.

**Action (quick):** set `side` explicitly on every sided exercise record so the default never fires.
**Action (proper):** add an enum — `'left' | 'right' | 'both' | 'alternating'` — and validate.

### 1.6 Reference and baseline endpoints were specified and never built

- `GET/PUT /api/v1/patients/:id/baseline` — spec in `BASELINE_SYNC_CONTRACT.md`
- `GET/POST /exercise-service/references/:exerciseName` — spec in `src/dtw/references/index.js`

Until the second exists, every recorded reference is bundled into the webpack build, so shipping a
new or corrected exercise reference requires a **frontend deploy**.

### 1.7 Two baseline systems exist and do not talk

The backend has `exercise-assessments` with `expectedConfig` / `currentConfig` per joint, plus
automatic widening in `exercise-aggregate.service.ts`. The pose engine has `PatientBaseline` in
`localStorage`. Both independently implement "a percentage of the patient's own capability".
Neither knows about the other. See `MOVEMENT_BASELINE_PLAN.md`.

---

## Part 2 — Mobile app

### 2.1 Grey screen on every launch

A `finally` block that also runs on an early `return`:

```js
// src/navigation/stack/GeneralRoutes.js
try {
  if (loading) { return; }          // auth still working
  setInitialRoute(route);
} catch (e) { … }
finally {
  setIsLoading(false);              // ← also runs on that early return
}
```

That leaves `isLoading === false` with `initialRoute === null`, and the render shows nothing:

```jsx
<LoadingIndicator isLoading={isLoading} />            // false -> null
{!isLoading && initialRoute && <Stack.Navigator …>}   // true && null -> nothing
```

Made worse by a **401 on every cold start** — the stored token is rejected and the app silently
re-authenticates, so two network round trips happen before anything can paint.

**Fixes, in order:** move `setIsLoading(false)` out of the `finally`; render the loading indicator
whenever `initialRoute` is null; clear the token on 401 instead of keeping a rejected one; do not
block first paint on a network call. Full detail in `APP_AND_BACKEND_ISSUES.md` §1.

### 2.2 The spoken voice sounds curt

Currently `react-native-tts@4.1.1`, which drives the **device's built-in engine** (Google TTS on
this handset). Only two settings are applied: `Tts.setDefaultLanguage('en-US')` and
`Tts.setDefaultRate(0.45)`.

The curtness is mostly **wording and delivery, not the engine**. Cheapest improvements first:

1. **Rewrite the cues.** They are terse imperatives — "Slow down", "That's high enough", "Try to
   lift higher". Warmer equivalents cost nothing: *"Let's slow it down a little"*, *"That's a great
   height — hold it there"*, *"See if you can lift a little higher"*. These live in
   `specToReference.js` under each exercise's `feedback` block, so this is a pose-engine change,
   not a mobile one.
2. **Pick a specific voice.** `Tts.voices()` lists what the device has; Google TTS usually ships
   several en-US neural voices of noticeably different warmth. Today none is selected, so the
   patient gets whatever the device defaults to.
3. **Set pitch as well as rate.** `Tts.setDefaultPitch()` is never called. A slightly lower pitch
   with the existing slow rate reads as calmer.

**On ElevenLabs and similar:** quality is materially better, but it is a network call per phrase.
Cues are time-critical mid-rep, so streaming them live would arrive late. The viable pattern is
**pre-generating the fixed cue set as audio files** and shipping them — the cue strings are a small,
closed set — and falling back to device TTS for anything dynamic (rep numbers). That is a real
project: cost per character, caching, offline behaviour, and a voice-licensing question. Worth doing
after 1–3 above, which are nearly free.

---

## Part 3 — Admin portal

| | Item |
| --- | --- |
| 3.1 | Set `side` explicitly on sided exercises (see 1.5) — likely a data task, not code |
| 3.2 | Surface the completed-vs-attempt split once the backend stores it (1.2) |
| 3.3 | Clinician review and **override** of a patient's baseline — a PT's goniometer reading should beat a camera estimate |
| 3.4 | Trigger a re-assessment manually (see `MOVEMENT_BASELINE_PLAN.md`) |

---

## Part 4 — Can we send progress notifications?

**Not yet, and for three stacked reasons.**

1. **For 7 of 16 exercises the metric never computes** (1.1). No number, no notification.
2. **Per-rep history is dropped** (1.2), so "your range improved" can only be derived from
   session-level aggregates, not from rep-level detail.
3. **The completed-vs-attempt signal is currently wrong.** `romPct` is averaged across *every*
   tracked feature, including ones the exercise does not move. Measured across seven exercises:

   | Exercise | completed | attempt |
   | --- | --- | --- |
   | CalfRaisesSeated | 3 | 7 |
   | MiniLunges | 2 | 8 |
   | MiniSquats | 4 | 6 |
   | StandingMarch | 2 | 8 |
   | StandingDorsiflexion | 3 | 7 |
   | CalfRaisesStanding | 2 | 8 |
   | WallPushUp | 2 | 8 |

   Features irrelevant to the movement (`handsXNorm` at 2%, `wristHeightNormL` at 14%) drag the
   average below the 70% threshold, so good reps are logged as attempts.

**What already exists and is encouraging:** the backend has `Improvement_<joint>` with an
`avg_last_3` baseline, plus `exercise-aggregate` with `avgLast3` and dated records, and automatic
widening when a patient exceeds their range. **The machinery for day-0 vs day-30 comparison is
built.** It is being fed names it cannot match and a quality metric that is miscomputed.

Fix 1.1, 1.2 and the `romPct` defect and progress notifications become straightforward.

---

## Part 5 — Decisions needed from you or a clinician

| # | Decision | Who |
| --- | --- | --- |
| D1 | The canonical joint-key list (1.1) | Developer — **blocking** |
| D2 | What `side` means for a bilateral exercise, and what each exercise should be | You + clinician |
| D7 | Which joints the Movement Baseline should assess — research compiled in `BASELINE_ASSESSMENT_RESEARCH.md`, needs PT review | Licensed PT |
| D3 | Should `romPct` report the primary feature instead of an average? | You — recommended yes |
| D4 | Clinical sign-off on all 16 safety caps — **none came from research** | Licensed PT |
| D5 | Re-assessment cadence (90 days proposed) and the progress-trigger thresholds | Clinician |
| D6 | Whether to adopt the Movement Baseline architecture | You |

On **D4**, the two most worth a PT's time: `SideArmRaise` (`shoulderAngle max 95` — a real
impingement limit, and the demonstration overshoots it by 4.71°) and `WallPushUp`
(`elbowAngle min 75`, overshoots by 5.84°).

---

## Appendix A — What changed in the pose engine, 2026-10-11 to 14

All verified: **572 tests passing**, bundle compiles clean.

| Change | File | Why |
| --- | --- | --- |
| `kneeLiftNorm` normalised by `torsoLen`, not hip→ankle | `universalFeatures.js` | The old denominator collapsed as the knee rose, double-counting the lift |
| `side: 'both'` resolves its pin to a direction-aware aggregate | `DTWPhaseMachine.js` | `'both'` was dropped entirely; right-arm curls counted nothing |
| Cap breaches named in the rep log; `details` serialised | `DTWPhaseMachine.js` | "cap did not fire" and "cap fired silently" were indistinguishable |
| A breach during a rep is announced at rep end | `DTWPhaseMachine.js` | Breaches flagged reps silently; the warning never reached the patient |
| `BicepCurls` cap `elbowAngle` 40 → 5 | `specToReference.js` | Flagged a full, correct curl — all 10 reps logged as attempts |
| `SeatedMarch` caps 0.45 → 0.70 and 50 → 5 | `specToReference.js` | Both flagged their own reference recording |
| `WallPushUp` `minRomPct` 0.25 → 0.55 | `specToReference.js` | The gate was 22° of a 99° movement; waving the arms counted as reps |
| `checkCameraPitch` added (advisory) | `PoseQuality.js` | Camera **height** was entirely unchecked |
| Captures autosave and survive an abandoned session | `KeypointRecorder.js` | A 9-of-10 run produced no replayable file at all |

**Affects stored data:** the `kneeLiftNorm` change (1.3), and four exercises — `BicepCurls`,
`WallPushUp`, `MiniLunges`, `StepUps` — now resolve to `elbowAngleMin` / `kneeAngleMin` rather than
a sided key.

## Appendix B — Validation status

13 of 16 run on device 2026-10-14. Every session captured a replayable `.jsonl`.

| Tested | Not tested |
| --- | --- |
| SideArmRaise, LiftsAndChops, BicepCurls, SitToStand, LongArcQuad, SeatedDorsiflexion, CalfRaisesSeated, MiniLunges, MiniSquats, StandingMarch, StandingDorsiflexion, CalfRaisesStanding, WallPushUp | **StepUps** (skipped) · **SeatedMarch** (needs re-extraction after 1.3) · **StandingStraightUp** (no reference recorded yet) |

## Appendix C — Scaling beyond 16 exercises

Manual device testing does not scale, and every defect found this round was a **class** bug, not an
instance bug — the `kneeLiftNorm` denominator, the `side: 'both'` handling, the untuned `minRomPct`
default, the cap key expansion. Each affected many exercises at once.

Four tiers, cheapest first:

| Tier | What | Cost |
| --- | --- | --- |
| **0** | Static checks over every reference on every commit — cap resolves to a real feature, primary feature has a usable range, `minRomPct` explicitly set, joint names validate | Free. Would have caught 4 of this round's findings |
| **1** | Synthetic replay — drive each exercise with a generated rep signal | Free |
| **2** | **Recorded replay** — re-run captured real sessions against a changed engine and diff the rep counts. The corpus and the harness entry point already exist | Moderate, highest value |
| **3** | On-device manual — a sample of movement *classes* per release, never a sweep | Expensive |

Per-exercise tuning (`minRomPct`, caps) stays irreducibly per-exercise, but should be **proposed
from the reference recording at authoring time** and approved by a human — not typed in by hand.
That is what makes onboarding 2,000 exercises tractable.
