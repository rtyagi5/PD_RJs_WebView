import { calculateInteriorAngle, calculateAngle } from './utilities';

export const StandingMarch_repDetection = async (
    poses,
    side,  // Not used in this exercise since we alternate legs automatically
    feedbackRef,
    leftLegCountRef,  // Track left leg lifts
    rightLegCountRef, // Track right leg lifts
    lastLegRef,       // Track which leg was last lifted ('left' or 'right')
    repCountRef,
    targetReps,
    handleExerciseComplete,
    keypointColorsRef,
    segmentColorsRef,
    keypointsRef,
    feedbackLockRef
) => {
    // Keypoints for both sides
    const keypoints = {
        left: {
            hip: null,
            knee: null,
            ankle: null,
            shoulder: null,
            ear: null
        },
        right: {
            hip: null,
            knee: null,
            ankle: null,
            shoulder: null,
            ear: null
        },
        nose: null
    };

    // Reset colors to default
    keypointColorsRef.current = "#66FF00";
    segmentColorsRef.current = "#66FF00";

    if (poses.length > 0 && poses[0].keypoints) {
        const poseKeypoints = poses[0].keypoints;
        
        // Get all keypoints for both sides
        ['left', 'right'].forEach(side => {
            keypoints[side].hip = poseKeypoints.find(k => k.name === `${side}_hip`);
            keypoints[side].knee = poseKeypoints.find(k => k.name === `${side}_knee`);
            keypoints[side].ankle = poseKeypoints.find(k => k.name === `${side}_ankle`);
            keypoints[side].shoulder = poseKeypoints.find(k => k.name === `${side}_shoulder`);
            keypoints[side].ear = poseKeypoints.find(k => k.name === `${side}_ear`);
        });
        keypoints.nose = poseKeypoints.find(k => k.name === 'nose');

        // Check if all required keypoints are detected with good confidence
        const allKeyPointsDetected = 
            Object.values(keypoints.left).every(k => k && k.score > 0.3) &&
            Object.values(keypoints.right).every(k => k && k.score > 0.3) &&
            keypoints.nose && keypoints.nose.score > 0.3;

        if (allKeyPointsDetected) {
            keypointsRef.current = [
                'left_hip', 'left_knee', 'left_ankle', 'left_shoulder', 'left_ear',
                'right_hip', 'right_knee', 'right_ankle', 'right_shoulder', 'right_ear',
                'nose'
            ];

            // Calculate angles for both legs
            const angles = {
                left: calculateLegAngle(keypoints.left),
                right: calculateLegAngle(keypoints.right)
            };

            // Calculate posture (angle between shoulders and hips)
            const postureAngle = calculatePosture(keypoints);
            const isGoodPosture = postureAngle > 160; // Upright posture threshold

            // Determine which leg should move next
            const nextLeg = lastLegRef.current === 'left' ? 'right' : 'left';
            const otherLeg = nextLeg === 'left' ? 'right' : 'left';
            
            console.log(`Next leg to move: ${nextLeg}, Last leg: ${lastLegRef.current}`);

            // Check if the next leg is lifted high enough and the other leg is down
            if (angles[nextLeg] > 70 && angles[otherLeg] < 30) {
                if (!feedbackLockRef.current) {
                    if (!isGoodPosture) {
                        feedbackRef.current = "Keep your torso upright";
                        keypointColorsRef.current = {
                            [`${nextLeg}_hip`]: "#FFA500", // Orange for warning
                            [`${nextLeg}_knee`]: "#FFA500",
                            [`${nextLeg}_ankle`]: "#FFA500"
                        };
                    } else {
                        // Count the rep when the leg is lifted with good form
                        if (nextLeg === 'left') leftLegCountRef.current++;
                        else rightLegCountRef.current++;

                        // Toggle the last leg reference
                        lastLegRef.current = nextLeg;

                        // Count a full rep when both legs have completed their lifts
                        if (leftLegCountRef.current > 0 && rightLegCountRef.current > 0) {
                            const completedReps = Math.min(leftLegCountRef.current, rightLegCountRef.current);
                            repCountRef.current = completedReps;
                            
                            if (repCountRef.current >= targetReps) {
                                handleExerciseComplete();
                            }
                        }

                        feedbackRef.current = `Good! Now ${nextLeg === 'left' ? 'right' : 'left'} leg next`;
                        feedbackLockRef.current = true;
                        setTimeout(() => { feedbackLockRef.current = false; }, 1000);
                    }
                }
            } else if (!feedbackLockRef.current) {
                if (!isGoodPosture) {
                    feedbackRef.current = "Stand up straight";
                } else {
                    feedbackRef.current = `Lift your ${nextLeg} knee to waist level`;
                }
            }

            // Visual feedback - highlight the leg that should move next
            keypointColorsRef.current = keypointColorsRef.current || {};
            keypointColorsRef.current[`${nextLeg}_hip`] = isGoodPosture ? "#FF0000" : "#FFA500";
            keypointColorsRef.current[`${nextLeg}_knee`] = isGoodPosture ? "#FF0000" : "#FFA500";
            keypointColorsRef.current[`${nextLeg}_ankle`] = isGoodPosture ? "#FF0000" : "#FFA500";

        } else {
            feedbackRef.current = "Please ensure your whole body is visible in the frame";
            keypointsRef.current = [];
        }
    }

    return {
        keypoints: keypointsRef.current,
        keypointColors: keypointColorsRef.current,
        segmentColors: segmentColorsRef.current
    };
};

// Helper function to calculate leg angle (hip-knee-ankle)
const calculateLegAngle = (leg) => {
    if (!leg.hip || !leg.knee || !leg.ankle) return 0;
    
    const angle = calculateInteriorAngle(
        { x: leg.hip.x, y: leg.hip.y },
        { x: leg.knee.x, y: leg.knee.y },
        { x: leg.ankle.x, y: leg.ankle.y }
    );
    
    return angle || 0;
};

// Calculate posture angle (shoulder-hip-knee)
const calculatePosture = (keypoints) => {
    const leftSide = keypoints.left;
    const rightSide = keypoints.right;
    
    if (!leftSide.shoulder || !leftSide.hip || !rightSide.shoulder || !rightSide.hip) return 180;
    
    // Calculate angle between shoulders and hips
    const shoulderMid = {
        x: (leftSide.shoulder.x + rightSide.shoulder.x) / 2,
        y: (leftSide.shoulder.y + rightSide.shoulder.y) / 2
    };
    
    const hipMid = {
        x: (leftSide.hip.x + rightSide.hip.x) / 2,
        y: (leftSide.hip.y + rightSide.hip.y) / 2
    };
    
    // Create a point directly below the shoulders for angle calculation
    const referencePoint = {
        x: shoulderMid.x,
        y: shoulderMid.y + 100 // 100 pixels below shoulders
    };
    
    return calculateAngle(
        referencePoint,
        shoulderMid,
        hipMid
    );
};

export default StandingMarch_repDetection;
