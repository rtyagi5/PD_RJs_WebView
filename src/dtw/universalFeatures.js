// ---------------------------------------------
// dtw/universalFeatures.js
// Universal feature extractor — computes ALL body measurements every frame.
// One function for every exercise. DTW decides which features matter.
// ---------------------------------------------
import { angle, distance, kp, present } from '../features.js';

/**
 * Compute a comprehensive feature vector from raw keypoints.
 * All angles are in degrees (0-180). All normalized values are unitless.
 * Returns NaN for any feature whose required keypoints are missing/low-confidence.
 *
 * @param {Array} kps - Array of keypoint objects { name, x, y, score }
 * @returns {Object} feature vector with 30 named features (see UNIVERSAL_FEATURE_KEYS)
 */
/**
 * Strip the side / aggregate suffix from a universal feature key, so keys can be
 * compared as a family: footPitchNormL -> footPitchNorm, kneeAngleMin -> kneeAngle.
 *
 * Needed wherever features are ranked or matched, because the key set mixes
 * degrees with dimensionless ratios and a naive comparison of raw ranges lets a
 * 100-degree elbow beat a 0.17 foot-pitch every time.
 */
export function stripSideSuffix(key) {
  return String(key).replace(/(L|R|Min|Max|Avg)$/, '');
}

