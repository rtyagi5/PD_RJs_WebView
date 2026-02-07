import axios from "axios"
import { getServiceUrl } from "./config";
import { METRIC_MAP } from "./ExerciseTracker_refactored";
const lineWidth = 2;  // Adjusted line width
let messageCache = {}
let updates = []

export function resetSyncState() {
  updates = [];
  messageCache = {};
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


export const drawCanvas = (poses, videoWidth, videoHeight, ctx, keypoints, keypointColors, segmentColors) => {
  if (poses.length > 0 && poses[0].keypoints) {
    drawKeypoints(poses[0].keypoints, 0.3, ctx, 1, keypoints, keypointColors);
    drawSkeleton(poses[0].keypoints, 0.3, ctx, 1, keypoints, segmentColors);
  }
};

export const sendUpdates = async (data, exerciseType, activityData, setDisplayMessage) => {
  const cacheKey = `${data.repCount}_${data?.feedback}`
  // Do NOT skip completion updates, even if duplicate
  if (messageCache[cacheKey] && !data?.completionStatusRef) {
    return
  }
  const selectedConfig = METRIC_MAP[exerciseType] || [];

  // Include only the relevant data points
  const filteredData = {
    fps: data.fps,
    repCount: data.repCount,
    feedback: data.feedback,
    exerciseType: exerciseType,
    completionStatusRef: data.completionStatusRef,
    // Session state context for WebView TTS / coaching
    ...(data.sessionState != null && { sessionState: data.sessionState }),
    ...(data.coachingChecks != null && { coachingChecks: data.coachingChecks }),
    ...(data.countdownRemaining != null && { countdownRemaining: data.countdownRemaining }),
  };

  selectedConfig.forEach(param => {
    if (data[param] !== undefined) {
      filteredData[param] = data[param];
    }
  });

  updates.push(filteredData);
  // Always send completion updates to the server
  if (data?.completionStatusRef) {
    setDisplayMessage("Syncing exercise data...");
    const query = new URLSearchParams(window.location.search);
    try {
      const res = await axios.post(`${getServiceUrl(activityData).EXERCISE_SERVICE}/activities/exercise-data`, {
        updates,
        activity: activityData?.activity,
        activityType: "exercise"
      }, {
        headers: {
          Authorization: `Bearer ${query.get("token")}`,
          tenantId: activityData?.tenant
        }
      });
      setDisplayMessage("Data synced successfully!!");
      console.log("server sync success", res);
    } catch (err) {
      setDisplayMessage("Failed to sync exercise data. Please try again.");
      console.log("failed in sending the data to server", err);
    }
  }

  messageCache[cacheKey] = 1

  if (window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(JSON.stringify(filteredData));
  } else if (window.parent) {
    window.parent.postMessage(filteredData, "*");
  }
};

export function calculateDistance(point1, point2) {
  if (!point1 || !point2) return 0;
  const dx = point1.x - point2.x;
  const dy = point1.y - point2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

