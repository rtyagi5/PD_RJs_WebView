// The recorder's output is the substrate every later measurement sits on, so
// these tests are mostly about the file being strictly parseable and the clock
// being real elapsed time rather than a frame index.
import { KeypointRecorder } from '../KeypointRecorder';

/** Drive performance.now() so timing assertions are deterministic. */
function mockClock(startAt = 5000) {
  let t = startAt;
  const spy = jest.spyOn(performance, 'now').mockImplementation(() => t);
  return { advance: (ms) => { t += ms; }, restore: () => spy.mockRestore() };
}

const KPS = [
  { name: 'left_shoulder', x: 412.6789, y: 233.1234, score: 0.87654 },
  { name: 'left_elbow', x: 398.2345, y: 301.5678, score: 0.81234 },
];

function makeRecorder(opts = {}) {
  return new KeypointRecorder({
    exercise: 'SeatedDorsiflexion',
    side: 'left',
    patientId: 'p1',
    detector: 'mediapipe',
    featureKeys: ['footPitchNormL', 'ankleAngleToeL'],
    primaryFeature: 'footPitchNormL',
    videoW: 640,
    videoH: 480,
    ...opts,
  });
}

/** Run a short session and return the raw jsonl text. */
function record(recorder, frames, clock) {
  recorder.start();
  for (const f of frames) {
    recorder.recordFrame(f.kps ?? KPS, f.feat ?? {});
    if (clock) clock.advance(f.dt ?? 33);
  }
  return recorder.finish({ liveRepCount: 4 });
}

describe('file format', () => {
  let clock;
  beforeEach(() => { clock = mockClock(); });
  afterEach(() => clock.restore());

  it('writes a valid header with schema 1 and the required fields', () => {
    const out = record(makeRecorder(), [{}], clock);
    const header = JSON.parse(out.jsonl.split('\n')[0]);

    expect(header.type).toBe('header');
    expect(header.schema).toBe(1);
    for (const field of ['sessionId', 'exercise', 'side', 'patientId', 'detector',
      'modelVariant', 'modelAsset', 'videoW', 'videoH', 'startedAtIso', 'appVersion', 'userAgent']) {
      expect(header).toHaveProperty(field);
    }
    expect(header.exercise).toBe('SeatedDorsiflexion');
    expect(header.videoW).toBe(640);
  });

  it('records the live rep count so a replay has something to be checked against', () => {
    // Without this the harness cannot assert that replay matches live, which is
    // the only thing that makes offline measurement trustworthy.
    const out = record(makeRecorder(), [{}, {}], clock);
    expect(JSON.parse(out.jsonl.split('\n')[0]).liveRepCount).toBe(4);
  });

  it('is true JSONL — every line parses independently', () => {
    const out = record(makeRecorder(), [{}, {}, {}], clock);
    const lines = out.jsonl.trimEnd().split('\n');
    expect(lines.length).toBe(4); // header + 3 frames
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
    // Not a wrapping array, no trailing commas.
    expect(out.jsonl.trimStart().startsWith('[')).toBe(false);
  });

  it('starts at t=0 and never goes backwards', () => {
    const out = record(makeRecorder(), [{ dt: 33 }, { dt: 40 }, { dt: 12 }, { dt: 33 }], clock);
    const ts = out.jsonl.trimEnd().split('\n').slice(1).map(l => JSON.parse(l).t);
    expect(ts[0]).toBe(0);
    for (let i = 1; i < ts.length; i++) {
      expect(ts[i]).toBeGreaterThanOrEqual(ts[i - 1]);
    }
    // Real elapsed ms, not a frame index — the uneven gaps must survive.
    expect(ts).toEqual([0, 33, 73, 85]);
  });

  it('writes keypoints as [name, x, y, score] arrays, rounded', () => {
    const out = record(makeRecorder(), [{}], clock);
    const frame = JSON.parse(out.jsonl.split('\n')[1]);
    expect(Array.isArray(frame.kp)).toBe(true);
    const [name, x, y, score] = frame.kp[0];
    expect(typeof name).toBe('string');
    expect(typeof x).toBe('number');
    expect(typeof y).toBe('number');
    expect(typeof score).toBe('number');
    expect(x).toBe(412.7);   // 1 decimal
    expect(score).toBe(0.877); // 3 decimals
    expect(frame.kp[0]).toHaveLength(4);
  });

  it('records only the exercise metrics plus the primary feature', () => {
    // Dumping all 31 universal features triples the file for no benefit.
    const out = record(makeRecorder(), [{
      feat: { footPitchNormL: 0.118, ankleAngleToeL: 88.4, kneeAngleR: 170, trunkAngleL: 172 },
    }], clock);
    const frame = JSON.parse(out.jsonl.split('\n')[1]);
    expect(Object.keys(frame.feat).sort()).toEqual(['ankleAngleToeL', 'footPitchNormL']);
  });

  it('flags mediapipe confidence as synthetic, and does not for movenet', () => {
    // detectors.js substitutes 1.0 when MediaPipe omits visibility, so a score of
    // 1.0 may never have been measured. Consumers have to be told.
    const mp = record(makeRecorder({ detector: 'mediapipe' }), [{}], clock);
    expect(JSON.parse(mp.jsonl.split('\n')[0]).confidenceIsSynthetic).toBe(true);

    const mn = record(makeRecorder({ detector: 'movenet' }), [{}], clock);
    expect(JSON.parse(mn.jsonl.split('\n')[0]).confidenceIsSynthetic).toBeUndefined();
  });

  it('serialises missing values as null, never as a bare NaN literal', () => {
    // `NaN` is not valid JSON; one such frame makes the line unparseable.
    const out = record(makeRecorder(), [{
      kps: [{ name: 'left_heel', x: NaN, y: undefined, score: NaN }],
      feat: { footPitchNormL: NaN, ankleAngleToeL: 12.5 },
    }], clock);

    expect(out.jsonl).not.toMatch(/NaN/);
    const frame = JSON.parse(out.jsonl.split('\n')[1]);
    expect(frame.kp[0]).toEqual(['left_heel', null, null, null]);
    expect(frame.feat.footPitchNormL).toBeNull();
    expect(frame.feat.ankleAngleToeL).toBe(12.5);
  });

  it('skips keypoints with no name rather than emitting a malformed entry', () => {
    const out = record(makeRecorder(), [{
      kps: [{ x: 1, y: 2, score: 0.5 }, ...KPS],
    }], clock);
    expect(JSON.parse(out.jsonl.split('\n')[1]).kp).toHaveLength(2);
  });
});

