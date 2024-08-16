const color = "aqua";
const lineWidth = 2;  // Adjusted line width

function toTuple({ y, x }) {
  return [y, x];
}

export function drawPoint(ctx, y, x, r, color) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 2 * Math.PI);
  ctx.fillStyle = color;
  ctx.fill();
}

export function drawSegment([ay, ax], [by, bx], color, scale, ctx) {
  ctx.beginPath();
  ctx.moveTo(ax * scale, ay * scale);
  ctx.lineTo(bx * scale, by * scale);
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = color;
  ctx.stroke();
}

export function drawSkeleton(keypoints, minConfidence, ctx, scale = 1) {
  const adjacentKeyPoints = [
    [5, 7], [7, 9], [6, 8], [8, 10],
    [11, 13], [13, 15], [12, 14], [14, 16],
    [11, 12], [5, 6], [5, 11], [6, 12]
  ];

  adjacentKeyPoints.forEach(([i, j]) => {
    const kp1 = keypoints[i];
    const kp2 = keypoints[j];
    if (kp1 && kp2 && kp1.score >= minConfidence && kp2.score >= minConfidence) {
      const { x: x1, y: y1 } = kp1;
      const { x: x2, y: y2 } = kp2;
      if (x1 !== undefined && y1 !== undefined && x2 !== undefined && y2 !== undefined) {
        drawSegment(toTuple({ y: y1, x: x1 }), toTuple({ y: y2, x: x2 }), color, scale, ctx);
      }
    }
  });
}

export function drawKeypoints(keypoints, minConfidence, ctx, scale = 1) {
  keypoints.forEach((keypoint) => {
    if (keypoint && keypoint.score >= minConfidence) {
      const { x, y } = keypoint;
      if (x !== undefined && y !== undefined) {
        drawPoint(ctx, y * scale, x * scale, 4, color);  // Adjusted point size
      }
    }
  });
}