export function computeUniversalFeatures(kps) {
  // --- Lookup keypoints ---
  const Ls  = kp(kps, 'left_shoulder');  const Rs  = kp(kps, 'right_shoulder');
  const Le  = kp(kps, 'left_elbow');     const Re  = kp(kps, 'right_elbow');
  const Lw  = kp(kps, 'left_wrist');     const Rw  = kp(kps, 'right_wrist');
  const Lh  = kp(kps, 'left_hip');       const Rh  = kp(kps, 'right_hip');
  const Lk  = kp(kps, 'left_knee');      const Rk  = kp(kps, 'right_knee');
  const La  = kp(kps, 'left_ankle');     const Ra  = kp(kps, 'right_ankle');
  // MediaPipe-only (heel + foot_index); gracefully NaN for MoveNet
  const Lhe = kp(kps, 'left_heel');      const Rhe = kp(kps, 'right_heel');
  const Lfi = kp(kps, 'left_foot_index');const Rfi = kp(kps, 'right_foot_index');

  const P = present;
  const A = angle;
  const D = distance;
  const fin = Number.isFinite;

  // --- Per-side joint angles ---
  // 1. Shoulder angle (hip → shoulder → elbow)
  const shoulderAngleL = (P(Lh) && P(Ls) && P(Le)) ? A(Lh, Ls, Le) : NaN;
  const shoulderAngleR = (P(Rh) && P(Rs) && P(Re)) ? A(Rh, Rs, Re) : NaN;

  // 2. Elbow angle (shoulder → elbow → wrist)
  const elbowAngleL = (P(Ls) && P(Le) && P(Lw)) ? A(Ls, Le, Lw) : NaN;
  const elbowAngleR = (P(Rs) && P(Re) && P(Rw)) ? A(Rs, Re, Rw) : NaN;

  // 3. Hip flexion angle (shoulder → hip → knee)
  const hipAngleL = (P(Ls) && P(Lh) && P(Lk)) ? A(Ls, Lh, Lk) : NaN;
  const hipAngleR = (P(Rs) && P(Rh) && P(Rk)) ? A(Rs, Rh, Rk) : NaN;

  // 4. Knee angle (hip → knee → ankle)
  const kneeAngleL = (P(Lh) && P(Lk) && P(La)) ? A(Lh, Lk, La) : NaN;
  const kneeAngleR = (P(Rh) && P(Rk) && P(Ra)) ? A(Rh, Rk, Ra) : NaN;

  // 5. Trunk angle (shoulder → hip → ankle)  — posture indicator
  const trunkAngleL = (P(Ls) && P(Lh) && P(La)) ? A(Ls, Lh, La) : NaN;
  const trunkAngleR = (P(Rs) && P(Rh) && P(Ra)) ? A(Rs, Rh, Ra) : NaN;

  // --- Reference lengths for normalization (moved up so foot-keypoint sanity check can use them) ---
  const torsoLenL = (P(Ls) && P(Lh)) ? Math.max(D(Ls, Lh), 1e-6) : NaN;
  const torsoLenR = (P(Rs) && P(Rh)) ? Math.max(D(Rs, Rh), 1e-6) : NaN;
  const torsoLen  = avgFinite([torsoLenL, torsoLenR]);

  const shankLenL = (P(Lk) && P(La)) ? Math.max(D(Lk, La), 1e-6) : NaN;
  const shankLenR = (P(Rk) && P(Ra)) ? Math.max(D(Rk, Ra), 1e-6) : NaN;

  // Foot-keypoint sanity check: heel↔foot_index distance should be at most ~90% of shank length.
  // When MediaPipe latches onto a chair leg / vertical background line, heel & foot_index get
  // smeared along it and the heel-toe distance balloons. Invalidate foot-derived features
  // (ankleAngleToe/Heel, footPitchNorm) for that frame so chair-leg hallucinations don't
  // produce false reps. 0.9 is generous — a real foot is typically 60-70% of shank length.
  const footSpanL = (P(Lhe) && P(Lfi)) ? D(Lhe, Lfi) : NaN;
  const footSpanR = (P(Rhe) && P(Rfi)) ? D(Rhe, Rfi) : NaN;
  const footValidL = fin(footSpanL) && fin(shankLenL) && footSpanL <= shankLenL * 0.9;
  const footValidR = fin(footSpanR) && fin(shankLenR) && footSpanR <= shankLenR * 0.9;

  // 6. Ankle-toe angle (knee → ankle → foot_index)  — calf raises
  const ankleAngleToeL  = (P(Lk) && P(La) && P(Lfi) && footValidL) ? A(Lk, La, Lfi) : NaN;
  const ankleAngleToeR  = (P(Rk) && P(Ra) && P(Rfi) && footValidR) ? A(Rk, Ra, Rfi) : NaN;

  // 7. Ankle-heel angle (knee → ankle → heel)
  const ankleAngleHeelL = (P(Lk) && P(La) && P(Lhe) && footValidL) ? A(Lk, La, Lhe) : NaN;
  const ankleAngleHeelR = (P(Rk) && P(Ra) && P(Rhe) && footValidR) ? A(Rk, Ra, Rhe) : NaN;

  // 10. Foot pitch (toe.y - heel.y) / shank  — dorsiflexion
  // Also gated by footValid so chair-leg hallucinations don't produce false dorsiflexion reps.
  const footPitchNormL = (P(Lfi) && P(Lhe) && fin(shankLenL) && footValidL)
    ? (Lfi.y - Lhe.y) / shankLenL : NaN;
  const footPitchNormR = (P(Rfi) && P(Rhe) && fin(shankLenR) && footValidR)
    ? (Rfi.y - Rhe.y) / shankLenR : NaN;

  const hipAnkleLenL = (P(Lh) && P(La)) ? Math.max(D(Lh, La), 1e-6) : NaN;
  const hipAnkleLenR = (P(Rh) && P(Ra)) ? Math.max(D(Rh, Ra), 1e-6) : NaN;

  // --- Normalized heights ---
  // 8. Wrist height (0 = at hip, 1 = at shoulder, >1 = above shoulder)
  const midHip = (P(Lh) && P(Rh)) ? { x: (Lh.x + Rh.x) / 2, y: (Lh.y + Rh.y) / 2 } : (P(Lh) ? Lh : (P(Rh) ? Rh : null));
  const wristHeightNormL = (P(Lw) && midHip && fin(torsoLen))
    ? (midHip.y - Lw.y) / torsoLen : NaN;
  const wristHeightNormR = (P(Rw) && midHip && fin(torsoLen))
    ? (midHip.y - Rw.y) / torsoLen : NaN;

  // 9. Knee lift (0 = at rest, >0 = knee rising)  — marches
  //
  // Normalised by torsoLen, NOT by the hip->ankle distance. The normaliser is
  // meant to be a body-size reference so the ratio is comparable between people
  // and camera distances - but hip->ankle is a POSE distance, not a body
  // dimension: the leg folds as the knee comes up, so that distance collapses by
  // the same movement the numerator is measuring. The denominator shrank while
  // the numerator grew, and the ratio double-counted the lift.
  //
  // Measured on device during a seated march (the [Features] log below printed
  // the normaliser all along):
  //   20:27:31.707  kneeLiftL=0.000  hipAnkLenL=131   <- resting
  //   20:27:32.825  kneeLiftL=0.834  hipAnkLenL=59    <- peak lift
  // The normaliser more than halved at the top of the lift. Held at its resting
  // value that rep reads 0.834 * 59/130 = 0.379 - inside even the original 0.45
  // cap. Every cap breach in that session was the denominator, not the patient:
  // ten reps were logged as `attempt` and the safety cue fired on all of them.
  // A low camera amplified it (the extended leg foreshortens more, so resting
  // hipAnkLen inflates relative to the lifted one), which is why the same march
  // counted correctly with the phone at table height and over-triggered on the
  // floor - but the coupling is the root cause and it is present at every height.
  //
  // torsoLen (shoulder->hip) is independent of what the legs are doing, and is
  // already the normaliser for hipToAnkleNorm and wristHeightNorm, so this also
  // makes the family consistent. It is not projection-proof - camera pitch
  // foreshortens the torso too - but it no longer moves WITH the exercise.
  //
  // Scale changed, so every kneeLiftNorm number authored against the old feature
  // is stale: the march references must be re-extracted and their caps re-derived.
  const kneeLiftNormL = (P(Lh) && P(Lk) && fin(torsoLen))
    ? Math.max(0, Lh.y - Lk.y) / torsoLen : NaN;
  const kneeLiftNormR = (P(Rh) && P(Rk) && fin(torsoLen))
    ? Math.max(0, Rh.y - Rk.y) / torsoLen : NaN;

  // Diagnostic: log lower-body keypoint confidence (throttled)
  if (!computeUniversalFeatures._fc) computeUniversalFeatures._fc = 0;
  if (++computeUniversalFeatures._fc % 60 === 0) {
    const aLS = La?.score?.toFixed(2) ?? 'x';
    const aRS = Ra?.score?.toFixed(2) ?? 'x';
    const kLS = Lk?.score?.toFixed(2) ?? 'x';
    const kRS = Rk?.score?.toFixed(2) ?? 'x';
    const hLS = Lh?.score?.toFixed(2) ?? 'x';
    const hRS = Rh?.score?.toFixed(2) ?? 'x';
    console.log(
      `[Features] hipL=${hLS} hipR=${hRS} kneeL=${kLS} kneeR=${kRS} ankleL=${aLS} ankleR=${aRS}` +
      ` | kneeLiftL=${fin(kneeLiftNormL) ? kneeLiftNormL.toFixed(3) : 'NaN'}` +
      ` kneeLiftR=${fin(kneeLiftNormR) ? kneeLiftNormR.toFixed(3) : 'NaN'}` +
      ` torsoLen=${fin(torsoLen) ? torsoLen.toFixed(0) : 'NaN'}` +
      ` hipAnkLenL=${fin(hipAnkleLenL) ? hipAnkleLenL.toFixed(0) : 'NaN'}` +
      ` hipAnkLenR=${fin(hipAnkleLenR) ? hipAnkleLenR.toFixed(0) : 'NaN'}` +
      ` hipAngleL=${fin(hipAngleL) ? hipAngleL.toFixed(0) : 'NaN'}` +
      ` hipAngleR=${fin(hipAngleR) ? hipAngleR.toFixed(0) : 'NaN'}` +
      // Knee angle and ankle-toe angle are the two numbers that say what POSTURE
      // the patient is in, as opposed to how well they are being tracked. The
      // SeatedDorsiflexion reference was demonstrated at a knee of 97-110deg -
      // a slightly extended leg, not a right angle - and footPitchNorm is a raw
      // image-space ratio, so sitting differently moves the signal without
      // moving the ankle. Without these logged, a patient changing posture
      // mid-set is indistinguishable from a patient whose ankle stopped moving.
      ` kneeAngleL=${fin(kneeAngleL) ? kneeAngleL.toFixed(0) : 'NaN'}` +
      ` kneeAngleR=${fin(kneeAngleR) ? kneeAngleR.toFixed(0) : 'NaN'}` +
      ` ankToeL=${fin(ankleAngleToeL) ? ankleAngleToeL.toFixed(0) : 'NaN'}` +
      ` ankToeR=${fin(ankleAngleToeR) ? ankleAngleToeR.toFixed(0) : 'NaN'}` +
      // Standing dorsiflexion is the one case where these two features are not
      // interchangeable. Leaning forward over a planted foot rotates the shank
      // on the foot, which IS ankle dorsiflexion — ankToe cannot tell it from a
      // toe lift. Only the foot's pitch in the image says whether the forefoot
      // actually left the floor. Log both, or a sway set and a real set are
      // indistinguishable after the fact.
      ` footPitchL=${fin(footPitchNormL) ? footPitchNormL.toFixed(3) : 'NaN'}` +
      ` footPitchR=${fin(footPitchNormR) ? footPitchNormR.toFixed(3) : 'NaN'}` +
      // The whole line was lower-body, so an arm exercise logged nothing that
      // described the arms. A BicepCurls set that appeared to count both arms
      // could not be diagnosed at all: which elbow actually moved is exactly
      // the question, and nothing recorded it.
      ` | elbowL=${fin(elbowAngleL) ? elbowAngleL.toFixed(0) : 'NaN'}` +
      ` elbowR=${fin(elbowAngleR) ? elbowAngleR.toFixed(0) : 'NaN'}` +
      ` shoulderL=${fin(shoulderAngleL) ? shoulderAngleL.toFixed(0) : 'NaN'}` +
      ` shoulderR=${fin(shoulderAngleR) ? shoulderAngleR.toFixed(0) : 'NaN'}` +
      ` wristL=${fin(wristHeightNormL) ? wristHeightNormL.toFixed(2) : 'NaN'}` +
      ` wristR=${fin(wristHeightNormR) ? wristHeightNormR.toFixed(2) : 'NaN'}`
    );
  }

  // --- Aggregate / bilateral features ---
  // 11. Hands height (centroid of both wrists relative to hip, normalized by torso)
  const midShoulder = (P(Ls) && P(Rs)) ? { x: (Ls.x + Rs.x) / 2, y: (Ls.y + Rs.y) / 2 } : null;
  const shoulderWidth = (P(Ls) && P(Rs)) ? D(Ls, Rs) : NaN;

  let handsCentroid = null;
  if (P(Lw) && P(Rw)) handsCentroid = { x: (Lw.x + Rw.x) / 2, y: (Lw.y + Rw.y) / 2 };
  else if (P(Lw)) handsCentroid = Lw;
  else if (P(Rw)) handsCentroid = Rw;

  const handsHeightNorm = (handsCentroid && midHip && fin(torsoLen))
    ? Math.max(0, midHip.y - handsCentroid.y) / torsoLen : NaN;

  // 12. Hands horizontal offset (+ = right of center, − = left) normalized by shoulder width
  const handsXNorm = (handsCentroid && midShoulder && fin(shoulderWidth))
    ? (handsCentroid.x - midShoulder.x) / Math.max(shoulderWidth, 1e-6) : NaN;

  // 13. Hip-to-ankle normalized distance (for sit-to-stand / long arc quad)
  const hipToAnkleNormL = (P(Lh) && P(La) && fin(torsoLen))
    ? D(Lh, La) / torsoLen : NaN;
  const hipToAnkleNormR = (P(Rh) && P(Ra) && fin(torsoLen))
    ? D(Rh, Ra) / torsoLen : NaN;

  // --- Min/Max aggregates (useful for bilateral exercises) ---
  const minF = (a, b) => {
    if (fin(a) && fin(b)) return Math.min(a, b);
    return fin(a) ? a : (fin(b) ? b : NaN);
  };
  const maxF = (a, b) => {
    if (fin(a) && fin(b)) return Math.max(a, b);
    return fin(a) ? a : (fin(b) ? b : NaN);
  };

  return {
    // Joint angles (per side)
    shoulderAngleL, shoulderAngleR,
    elbowAngleL, elbowAngleR,
    hipAngleL, hipAngleR,
    kneeAngleL, kneeAngleR,
    trunkAngleL, trunkAngleR,
    ankleAngleToeL, ankleAngleToeR,
    ankleAngleHeelL, ankleAngleHeelR,

    // Normalized positions (per side)
    wristHeightNormL, wristHeightNormR,
    kneeLiftNormL, kneeLiftNormR,
    footPitchNormL, footPitchNormR,
    hipToAnkleNormL, hipToAnkleNormR,

    // Bilateral aggregates
    handsHeightNorm,
    handsXNorm,

    // Min/max aggregates
    shoulderAngleMin: minF(shoulderAngleL, shoulderAngleR),
    elbowAngleMin: minF(elbowAngleL, elbowAngleR),
    hipAngleMin: minF(hipAngleL, hipAngleR),
    kneeAngleMin: minF(kneeAngleL, kneeAngleR),
    trunkAngleMin: minF(trunkAngleL, trunkAngleR),
    kneeLiftNormMax: maxF(kneeLiftNormL, kneeLiftNormR),
    footPitchNormAvg: avgFinite([footPitchNormL, footPitchNormR]),
  };
}

