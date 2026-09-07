import { PROCESSING_MAX_WIDTH, VIDEO_CONSTRAINTS, processingSize } from './captureConfig';
import { extractFeaturesFromVideo } from './dtw/videoFeatureExtractor';

// PROCESSING_MAX_WIDTH governs the OFFLINE reference extractor only: a template
// built from a raw 1080p phone recording encodes landmark quality a live session
// cannot reproduce - systematically unreachable, the same class of defect as the
// open LiftsAndChops scale mismatch.
//
// The LIVE path deliberately requests no resolution at all. Asking for one was
// tried and measured on a Galaxy A36: the phone answered `width: {ideal: 1280}`
// with 720x1280 PORTRAIT - 3x the pixels of the 640x480 default and a NARROWER
// frame (aspect 0.56 vs 1.33) - which collapsed the pose rate to 6.6-7.5/s at
// 120-150ms latency. At that rate the top of a raise is never sampled: the
// primary feature reads NaN through the `raised` phase, rom goes to -Infinity,
// phases thrash and reps go uncounted. These tests exist to stop that returning.

describe('capture constraints', () => {
  it('requests no resolution, so the browser keeps its cheap default', () => {
    // The regression this pins: a width hint made the phone hand back a portrait
    // frame at 3x the pixel cost, and pose inference could no longer keep up
    // with the movement it was measuring.
    expect(VIDEO_CONSTRAINTS.width).toBeUndefined();
    expect(VIDEO_CONSTRAINTS.height).toBeUndefined();
    expect(VIDEO_CONSTRAINTS.aspectRatio).toBeUndefined();
    expect(VIDEO_CONSTRAINTS.frameRate).toBeUndefined();
  });

  it('keeps the front camera', () => {
    expect(VIDEO_CONSTRAINTS.facingMode).toBe('user');
  });

  it('constrains nothing but the camera to use', () => {
    // Any future key here changes what the phone negotiates, and the negotiated
    // format is what decides whether the engine can see the top of a rep.
    expect(Object.keys(VIDEO_CONSTRAINTS)).toEqual(['facingMode']);
  });

  it('keeps the extractor cap independent of the live path', () => {
    // They were briefly the same number. Re-coupling them would drag the live
    // regression back in the next time the extractor cap is tuned.
    expect(PROCESSING_MAX_WIDTH).toBe(1280);
    expect(VIDEO_CONSTRAINTS.width).toBeUndefined();
  });
});

describe('processingSize', () => {
  it('caps a large source at the processing width', () => {
    expect(processingSize(1920, 1080)).toEqual({ width: 1280, height: 720, scaled: true });
  });

  it('preserves aspect ratio when it caps', () => {
    const { width, height } = processingSize(4032, 3024); // a 4:3 phone capture
    expect(width / height).toBeCloseTo(4 / 3, 2);
  });

  it('never upscales a source that is already smaller', () => {
    // Upscaling would cost time and add nothing: the pixels are not there.
    expect(processingSize(640, 480)).toEqual({ width: 640, height: 480, scaled: false });
  });

  it('passes a source at exactly the cap through untouched', () => {
    expect(processingSize(1280, 720)).toEqual({ width: 1280, height: 720, scaled: false });
  });

  it('handles a portrait source', () => {
    expect(processingSize(2160, 3840)).toEqual({ width: 1280, height: 2276, scaled: true });
  });

  it('returns zeroes rather than NaN for a video with no dimensions yet', () => {
    // videoWidth is 0 until metadata loads; a NaN canvas size would throw.
    expect(processingSize(0, 0)).toEqual({ width: 0, height: 0, scaled: false });
    expect(processingSize(undefined, undefined)).toEqual({ width: 0, height: 0, scaled: false });
  });
});

describe('the extractor runs at the capped size', () => {
  let canvases;

  function fakeVideo(w, h, duration = 0.2) {
    return {
      videoWidth: w, videoHeight: h, duration, readyState: 4,
      seeking: false, currentTime: 0,
      addEventListener: () => {}, removeEventListener: () => {},
    };
  }

  beforeEach(() => {
    canvases = [];
    jest.spyOn(document, 'createElement').mockImplementation(tag => {
      if (tag !== 'canvas') return {};
      const c = {
        width: 0, height: 0,
        getContext: () => ({ drawImage: () => {} }),
      };
      canvases.push(c);
      return c;
    });
  });

  afterEach(() => jest.restoreAllMocks());

  /** Records what the detector was actually handed. */
  function spyDetector() {
    const seen = [];
    return {
      seen,
      estimatePoses: async (input) => {
        seen.push(input);
        return [{ keypoints: [] }];
      },
    };
  }

  it('hands the detector the canvas, not the video element', async () => {
    // This is the whole fix. The canvas was already being created and drawn
    // into, but estimatePoses was called on videoEl, so the drawImage was dead
    // code and the cap did nothing.
    const video = fakeVideo(1920, 1080);
    const det = spyDetector();
    await extractFeaturesFromVideo(video, det, { fps: 10 });

    expect(det.seen.length).toBeGreaterThan(0);
    for (const input of det.seen) {
      expect(input).toBe(canvases[0]);
      expect(input).not.toBe(video);
    }
  });

  it('sizes that canvas to the processing width', async () => {
    const video = fakeVideo(1920, 1080);
    await extractFeaturesFromVideo(video, spyDetector(), { fps: 10 });
    expect(canvases[0].width).toBe(PROCESSING_MAX_WIDTH);
    expect(canvases[0].height).toBe(720);
  });

  it('matches a live session recorded at the cap', async () => {
    // A 1080p reference and a 1280-wide live session must end up processing at
    // the same size, or the template is built from better landmarks than the
    // patient can ever produce.
    await extractFeaturesFromVideo(fakeVideo(1920, 1080), spyDetector(), { fps: 10 });
    const fromPhone = { width: canvases[0].width, height: canvases[0].height };

    canvases = [];
    await extractFeaturesFromVideo(fakeVideo(1280, 720), spyDetector(), { fps: 10 });
    const fromLive = { width: canvases[0].width, height: canvases[0].height };

    expect(fromPhone).toEqual(fromLive);
  });

  it('leaves an already-small source alone', async () => {
    await extractFeaturesFromVideo(fakeVideo(640, 480), spyDetector(), { fps: 10 });
    expect(canvases[0].width).toBe(640);
    expect(canvases[0].height).toBe(480);
  });
});
