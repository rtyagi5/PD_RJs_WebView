// Import common utility functions
import { calculateInteriorAngle } from './utilities';

// Track initialization state
let hasInitialized = false;

// Create refs at the module level
const lastLegSwitchTimeRef = { current: 0 };

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
    feedbackLockRef,
    lastLegSwitchTime = lastLegSwitchTimeRef
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
    
    // Track leg states with more descriptive values
    const LEG_STATES = {
        NONE: 0,    // Leg hasn't moved yet
        LIFTED: 1,  // Leg is lifted
        LOWERED: 2  // Leg has been lifted and lowered (complete movement)
    };

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

        // Calculate angles for both hips and knees using the common utility function
        const calculateAngles = (side) => {
            const shoulder = keypoints[side].shoulder;
            const hip = keypoints[side].hip;
            const knee = keypoints[side].knee;
            const ankle = keypoints[side].ankle;

            // Calculate hip angle (shoulder-hip-knee)
            const hipAngle = calculateInteriorAngle(
                shoulder,
                hip,
                knee
            ) || 180; // Default to 180 if calculation fails

            // Calculate knee angle (hip-knee-ankle)
            const kneeAngle = calculateInteriorAngle(
                hip,
                knee,
                ankle
            ) || 180; // Default to 180 if calculation fails

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

            // Leg switching cooldown
            const LEG_SWITCH_COOLDOWN = 800; // ms to wait before allowing another leg switch
            
            // Angle thresholds for movement detection
            // Adjusted to be more lenient and better for standing march
            const LIFTED_HIP_THRESHOLD = 160;      // Hip angle when lifted (more lenient)
            const LIFTED_KNEE_THRESHOLD = 150;     // Knee angle when lifted (more lenient)
            const LOWERED_HIP_THRESHOLD = 170;     // Hip angle when fully lowered
            const LOWERED_KNEE_THRESHOLD = 165;    // Knee angle when fully lowered
            
            // Check if legs are lifted or lowered
            // A leg is considered lifted if it's bent
            const isLeftLegLifted = leftHipAngle < LIFTED_HIP_THRESHOLD && 
                                 leftKneeAngle < LIFTED_KNEE_THRESHOLD;
                                  
            const isRightLegLifted = rightHipAngle < LIFTED_HIP_THRESHOLD && 
                                  rightKneeAngle < LIFTED_KNEE_THRESHOLD;
            
            // A leg is considered lowered if it's straight
            const isLeftLegLowered = leftHipAngle > LOWERED_HIP_THRESHOLD && 
                                  leftKneeAngle > LOWERED_KNEE_THRESHOLD;
                                  
            const isRightLegLowered = rightHipAngle > LOWERED_HIP_THRESHOLD && 
                                   rightKneeAngle > LOWERED_KNEE_THRESHOLD;
            
            // Track previous states for edge detection
            const prevLeftLegState = leftLegCountRef.current;
            const prevRightLegState = rightLegCountRef.current;
            
            // Debug logging for leg states - only log when there's a state change
            const leftState = isLeftLegLifted ? 'LIFTED' : isLeftLegLowered ? 'LOWERED' : 'MOVING';
            const rightState = isRightLegLifted ? 'LIFTED' : isRightLegLowered ? 'LOWERED' : 'MOVING';
            
            if (leftState !== (window.lastLeftState || '') || rightState !== (window.lastRightState || '')) {
                console.log(`[LEFT] Hip: ${leftHipAngle.toFixed(1)}°, Knee: ${leftKneeAngle.toFixed(1)}° - ${leftState}`);
                console.log(`[RIGHT] Hip: ${rightHipAngle.toFixed(1)}°, Knee: ${rightKneeAngle.toFixed(1)}° - ${rightState}`);
                window.lastLeftState = leftState;
                window.lastRightState = rightState;
            }

            // Only process if we're not locked and have good keypoint confidence
            const MIN_CONFIDENCE = 0.4; // Minimum confidence score for keypoints
            const hasGoodConfidence = 
                keypoints.left.hip?.score > MIN_CONFIDENCE &&
                keypoints.left.knee?.score > MIN_CONFIDENCE &&
                keypoints.right.hip?.score > MIN_CONFIDENCE &&
                keypoints.right.knee?.score > MIN_CONFIDENCE;
                
            if (!feedbackLockRef.current.locked && hasGoodConfidence) {
                const now = Date.now();
                const canSwitchLegs = now - lastLegSwitchTime.current > LEG_SWITCH_COOLDOWN; // 800ms cooldown
                
                // Handle left leg state changes
                if (isLeftLegLifted && prevLeftLegState !== LEG_STATES.LIFTED) {
                    leftLegCountRef.current = LEG_STATES.LIFTED;
                    console.log(`[StandingMarch] Left leg lifted (Hip: ${leftHipAngle.toFixed(1)}°, Knee: ${leftKneeAngle.toFixed(1)}°)`);
                    feedbackRef.current = 'Left leg up';
                    
                    // Lock briefly to prevent rapid state changes
                    feedbackLockRef.current.locked = true;
                    setTimeout(() => {
                        feedbackLockRef.current.locked = false;
                    }, 300);
                } 
                else if (isLeftLegLowered && prevLeftLegState === LEG_STATES.LIFTED) {
                    leftLegCountRef.current = LEG_STATES.LOWERED;
                    console.log(`[StandingMarch] Left leg lowered (Hip: ${leftHipAngle.toFixed(1)}°, Knee: ${leftKneeAngle.toFixed(1)}°)`);
                    feedbackRef.current = 'Left leg down';
                    
                    // Lock briefly to prevent rapid state changes
                    feedbackLockRef.current.locked = true;
                    setTimeout(() => {
                        feedbackLockRef.current.locked = false;
                    }, 300);
                }

                // Handle right leg state changes
                if (isRightLegLifted && prevRightLegState !== LEG_STATES.LIFTED) {
                    rightLegCountRef.current = LEG_STATES.LIFTED;
                    console.log(`[StandingMarch] Right leg lifted (Hip: ${rightHipAngle.toFixed(1)}°, Knee: ${rightKneeAngle.toFixed(1)}°)`);
                    feedbackRef.current = 'Right leg up';
                    
                    // Lock briefly to prevent rapid state changes
                    feedbackLockRef.current.locked = true;
                    setTimeout(() => {
                        feedbackLockRef.current.locked = false;
                    }, 300);
                }
                else if (isRightLegLowered && prevRightLegState === LEG_STATES.LIFTED) {
                    rightLegCountRef.current = LEG_STATES.LOWERED;
                    console.log(`[StandingMarch] Right leg lowered (Hip: ${rightHipAngle.toFixed(1)}°, Knee: ${rightKneeAngle.toFixed(1)}°)`);
                    feedbackRef.current = 'Right leg down';
                    
                    // Lock briefly to prevent rapid state changes
                    feedbackLockRef.current.locked = true;
                    setTimeout(() => {
                        feedbackLockRef.current.locked = false;
                    }, 300);
                }

                // Handle leg switching when current leg completes its movement
                if (currentLeg === 'left' && leftLegCountRef.current === LEG_STATES.LOWERED && canSwitchLegs) {
                    console.log(`[StandingMarch] Left leg completed movement, switching to right`);
                    startLegRef.current = 'right';
                    lastLegSwitchTime.current = now;
                    feedbackRef.current = 'Now lift right leg';
                    feedbackLockRef.current.locked = true;
                    setTimeout(() => {
                        feedbackLockRef.current.locked = false;
                    }, 800);
                }
                else if (currentLeg === 'right' && rightLegCountRef.current === LEG_STATES.LOWERED && canSwitchLegs) {
                    console.log(`[StandingMarch] Right leg completed movement, switching to left`);
                    startLegRef.current = 'left';
                    lastLegSwitchTime.current = now;
                    feedbackRef.current = 'Now lift left leg';
                    feedbackLockRef.current.locked = true;
                    setTimeout(() => {
                        feedbackLockRef.current.locked = false;
                    }, 800);
                }
            }
            
            // Debug log current leg states
            const legStateToString = (state) => {
                switch(state) {
                    case LEG_STATES.NONE: return 'NONE';
                    case LEG_STATES.LIFTED: return 'LIFTED';
                    case LEG_STATES.LOWERED: return 'LOWERED';
                    default: return 'UNKNOWN';
                }
            };
            
            console.log(`[Leg States] Left: ${legStateToString(leftLegCountRef.current)}, Right: ${legStateToString(rightLegCountRef.current)}, Current Leg: ${currentLeg}`);
            
            // Check if both legs have completed their full movement (lifted and lowered)
            const leftLegComplete = leftLegCountRef.current === LEG_STATES.LOWERED;
            const rightLegComplete = rightLegCountRef.current === LEG_STATES.LOWERED;
            
            // Only check for rep completion if we're not in the middle of a movement
            const isStablePosition = 
                (leftLegCountRef.current === LEG_STATES.NONE || leftLegComplete) &&
                (rightLegCountRef.current === LEG_STATES.NONE || rightLegComplete);
            
            if (!feedbackLockRef.current.locked && isStablePosition && leftLegComplete && rightLegComplete) {
                // Count a full rep when both legs have completed their movement
                repCountRef.current += 1;
                console.log(`[StandingMarch] Rep ${repCountRef.current} completed!`);
                feedbackRef.current = `Great! ${repCountRef.current} reps completed`;
                
                // Check if target reps reached
                if (repCountRef.current >= targetReps) {
                    console.log(`[StandingMarch] Exercise complete! ${targetReps} reps done`);
                    await handleExerciseComplete();
                }
                
                // Lock to prevent rapid state changes
                feedbackLockRef.current.locked = true;
                
                // Reset leg states for next rep after a short delay
                setTimeout(() => {
                    leftLegCountRef.current = LEG_STATES.NONE;
                    rightLegCountRef.current = LEG_STATES.NONE;
                    
                    // Alternate the starting leg for the next rep
                    startLegRef.current = startLegRef.current === 'left' ? 'right' : 'left';
                    console.log(`[StandingMarch] Next rep - start with ${startLegRef.current} leg`);
                    
                    // Unlock after a longer delay to ensure stability
                    setTimeout(() => {
                        feedbackLockRef.current.locked = false;
                    }, 1000);
                }, 500);
            }
            
            // Visual feedback for current leg
            // Set keypoint colors for the current leg (red)
            keypointColorsRef.current = "#FF0000"; // Color for keypoints
            keypointsRef.current = [
                `${currentLeg}_hip`,
                `${currentLeg}_knee`,
                `${currentLeg}_ankle`,
                `${currentLeg}_foot_index`,
                `${currentLeg}_heel`
            ];
            
            // Set segment colors for the current leg (red)
            segmentColorsRef.current = "#FF0000";
            
            // Define the segments for the current leg
            const legSegments = currentLeg === 'left' 
                ? [
                    'left_hip-left_knee', 'left_knee-left_ankle',
                    'left_ankle-left_heel', 'left_ankle-left_foot_index',
                    'left_heel-left_foot_index'
                  ]
                : [
                    'right_hip-right_knee', 'right_knee-right_ankle',
                    'right_ankle-right_heel', 'right_ankle-right_foot_index',
                    'right_heel-right_foot_index'
                  ];
            
            keypointsRef.current = [
                ...keypointsRef.current,
                ...legSegments
            ];
            
            // Update feedback to show which leg to lift
            if (!feedbackRef.current || feedbackRef.current === 'Left leg down' || feedbackRef.current === 'Right leg down') {
                feedbackRef.current = `Lift your ${currentLeg} leg`;
            }
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
