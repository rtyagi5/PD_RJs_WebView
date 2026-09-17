import {
  checkDistance, checkCameraAngle, checkCameraRoll, checkVisibility, checkLighting,
  checkFootTracking, runAllChecks, CHECK_PRIORITY,
} from './PoseQuality';
import { drawTargetBox } from './CoachingOverlay';

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

// ─── Camera roll ─────────────────────────────────────────────────────────────
// Angle features are three-point angles and so are invariant to image rotation.
// The normalized HEIGHT features are not: they take a raw vertical difference
// and only normalize the magnitude, so they assume the image y-axis points along
// gravity. A tilted phone therefore fabricates signal in footPitchNorm and
// kneeLiftNorm while leaving kneeAngle untouched — which is why roll needs its
// own check rather than riding on the camera-angle one.

/** Body rotated bodily about the frame centre, i.e. what a rolled camera sees. */
function rolledBody(deg, opts = {}) {
  const rad = (deg * Math.PI) / 180;
  const cx = W / 2;
  const cy = H / 2;
  return body(opts).map(k => {
    const dx = k.x - cx;
    const dy = k.y - cy;
    return {
      ...k,
      x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
      y: cy + dx * Math.sin(rad) + dy * Math.cos(rad),
    };
  });
}

describe('checkCameraRoll', () => {
  it('accepts a level camera in every view', () => {
    for (const view of ['front', 'side', 'diagonal']) {
      expect(checkCameraRoll(body(), view).status).toBe('good');
    }
  });

  it('measures roll off the shoulder line when facing the camera', () => {
    const res = checkCameraRoll(rolledBody(20), 'front');
    expect(res.reference).toBe('shoulders');
    expect(res.rollDeg).toBeCloseTo(20, 0);
    expect(res.status).toBe('rolled');
  });

  it('measures roll off the trunk axis in a side view', () => {
    // The decisive case. Shoulders foreshorten to almost nothing side-on, so the
    // shoulder line is degenerate and this used to go completely unchecked.
    const res = checkCameraRoll(rolledBody(20, { shoulderGap: 8 }), 'side');
    expect(res.reference).toBe('trunk');
    expect(res.rollDeg).toBeCloseTo(20, 0);
    expect(res.status).toBe('rolled');
  });

  it('catches a tilt in a side view that the camera-angle check passes', () => {
    // checkCameraAngle only tests shoulder separation for a side view, so a
    // rolled phone looks perfectly fine to it.
    const tilted = rolledBody(20, { shoulderGap: 8 });
    expect(checkCameraAngle(tilted, W, H, 'side').status).toBe('good');
    expect(checkCameraRoll(tilted, 'side').status).toBe('rolled');
  });

  it('honours a per-exercise limit', () => {
    const tilted = rolledBody(10, { shoulderGap: 8 });
    expect(checkCameraRoll(tilted, 'side').status).toBe('good');            // 12 default
    expect(checkCameraRoll(tilted, 'side', { maxRollDeg: 8 }).status).toBe('rolled');
  });

  it('reports unknown rather than blocking when the body is not visible', () => {
    expect(checkCameraRoll([], 'side').status).toBe('unknown');
  });

  it('names both possible causes, since one view cannot tell them apart', () => {
    // A rolled camera and a leaning patient are indistinguishable from a single
    // 2D view, so the message must not assert either.
    expect(checkCameraRoll(rolledBody(25), 'front').message).toMatch(/camera|straighten/i);
  });
});

describe('roll gates the session', () => {
  it('blocks a rolled setup even when everything else is fine', () => {
    const spec = { framing: { view: 'side' } };
    const level = runAllChecks(body({ shoulderGap: 8 }), W, H, spec);
    const tilted = runAllChecks(rolledBody(20, { shoulderGap: 8 }), W, H, spec);
    expect(level.allGood).toBe(true);
    expect(tilted.allGood).toBe(false);
    expect(tilted.checks.find(c => c.name === 'roll').status).toBe('rolled');
  });

  it('reports roll as its own check dimension', () => {
    const res = runAllChecks(body(), W, H, { framing: { view: 'front' } });
    expect(res.checks.map(c => c.name)).toContain('roll');
  });

  it('does not block when roll cannot be judged', () => {
    // Missing keypoints are the visibility check's job to reject, not this one.
    const res = checkCameraRoll([{ name: 'nose', x: 1, y: 1, score: 0.9 }], 'side');
    expect(res.status).toBe('unknown');
  });
});

