# Hand-off: three defects outside the pose engine

**No code has been changed for any of these.** Each is self-contained — send the relevant
section to whoever owns that repo.

Found 2026-10-14 during an on-device test round (13 exercises, Galaxy A36, `com.rehabranger.app.dev`).

| # | Defect | Owner | Severity |
| --- | --- | --- | --- |
| 1 | Grey screen on every app launch | **mobile-app** | High — it looks broken to every patient |
| 2 | Exercise videos fail to play | **rehab-backend** | High — and it is burning S3 bandwidth and server memory |
| 3 | Every session runs as `side=left`, whatever the exercise says | **cross-repo** | High — the engine watches the wrong limb |

---

## 1. Grey screen on launch — `mobile-app`

### What the patient sees

A blank dark-grey screen for several seconds on every cold start. No spinner, no logo, no error.
It eventually resolves to the exercise list on its own, or after a force-stop and relaunch.

### Root cause: a `finally` that also runs on an early return

`src/navigation/stack/GeneralRoutes.js`:

```js
const checkAppInitialization = async () => {
  try {
    if (loading) {
      return;              // auth is still working — come back later
    }
    ...
    setInitialRoute(route);
  } catch (error) {
    console.error('Error checking app initialization:', error);
  } finally {
    setIsLoading(false);   // ← ALSO runs on the early return above
  }
};
```

JavaScript runs `finally` on a `return` inside `try`. So while `AuthContext` is still loading, this
effect bails out early **but still sets `isLoading = false`**, leaving `initialRoute` as `null`.

The render then has nothing to show:

```jsx
<LoadingIndicator isLoading={isLoading} />            // false  -> returns null
{!isLoading && initialRoute && <Stack.Navigator …>}   // true && null -> renders nothing
```

Neither branch renders. The result is a bare root view — the grey screen. It only recovers when
auth finishes, the effect re-runs, and `initialRoute` is finally set.

### Why it happens on *every* launch

`src/components/API/AuthContext.js` fails its first authenticated call every time. From the device
log:

```
LOG   Running "PatientApp" with {"rootTag":11}
LOG   onboardingStatus: true
ERROR Failed to load token, user data, or onboarding status [AxiosError: Request failed with status code 401]
```

The stored token is rejected with a **401**, and the app then silently re-authenticates from saved
credentials. So every cold start runs, serially:

1. Keychain read (onboarding status)
2. Keychain read (token)
3. **network round trip** → 401
4. Keychain read (credentials)
5. **second network round trip** → `generateToken()`

Two remote round trips before anything can paint. That is what makes the blank window long enough
to look like a crash.

### A second, related bug in the same file

```js
token = await getToken();
if (token) {
  setUserToken(token);                                  // set BEFORE it is validated
  const response = await getRequest(ENDPOINTS.GET_USER_DETAIL);
  setUserData(response.data);                           // never runs on 401
}
} catch (e) {
  console.error('Failed to load token, user data, or onboarding status', e);
  const credentials = await getCredentials();
  if (credentials && credentials.email && credentials.password) {
    await generateToken();
  }
}
```

`setUserToken(token)` is called before the token is validated, and the 401 handler **never clears
it**. The app holds a token it has just been told is invalid. If no email/password happen to be
stored, there is no recovery at all and no route to the login screen — just the grey screen.

### Suggested fixes, in priority order

| | Change | Effect |
| --- | --- | --- |
| **1** | Move `setIsLoading(false)` out of the `finally` so the early return does not claim loading finished | **Removes the blank screen on its own** |
| **2** | Render the loading indicator whenever `initialRoute` is null, so no state renders nothing | Belt and braces — no blank state is reachable |
| **3** | Clear the token (and `userToken` state) on a 401 instead of keeping a rejected one | Correctness; also lets the router fall through to `SignIn` properly |
| **4** | Do not block first paint on a network call — paint from cached user data and refresh in the background | Removes the two serial round trips from the startup path |

1 and 2 are a few lines and fix what the patient sees. 3 and 4 are the underlying design.

> Worth checking separately: **why the token is 401 on every launch.** If `JWT_EXPIRY_TIME` is short,
> patients are being silently re-authenticated constantly. Note the backend never verifies JWT
> signatures (it uses `jwt.decode`, not `jwt.verify`), so a 401 here is most likely genuine expiry.

---

## 2. Exercise videos fail to play — `rehab-backend`

### What the patient sees

The demo video on the exercise page fails with a playback error.

### The device error

```
ExoPlaybackException: Source error
  Caused by: HttpDataSource$HttpDataSourceException:
    okhttp3.internal.http2.StreamResetException: stream was reset: INTERNAL_ERROR
      at androidx.media3.extractor.mp4.Mp4Extractor.readSample(Mp4Extractor.java:980)
```

The failure is **mid-file** (`readSample`), not at connect — the download starts and is then cut off.

### Reproduced off-device, so this is not a mobile bug

Three full GETs of the same URL from a laptop, against a true `Content-Length` of **4,194,920**:

```
try1: got=396259  status=200
try2: got=100271  status=200
try3: got=587395  status=200
```

Every one truncates, at a different point. Ranged requests are worse:

```
range 0-524287        -> got=100271  status=206
range 2097152-2621439 -> got=0       status=206
range 3670016-4194919 -> got=0       status=206
```

