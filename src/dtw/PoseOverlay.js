// ---------------------------------------------
// dtw/PoseOverlay.js
// Draws the detected skeleton over the reference-extractor video, and picks out
// the joint the primary feature is measured from.
//
// Why this exists: labelling a reference is a judgement call made from what the
// MODEL saw, not from what the video shows. Those differ more than you would
// expect for the foot exercises, where MediaPipe routinely puts foot_index on a
// chair leg while the video looks perfectly clear. Without the overlay an
// operator can mark clean rep boundaries around frames whose keypoints are
// nonsense, and the mistake only surfaces much later as an unusable template.
//
// It draws from `frames[i].keypoints`, which the extractor already stores for
// exactly this purpose, so nothing is re-inferred.
// ---------------------------------------------

import React, { useEffect, useRef } from 'react';
import { stripSideSuffix } from './universalFeatures.js';
import { processingSize } from '../captureConfig.js';

// Name-based rather than index-based, unlike utilities.drawSkeleton: that one
// works on COCO-17 indices and stops at the ankle, and the foot is the whole
// point here. Names also survive a detector swap, which indices do not.
const BONES = [
  ['left_shoulder', 'right_shoulder'], ['left_hip', 'right_hip'],
  ['left_shoulder', 'left_hip'], ['right_shoulder', 'right_hip'],
  ['left_shoulder', 'left_elbow'], ['left_elbow', 'left_wrist'],
  ['right_shoulder', 'right_elbow'], ['right_elbow', 'right_wrist'],
  ['left_hip', 'left_knee'], ['left_knee', 'left_ankle'],
  ['right_hip', 'right_knee'], ['right_knee', 'right_ankle'],
  // MediaPipe-only, and the reason the shared helper could not be reused.
  ['left_ankle', 'left_heel'], ['left_heel', 'left_foot_index'],
  ['left_ankle', 'left_foot_index'],
  ['right_ankle', 'right_heel'], ['right_heel', 'right_foot_index'],
  ['right_ankle', 'right_foot_index'],
];

// Which points a feature is actually computed from, mirroring universalFeatures.
// `vertex` is the joint the angle opens at; `ratio` features have no vertex and
// are drawn as the pair whose separation is being measured.
const FEATURE_GEOMETRY = {
  shoulderAngle:  { kind: 'angle', pts: ['hip', 'shoulder', 'elbow'] },
  elbowAngle:     { kind: 'angle', pts: ['shoulder', 'elbow', 'wrist'] },
  hipAngle:       { kind: 'angle', pts: ['shoulder', 'hip', 'knee'] },
  kneeAngle:      { kind: 'angle', pts: ['hip', 'knee', 'ankle'] },
  trunkAngle:     { kind: 'angle', pts: ['shoulder', 'hip', 'ankle'] },
  ankleAngleToe:  { kind: 'angle', pts: ['knee', 'ankle', 'foot_index'] },
  ankleAngleHeel: { kind: 'angle', pts: ['knee', 'ankle', 'heel'] },
  footPitchNorm:  { kind: 'ratio', pts: ['heel', 'foot_index'] },
  kneeLiftNorm:   { kind: 'ratio', pts: ['hip', 'knee'] },
  wristHeightNorm:{ kind: 'ratio', pts: ['hip', 'wrist'] },
  hipToAnkleNorm: { kind: 'ratio', pts: ['hip', 'ankle'] },
};

/** Which side a concrete feature key refers to, or null for an aggregate. */
function sideOf(key) {
  if (/L$/.test(key)) return 'left';
  if (/R$/.test(key)) return 'right';
  return null;
}

/**
 * Resolve the highlighted points for a feature key against a keypoint list.
 * Returns null when the feature is an aggregate with no single side, or when
 * the frame is missing one of the points.
 */
