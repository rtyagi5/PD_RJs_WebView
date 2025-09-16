import axios from "axios"
import { getServiceUrl } from "./config";
const lineWidth = 2;  // Adjusted line width
let messageCache = {}

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

// export function drawSkeleton(keypoints, minConfidence, ctx, scale = 1) {
//   const adjacentKeyPoints = [
//     [5, 7], [7, 9], [6, 8], [8, 10],
//     [11, 13], [13, 15], [12, 14], [14, 16],
//     [11, 12], [5, 6], [5, 11], [6, 12]
//   ];

//   adjacentKeyPoints.forEach(([i, j]) => {
//     const kp1 = keypoints[i];
//     const kp2 = keypoints[j];
//     if (kp1 && kp2 && kp1.score >= minConfidence && kp2.score >= minConfidence) {
//       const { x: x1, y: y1 } = kp1;
//       const { x: x2, y: y2 } = kp2;
//       if (x1 !== undefined && y1 !== undefined && x2 !== undefined && y2 !== undefined) {
//         drawSegment(toTuple({ y: y1, x: x1 }), toTuple({ y: y2, x: x2 }), color, scale, ctx);
//       }
//     }
//   });
// }
// export function drawSkeleton(keypoints, minConfidence, ctx, scale = 1, highlightSegments = {}) {
//   const adjacentKeyPoints = [
//     [5, 7], [7, 9], [6, 8], [8, 10],
//     [11, 13], [13, 15], [12, 14], [14, 16],
//     [11, 12], [5, 6], [5, 11], [6, 12]
//   ];

//   adjacentKeyPoints.forEach(([i, j]) => {
//     const kp1 = keypoints[i];
//     const kp2 = keypoints[j];
//     if (kp1 && kp2 && kp1.score >= minConfidence && kp2.score >= minConfidence) {
//       const { x: x1, y: y1 } = kp1;
//       const { x: x2, y: y2 } = kp2;
//       const segmentName = `${kp1.name}-${kp2.name}`;
//       let color = highlightSegments[segmentName] || "aqua"; // Use the highlight color if specified, otherwise use aqua
//       if (x1 !== undefined && y1 !== undefined && x2 !== undefined && y2 !== undefined) {
//         drawSegment(toTuple({ y: y1, x: x1 }), toTuple({ y: y2, x: x2 }), color, scale, ctx);
//       }
//     }
//   });
// }
export function drawSkeleton(keypoints, minConfidence, ctx, scale = 1, keypoints_CC, segmentColor) {
  const adjacentKeyPoints = [
    [5, 7], [7, 9], [6, 8], [8, 10],
    [11, 13], [13, 15], [12, 14], [14, 16],
    [11, 12], [5, 6], [5, 11], [6, 12]
  ];
  // Ensure keypoints_CC is treated as an array
  const safeKeypointsCC = Array.isArray(keypoints_CC) ? keypoints_CC : [];

  adjacentKeyPoints.forEach(([i, j]) => {
    const kp1 = keypoints[i];
    const kp2 = keypoints[j];
    if (kp1 && kp2 && kp1.score >= minConfidence && kp2.score >= minConfidence) {
      const kp1Name = keypoints[i].name;
      const kp2Name = keypoints[j].name;
      // Check if both keypoints of the segment are in keypoints_CC
      const color = (safeKeypointsCC.includes(kp1Name) && keypoints_CC.includes(kp2Name)) ? segmentColor : "aqua";
      drawSegment([kp1.y, kp1.x], [kp2.y, kp2.x], color, scale, ctx);
    }
  });
}


// export function drawKeypoints(keypoints, minConfidence, ctx, scale = 1) {
//   keypoints.forEach((keypoint) => {
//     if (keypoint && keypoint.score >= minConfidence) {
//       const { x, y } = keypoint;
//       if (x !== undefined && y !== undefined) {
//         drawPoint(ctx, y * scale, x * scale, 4, color);  // Adjusted point size
//       }
//     }
//   });
// }

// export function drawKeypoints(keypoints, minConfidence, ctx, scale = 1, highlight = {}) {
//   keypoints.forEach((keypoint) => {
//     if (keypoint && keypoint.score >= minConfidence) {
//       const { x, y, name } = keypoint;
//       let color = highlight[name] || "aqua";  // Use the highlight color if specified, otherwise use aqua
//       if (x !== undefined && y !== undefined) {
//         drawPoint(ctx, y * scale, x * scale, 4, color);
//       }
//     }
//   });
// }