// ─── Foot tracking ───────────────────────────────────────────────────────────
// The four foot exercises are measured entirely from heel and foot_index, and
// nothing verified either was being tracked. checkVisibility could not do it:
// it requires EVERY listed keypoint, which is unsatisfiable side-on where the
// far foot is occluded, and it tests `score`, which the MediaPipe wrapper fills
// in as a synthetic 1.0 whenever the model omits visibility. So a presence test
// on foot keypoints passed even when the landmarks were nonsense.
//
// The geometric test is what carries the weight: MediaPipe routinely latches
// onto a vertical chair leg and smears heel and foot_index along it, which
// blows heel-toe span far past any real foot. Catching that during coaching
// lets the patient move the chair before the set instead of discovering it as
// false reps afterwards.

const SHANK = 80;

/** Body plus a complete foot on one side. `spanRatio` is heel-toe over shank. */
function bodyWithFoot({ side = 'left', spanRatio = 0.65, ...rest } = {}) {
  const kps = body(rest);
  const ankle = kps.find(k => k.name === `${side}_ankle`);
  const kneeY = ankle.y - SHANK;
  return [
    ...kps,
    { name: `${side}_knee`, x: ankle.x, y: kneeY, score: 1.0 },
    { name: `${side}_heel`, x: ankle.x, y: ankle.y, score: 1.0 },
    { name: `${side}_foot_index`, x: ankle.x + SHANK * spanRatio, y: ankle.y, score: 1.0 },
  ];
}

const FOOT_SPEC = { framing: { view: 'side', requireFoot: true, maxRollDeg: 8 } };

/** Knee and ankle tracked, but the foot itself unresolved - the chair-leg case. */
function legWithoutFoot({ side = 'left' } = {}) {
  const kps = body();
  const ankle = kps.find(k => k.name === `${side}_ankle`);
  return [
    ...kps,
    { name: `${side}_knee`, x: ankle.x, y: ankle.y - SHANK, score: 0.95 },
    { name: `${side}_heel`, x: ankle.x, y: ankle.y, score: 0.05 },
    { name: `${side}_foot_index`, x: ankle.x, y: ankle.y, score: 0.05 },
  ];
}


describe('telling a lost foot from a lost patient', () => {
  // "Make sure your whole foot is in view" is the right thing to say when the
  // patient is out of shot, and useless when they are sitting correctly and the
  // detector is losing the foot against a chair leg. The two have different
  // fixes, so they need different instructions - the leg being tracked while the
  // foot is not is what separates them.

  it('asks the patient to clear the chair legs when the leg tracks but the foot does not', () => {
    const out = checkFootTracking(legWithoutFoot({ side: 'left' }), {
      ...FOOT_SPEC.framing, side: 'left',
    });
    expect(out.status).toBe('foot_obscured');
    expect(out.message).toMatch(/chair legs/i);
    expect(out.message).toMatch(/left/);
  });

  it('still asks for framing when the leg is not tracked either', () => {
    const out = checkFootTracking(body(), { ...FOOT_SPEC.framing, side: 'left' });
    expect(out.status).toBe('no_foot');
    expect(out.message).toMatch(/in view/i);
  });

  it('does not fire when the foot is tracked normally', () => {
    const out = checkFootTracking(bodyWithFoot({ side: 'left' }), {
      ...FOOT_SPEC.framing, side: 'left',
    });
    expect(out.status).toBe('good');
  });
});

