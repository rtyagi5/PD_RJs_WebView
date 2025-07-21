import { calculateInteriorAngle } from './utilities';

// Track initialization state
let hasInitialized = false;

export const StandingMarch_repDetection = async (
    poses,
    side,
    feedbackRef,
    leftLegCountRef,
    rightLegCountRef,
    startLegRef,
    repCountRef,
    targetReps,
    handleExerciseComplete,
    keypointColorsRef,
    segmentColorsRef,
    keypointsRef,
    feedbackLockRef
) => {
    // Initialize refs if not set
    if (startLegRef.current === undefined) {
        startLegRef.current = 'left';
    }
    if (!feedbackLockRef.current) {
        feedbackLockRef.current = { locked: false };
    }

    // Track which leg we're currently working on
    const currentLeg = startLegRef.current;
    const otherLeg = currentLeg === 'left' ? 'right' : 'left';

    // Only log initialization on first run
    if (!hasInitialized) {
        console.log(`[StandingMarch] Starting exercise - Target: ${targetReps} reps`);
        console.log(`[StandingMarch] Starting with ${currentLeg} leg first`);
        hasInitialized = true;
    }

    // Keypoints for both legs
    const keypoints = {
        left: { hip: null, knee: null, ankle: null, shoulder: null },
        right: { hip: null, knee: null, ankle: null, shoulder: null }
    };

    // Initialize angles
    const angles = {
        left: { hip: 180, knee: 180 },
        right: { hip: 180, knee: 180 }
    };

    if (poses.length > 0 && poses[0].keypoints) {
        const poseKeypoints = poses[0].keypoints;

        // Get all keypoints for both sides
        ['left', 'right'].forEach(side => {
            keypoints[side].shoulder = poseKeypoints.find(k => k.name === `${side}_shoulder`);
            keypoints[side].hip = poseKeypoints.find(k => k.name === `${side}_hip`);
            keypoints[side].knee = poseKeypoints.find(k => k.name === `${side}_knee`);
            keypoints[side].ankle = poseKeypoints.find(k => k.name === `${side}_ankle`);
        });

        // Helper function to calculate angle between three points
        const calculateAngle = (point1, point2, point3) => {
            if (!point1 || !point2 || !point3) return 180;
            
            // Calculate vectors
            const v1 = { x: point1.x - point2.x, y: point1.y - point2.y };
            const v2 = { x: point3.x - point2.x, y: point3.y - point2.y };
            
            // Calculate dot product and magnitudes
            const dot = v1.x * v2.x + v1.y * v2.y;
            const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
            const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);
            
            // Calculate angle in degrees
            let angle = Math.acos(Math.min(Math.max(dot / (mag1 * mag2), -1), 1)) * (180 / Math.PI);
            
            // Ensure angle is between 0 and 180
            return isNaN(angle) ? 0 : angle;
        };

        // Calculate angles for a given side
        const calculateAngles = (side) => {
            const { shoulder, hip, knee, ankle } = keypoints[side];
            const hipAngle = calculateAngle(shoulder, hip, knee);
            const kneeAngle = calculateAngle(hip, knee, ankle);

            return {
                hip: hipAngle,
                knee: kneeAngle
            };
        };

        // Check if all required keypoints are detected with good confidence
        const hasGoodKeypoints = 
            keypoints.left.hip?.score > 0.3 &&
            keypoints.left.knee?.score > 0.3 &&
            keypoints.right.hip?.score > 0.3 &&
            keypoints.right.knee?.score > 0.3;

        if (hasGoodKeypoints) {
            // Update keypoints for visualization
            keypointsRef.current = [
                'left_shoulder', 'left_hip', 'left_knee', 'left_ankle',
                'right_shoulder', 'right_hip', 'right_knee', 'right_ankle'
            ];

            // Set default colors
            keypointColorsRef.current = 'aqua';
            segmentColorsRef.current = 'aqua';

            // Calculate angles for both legs
            angles.left = calculateAngles('left');
            angles.right = calculateAngles('right');
            
            // Log current angles for debugging
            console.log(`[Angles] Left - Hip: ${angles.left.hip.toFixed(1)}°, Knee: ${angles.left.knee.toFixed(1)}° | ` +
                      `Right - Hip: ${angles.right.hip.toFixed(1)}°, Knee: ${angles.right.knee.toFixed(1)}°`);

            // Define leg movement detection with angle logging
            const leftHipAngle = angles.left.hip;
            const leftKneeAngle = angles.left.knee;
            const rightHipAngle = angles.right.hip;
            const rightKneeAngle = angles.right.knee;

            // Check if legs are lifted (more sensitive thresholds)
            const isLeftLegUp = leftHipAngle < 170 && leftKneeAngle < 155;  // More sensitive to left leg lift
            const isRightLegUp = rightHipAngle < 170 && rightKneeAngle < 145; // Slightly more sensitive to right leg lift
            
            // Check if legs are lowered (more forgiving thresholds)
            const isLeftLegDown = leftHipAngle > 172 && leftKneeAngle > 160;  // More forgiving for left leg down
            const isRightLegDown = rightHipAngle > 172 && rightKneeAngle > 160; // More forgiving for right leg down
            
            // Debug logging for leg states
            console.log(`[LEFT] Hip: ${leftHipAngle.toFixed(1)}°, Knee: ${leftKneeAngle.toFixed(1)}° - ` + 
                       `${isLeftLegUp ? 'LIFTED' : isLeftLegDown ? 'LOWERED' : 'MOVING'}`);
            console.log(`[RIGHT] Hip: ${rightHipAngle.toFixed(1)}°, Knee: ${rightKneeAngle.toFixed(1)}° - ` + 
                      `${isRightLegUp ? 'LIFTED' : isRightLegDown ? 'LOWERED' : 'MOVING'}`);

            // Update leg states independently
            if (isLeftLegUp && leftLegCountRef.current === 0) {
                leftLegCountRef.current = 1;
                console.log(`[StandingMarch] Left leg lifted`);
                feedbackRef.current = 'Great! Now lower your left leg';
            } else if (isLeftLegDown && leftLegCountRef.current === 1) {
                leftLegCountRef.current = 2;
                console.log(`[StandingMarch] Left leg lowered`);
                feedbackRef.current = 'Now lift your right knee';
            }

            if (isRightLegUp && rightLegCountRef.current === 0) {
                rightLegCountRef.current = 1;
                console.log(`[StandingMarch] Right leg lifted`);
                feedbackRef.current = 'Great! Now lower your right leg';
            } else if (isRightLegDown && rightLegCountRef.current === 1) {
                rightLegCountRef.current = 2;
                console.log(`[StandingMarch] Right leg lowered`);
                feedbackRef.current = 'Now lift your left knee';
            }

            // Count a rep when either leg completes a full cycle
            if ((leftLegCountRef.current === 2 || rightLegCountRef.current === 2) && !feedbackLockRef.current.locked) {
                feedbackLockRef.current.locked = true;
                
                // Only increment rep count if we've had at least one full cycle
                if (leftLegCountRef.current === 2 || rightLegCountRef.current === 2) {
                    repCountRef.current++;
                    console.log(`[StandingMarch] Rep ${repCountRef.current} completed!`);
                    feedbackRef.current = `Great! ${repCountRef.current} reps completed`;
                }
                
                // Reset for next rep
                leftLegCountRef.current = 0;
                rightLegCountRef.current = 0;
                
                // Check if target reps reached
                if (repCountRef.current >= targetReps) {
                    console.log(`[StandingMarch] Exercise complete! ${targetReps} reps done`);
                    await handleExerciseComplete();
                }
                
                // Unlock after a short delay to prevent multiple counts
                setTimeout(() => {
                    feedbackLockRef.current.locked = false;
                }, 500);
            }
            
            // Visual feedback for current leg
            keypointColorsRef.current = {
                [`${currentLeg}_hip`]: "#FF0000",
                [`${currentLeg}_knee`]: "#FF0000",
                [`${currentLeg}_ankle`]: "#FF0000"
            };
        } else {
            const missingKeypoints = [];
            if (!keypoints.left.hip || keypoints.left.hip.score <= 0.3) missingKeypoints.push('left hip');
            if (!keypoints.left.knee || keypoints.left.knee.score <= 0.3) missingKeypoints.push('left knee');
            if (!keypoints.right.hip || keypoints.right.hip.score <= 0.3) missingKeypoints.push('right hip');
            if (!keypoints.right.knee || keypoints.right.knee.score <= 0.3) missingKeypoints.push('right knee');
            
            const newFeedback = `Please ensure your ${missingKeypoints.join(' and ')} are visible in the frame`;
            if (feedbackRef.current !== newFeedback) {
                feedbackRef.current = newFeedback;
            }
            keypointsRef.current = [];
            keypointColorsRef.current = {};
            segmentColorsRef.current = {};
            
            // Only log missing keypoints if they've changed and we haven't logged them recently
            if (feedbackRef.current !== newFeedback) {
                console.log(`[StandingMarch] Missing keypoints: ${missingKeypoints.join(', ')}`);
                // Reset feedback after a delay to avoid spamming
                setTimeout(() => {
                    feedbackRef.current = newFeedback;
                }, 1000);
            }
        }
    }

    return {
        keypoints: keypointsRef.current || [],
        keypointColors: keypointColorsRef.current || {},
        segmentColors: segmentColorsRef.current || {},
        leftKneeAngle: angles ? angles.left : { hip: 180, knee: 180 },
        rightKneeAngle: angles ? angles.right : { hip: 180, knee: 180 },
        repCount: repCountRef.current,
        feedback: feedbackRef.current
    };
};

// Remove unused function

export default StandingMarch_repDetection;
