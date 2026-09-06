# Baseline & session sync — API contract

**Status:** specification only. None of these endpoints exist yet.
**Client side:** `src/dtw/BaselineStore.js` defines the interface. `LocalBaselineStore` is
implemented and in use; `SyncedBaselineStore` is declared and throws until this contract is built.

## Why this exists

Patient baselines are currently `localStorage`-only. A patient who switches phones, clears their
browser, or uses a shared tablet loses their baseline — and because the old failure path was a
silent `catch`, they were simply re-baselined against a different starting point. Every progress
number after that is wrong and nothing surfaces it.

The client half of that problem is fixed: `BaselineStore` now reports `ok | empty | unavailable |
corrupt`, and `PatientBaseline.storageFailed()` lets a session be marked uncalibrated rather than
silently falling back. The other half needs a server.

## Architecture

```
write  ->  localStorage (immediately, always)  ->  outbox queue  ->  server
read   ->  server (if online and fresher)      ->  else localStorage  ->  else fallback chain
```

`localStorage` is a cache and write-ahead buffer. **The server is the system of record.** Inference
runs on-device and a session must never depend on connectivity, so the local write always happens
first and always succeeds from the patient's point of view.

## Endpoints

Exact shape is the backend owner's call; these are the required capabilities.

```
GET  /api/v1/patients/:id/baseline
     -> { protocolBaseline, exerciseBaselines[], updatedAt, version }

PUT  /api/v1/patients/:id/baseline
     body: { protocolBaseline | exerciseBaseline, capturedAt, quality,
             clientVersion, schema, ifUnmodifiedSince: <updatedAt> }
     -> 200 with new updatedAt, or 409 on conflict

POST /api/v1/sessions
     body: { clientId (uuid), patientId, exercise, side, startedAt, endedAt,
             reps[], summary, deviceInfo, appVersion }
     -> { sessionId }

POST /api/v1/sessions/:id/recording
     multipart or presigned S3 PUT for the gzipped .jsonl keypoint sidecar
```

### Reusing the existing pipe instead

The app already POSTs to `${EXERCISE_SERVICE}/activities/exercise-data` (`src/utilities.js:115`)
carrying `repSummary`, `completedReps`, `attemptedReps` and `completionRate`. If adding four
endpoints is not worth it, the session-summary half of this contract can ride that payload. The
baseline half cannot — baselines are read at session *start*, keyed by patient rather than activity,
and must outlive any single activity record.

## Hard requirements

1. **Idempotency.** Every write carries a client-generated UUID (`clientId`). A retried upload must
   not create a duplicate session or double-count reps. This is the most common failure mode in
   offline-first sync — design for it now, not after the first duplicate-rep support ticket.
2. **Conflict resolution, explicitly chosen.** Two devices can both write a baseline. Rule:
   **most recent `capturedAt` wins for baselines**, and **never silently merge ranges** — a merged
   range belongs to no real capture. Return 409 and let the client re-read. Document whatever rule
   is chosen; do not arrive at last-write-wins by accident.
3. **Schema versioning.** Every persisted object carries `schema: <int>`. The server rejects unknown
   future versions rather than storing them half-understood. Clients must read older schemas.
4. **Outbox with retry.** Failed writes queue locally and retry with backoff on next app open. Cap
   the queue and log drops. The patient never sees a sync error mid-session.
5. **No silent degradation.** If a baseline can be neither read locally nor fetched, the session
   falls back explicitly and the UI must show it as uncalibrated. It must not use a template gate
   while displaying baseline-relative progress. *(Client side of this is done.)*
6. **Clock skew.** `updatedAt` is server time. Device clocks are wrong often enough to corrupt
   "most recent wins".
7. **Migration.** Existing patients have baselines under `dtw_baseline_<patientId>_<exerciseName>`.
   On first run after deploy, upload any local baseline with no server counterpart exactly once,
   then treat the server as authoritative. Write this before the deploy.
8. **PHI.** Baselines and session telemetry are health data tied to a patient identifier. Encrypt in
   transit and at rest, scope by tenant server-side (not just client-side — `REACT_APP_TENANT`
   already exists but is client-supplied), and confirm retention with whoever owns compliance.

## Keypoint recordings

Produced by `src/KeypointRecorder.js`. ~1,800 frames x ~21 keypoints = 2-4 MB raw, ~200-400 KB
gzipped per 60s session. Gzip client-side.

- Blob to object storage; **pointer + header metadata only** in Mongo. Never store per-frame arrays
  as Mongo documents — the 16MB document limit and query performance both suffer.
- Upload after session completion, never during. Inference must not compete with a network write.
- Retention: suggest 90 days. This is a debugging asset, not a permanent clinical record.
- **Consent is a launch blocker.** Joint coordinates are more privacy-preserving than the existing
  video path — no face, no room — but confirm the consent language covers keypoint capture and
  retention before any patient session is used for engineering analysis.
- A per-patient opt-out must be honoured client-side, before recording starts.
