import { SessionStateMachine, SESSION_STATES } from './SessionStateMachine';

const W = 640;
const H = 480;

/**
 * Build a keypoint set that passes all P0 checks: centred, facing front,
 * body filling ~50% of the frame height.
 */
function goodKeypoints({ score = 0.9 } = {}) {
  const cx = W / 2;
  return [
    { name: 'nose', x: cx, y: H * 0.20, score },
    { name: 'left_shoulder', x: cx - 40, y: H * 0.32, score },
    { name: 'right_shoulder', x: cx + 40, y: H * 0.32, score },
    { name: 'left_hip', x: cx - 30, y: H * 0.50, score },
    { name: 'right_hip', x: cx + 30, y: H * 0.50, score },
    { name: 'left_knee', x: cx - 30, y: H * 0.60, score },
    { name: 'right_knee', x: cx + 30, y: H * 0.60, score },
    { name: 'left_ankle', x: cx - 30, y: H * 0.70, score },
    { name: 'right_ankle', x: cx + 30, y: H * 0.70, score },
  ];
}

/** Keypoints too weak to be considered present. */
const invisibleKeypoints = () => goodKeypoints({ score: 0.05 });

function makeSM(opts) {
  return new SessionStateMachine({ name: 'TestExercise' }, opts);
}

/** Step the machine n times, advancing the clock. */
function run(sm, { keypoints, n = 1, startMs = 0, frameMs = 33, engineDone = false } = {}) {
  let last;
  for (let i = 0; i < n; i++) {
    last = sm.step({
      keypoints, frameW: W, frameH: H,
      hasDetector: true, hasVideo: true,
      engineDone, now: startMs + i * frameMs,
    });
  }
  return last;
}

/** Advance from LOADING all the way into ACTIVE. */
function reachActive(sm) {
  run(sm, { keypoints: goodKeypoints(), n: 1, startMs: 0 });            // LOADING → COACHING
  run(sm, { keypoints: goodKeypoints(), n: 60, startMs: 0 });           // stabilise + minCoachingMs
  run(sm, { keypoints: goodKeypoints(), n: 2, startMs: 4000 });         // → COUNTDOWN
  return run(sm, { keypoints: goodKeypoints(), n: 2, startMs: 12000 }); // countdown elapses → ACTIVE
}

describe('state progression', () => {
  it('starts in LOADING', () => {
    expect(makeSM().state).toBe(SESSION_STATES.LOADING);
  });

  it('stays in LOADING until both detector and video are ready', () => {
    const sm = makeSM();
    sm.step({ keypoints: [], frameW: W, frameH: H, hasDetector: false, hasVideo: false, now: 0 });
    expect(sm.state).toBe(SESSION_STATES.LOADING);
  });

  it('moves to COACHING once the detector and video are ready', () => {
    const sm = makeSM();
    const r = run(sm, { keypoints: goodKeypoints() });
    expect(r.state).toBe(SESSION_STATES.COACHING);
  });

  it('does not jump straight to COUNTDOWN on a single good frame', () => {
    const sm = makeSM();
    run(sm, { keypoints: goodKeypoints(), n: 1 });
    const r = run(sm, { keypoints: goodKeypoints(), n: 2, startMs: 33 });
    expect(r.state).toBe(SESSION_STATES.COACHING);
  });

  it('requires both stable frames AND the minimum coaching time', () => {
    // Plenty of good frames, but all within minCoachingMs → still coaching.
    const sm = makeSM();
    run(sm, { keypoints: goodKeypoints(), n: 1 });
    const r = run(sm, { keypoints: goodKeypoints(), n: 60, startMs: 0, frameMs: 1 });
    expect(r.state).toBe(SESSION_STATES.COACHING);
  });

  it('enters COUNTDOWN after stable frames and enough elapsed time', () => {
    const sm = makeSM();
    run(sm, { keypoints: goodKeypoints(), n: 1 });
    run(sm, { keypoints: goodKeypoints(), n: 60, startMs: 0 });
    const r = run(sm, { keypoints: goodKeypoints(), n: 2, startMs: 4000 });
    expect(r.state).toBe(SESSION_STATES.COUNTDOWN);
    expect(r.countdownRemaining).toBeGreaterThan(0);
  });

  it('reaches ACTIVE once the countdown elapses', () => {
    const r = reachActive(makeSM());
    expect(r.state).toBe(SESSION_STATES.ACTIVE);
  });

  it('completes when the engine signals done', () => {
    const sm = makeSM();
    reachActive(sm);
    const r = run(sm, { keypoints: goodKeypoints(), startMs: 20000, engineDone: true });
    expect(r.state).toBe(SESSION_STATES.COMPLETED);
  });

  it('treats COMPLETED as terminal', () => {
    const sm = makeSM();
    reachActive(sm);
    run(sm, { keypoints: goodKeypoints(), startMs: 20000, engineDone: true });
    const r = run(sm, { keypoints: goodKeypoints(), startMs: 21000 });
    expect(r.state).toBe(SESSION_STATES.COMPLETED);
  });
});

