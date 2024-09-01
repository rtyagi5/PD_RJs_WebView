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


export const calculateInteriorAngle = (p1, p2, p3) => {
  const v1 = { x: p1.x - p2.x, y: p1.y - p2.y };
  const v2 = { x: p3.x - p2.x, y: p3.y - p2.y };

  const dotProduct = v1.x * v2.x + v1.y * v2.y;
  const magnitude1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
  const magnitude2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);

  if (magnitude1 === 0 || magnitude2 === 0) {
    return NaN;
  }

  const angle = Math.acos(dotProduct / (magnitude1 * magnitude2)) * (180 / Math.PI);
  return angle;
};


export const drawCanvas = (poses, videoWidth, videoHeight, ctx) => {
  // const ctx = canvas.current.getContext("2d");
  // canvas.current.width = videoWidth;
  // canvas.current.height = videoHeight;
  ctx.clearRect(0, 0, videoWidth, videoHeight);

  if (poses.length > 0 && poses[0].keypoints) {
    drawKeypoints(poses[0].keypoints, 0.3, ctx);
    drawSkeleton(poses[0].keypoints, 0.3, ctx);
  }
};


export const sendUpdates = (data, exerciseType) => {
  // Example config to determine which data points to include based on exerciseType
  const exerciseDataConfig = {
    "SideArmRaise": ["armAngle", "shoulderAngle"],
    "Squats": ["kneeAngle", "hipAngle"],
    // Add more exercises and their specific data points here
  };

  const selectedConfig = exerciseDataConfig[exerciseType] || [];

  // Include only the relevant data points
  const filteredData = {
    fps: data.fps,
    repCount: data.repCount,
    feedback: data.feedback,
    exerciseType: exerciseType, // Include the exerciseType here
  };

  selectedConfig.forEach(param => {
    if (data[param] !== undefined) {
      filteredData[param] = data[param];
    }
  });

  console.log('Sending data:', filteredData); // Add this to check the data structure

  if (window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(JSON.stringify(filteredData));
  } else if (window.parent) {
    window.parent.postMessage(filteredData, "*"); // Send the message to the parent window
  }
};
