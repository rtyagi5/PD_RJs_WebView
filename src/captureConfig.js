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
 * Target width for anything we run pose detection on.
 *
 * Requested as `ideal` rather than `exact` so a device that cannot deliver it
 * degrades instead of failing getUserMedia outright.
 *
 * Deliberately width-only: constraining height too would push most phones from
 * 4:3 to 16:9, which changes the vertical field of view and therefore
 * PoseQuality.checkDistance's `bodyHeight / frameH` ratio — a hard P0 gate.
 */
export const PROCESSING_MAX_WIDTH = 1280;

/** Live webcam constraints. Front camera, and enough pixels to be worth having. */
export const VIDEO_CONSTRAINTS = {
  facingMode: 'user',
  width: { ideal: PROCESSING_MAX_WIDTH },
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