**Mid-file range requests return zero bytes.** A video player relies entirely on ranged requests, so
this alone makes playback impossible.

### Root cause

`packages/users/src/modules/files/service.ts`, `getFile()`:

```ts
const data = await s3.getObject(downloadParams).promise();   // whole file into memory
const stream = new StreamableFile(data.Body as Buffer);
res.setHeader("Content-Length", data.ContentLength);
res.setHeader("Accept-Ranges", "bytes");                     // ← advertised, not implemented
stream.getStream().pipe(res);
```

Three defects in six lines:

1. **`Accept-Ranges: bytes` is a lie.** The handler never reads the `Range` request header. Every
   request triggers a full `getObject`, and the response is the whole buffer — so a player asking
   for a middle chunk gets something it cannot use. This is the one that actually breaks playback.
2. **The entire file is buffered into Node memory** before a byte is sent. One of these videos is
   **50,593,389 bytes (48 MB)** — that is 48 MB of heap per concurrent request, per cluster worker.
3. **No stream error handling.** If the pipe breaks the response simply ends short, which is exactly
   the truncation measured above.

Response headers add two more problems:

```
last-modified: Thu, 15 Oct 2026 02:09:15 GMT    <- set to NOW on every request
cf-cache-status: MISS                            <- therefore never cached
Cache-Control: max-age=14400
X-RateLimit-Limit: 100  X-RateLimit-Remaining: 93
```

`last-modified` is the current time rather than the object's real mtime, so Cloudflare cannot
validate a cached copy — `cf-cache-status` is **MISS on every request**. Every play re-fetches the
whole file from S3 through the Node process. There is also a **rate limiter** on this route, which a
player issuing many ranged requests could trip.

### Suggested fix

**Preferred: stop proxying the bytes.** Have `GET /user-service/files/*` return a **302 to a
presigned S3 URL** (or put CloudFront in front of the bucket). S3 implements ranges correctly,
handles caching, and takes 48 MB transfers out of the API process entirely. This removes all four
problems at once.

If the proxy must stay:
- honour the `Range` header, reply `206` with `Content-Range`, and use `s3.getObject({ Range })`
- stream the S3 body (`.createReadStream()`), never `.promise()` into a Buffer
- handle `error` on both streams
- set `last-modified` from the S3 object's `LastModified`, and an `ETag`, so Cloudflare can cache

**Separately: the video files are far too large for mobile.** 48 MB for a demo clip of a side arm
raise is not reasonable over cellular. 2–5 MB re-encodes would fix the user experience even before
the server work.

| Video | Content-Length |
| --- | --- |
| `Video_RightSideArmRaise.mp4` | 50,593,389 (48 MB) |
| `Video_SeatedMarches.mp4` | 4,194,920 (4.0 MB) |
| `Video_StandingStraightUp.mp4` | 3,508,713 (3.3 MB) |

---

## 3. Every session runs as `side=left` — cross-repo

### The evidence

All 13 captures from the test round, read from their own headers:

```
SideArmRaise          side=left   primary=shoulderAngleL
LiftsAndChops         side=left   primary=handsHeightNorm
BicepCurls            side=left   primary=elbowAngleMin
SitToStand            side=left   primary=kneeAngleL
LongArcQuad           side=left   primary=kneeAngleL
SeatedDorsiflexion    side=left   primary=ankleAngleToeL
CalfRaisesSeated      side=left   primary=ankleAngleToeL
MiniLunges            side=left   primary=kneeAngleMin
MiniSquats            side=left   primary=kneeAngleMin
StandingMarch         side=left   primary=hipAngleMin
StandingDorsiflexion  side=left   primary=ankleAngleToeL
CalfRaisesStanding    side=left   primary=ankleAngleToeL
WallPushUp            side=left   primary=elbowAngleMin
```

**Every single one.** And the programme's first exercise is displayed in the app as
**"Side Arm Raise (Right)"**, with the demo video `Video_RightSideArmRaise.mp4` — a right-side
exercise that ran as `side=left`.

### Why

The exercise record carries no `side`, so the backend correctly omits the claim, and the pose app
invents one:

```ts
// rehab-backend — activities/exercise/service.ts:120
if (!tokenData?.side) { delete tokenData.side; }
```
```js
// Posedetection_ReactJS_WebView — src/App.js:71
setSide(sideFromURL ?? "left");
```

### Consequence, confirmed on device

For any exercise whose primary feature is sided (`kneeAngleL`, `shoulderAngleL`, `ankleAngleToeL`),
**only the left limb is measured.** Performing the exercise on the right produces no reps at all.
That is exactly what was observed on `LongArcQuad`: the left leg counted, the right did nothing.

Note which exercises are immune, and why: `BicepCurls`, `MiniLunges`, `MiniSquats`, `WallPushUp` all
resolve to a `*Min` aggregate, so either limb registers. The sided ones do not.

### This is the open decision already written up

Full analysis, the three-layer ownership split, and the options are in
[NOTES.md](NOTES.md#1-what-should-side-mean-for-a-bilateral-exercise). The test round turns it from
a theory into a measured fact: **the side encoded in the exercise name is not reaching the engine,
and the engine is defaulting to the opposite limb.**

Shortest path to stopping the harm, pending the full decision: set `side` explicitly on every
exercise record that is sided, so the default never fires.
