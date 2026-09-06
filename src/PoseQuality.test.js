import {
  checkDistance, checkCameraAngle, checkVisibility, checkLighting, runAllChecks,
} from './PoseQuality';

const W = 640;
const H = 480;

/**
 * Body spanning `ratio` of the frame height, horizontally centred.
 * IDEAL_BODY_RATIO is 0.50, with 'too close' above 0.70 and 'too far' below 0.20.
 */
function body({ ratio = 0.5, cx = W / 2, score = 0.9, shoulderGap = 80, shoulderTilt = 0 } = {}) {
  const noseY = H * 0.1;
  const ankleY = noseY + H * ratio;
  return [
    { name: 'nose', x: cx, y: noseY, score },
    { name: 'left_shoulder', x: cx - shoulderGap / 2, y: noseY + 60, score },
    { name: 'right_shoulder', x: cx + shoulderGap / 2, y: noseY + 60 + shoulderTilt, score },
    { name: 'left_hip', x: cx - 30, y: (noseY + ankleY) / 2, score },
    { name: 'right_hip', x: cx + 30, y: (noseY + ankleY) / 2, score },
    { name: 'left_ankle', x: cx - 30, y: ankleY, score },
    { name: 'right_ankle', x: cx + 30, y: ankleY, score },
  ];
}

describe('checkDistance', () => {
  it('accepts a well-framed body', () => {
    expect(checkDistance(body({ ratio: 0.5 }), W, H).status).toBe('good');
  });

  it('flags a body filling too much of the frame', () => {
    expect(checkDistance(body({ ratio: 0.85 }), W, H).status).toBe('too_close');
  });

  it('flags a body that is too small in frame', () => {
    expect(checkDistance(body({ ratio: 0.12 }), W, H).status).toBe('too_far');
  });

  it('reports unknown when the nose or ankles are missing', () => {
    const partial = body().filter(k => !k.name.includes('ankle'));
    expect(checkDistance(partial, W, H).status).toBe('unknown');
  });

  it('honours a per-exercise ideal-ratio override', () => {
    // With a much smaller ideal, a 0.5 body reads as too close.
    const res = checkDistance(body({ ratio: 0.5 }), W, H, { idealBodyRatio: 0.2, tolClose: 0.05 });
    expect(res.status).not.toBe('good');
  });
});

describe('checkCameraAngle', () => {
  it('accepts a centred front-facing pose', () => {
    expect(checkCameraAngle(body(), W, H, 'front').status).toBe('good');
  });

  it('flags a body far off to one side', () => {
    expect(checkCameraAngle(body({ cx: W * 0.05 }), W, H, 'front').status).not.toBe('good');
  });

  it('flags a strongly tilted shoulder line', () => {
    expect(checkCameraAngle(body({ shoulderTilt: 90 }), W, H, 'front').status).toBe('tilted');
  });

  it('requires a narrow shoulder span for a side view', () => {
    expect(checkCameraAngle(body({ shoulderGap: 20 }), W, H, 'side').status).toBe('good');
    expect(checkCameraAngle(body({ shoulderGap: 200 }), W, H, 'side').status).toBe('not_side');
  });

  it('requires a mid shoulder span for a diagonal view', () => {
    expect(checkCameraAngle(body({ shoulderGap: 90 }), W, H, 'diagonal').status).toBe('good');
    expect(checkCameraAngle(body({ shoulderGap: 250 }), W, H, 'diagonal').status).toBe('not_diagonal');
  });
});

describe('checkVisibility', () => {
  it('passes when the required keypoints are confident', () => {
    expect(checkVisibility(body()).status).toBe('good');
  });

  it('fails when the required keypoints are low confidence', () => {
    expect(checkVisibility(body({ score: 0.05 })).status).not.toBe('good');
  });

  it('honours a custom required-keypoint list', () => {
    const noAnkles = body().filter(k => !k.name.includes('ankle'));
    expect(checkVisibility(noAnkles, ['left_ankle', 'right_ankle']).status).not.toBe('good');
  });

  it('names the missing body parts in its message', () => {
    const res = checkVisibility(body({ score: 0.05 }));
    expect(typeof res.message).toBe('string');
    expect(res.message.length).toBeGreaterThan(0);
  });
});

describe('checkLighting', () => {
  it('passes with confident keypoints', () => {
    expect(checkLighting(body({ score: 0.9 })).status).toBe('good');
  });

  it('flags uniformly low confidence as poor lighting', () => {
    expect(checkLighting(body({ score: 0.1 })).status).toBe('poor');
  });
});

describe('runAllChecks', () => {
  it('passes everything for a well-positioned patient', () => {
    const { allGood, checks } = runAllChecks(body(), W, H, {});
    expect(allGood).toBe(true);
    expect(checks.length).toBeGreaterThanOrEqual(4);
  });

  it('fails when the patient is out of position', () => {
    expect(runAllChecks(body({ ratio: 0.9 }), W, H, {}).allGood).toBe(false);
  });

  // Lighting is advisory (P2): it is surfaced to the user but must never block the
  // session from starting, since low scores are common for stroke patients.
  it('does not let poor lighting alone block the session', () => {
    // The tracked joints are confident enough to pass the P0 checks, but the
    // frame average is dragged below the lighting threshold by the many
    // peripheral keypoints (face, hands) that the model is unsure about.
    const dim = [
      ...body({ score: 0.45 }),
      ...['left_eye', 'right_eye', 'left_ear', 'right_ear', 'left_elbow', 'right_elbow',
        'left_wrist', 'right_wrist', 'left_knee', 'right_knee'].map(name => ({
        name, x: W / 2, y: H / 2, score: 0.03,
      })),
    ];
    const { allGood, checks } = runAllChecks(dim, W, H, {});
    const lighting = checks.find(c => c.name === 'lighting');
    expect(lighting.status).toBe('poor');
    expect(allGood).toBe(true);
  });

  it('reports a check entry for each dimension', () => {
    const { checks } = runAllChecks(body(), W, H, {});
    const types = checks.map(c => c.name);
    expect(types).toEqual(expect.arrayContaining(['distance', 'angle', 'visibility', 'lighting']));
  });

  it('does not throw on an empty keypoint array', () => {
    expect(() => runAllChecks([], W, H, {})).not.toThrow();
  });
});