export function drawKeypoints(keypoints, minConfidence, ctx, scale = 1, keypoints_CC, color) {
  // Ensure keypoints_CC is treated as an array
  const safeKeypointsCC = Array.isArray(keypoints_CC) ? keypoints_CC : [];
  keypoints.forEach((keypoint) => {
    if (keypoint && keypoint.score >= minConfidence) {
      // Use the specified color if the keypoint is in keypoints_CC, otherwise use "aqua"
      const drawColor = safeKeypointsCC.includes(keypoint.name) ? color : "aqua";
      drawPoint(ctx, keypoint.y * scale, keypoint.x * scale, 4, drawColor);
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
  return Math.round(angle);  // Round the angle to the nearest integer
};

// export const calculateInteriorAngle = (p1, p2, p3) => {
//   const v1 = { x: p1.x - p2.x, y: p1.y - p2.y };
//   const v2 = { x: p3.x - p2.x, y: p3.y - p2.y };

//   const dotProduct = v1.x * v2.x + v1.y * v2.y;
//   const magnitude1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
//   const magnitude2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);

//   if (magnitude1 === 0 || magnitude2 === 0) {
//     return NaN;
//   }

//   let angle = Math.acos(dotProduct / (magnitude1 * magnitude2)) * (180 / Math.PI);

//   // To ensure the interior angle is calculated
//   const crossProduct = v1.x * v2.y - v1.y * v2.x;
//   if (crossProduct < 0) {
//     angle = 360 - angle;
//   }

//   return angle;
// };

// export const drawCanvas = (poses, videoWidth, videoHeight, ctx) => {
//   // const ctx = canvas.current.getContext("2d");
//   // canvas.current.width = videoWidth;
//   // canvas.current.height = videoHeight;
//   ctx.clearRect(0, 0, videoWidth, videoHeight);

//   if (poses.length > 0 && poses[0].keypoints) {
//     drawKeypoints(poses[0].keypoints, 0.3, ctx);
//     drawSkeleton(poses[0].keypoints, 0.3, ctx);
//   }
// };

export const drawCanvas = (poses, videoWidth, videoHeight, ctx, keypoints, keypointColors, segmentColors) => {
  ctx.clearRect(0, 0, videoWidth, videoHeight);

  if (poses.length > 0 && poses[0].keypoints) {
    drawKeypoints(poses[0].keypoints, 0.3, ctx, 1, keypoints, keypointColors);
    drawSkeleton(poses[0].keypoints, 0.3, ctx, 1, keypoints, segmentColors);
  }
};

const updates = []
export const sendUpdates = async (data, exerciseType, activityData) => {
  // In development, we still want to post to WebView/parent but skip server API calls
  const devMode = process.env.REACT_APP_DEVELOPMENT_MODE === 'true';
  if (devMode) {
    console.log('[DEV] Skipping server API call; will still post message to WebView/parent');
  }

  // Example config to determine which data points to include based on exerciseType
  const cacheKey = `${data.repCount}_${data?.feedback}`
  if (messageCache[cacheKey]) {
    return
  }
  const exerciseDataConfig = {
    "SideArmRaise": ["armAngle", "shoulderAngle"],
    "Squats": ["kneeAngle", "hipAngle"],
    "SitToStand": ["spineAngle", "kneeAngle", "hipDistance"], // New configuration for SitToStand
    "MiniSquats": ["kneeAngle", "spineAngle"], // Add MiniSquats configuration
    "LongArcQuad": ["kneeAngle", "spineAngle"], // Add MiniSquats configuration
    "StandingStraightUp": ["headTilt", "shoulderAlignment", "hipAlignment", "kneeAlignment", "ankleAlignment"], // Add Standing Straight Up configuration
    "SeatedMarches": ["hipAngle", "kneeAngle"],
    "StandingMarches": ["hipAngle", "kneeAngle"],
    "MiniLunges": ["kneeAngle", "hipAngle"],
    "BicepCurls": ["elbowAngle"],
    "LiftsAndChops": [
      "shoulderFlexionExtension",
      "shoulderAbductionAdduction",
      "trunkRotation",
      "trunkFlexionExtension",
      "hipRotation"
    ],
    "StepUps": ["kneeAngle", "hipAngle"],
    "WallPushUp": ["elbowAngle", "shoulderAngle", "trunkAngle"],
    "CalfRaisesSeated": ["ankleAngle", "kneeAngle", "trunkAngle"],
    "CalfRaisesStanding": ["ankleAngle", "kneeAngle", "trunkAngle"],
    "SeatedDorsiflexion": ["ankleAngle", "kneeAngle", "trunkAngle"],
    "StandingDorsiflexion": ["ankleAngle", "kneeAngle", "trunkAngle"]
  };

  const selectedConfig = exerciseDataConfig[exerciseType] || [];

  // Include only the relevant data points
  const filteredData = {
    fps: data.fps,
    repCount: data.repCount,
    feedback: data.feedback,
    exerciseType: exerciseType, // Include the exerciseType here
    completionStatusRef: data.completionStatusRef,
  };

  let sync = filteredData.repCount > 0
  selectedConfig.forEach(param => {
    if (data[param] !== undefined) {
      filteredData[param] = data[param];
    }
  });

  updates.push(filteredData);
  if (!devMode && data?.completionStatusRef) {
    const query = new URLSearchParams(window.location.search);
    await axios.post(`${getServiceUrl(activityData).EXERCISE_SERVICE}/activities/exercise-data`, {
      updates,
      activity: activityData?.activity,
      activityType: "exercise"
    }, {
      headers: {
        Authorization: `Bearer ${query.get("token")}`,
        tenantId: activityData?.tenant
      }
    }).catch((err) => {
      console.log("failed in sending the data to server");
    }).then((res) => {
      console.log("server sync success");
    })
  }

  messageCache[cacheKey] = 1

  if (window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(JSON.stringify(filteredData));
  } else if (window.parent) {
    window.parent.postMessage(filteredData, "*"); // Send the message to the parent window
  }
};

export function calculateDistance(point1, point2) {
  if (!point1 || !point2) return 0;
  const dx = point1.x - point2.x;
  const dy = point1.y - point2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculates the midpoint between two points
 * @param {Object} point1 - First point with x and y coordinates
 * @param {Object} point2 - Second point with x and y coordinates
 * @returns {Object} Midpoint coordinates {x, y}
 */
export function getMidpoint(point1, point2) {
  if (!point1 || !point2) return null;
  return {
    x: (point1.x + point2.x) / 2,
    y: (point1.y + point2.y) / 2
  };
}

/**
 * Calculates the slope between two points
 * @param {Object} point1 - First point with x and y coordinates
 * @param {Object} point2 - Second point with x and y coordinates
 * @returns {number} Slope between the two points
 */
export function calculateSlope(point1, point2) {
  if (!point1 || !point2) return 0;
  if (Math.abs(point2.x - point1.x) < 0.0001) return Number.POSITIVE_INFINITY; // Vertical line
  return (point2.y - point1.y) / (point2.x - point1.x);
}
