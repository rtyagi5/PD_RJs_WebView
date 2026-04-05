---
name: session-webview
description: Session state machine, WebView postMessage bridge, JWT token handling, coaching overlay. Use when working on SessionStateMachine.js, ExerciseTracker_refactored.js, or App.js.
---
# SKILL: Session State Machine & WebView Communication

> Load this skill when working on `SessionStateMachine.js`, `ExerciseTracker_refactored.js`, `App.js`, `CoachingOverlay.js`, or any code dealing with session lifecycle, WebView integration, or host app communication.

---

## Session State Machine (`SessionStateMachine.js`)

### States and Transitions

```
LOADING ──▶ COACHING ──▶ COUNTDOWN (5s) ──▶ ACTIVE ──▶ COMPLETED
                 ↑                               ↓
                 └──────────── INACTIVE ◀────────┘
                       (keypoints lost >15 frames)
```

| State | Entry Condition | Behavior |
|-------|----------------|---------|
| `LOADING` | Detector not initialized | Show loading spinner; block everything |
| `COACHING` | Detector ready; P0 checks failing | Show coaching overlay; guide user into position |
| `COUNTDOWN` | All P0 checks pass for 3 consecutive seconds | 5-second countdown; start exercise after |
| `ACTIVE` | Countdown complete | Frame pipeline active; reps counted; feedback shown |
| `INACTIVE` | Key keypoints missing >15 frames during ACTIVE | Pause rep counting; show "Return to frame" |
| `COMPLETED` | `repCount >= targetReps` (or time elapsed for time mode) | Send completion to host; no more rep counting |

### P0 Checks (must all pass to enter COUNTDOWN)
- **Distance:** Patient at correct distance from camera
- **Camera angle:** Patient facing camera (shoulders horizontal)
- **Visibility:** Exercise-required keypoints all above confidence threshold

### INACTIVE Guard
During ACTIVE, check every frame whether the exercise's primary keypoints are visible. If missing for more than 15 consecutive frames → transition to INACTIVE. Resume to ACTIVE when keypoints return.

```js
let inactiveFrameCount = 0;
const INACTIVE_THRESHOLD = 15;

if (state === 'ACTIVE') {
  if (!primaryKeypointsVisible(keypoints, exerciseConfig)) {
    inactiveFrameCount++;
    if (inactiveFrameCount >= INACTIVE_THRESHOLD) {
      setState('INACTIVE');
      inactiveFrameCount = 0;
    }
  } else {
    inactiveFrameCount = 0;
  }
}
```

---

## WebView Communication

### Inbound — Host App Passes Exercise via JWT

```
URL: https://app.rehabranger.ai/?token=eyJhbGci...
```

JWT payload (decoded in `App.js` using `jwt-decode`):
```json
{
  "exercise": "SideArmRaise",
  "reps": 10,
  "side": "left",
  "tenant": "clinic_name",
  "activityId": "abc123"
}
```

Fallback (dev mode): read from `.env` when `REACT_APP_DEVELOPMENT_MODE=true`:
```env
REACT_APP_DEFAULT_EXERCISE=StandingMarch
REACT_APP_DEFAULT_REPS=5
REACT_APP_DEFAULT_SIDE=left
```

### Outbound — WebView → Host App

**Every meaningful state transition** (not every frame):

```js
function sendUpdate(data) {
  const message = JSON.stringify({
    fps: currentFps,
    repCount: repCountRef.current,
    feedback: currentFeedback,
    exerciseType: exerciseName,
    completionStatusRef: false,
    sessionState: currentState,
    // Optional: quality, templatePosition, attemptCount
    ...data,
  });

  // Dual-channel: React Native + web iframe
  if (window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(message);
  } else {
    window.parent.postMessage(message, '*');
  }
}
```

**On exercise completion:**
```js
sendUpdate({
  completionStatusRef: true,
  finalRepCount: repCountRef.current,
  completedReps: completedRepCount,
  attemptReps: attemptRepCount,
  sessionDuration: Date.now() - sessionStartTime,
  sessionState: 'COMPLETED',
});
```

### postMessage Throttling Rules

**Never send on every frame.** Always throttle:

```js
// Throttle to state changes only
const lastFeedbackRef = useRef('');
const lastRepCountRef = useRef(0);

function maybeSendUpdate() {
  const feedbackChanged = currentFeedback !== lastFeedbackRef.current;
  const repChanged = repCount !== lastRepCountRef.current;

  if (feedbackChanged || repChanged || sessionStateChanged) {
    sendUpdate({ ... });
    lastFeedbackRef.current = currentFeedback;
    lastRepCountRef.current = repCount;
  }
}
```

---

