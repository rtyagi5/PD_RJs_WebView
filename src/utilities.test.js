// Covers the WebView bridge: what actually reaches the host app, including the
// per-rep ROM summary and the side-resolved angle keys that regressed.
import { sendUpdates, resetSyncState, calculateDistance } from './utilities';

jest.mock('axios', () => ({ post: jest.fn(() => Promise.resolve({ data: {} })) }));

const ACTIVITY = { tenant: 'clinic', activity: 'act-1' };
const noop = () => {};

/** Capture whatever is posted to the parent window (the iframe host path). */
function captureParentMessages() {
  const sent = [];
  window.parent.postMessage = (data) => sent.push(data);
  return sent;
}

beforeEach(() => {
  resetSyncState();
  delete window.ReactNativeWebView;
  jest.clearAllMocks();
});

describe('payload contents', () => {
  it('always includes the core session fields', async () => {
    const sent = captureParentMessages();
    await sendUpdates(
      { fps: 30, repCount: 1, feedback: 'Good', completionStatusRef: false },
      'SideArmRaise', ACTIVITY, noop
    );
    expect(sent[0]).toMatchObject({
      fps: 30, repCount: 1, feedback: 'Good', exerciseType: 'SideArmRaise',
    });
  });

  it('forwards side-resolved angle keys for the exercise', async () => {
    const sent = captureParentMessages();
    await sendUpdates(
      { repCount: 1, feedback: 'Good', shoulderAngleL: 88, elbowAngleL: 170 },
      'SideArmRaise', ACTIVITY, noop
    );
    expect(sent[0].shoulderAngleL).toBe(88);
    expect(sent[0].elbowAngleL).toBe(170);
  });

  it('forwards the right side too when that is the active one', async () => {
    const sent = captureParentMessages();
    await sendUpdates(
      { repCount: 1, feedback: 'Good', shoulderAngleR: 91 },
      'SideArmRaise', ACTIVITY, noop
    );
    expect(sent[0].shoulderAngleR).toBe(91);
  });

  it('drops metrics that do not belong to the exercise', async () => {
    const sent = captureParentMessages();
    await sendUpdates(
      { repCount: 1, feedback: 'Good', shoulderAngleL: 88, footPitchNormL: 0.1 },
      'SideArmRaise', ACTIVITY, noop
    );
    expect(sent[0].shoulderAngleL).toBe(88);
    expect(sent[0].footPitchNormL).toBeUndefined();
  });

  it('forwards the per-rep ROM summary when present', async () => {
    const sent = captureParentMessages();
    const repSummary = { rep: 3, features: { shoulderAngleL: { min: 31, max: 89 } } };
    await sendUpdates(
      { repCount: 3, feedback: '3', repSummary }, 'SideArmRaise', ACTIVITY, noop
    );
    expect(sent[0].repSummary).toEqual(repSummary);
  });

  it('omits repSummary on ordinary frames', async () => {
    const sent = captureParentMessages();
    await sendUpdates({ repCount: 1, feedback: 'Good' }, 'SideArmRaise', ACTIVITY, noop);
    expect(sent[0]).not.toHaveProperty('repSummary');
  });

  it('includes coaching context only when supplied', async () => {
    const sent = captureParentMessages();
    await sendUpdates(
      { repCount: 0, feedback: 'Step back', sessionState: 'coaching', coachingChecks: [] },
      'SideArmRaise', ACTIVITY, noop
    );
    expect(sent[0].sessionState).toBe('coaching');
    expect(sent[0].coachingChecks).toEqual([]);
  });
});

describe('de-duplication', () => {
  it('suppresses an identical rep/feedback pair', async () => {
    const sent = captureParentMessages();
    const payload = { repCount: 1, feedback: 'Good' };
    await sendUpdates(payload, 'SideArmRaise', ACTIVITY, noop);
    await sendUpdates(payload, 'SideArmRaise', ACTIVITY, noop);
    expect(sent).toHaveLength(1);
  });

  it('sends again when the rep count advances', async () => {
    const sent = captureParentMessages();
    await sendUpdates({ repCount: 1, feedback: 'Good' }, 'SideArmRaise', ACTIVITY, noop);
    await sendUpdates({ repCount: 2, feedback: 'Good' }, 'SideArmRaise', ACTIVITY, noop);
    expect(sent).toHaveLength(2);
  });

  it('never suppresses a completion update', async () => {
    const sent = captureParentMessages();
    const payload = { repCount: 5, feedback: 'Done', completionStatusRef: true };
    await sendUpdates(payload, 'SideArmRaise', ACTIVITY, noop);
    await sendUpdates(payload, 'SideArmRaise', ACTIVITY, noop);
    expect(sent).toHaveLength(2);
  });

  it('forgets the cache after a session reset', async () => {
    const sent = captureParentMessages();
    const payload = { repCount: 1, feedback: 'Good' };
    await sendUpdates(payload, 'SideArmRaise', ACTIVITY, noop);
    resetSyncState();
    await sendUpdates(payload, 'SideArmRaise', ACTIVITY, noop);
    expect(sent).toHaveLength(2);
  });
});

describe('delivery channel', () => {
  it('prefers the native WebView bridge when present', async () => {
    const posted = [];
    window.ReactNativeWebView = { postMessage: (s) => posted.push(s) };
    const parentSent = captureParentMessages();

    await sendUpdates({ repCount: 1, feedback: 'Good' }, 'SideArmRaise', ACTIVITY, noop);

    expect(posted).toHaveLength(1);
    expect(JSON.parse(posted[0])).toMatchObject({ repCount: 1 });
    expect(parentSent).toHaveLength(0);
  });

  it('falls back to the parent window when embedded in an iframe', async () => {
    const sent = captureParentMessages();
    await sendUpdates({ repCount: 1, feedback: 'Good' }, 'SideArmRaise', ACTIVITY, noop);
    expect(sent).toHaveLength(1);
  });
});

describe('server sync', () => {
  it('posts accumulated updates only on completion', async () => {
    const axios = require('axios');
    captureParentMessages();

    await sendUpdates({ repCount: 1, feedback: 'Good' }, 'SideArmRaise', ACTIVITY, noop);
    expect(axios.post).not.toHaveBeenCalled();

    await sendUpdates(
      { repCount: 5, feedback: 'Done', completionStatusRef: true },
      'SideArmRaise', ACTIVITY, noop
    );
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  it('reports a sync failure to the user instead of throwing', async () => {
    const axios = require('axios');
    axios.post.mockRejectedValueOnce(new Error('network down'));
    captureParentMessages();
    const messages = [];

    await expect(sendUpdates(
      { repCount: 5, feedback: 'Done', completionStatusRef: true },
      'SideArmRaise', ACTIVITY, (m) => messages.push(m)
    )).resolves.not.toThrow();

    expect(messages.some(m => /fail/i.test(m))).toBe(true);
  });
});

describe('calculateDistance', () => {
  it('measures a 3-4-5 triangle', () => {
    expect(calculateDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it('returns 0 for missing points rather than NaN', () => {
    expect(calculateDistance(null, { x: 3, y: 4 })).toBe(0);
    expect(calculateDistance({ x: 0, y: 0 }, undefined)).toBe(0);
  });
});
