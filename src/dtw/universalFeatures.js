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
 * @returns {Object} feature vector with ~22 named features
 */
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
  const kneeLiftNormL = (P(Lh) && P(Lk) && fin(hipAnkleLenL))
    ? Math.max(0, Lh.y - Lk.y) / hipAnkleLenL : NaN;
  const kneeLiftNormR = (P(Rh) && P(Rk) && fin(hipAnkleLenR))
    ? Math.max(0, Rh.y - Rk.y) / hipAnkleLenR : NaN;

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
      ` hipAnkLenL=${fin(hipAnkleLenL) ? hipAnkleLenL.toFixed(0) : 'NaN'}` +
      ` hipAnkLenR=${fin(hipAnkleLenR) ? hipAnkleLenR.toFixed(0) : 'NaN'}` +
      ` hipAngleL=${fin(hipAngleL) ? hipAngleL.toFixed(0) : 'NaN'}` +
      ` hipAngleR=${fin(hipAngleR) ? hipAngleR.toFixed(0) : 'NaN'}`
    );
  }

  // 10. Foot pitch (toe.y - heel.y) / shank  — dorsiflexion
  // Also gated by footValid so chair-leg hallucinations don't produce false dorsiflexion reps.
  const footPitchNormL = (P(Lfi) && P(Lhe) && fin(shankLenL) && footValidL)
    ? (Lfi.y - Lhe.y) / shankLenL : NaN;
  const footPitchNormR = (P(Rfi) && P(Rhe) && fin(shankLenR) && footValidR)
    ? (Rfi.y - Rhe.y) / shankLenR : NaN;

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
