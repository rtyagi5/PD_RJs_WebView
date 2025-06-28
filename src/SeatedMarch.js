import { calculateInteriorAngle } from './utilities';

export const SeatedMarch_repDetection = async (
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
            shoulder: null
        },
        right: {
            hip: null,
            knee: null,
            ankle: null,
            shoulder: null
        }
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
        });

        // Check if all required keypoints are detected with good confidence
        const allKeyPointsDetected = Object.values(keypoints.left).every(k => k && k.score > 0.3) &&
                                    Object.values(keypoints.right).every(k => k && k.score > 0.3);

        if (allKeyPointsDetected) {
            keypointsRef.current = [
                'left_hip', 'left_knee', 'left_ankle', 'left_shoulder',
                'right_hip', 'right_knee', 'right_ankle', 'right_shoulder'
            ];

            // Calculate angles for both legs
            const angles = {
                left: calculateLegAngle(keypoints.left),
                right: calculateLegAngle(keypoints.right)
            };

            // Determine which leg should move next (alternate from last moved leg)
            // If both counts are 0, we're starting a new rep - use left leg first
            const nextLeg = (leftLegCountRef.current === 0 && rightLegCountRef.current === 0) 
                ? 'left' 
                : (lastLegRef.current === 'left' ? 'right' : 'left');
            const otherLeg = nextLeg === 'left' ? 'right' : 'left';
            
            console.log(`Next leg to move: ${nextLeg}, Last leg: ${lastLegRef.current}, Left count: ${leftLegCountRef.current}, Right count: ${rightLegCountRef.current}`);

            // Check if the next leg is lifted high enough and the other leg is down
            if (angles[nextLeg] > 60 && angles[otherLeg] < 30) {
                if (!feedbackLockRef.current) {
                    // Count the leg lift
                    if (nextLeg === 'left') leftLegCountRef.current++;
                    else rightLegCountRef.current++;

                    // Toggle the last leg reference
                    lastLegRef.current = nextLeg;

                    // Check if we've completed a full rep (both legs lifted)
                    if (leftLegCountRef.current > 0 && rightLegCountRef.current > 0) {
                        // Only increment the rep count when we complete a full Left-Right cycle
                        repCountRef.current++;
                        
                        // Reset the leg counts for the next rep
                        leftLegCountRef.current = 0;
                        rightLegCountRef.current = 0;
                        
                        // Set up for the next rep to start with left leg
                        lastLegRef.current = 'right';
                        
                        if (repCountRef.current >= targetReps) {
                            handleExerciseComplete();
                        } else {
                            feedbackRef.current = `Good! ${repCountRef.current} reps completed. Next rep: left leg first`;
                        }
                    }

                    // Update the feedback to show which leg to lift next
                    if (leftLegCountRef.current === 1 && rightLegCountRef.current === 0) {
                        feedbackRef.current = 'Good! Now right leg next';
                    } else if (leftLegCountRef.current === 0 && rightLegCountRef.current === 0) {
                        feedbackRef.current = `Rep ${repCountRef.current + 1}: Lift your left knee`;
                    }
                    feedbackLockRef.current = true;
                    setTimeout(() => { feedbackLockRef.current = false; }, 1000);
                }
            } else if (!feedbackLockRef.current) {
                // Update the feedback to show which leg to lift (nextLeg is the one that needs to move)
                feedbackRef.current = `Lift your ${nextLeg} knee higher`;
            }

            // Visual feedback - highlight the leg that should move next
            keypointColorsRef.current = {
                [`${nextLeg}_hip`]: "#FF0000",
                [`${nextLeg}_knee`]: "#FF0000",
                [`${nextLeg}_ankle`]: "#FF0000"
            };

        } else {
            feedbackRef.current = "Please ensure your whole body is visible in the frame";
            keypointsRef.current = [];
        }
    }

    return {
        keypoints: keypointsRef.current,
        keypointColors: keypointColorsRef.current,
        segmentColors: segmentColorsRef.current,
        leftKneeAngle: angles ? angles.left : undefined,
        rightKneeAngle: angles ? angles.right : undefined,
        repCount: repCountRef.current
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

export default SeatedMarch_repDetection;