describe('countdown hysteresis', () => {
  it('tolerates a brief loss of tracking without dropping back to coaching', () => {
    const sm = makeSM();
    run(sm, { keypoints: goodKeypoints(), n: 1 });
    run(sm, { keypoints: goodKeypoints(), n: 60, startMs: 0 });
    run(sm, { keypoints: goodKeypoints(), n: 2, startMs: 4000 });
    expect(sm.state).toBe(SESSION_STATES.COUNTDOWN);

    // A few bad frames — under countdownBadFramesAllowed — must not cancel it.
    const r = run(sm, { keypoints: invisibleKeypoints(), n: 5, startMs: 4100 });
    expect(r.state).toBe(SESSION_STATES.COUNTDOWN);
  });

  it('falls back to COACHING when tracking is lost for too long', () => {
    const sm = makeSM({ countdownBadFramesAllowed: 3 });
    run(sm, { keypoints: goodKeypoints(), n: 1 });
    run(sm, { keypoints: goodKeypoints(), n: 60, startMs: 0 });
    run(sm, { keypoints: goodKeypoints(), n: 2, startMs: 4000 });
    const r = run(sm, { keypoints: invisibleKeypoints(), n: 10, startMs: 4100 });
    expect(r.state).toBe(SESSION_STATES.COACHING);
  });
});

describe('inactivity handling', () => {
  it('goes INACTIVE after sustained loss of the patient', () => {
    const sm = makeSM();
    reachActive(sm);
    const r = run(sm, { keypoints: invisibleKeypoints(), n: 30, startMs: 20000 });
    expect(r.state).toBe(SESSION_STATES.INACTIVE);
  });

  it('does not go INACTIVE on a couple of dropped frames', () => {
    const sm = makeSM();
    reachActive(sm);
    const r = run(sm, { keypoints: invisibleKeypoints(), n: 3, startMs: 20000 });
    expect(r.state).toBe(SESSION_STATES.ACTIVE);
  });

  it('returns to ACTIVE when the patient comes back', () => {
    const sm = makeSM();
    reachActive(sm);
    run(sm, { keypoints: invisibleKeypoints(), n: 30, startMs: 20000 });
    expect(sm.state).toBe(SESSION_STATES.INACTIVE);
    const r = run(sm, { keypoints: goodKeypoints(), n: 20, startMs: 22000 });
    expect(r.state).toBe(SESSION_STATES.ACTIVE);
  });

  it('falls all the way back to COACHING after a long absence', () => {
    const sm = makeSM();
    reachActive(sm);
    run(sm, { keypoints: invisibleKeypoints(), n: 30, startMs: 20000 });
    const r = run(sm, { keypoints: invisibleKeypoints(), n: 5, startMs: 60000 });
    expect(r.state).toBe(SESSION_STATES.COACHING);
  });
});

describe('reset', () => {
  it('returns the machine to LOADING', () => {
    const sm = makeSM();
    reachActive(sm);
    sm.reset();
    expect(sm.state).toBe(SESSION_STATES.LOADING);
  });

  it('clears the stability counters so coaching must be re-earned', () => {
    const sm = makeSM();
    reachActive(sm);
    sm.reset();
    const r = run(sm, { keypoints: goodKeypoints(), n: 2, startMs: 30000 });
    expect(r.state).toBe(SESSION_STATES.COACHING);
  });
});

describe('coaching messages', () => {
  it('reports no coaching message during ACTIVE (the engine drives feedback there)', () => {
    const sm = makeSM();
    const r = reachActive(sm);
    expect(r.message).toBeFalsy();
  });

  it('surfaces a visibility problem while coaching', () => {
    const sm = makeSM();
    run(sm, { keypoints: goodKeypoints(), n: 1 });
    const r = run(sm, { keypoints: invisibleKeypoints(), n: 2, startMs: 100 });
    expect(r.state).toBe(SESSION_STATES.COACHING);
    expect(typeof r.message).toBe('string');
    expect(r.message.length).toBeGreaterThan(0);
  });

  it('always returns the check list for overlay drawing', () => {
    const sm = makeSM();
    const r = run(sm, { keypoints: goodKeypoints(), n: 2 });
    expect(Array.isArray(r.coachingChecks)).toBe(true);
  });
});

describe('naming the check the patient is blocked on', () => {
  // The host needs to tell a real fault from ambient framing chatter: a named
  // fault is an instruction the session cannot proceed without, and it has to be
  // heard. On device "Turn around so your left side faces the camera" was sent
  // as an ordinary cue, queued behind another, and then dropped for a generic
  // tip - the patient sat in front of a yellow screen for 29 seconds.

  it('names the failing check alongside its message', () => {
    const sm = makeSM();
    run(sm, { keypoints: goodKeypoints(), n: 1 });        // LOADING -> COACHING
    const out = run(sm, { keypoints: invisibleKeypoints(), n: 1, startMs: 100 });
    expect(out.state).toBe(SESSION_STATES.COACHING);
    expect(out.message).toBeTruthy();
    expect(out.blockingCheck).toBe('visibility');
  });

  it('leaves it null when nothing is failing and the message is the fallback', () => {
    const sm = makeSM();
    run(sm, { keypoints: goodKeypoints(), n: 1 });        // LOADING -> COACHING
    const out = run(sm, { keypoints: goodKeypoints(), n: 1, startMs: 100 });
    expect(out.state).toBe(SESSION_STATES.COACHING);
    expect(out.message).toBe('Position yourself in the frame');
    expect(out.blockingCheck).toBeNull();
  });

  it('reports no blocking check once the session is running', () => {
    const sm = makeSM();
    const out = reachActive(sm);
    expect(out.state).toBe(SESSION_STATES.ACTIVE);
    expect(out.blockingCheck).toBeNull();
  });
});