describe('checkFootTracking', () => {
  it('passes straight through for exercises that do not declare requireFoot', () => {
    // The twelve MoveNet exercises have no heel or foot_index at all - COCO-17
    // stops at the ankle - so this must be opt-in or it rejects all of them.
    expect(checkFootTracking(body(), {}).status).toBe('good');
    expect(checkFootTracking([], {}).status).toBe('good');
  });

  it('accepts one plausibly-tracked foot', () => {
    const res = checkFootTracking(bodyWithFoot(), { requireFoot: true });
    expect(res.status).toBe('good');
    expect(res.side).toBe('left');
    expect(res.spanRatio).toBeCloseTo(0.65, 2);
  });

  it('accepts a single foot side-on, where the far one is occluded', () => {
    // The decisive case against using checkVisibility for this: requiring both
    // heels can never be satisfied in the side view all four exercises use.
    const oneFoot = bodyWithFoot({ side: 'left' });
    expect(oneFoot.some(k => k.name === 'right_heel')).toBe(false);
    expect(checkFootTracking(oneFoot, { requireFoot: true }).status).toBe('good');
  });

  it('rejects a foot smeared down a chair leg', () => {
    // 1.4 x shank is not a foot. A real one is 60-70%.
    const res = checkFootTracking(bodyWithFoot({ spanRatio: 1.4 }), { requireFoot: true });
    expect(res.status).toBe('implausible');
    expect(res.message).toMatch(/chair/i);
  });

  it('rejects when no complete foot is present', () => {
    const res = checkFootTracking(body(), { requireFoot: true });
    expect(res.status).toBe('no_foot');
    expect(res.message).toMatch(/foot/i);
  });

  it('is not fooled by the synthetic confidence MediaPipe reports', () => {
    // Every foot keypoint carries score 1.0 here, exactly as the live wrapper
    // emits. A confidence-based check would call this good.
    const latched = bodyWithFoot({ spanRatio: 1.4 });
    expect(latched.filter(k => k.name.includes('foot') || k.name.includes('heel'))
      .every(k => k.score === 1.0)).toBe(true);
    expect(checkVisibility(latched).status).toBe('good');
    expect(checkFootTracking(latched, { requireFoot: true }).status).toBe('implausible');
  });

  it('honours a per-exercise span ceiling', () => {
    const foot = bodyWithFoot({ spanRatio: 0.85 });
    expect(checkFootTracking(foot, { requireFoot: true }).status).toBe('good');
    expect(checkFootTracking(foot, { requireFoot: true, footSpanMaxRatio: 0.7 }).status)
      .toBe('implausible');
  });

  it('takes the good foot when one side is latched and the other is clean', () => {
    const left = bodyWithFoot({ side: 'left', spanRatio: 0.65 });
    const ankleR = left.find(k => k.name === 'right_ankle');
    const both = [
      ...left,
      { name: 'right_knee', x: ankleR.x, y: ankleR.y - SHANK, score: 1.0 },
      { name: 'right_heel', x: ankleR.x, y: ankleR.y, score: 1.0 },
      { name: 'right_foot_index', x: ankleR.x, y: ankleR.y + SHANK * 1.4, score: 1.0 },
    ];
    expect(checkFootTracking(both, { requireFoot: true }).status).toBe('good');
  });
});

describe('foot tracking gates the session', () => {
  it('blocks a foot exercise when no foot is visible', () => {
    const res = runAllChecks(body({ shoulderGap: 8 }), W, H, FOOT_SPEC);
    expect(res.allGood).toBe(false);
    expect(res.checks.find(c => c.name === 'foot').status).toBe('no_foot');
  });

  it('lets the same setup through once a foot is tracked', () => {
    const res = runAllChecks(bodyWithFoot({ shoulderGap: 8 }), W, H, FOOT_SPEC);
    expect(res.checks.find(c => c.name === 'foot').status).toBe('good');
    expect(res.allGood).toBe(true);
  });

  it('does not gate the exercises that never declare it', () => {
    // Regression guard: adding a P0 check must not quietly break the other 12.
    const res = runAllChecks(body(), W, H, { framing: { view: 'front' } });
    expect(res.checks.find(c => c.name === 'foot').status).toBe('good');
    expect(res.allGood).toBe(true);
  });

  it('reports foot as its own check dimension and ranks it early', () => {
    const res = runAllChecks(body(), W, H, FOOT_SPEC);
    expect(res.checks.map(c => c.name)).toContain('foot');
    expect(CHECK_PRIORITY.indexOf('foot')).toBeLessThan(CHECK_PRIORITY.indexOf('distance'));
  });
});

describe('drawTargetBox agrees with checkDistance', () => {
  it('scales the box with the ratio it is given', () => {
    // The box used to be hardcoded at 0.60 of frame height whatever ratio was
    // passed, so it coached seated patients (target 0.45) into a position the
    // distance check then rejected.
    const heights = [];
    const ctx = {
      save: () => {}, restore: () => {}, fillRect: () => {}, setLineDash: () => {},
      beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, stroke: () => {},
      strokeRect: (x, y, w, h) => heights.push(h),
    };
    drawTargetBox(ctx, W, H, 0.45, '#fff');
    drawTargetBox(ctx, W, H, 0.60, '#fff');
    expect(heights[0]).toBeCloseTo(H * 0.45, 5);
    expect(heights[1]).toBeCloseTo(H * 0.60, 5);
  });
});

// ─── The foot gate must check the foot being MEASURED ────────────────────────
// Measured on device during SeatedDorsiflexion: the patient sat side-on with
// their right toward the camera while the activity was configured for 'left'.
// Right tracked at 0.98 confidence and satisfied the gate; left - the far,
// occluded foot - was at 0.65, and the engine counted ten reps off it. The
// session looked clean and was measuring a limb the model could barely see.

