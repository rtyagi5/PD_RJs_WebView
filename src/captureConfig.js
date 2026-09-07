// ---------------------------------------------
// captureConfig.js
// The one place that decides how many pixels the pose models get to see.
//
// Both detectors resize their own person-ROI before inference — MoveNet crops a
// square on the hip midpoint and resizes to 192x192, BlazePose crops a rotated
// hip-centred ROI and resizes to 256x256 — so the subject fills the model input
// no matter how far away they stand. What the capture resolution decides is
// whether that ROI is DOWNsampled from real pixels or UPsampled from too few.
//
// At 640x480 (Chrome's default when nothing is requested) a seated patient's ROI
// is roughly 200-300px being stretched to 256, i.e. information is invented
// before the model ever runs. That matters most for the four MediaPipe foot
// exercises, where footPitchNorm is a 3-10 pixel vertical difference between the
// two least reliable landmarks in the model.
//
// Live capture and offline reference extraction MUST agree on this number. A
// reference extracted from a 1080p phone recording would otherwise encode
// landmark quality that a live session cannot reproduce, and the template would
// be systematically unreachable — the same class of defect as the LiftsAndChops
// scale mismatch.
// ---------------------------------------------

/**
 * Cap for the OFFLINE reference extractor only. A phone recording is 1080p or
 * more; running pose on it raw would build a template from landmark quality a
 * live session cannot reproduce.
 *
 * This is NOT the live capture size - see VIDEO_CONSTRAINTS below for why the
 * live path deliberately requests nothing.
 */
export const PROCESSING_MAX_WIDTH = 1280;

/**
 * Live webcam constraints: front camera, and NO resolution request.
 *
 * A `width: { ideal: 1280 }` was tried here and had to be reverted. Measured on
 * a Galaxy A36 (Adreno, MoveNet, SideArmRaise) it did two damaging things:
 *
 *  1. The phone answered a width request with 720x1280 PORTRAIT, not a wider
 *     landscape frame - 3x the pixels of the 640x480 default, at an aspect
 *     ratio of 0.56 where the default is 1.33. The frame got NARROWER, which is
 *     the opposite of what the change was for, and an abducted arm now leaves
 *     it sideways.
 *  2. Tripling the per-frame texture upload collapsed the pose rate from the
 *     ~13/s this loop was already tuned to rescue down to 6.6-7.5/s at
 *     120-150ms latency. A rep is then sampled about 7 times, the top of the
 *     raise is missed outright (the primary feature reads NaN during `raised`,
 *     leaving rom=-Infinity), phases thrash, and reps go uncounted.
 *
 * The frame-rate cost is measured; the landmark-quality benefit was theoretical.
 * Every feature is an angle or a ratio, so nothing here is scale-dependent.
 *
 * If the foot exercises later prove to need more pixels, make it per-exercise
 * and pin the aspect ratio explicitly - do NOT reinstate a global width hint.
 */
export const VIDEO_CONSTRAINTS = {
  facingMode: 'user',
};

/**
 * Size a processing canvas for a source of the given dimensions, capped at
 * PROCESSING_MAX_WIDTH and preserving aspect ratio. Never upscales — a source
 * already smaller than the cap is passed through untouched.
 *
 * @param {number} srcW
 * @param {number} srcH
 * @returns {{ width: number, height: number, scaled: boolean }}
 */
export function processingSize(srcW, srcH) {
  const w = Number(srcW) || 0;
  const h = Number(srcH) || 0;
  if (w <= 0 || h <= 0) return { width: 0, height: 0, scaled: false };
  if (w <= PROCESSING_MAX_WIDTH) return { width: w, height: h, scaled: false };

  const scale = PROCESSING_MAX_WIDTH / w;
  return {
    width: PROCESSING_MAX_WIDTH,
    height: Math.max(1, Math.round(h * scale)),
    scaled: true,
  };
}
