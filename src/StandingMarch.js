import { calculateInteriorAngle } from './utilities';

export const StandingMarch_repDetection = async (
    poses,
    side,  // Not used in this exercise since we alternate legs automatically
    feedbackRef,
    leftLegCountRef,  // Track left leg lifts
    rightLegCountRef, // Track right leg lifts
    lastLegRef,       // Refs for managing state without re-renders
    repCountRef,
    targetReps,
    handleExerciseComplete,
    keypointColorsRef,
    segmentColorsRef,
    keypointsRef,
    feedbackLockRef
) => {
    // Initialize refs if they don't exist
    if (lastLegRef.current === undefined) {
        lastLegRef.current = 'none'; // Start with no leg lifted
    }
    if (!feedbackLockRef.current) {
        feedbackLockRef.current = { lastLiftTime: 0, locked: false };
    }

    // Keypoints for both sides
    const keypoints = {
        left: { hip: null, knee: null, ankle: null, shoulder: null },
        right: { hip: null, knee: null, ankle: null, shoulder: null }
    };

    // Reset colors to default
    keypointColorsRef.current = "#66FF00";
    segmentColorsRef.current = "#66FF00";
    
    let angles = { left: 0, right: 0 };

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
        const allKeyPointsDetected = 
            keypoints.left.hip && keypoints.left.hip.score > 0.3 &&
            keypoints.left.knee && keypoints.left.knee.score > 0.3 &&
            keypoints.right.hip && keypoints.right.hip.score > 0.3 &&
            keypoints.right.knee && keypoints.right.knee.score > 0.3;

        if (allKeyPointsDetected) {
            keypointsRef.current = [
                'left_hip', 'left_knee', 'left_ankle', 'left_shoulder',
                'right_hip', 'right_knee', 'right_ankle', 'right_shoulder'
            ];

            // Calculate angles for both legs
            angles = {
                left: calculateLegAngle(keypoints.left),
                right: calculateLegAngle(keypoints.right)
            };

            // Determine which leg is currently lifted (if any)
            const leftAngle = angles.left;
            const rightAngle = angles.right;
            const currentLeg = lastLegRef.current === 'none' ? 'left' : 
                             lastLegRef.current === 'left' ? 'right' : 'left';
            const otherLeg = currentLeg === 'left' ? 'right' : 'left';
            const currentLegAngle = currentLeg === 'left' ? leftAngle : rightAngle;
            const otherLegAngle = otherLeg === 'left' ? leftAngle : rightAngle;

            console.log(`--- STATE ---`);
            console.log(`Current leg to lift: ${currentLeg}`);
            console.log(`Angles - Left: ${leftAngle.toFixed(1)}° (${leftAngle < 120 ? 'LIFTED' : 'down'}), Right: ${rightAngle.toFixed(1)}° (${rightAngle < 120 ? 'LIFTED' : 'down'})`);

            // Check if we should switch legs
            const isLegLifted = currentLegAngle < 120; // Threshold for lifted leg
            const isOtherLegDown = otherLegAngle > 150; // Threshold for down leg

            // Check if we're ready to detect a lift
            if (isLegLifted && isOtherLegDown) {
                // Count the lift
                if (currentLeg === 'left') {
                    leftLegCountRef.current++;
                    console.log(`Left leg lifted! Count: ${leftLegCountRef.current}`);
                    feedbackRef.current = 'Good! Now lift your right knee';
                } else {
                    rightLegCountRef.current++;
                    console.log(`Right leg lifted! Count: ${rightLegCountRef.current}`);
                    feedbackRef.current = 'Good! Now lift your left knee';
                }
                
                // Update the last lifted leg
                lastLegRef.current = currentLeg;
                
                // Check if we've completed a full rep (both legs lifted in sequence)
                if (leftLegCountRef.current > 0 && rightLegCountRef.current > 0) {
                    // Complete one full rep
                    repCountRef.current++;
                    console.log(`Rep ${repCountRef.current} completed!`);
                    feedbackRef.current = `Great! Rep ${repCountRef.current} done. Next rep: lift your left knee`;
                    
                    // Reset the state for the next rep
                    leftLegCountRef.current = 0;
                    rightLegCountRef.current = 0;
                    lastLegRef.current = 'none';  // Reset to start new rep
                    
                    // If we've reached the target reps, complete the exercise
                    if (repCountRef.current >= targetReps) {
                        handleExerciseComplete(repCountRef.current);
                        return; // Exit early if exercise is complete
                    } else {
                        feedbackRef.current = `Good! ${repCountRef.current} reps completed. Next rep: left leg first`;
                        console.log('--- STARTING NEW REP ---');
                    }
                }
            } else {
                // Only show "lift higher" if the leg is partially raised
                if (currentLegAngle < 150 && currentLegAngle >= 120) {
                    feedbackRef.current = `Lift your ${currentLeg} knee higher!`;
                } else if (currentLegAngle >= 150 && otherLegAngle < 120) {
                    // If the other leg is lifted when it shouldn't be
                    feedbackRef.current = `Keep your ${otherLeg} leg down while lifting your ${currentLeg} knee`;
                } else if (lastLegRef.current === 'none') {
                    // Initial state - tell user to start with left leg
                    feedbackRef.current = 'Start by lifting your left knee';
                } else {
                    // Default instruction
                    feedbackRef.current = `Lift your ${currentLeg} knee`;
                };
            }
        } else {
            feedbackRef.current = "Please ensure your hips and knees are visible in the frame";
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
    if (!leg.hip || !leg.knee || !leg.ankle) return 180;
    
    const angle = calculateInteriorAngle(
        { x: leg.hip.x, y: leg.hip.y },
        { x: leg.knee.x, y: leg.knee.y },
        { x: leg.ankle.x, y: leg.ankle.y }
    );
    
    return isNaN(angle) ? 180 : angle;
};

export default StandingMarch_repDetection;
