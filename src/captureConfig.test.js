import { PROCESSING_MAX_WIDTH, VIDEO_CONSTRAINTS, processingSize } from './captureConfig';
import { extractFeaturesFromVideo } from './dtw/videoFeatureExtractor';

// Both detectors resize their own person-ROI before inference - MoveNet to
// 192x192, BlazePose to 256x256 - so the subject fills the model input however
// far away they stand. What the capture resolution decides is whether that ROI
// is downsampled from real pixels or upsampled from too few. At Chrome's
// 640x480 default a seated patient's ROI is roughly 200-300px stretched to 256,
// which invents detail before the model runs.
//
// The same number has to govern offline reference extraction, or a template
// built from a 1080p phone recording encodes landmark quality a live session
// cannot reproduce - systematically unreachable, the same class of defect as
// the open LiftsAndChops scale mismatch.

describe('capture constraints', () => {
  it('asks the camera for a real resolution', () => {
    // Previously the only constraint was facingMode, so Chrome returned 640x480.
    expect(VIDEO_CONSTRAINTS.width).toEqual({ ideal: PROCESSING_MAX_WIDTH });
  });

  it('asks as an ideal, not an exact', () => {
    // `exact` makes getUserMedia fail outright on a device that cannot comply,
    // which would lose the camera rather than lower the resolution.
    expect(VIDEO_CONSTRAINTS.width.exact).toBeUndefined();
  });

  it('does not constrain height', () => {
    // Constraining both would push most phones from 4:3 to 16:9, changing the
    // vertical field of view and with it checkDistance's bodyHeight / frameH -
    // a hard P0 gate. Width alone raises resolution at a fixed aspect ratio.
    expect(VIDEO_CONSTRAINTS.height).toBeUndefined();
    expect(VIDEO_CONSTRAINTS.aspectRatio).toBeUndefined();
  });

  it('keeps the front camera', () => {
    expect(VIDEO_CONSTRAINTS.facingMode).toBe('user');
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