/**
 * List of all feature keys produced by computeUniversalFeatures.
 * Used by the DTW engine to know which features to compare.
 */
export const UNIVERSAL_FEATURE_KEYS = [
  'shoulderAngleL', 'shoulderAngleR',
  'elbowAngleL', 'elbowAngleR',
  'hipAngleL', 'hipAngleR',
  'kneeAngleL', 'kneeAngleR',
  'trunkAngleL', 'trunkAngleR',
  'ankleAngleToeL', 'ankleAngleToeR',
  'ankleAngleHeelL', 'ankleAngleHeelR',
  'wristHeightNormL', 'wristHeightNormR',
  'kneeLiftNormL', 'kneeLiftNormR',
  'footPitchNormL', 'footPitchNormR',
  'hipToAnkleNormL', 'hipToAnkleNormR',
  'handsHeightNorm', 'handsXNorm',
  'shoulderAngleMin', 'elbowAngleMin', 'hipAngleMin',
  'kneeAngleMin', 'trunkAngleMin',
  'kneeLiftNormMax', 'footPitchNormAvg',
];

/**
 * Body-part name → feature keys mapping.
 * Used by the feedback system: PT says "back" → system watches trunkAngle features.
 */
/**
 * Features whose value depends on which way round the image is.
 *
 * Almost the whole feature set is invariant under a horizontal mirror: every
 * three-point angle is unchanged by reflection, and the normalized height
 * features are built from differences in y. handsXNorm is the exception —
 * it is a SIGNED horizontal offset, `(hands.x - midShoulder.x) / shoulderWidth`,
 * so a mirrored source flips its sign and inverts the movement it describes.
 *
 * This matters because phone front cameras often save the mirrored preview
 * rather than the sensor image, while getUserMedia always delivers the sensor
 * image (the live app only mirrors the preview in CSS). A reference extracted
 * from a mirrored recording would therefore disagree with every live session
 * on these features, and only on these.
 */
export const MIRROR_SENSITIVE_FEATURES = ['handsXNorm'];

export const BODY_PART_FEATURE_MAP = {
  'back':     ['trunkAngleL', 'trunkAngleR', 'trunkAngleMin'],
  'trunk':    ['trunkAngleL', 'trunkAngleR', 'trunkAngleMin'],
  'shoulder': ['shoulderAngleL', 'shoulderAngleR', 'shoulderAngleMin'],
  'elbow':    ['elbowAngleL', 'elbowAngleR', 'elbowAngleMin'],
  'hip':      ['hipAngleL', 'hipAngleR', 'hipAngleMin'],
  'knee':     ['kneeAngleL', 'kneeAngleR', 'kneeAngleMin'],
  'ankle':    ['ankleAngleToeL', 'ankleAngleToeR', 'ankleAngleHeelL', 'ankleAngleHeelR'],
  'foot':     ['footPitchNormL', 'footPitchNormR', 'footPitchNormAvg'],
  'wrist':    ['wristHeightNormL', 'wristHeightNormR'],
};

// --- Helpers ---

function avgFinite(arr) {
  const vals = arr.filter(Number.isFinite);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN;
}