## Coaching Overlay (`CoachingOverlay.js`)

Draws coaching instructions on the canvas during COACHING and COUNTDOWN states.

```js
// In CoachingOverlay.js
function drawCoachingOverlay(ctx, width, height, message, targetBox) {
  // Draw semi-transparent overlay
  // Draw target box (where patient should stand)
  // Draw coaching text message
}
```

Coaching messages come from `PoseQuality.js` checks — the highest-priority failing check's message is shown.

### Target Box
A dashed rectangle showing the ideal patient position in the frame. Sizes are calibrated based on the exercise:
- Full-body exercises: show nose-to-ankle area
- Upper-body seated: show upper-body area
- No target box during ACTIVE state

---

## App Entry Point (`App.js`)

1. On mount: decode JWT from URL `?token=` param (or read from `.env` in dev mode)
2. Fetch exercise details from backend: `GET https://{tenant}.rehabranger.ai/exercise-service/exercises/{name}`
3. Initialize the correct detector (MoveNet or MediaPipe) based on exercise config
4. Render `<ExerciseTracker_refactored>` with resolved props
5. Handle errors: JWT invalid, exercise not found, detector init failed

### Error Handling Pattern

```js
try {
  const token = new URLSearchParams(window.location.search).get('token');
  const payload = jwtDecode(token);
  setExerciseConfig(payload);
} catch (e) {
  // Fall back to dev defaults, or show error
  if (process.env.REACT_APP_DEVELOPMENT_MODE === 'true') {
    setExerciseConfig({
      exercise: process.env.REACT_APP_DEFAULT_EXERCISE,
      reps: parseInt(process.env.REACT_APP_DEFAULT_REPS),
      side: process.env.REACT_APP_DEFAULT_SIDE,
    });
  } else {
    setError('Invalid or missing exercise token.');
  }
}
```

---

## ExerciseTracker_refactored.js — Key Responsibilities

This is the main orchestration component. It coordinates:

1. **Detection loop** — `requestAnimationFrame` loop calling `detector.estimatePoses()`
2. **Feature extraction** — calls `computeUniversalFeatures()` or `computeFeaturesForExercise()`
3. **EMA smoothing** — smooths features before passing to exercise engine
4. **Engine routing** — `DTWPhaseMachine` if reference exists; `PhaseMachine` otherwise
5. **State transitions** — drives `SessionStateMachine`
6. **Canvas drawing** — calls `drawCanvas()` / `drawSkeleton()` / `drawKeypoints()` from `utilities.js`
7. **HUD update** — rep counter, feedback text, timer overlay
8. **postMessage** — throttled bridge to host app

### Ref vs State Decision Rule

- **`useRef`:** Anything accessed in the frame loop (repCount, currentPhase, sessionState, runningFlag)
- **`useState`:** Anything that triggers a re-render (UI display values, loading states)
- **Pattern:** Track in ref, sync to state on meaningful change

```js
const repCountRef = useRef(0);
const [displayRepCount, setDisplayRepCount] = useState(0);

// In frame loop:
repCountRef.current = newRepCount; // Fast, no re-render

// On rep change:
if (newRepCount !== displayRepCount) {
  setDisplayRepCount(newRepCount); // Trigger re-render for HUD
}
```

---

## Environment Variables Reference

| Variable | Dev Default | Description |
|----------|------------|-------------|
| `REACT_APP_DEVELOPMENT_MODE` | `true` | Bypass JWT; use env defaults |
| `REACT_APP_DEFAULT_EXERCISE` | `StandingMarch` | Exercise to load in dev |
| `REACT_APP_DEFAULT_REPS` | `5` | Target rep count in dev |
| `REACT_APP_DEFAULT_SIDE` | `left` | Active side in dev |
| `REACT_APP_ALLOW_VIDEO_RECORDING` | `false` | Enable `VideoRecorder.js` |
| `REACT_APP_ALLOW_SKELETON_RECORDING` | `false` | Enable `SkeletonRecorder.js` |
| `REACT_APP_TENANT` | `dev` | Backend API tenant slug |

---

## Backend API

Tenant-based endpoint resolution:
```
Exercise Service: https://{tenant}.rehabranger.ai/exercise-service
User Service:     https://{tenant}.rehabranger.ai/user-service
```

Configured in `src/config.js`. Use `axios` (pinned to `1.9.0` — do not upgrade without testing).

---

## Deployment

```bash
yarn build     # Production build
yarn deploy    # Deploy to GitHub Pages (gh-pages)
```

Deployed URL: `https://app.rehabranger.ai` (or GitHub Pages URL).

The app is loaded as a WebView by the host app. Host passes JWT as a URL query parameter.