describe('failure containment', () => {
  it('does not propagate an internal error into the session loop', () => {
    // A recorder fault must never break an exercise a patient is mid-way through.
    const rec = makeRecorder();
    rec.start();
    const spy = jest.spyOn(JSON, 'stringify').mockImplementation(() => {
      throw new Error('boom');
    });
    expect(() => rec.recordFrame(KPS, {})).not.toThrow();
    spy.mockRestore();

    expect(rec.failed).toBe(true);
    // and it stays disabled rather than throwing again every frame
    expect(() => rec.recordFrame(KPS, {})).not.toThrow();
    expect(rec.finish()).toBeNull();
  });

  it('ignores frames recorded before start()', () => {
    const rec = makeRecorder();
    expect(() => rec.recordFrame(KPS, {})).not.toThrow();
    expect(rec.frameCount).toBe(0);
  });

  it('is idempotent on repeated start()', () => {
    const rec = makeRecorder();
    rec.start();
    const first = rec.startedAtIso;
    rec.start();
    expect(rec.startedAtIso).toBe(first);
    expect(rec.lines).toHaveLength(1);
  });

  it('names the sidecar with the same stem convention as the video recorders', () => {
    const rec = makeRecorder();
    expect(rec.filename()).toMatch(/^session_.+_SeatedDorsiflexion\.jsonl$/);
  });

  it('does not post to the dev server outside development', async () => {
    // NODE_ENV is 'test' here; the guard must hold.
    const rec = makeRecorder();
    rec.start();
    rec.recordFrame(KPS, {});
    await expect(rec.saveToDevServer({ liveRepCount: 1 })).resolves.toBe(false);
  });
});