export function focusPointsFor(featureKey, byName) {
  if (!featureKey) return null;
  const geom = FEATURE_GEOMETRY[stripSideSuffix(featureKey)];
  const side = sideOf(featureKey);
  if (!geom || !side) return null;

  const pts = geom.pts.map(p => byName[`${side}_${p}`]);
  if (pts.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  return { kind: geom.kind, pts };
}

export default function PoseOverlay({
  videoRef, keypoints, featureKey, featureValue, minScore = 0.3,
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const cv = canvasRef.current;
    const video = videoRef?.current;
    if (!cv || !video) return;

    // Match the canvas to the video's DISPLAYED box, which is what the operator
    // sees. maxWidth/maxHeight styling means that is rarely the native size.
    const w = video.clientWidth;
    const h = video.clientHeight;
    if (!w || !h) return;
    if (cv.width !== w) cv.width = w;
    if (cv.height !== h) cv.height = h;

    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    if (!keypoints?.length) return;

    // Keypoints are in the PROCESSING canvas space the extractor inferred on,
    // not the video's native size and not its displayed size. Recompute that
    // space the same way rather than assuming, or the skeleton sits offset from
    // the body on every clip wider than the cap.
    const proc = processingSize(video.videoWidth, video.videoHeight);
    if (!proc.width || !proc.height) return;
    const sx = w / proc.width;
    const sy = h / proc.height;
    const X = p => p.x * sx;
    const Y = p => p.y * sy;

    const byName = {};
    for (const k of keypoints) if (k?.name) byName[k.name] = k;
    const visible = p => p && Number.isFinite(p.x) && Number.isFinite(p.y)
      && (p.score == null || p.score >= minScore);

    // --- Bones
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(90, 190, 255, 0.75)';
    for (const [a, b] of BONES) {
      const p = byName[a];
      const q = byName[b];
      if (!visible(p) || !visible(q)) continue;
      ctx.beginPath();
      ctx.moveTo(X(p), Y(p));
      ctx.lineTo(X(q), Y(q));
      ctx.stroke();
    }

    // --- Joints. Low-confidence points are drawn hollow rather than hidden:
    // an operator needs to see that the model is unsure, not just see nothing.
    for (const k of keypoints) {
      if (!k || !Number.isFinite(k.x) || !Number.isFinite(k.y)) continue;
      const sure = k.score == null || k.score >= minScore;
      ctx.beginPath();
      ctx.arc(X(k), Y(k), sure ? 3.5 : 3, 0, Math.PI * 2);
      if (sure) {
        ctx.fillStyle = '#5abeff';
        ctx.fill();
      } else {
        ctx.strokeStyle = 'rgba(255, 170, 34, 0.9)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    // --- The measured feature, picked out from everything else.
    const focus = focusPointsFor(featureKey, byName);
    if (!focus) return;

    const [a, b, c] = focus.pts;
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = '#ffd24a';
    ctx.beginPath();
    ctx.moveTo(X(a), Y(a));
    ctx.lineTo(X(b), Y(b));
    if (c) ctx.lineTo(X(c), Y(c));
    ctx.stroke();

    for (const p of focus.pts) {
      ctx.beginPath();
      ctx.arc(X(p), Y(p), 5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffd24a';
      ctx.fill();
    }

    // The vertex of an angle is its middle point; a ratio has no vertex, so
    // label the midpoint of the pair it measures.
    const label = focus.kind === 'angle' ? focus.pts[1] : {
      x: (focus.pts[0].x + focus.pts[1].x) / 2,
      y: (focus.pts[0].y + focus.pts[1].y) / 2,
    };

    if (focus.kind === 'angle') {
      const r = 26;
      const a1 = Math.atan2(Y(a) - Y(b), X(a) - X(b));
      const a2 = Math.atan2(Y(c) - Y(b), X(c) - X(b));
      ctx.beginPath();
      ctx.arc(X(b), Y(b), r, a1, a2, false);
      ctx.strokeStyle = 'rgba(255, 210, 74, 0.8)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    const text = Number.isFinite(featureValue)
      ? (focus.kind === 'angle' ? `${featureValue.toFixed(0)}°` : featureValue.toFixed(3))
      : 'n/a';
    const caption = `${featureKey}  ${text}`;

    ctx.font = '600 13px ui-monospace, SFMono-Regular, Menlo, monospace';
    const tw = ctx.measureText(caption).width;
    const tx = Math.min(Math.max(X(label) + 12, 4), w - tw - 12);
    const ty = Math.min(Math.max(Y(label) - 12, 18), h - 8);

    ctx.fillStyle = 'rgba(10, 10, 30, 0.85)';
    ctx.fillRect(tx - 6, ty - 14, tw + 12, 20);
    ctx.fillStyle = '#ffd24a';
    ctx.fillText(caption, tx, ty);
  }, [videoRef, keypoints, featureKey, featureValue, minScore]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute', top: 0, left: 0,
        width: '100%', height: '100%',
        pointerEvents: 'none', borderRadius: 8,
      }}
    />
  );
}
