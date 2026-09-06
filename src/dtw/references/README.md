# Recorded DTW references

Drop a `*.ref.json` here and it is auto-discovered at startup by `index.js`
(webpack `require.context`) and registered by `bootstrapReferences.js`.

Two things must hold for a file here to actually be used:

1. **Its `name` must be the canonical `EXERCISE_CONFIGS` key** — `SideArmRaise`,
   not `Left Side Arm Raise`. Lookups go through `getReference(exerciseType)`
   with the canonical key. A mismatch is caught and warned about at startup.
2. **Its phase labels must separate the start posture from the effort posture**
   on the feature the engine gates on. Checked by
   `referenceHealth.checkPhaseSeparation()`; a failure is warned about and the
   synthetic template is kept.

Confirm what is actually driving a session with the startup log:

```
[Engine] DTW mode for <exercise> — reference source: SYNTHETIC | VIDEO | API
```

`SYNTHETIC` means no recording is in use.

## Current state: 0 of 16 exercises run on a recorded reference

`Left Side Arm Raise.ref.json` is the only recording present, and it is **not**
loaded. It fails both conditions above.

### Why it was not simply renamed

The obvious fix — re-key it to `SideArmRaise` — was measured first, and it would
have broken the exercise. From its own template:

| Phase | frames | `shoulderAngleL` mean | min | max |
| --- | --- | --- | --- | --- |
| `lowered` (repCycle start) | 30 | **92.4** | 90.1 | 93.8 |
| `raised` (repCycle effort) | 30 | 55.3 | **21.4** | **93.9** |

Two problems:

- The `lowered` phase sits at ~92°, i.e. the arm is **up**. The synthetic
  convention is `lowered` = 30°, `raised` = 90°.
- The `raised` phase spans the entire 21–94° sweep rather than the top of it,
  which is the signature of a mis-segmented recording: the effort phase has
  swallowed the whole movement.

`DTWPhaseMachine` derives `refStartValue` from the mean of the start-phase
frames and `templateDirection` from `sign(refEffortValue - refStartValue)`. With
this file registered:

- `refStartValue` becomes **92.4** instead of 30, so `_primaryFeatureNearStart`
  would require the arm to be near 92° to open *or* close a rep;
- `templateDirection` becomes **−1**, so the direction gate in `step()` would
  reject *raising* the arm as wrong-direction motion and only accept lowering.

The result is an exercise that counts nothing while every log looks healthy —
strictly worse than the synthetic template it would replace.

### What would fix it

Re-record and re-export from `/reference-extractor` with correct phase
boundaries, then re-key to `SideArmRaise`. `checkPhaseSeparation` will accept it
once `lowered` and `raised` are actually distinct postures.

Note the division of labour: a recorded reference supplies **phase shape** — the
ordering and relative proportions of a movement, which generalise across bodies.
It must **not** supply ROM magnitudes, which do not generalise (one person's
shoulder range is not a stroke survivor's). Magnitudes come from the patient
baseline via `romGate.js`. Conflating the two is the design error that made
limited-ROM reps uncountable in the first place.