describe('checkFootTracking side selection', () => {
  /** knee/ankle/heel/toe for one side, with a plausible foot span. */
  function foot(side, { score = 0.9, x = 100 } = {}) {
    return [
      { name: `${side}_knee`,       x, y: 100, score },
      { name: `${side}_ankle`,      x, y: 180, score },
      { name: `${side}_heel`,       x: x - 5, y: 190, score },
      { name: `${side}_foot_index`, x: x + 30, y: 188, score },
    ];
  }

  const opts = { requireFoot: true };

  it('refuses when the measured foot is missing, however good the other is', () => {
    const kps = foot('right', { score: 0.98 });
    const res = checkFootTracking(kps, { ...opts, side: 'left' });
    expect(res.status).toBe('no_foot');
    expect(res.message).toContain('left');
  });

  it('passes when the measured foot is the one that is visible', () => {
    const kps = foot('left', { score: 0.9 });
    expect(checkFootTracking(kps, { ...opts, side: 'left' }).status).toBe('good');
  });

  it('names the side so the patient knows which foot to move', () => {
    const kps = [...foot('right', { score: 0.98 }), ...foot('left', { score: 0.1 })];
    const res = checkFootTracking(kps, { ...opts, side: 'left' });
    expect(res.message).toContain('left');
    expect(res.message).not.toContain('right');
  });

  it('still accepts either foot when no side is specified', () => {
    // Bilateral exercises keep the old behaviour.
    const kps = foot('right', { score: 0.9 });
    expect(checkFootTracking(kps, opts).status).toBe('good');
  });

  it('does not let the other foot mask an implausible measured one', () => {
    // A foot span wider than the shank means the keypoints have latched onto
    // something that is not a foot - a chair leg, typically.
    const bad = [
      { name: 'left_knee',       x: 100, y: 100, score: 0.9 },
      { name: 'left_ankle',      x: 100, y: 120, score: 0.9 },
      { name: 'left_heel',       x: 60,  y: 125, score: 0.9 },
      { name: 'left_foot_index', x: 200, y: 125, score: 0.9 },
    ];
    const kps = [...foot('right', { score: 0.98 }), ...bad];
    const res = checkFootTracking(kps, { ...opts, side: 'left' });
    expect(res.status).toBe('implausible');
    expect(res.side).toBe('left');
  });
});

// ─── Facing the wrong way round ──────────────────────────────────────────────
// Presence is not enough to tell a near limb from a far one. MediaPipe scores a
// keypoint 1.0 whenever it omits `visibility`, so heel and foot_index are always
// "present", and MIN_CONFIDENCE of 0.3 happily passes a knee at 0.43. Measured
// on device with the patient sitting right-side-on and the activity set to
// 'left': kneeL=0.43 kneeR=0.99, ankleL=0.48 ankleR=0.96. Every gate passed and
// six reps were counted off the occluded leg.

describe('checkFootTracking wrong-side detection', () => {
  function leg(side, score) {
    return [
      { name: `${side}_knee`,       x: 100, y: 100, score },
      { name: `${side}_ankle`,      x: 100, y: 180, score },
      { name: `${side}_heel`,       x: 95,  y: 190, score: 1.0 },
      { name: `${side}_foot_index`, x: 130, y: 188, score: 1.0 },
    ];
  }
  const sideView = { requireFoot: true, view: 'side' };

  it('tells the patient to turn round when measuring the far limb', () => {
    const kps = [...leg('left', 0.45), ...leg('right', 0.98)];
    const res = checkFootTracking(kps, { ...sideView, side: 'left' });
    expect(res.status).toBe('wrong_side');
    expect(res.message).toContain('left');
    expect(res.message).toMatch(/turn/i);
  });

  it('is happy when the measured limb is the near one', () => {
    const kps = [...leg('left', 0.45), ...leg('right', 0.98)];
    expect(checkFootTracking(kps, { ...sideView, side: 'right' }).status).toBe('good');
  });

  it('does not fire when both limbs track well', () => {
    // Front-on, or a side view with an unusually visible far leg.
    const kps = [...leg('left', 0.93), ...leg('right', 0.96)];
    expect(checkFootTracking(kps, { ...sideView, side: 'left' }).status).toBe('good');
  });

  it('only applies to side-view exercises', () => {
    // In a front view a confidence gap means something else, and telling the
    // patient to turn round would be wrong.
    const kps = [...leg('left', 0.45), ...leg('right', 0.98)];
    const res = checkFootTracking(kps, { requireFoot: true, side: 'left' });
    expect(res.status).not.toBe('wrong_side');
  });

  it('does not fire on a small confidence difference', () => {
    const kps = [...leg('left', 0.74), ...leg('right', 0.84)];
    expect(checkFootTracking(kps, { ...sideView, side: 'left' }).status).toBe('good');
  });
});
