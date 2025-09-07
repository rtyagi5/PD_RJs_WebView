import { calculateInteriorAngle, calculateDistance, getMidpoint, calculateSlope } from './utilities';

// Exercise state machine states
const EXERCISE_STATES = {
    IDLE: 'IDLE',
    SETUP: 'SETUP',
    LOWER: 'LOWER',
    HOLD: 'HOLD',
    PUSH: 'PUSH',
    COMPLETE: 'COMPLETE'
};

// Default configuration
const DEFAULTS = {
    // Angle thresholds (in degrees)
    ELBOW_ANGLE_MIN: 70,           // Minimum elbow angle at bottom of push-up
    ELBOW_ANGLE_MAX: 160,          // Maximum elbow angle at top of push-up
    SHOULDER_ANGLE_THRESHOLD: 20,  // Maximum shoulder angle from vertical
    HOLD_SECONDS: 1.0,             // Hold time at bottom (in seconds)
    REFRACTORY_MS: 500,            // Cooldown between reps (milliseconds)
    KP_MIN: 0.6,                   // Minimum confidence score for keypoints
    
    // Distance thresholds (as ratio of shoulder width)
    HAND_SHOULDER_OFFSET: 0.2,     // How much hands can be outside shoulder width
    MIN_SHOULDER_DISTANCE: 1.2,    // Minimum hand distance as ratio of shoulder width
    MAX_SHOULDER_DISTANCE: 1.8,    // Maximum hand distance as ratio of shoulder width
    
    // Feedback messages
    FEEDBACK: {
        SETUP: 'Stand arm\'s length from wall, hands on wall at shoulder height',
        READY: 'Bend elbows to lower your chest toward the wall',
        TOO_CLOSE: 'Move slightly closer to the wall',
        TOO_FAR: 'Move slightly further from the wall',
        HANDS_TOO_WIDE: 'Bring your hands slightly closer together',
        HANDS_TOO_NARROW: 'Place your hands slightly wider apart',
        LOWER: 'Lower your chest toward the wall',
        HOLD: 'Hold at the bottom',
        PUSH: 'Push back to starting position',
        COMPLETE: 'Great job! Exercise complete!',
        POSTURE: 'Keep your body in a straight line',
        ELBOWS_IN: 'Keep elbows slightly tucked in',
        FULL_RANGE: 'Lower until your elbows are at 90 degrees',
        ALIGNMENT: 'Keep your head in line with your body'
    },
    
    // Colors for visualization
    COLORS: {
        DEFAULT: 'aqua',
        CORRECT: '#00FF00',
        WARNING: '#FFA500',
        ERROR: 'red'
    }
};

// Helper function to calculate body angles for push-up form
function calculatePushUpAngles(keypoints) {
    const angles = {
        leftElbow: 180,
        rightElbow: 180,
        leftShoulder: 180,
        rightShoulder: 180,
        bodyAngle: 0
    };

    // Calculate elbow angles
    if (keypoints.leftShoulder && keypoints.leftElbow && keypoints.leftWrist) {
        angles.leftElbow = calculateInteriorAngle(
            keypoints.leftShoulder,
            keypoints.leftElbow,
            keypoints.leftWrist
        );
    }
    
    if (keypoints.rightShoulder && keypoints.rightElbow && keypoints.rightWrist) {
        angles.rightElbow = calculateInteriorAngle(
            keypoints.rightShoulder,
            keypoints.rightElbow,
            keypoints.rightWrist
        );
    }

    // Calculate shoulder angles (from vertical)
    if (keypoints.leftElbow && keypoints.leftShoulder && keypoints.leftHip) {
        angles.leftShoulder = calculateInteriorAngle(
            {x: keypoints.leftShoulder.x, y: keypoints.leftShoulder.y - 10}, // Point above shoulder
            keypoints.leftShoulder,
            keypoints.leftElbow
        );
    }
    
    if (keypoints.rightElbow && keypoints.rightShoulder && keypoints.rightHip) {
        angles.rightShoulder = calculateInteriorAngle(
            {x: keypoints.rightShoulder.x, y: keypoints.rightShoulder.y - 10}, // Point above shoulder
            keypoints.rightShoulder,
            keypoints.rightElbow
        );
    }

    // Calculate body angle (from vertical)
    if (keypoints.nose && keypoints.leftShoulder && keypoints.rightShoulder && 
        keypoints.leftHip && keypoints.rightHip) {
        const shoulderMid = getMidpoint(keypoints.leftShoulder, keypoints.rightShoulder);
        const hipMid = getMidpoint(keypoints.leftHip, keypoints.rightHip);
        
        // Calculate angle between vertical and shoulder-hip line
        angles.bodyAngle = Math.abs(calculateSlope(
            {x: shoulderMid.x, y: shoulderMid.y - 10}, // Point above shoulders
            hipMid
        ) * (180 / Math.PI));
    }
    
    return angles;
}

// Helper to check hand placement
function checkHandPlacement(keypoints) {
    if (!keypoints.leftShoulder || !keypoints.rightShoulder || 
        !keypoints.leftWrist || !keypoints.rightWrist) {
        return {
            isValid: false,
            message: 'Please ensure hands and shoulders are visible',
            isTooWide: false,
            isTooNarrow: false
        };
    }
    
    const shoulderWidth = calculateDistance(keypoints.leftShoulder, keypoints.rightShoulder);
    const handDistance = calculateDistance(keypoints.leftWrist, keypoints.rightWrist);
    
    const isTooWide = handDistance > shoulderWidth * DEFAULTS.MAX_SHOULDER_DISTANCE;
    const isTooNarrow = handDistance < shoulderWidth * DEFAULTS.MIN_SHOULDER_DISTANCE;
    
    // Check if hands are at shoulder height
    const leftHandAtShoulderHeight = Math.abs(keypoints.leftWrist.y - keypoints.leftShoulder.y) < 
                                   shoulderWidth * 0.2;
    const rightHandAtShoulderHeight = Math.abs(keypoints.rightWrist.y - keypoints.rightShoulder.y) < 
                                    shoulderWidth * 0.2;
    
    return {
        isValid: !isTooWide && !isTooNarrow && leftHandAtShoulderHeight && rightHandAtShoulderHeight,
        isTooWide,
        isTooNarrow,
        shoulderWidth,
        handDistance,
        leftHandAtShoulderHeight,
        rightHandAtShoulderHeight
    };
}

// Main exercise detection function
const WallPushUps_repDetection = (
    poses,
    side = 'both',
    feedbackRef,
    leftArmCountRef = { current: 0 },
    rightArmCountRef = { current: 0 },
    repCountRef = { current: 0 },
    targetReps = 10,
    handleExerciseComplete = () => {},
    keypointColorsRef = { current: DEFAULTS.COLORS.DEFAULT },
    segmentColorsRef = { current: DEFAULTS.COLORS.DEFAULT },
    keypointsRef = { current: [] },
    feedbackLockRef = { current: { locked: false } },
    lastRepTimeRef = { current: 0 }
) => {
    // Initialize state
    const state = {
        phase: 'IDLE',
        lastRepTime: 0,
        holdStartTime: 0,
        lastPhaseChange: Date.now(),
        isComplete: false,
        lastFeedbackTime: 0,
        repCount: 0,
        minElbowAngle: 180,
        maxElbowAngle: 0,
        isInPosition: false,
        hasStarted: false
    };

    // Early return if no poses detected
    if (!poses?.[0]?.keypoints?.length) {
        feedbackRef.current = 'No pose detected. Please position yourself in view.';
        keypointColorsRef.current = DEFAULTS.COLORS.ERROR;
        return getResult(state);
    }

    // Extract and organize keypoints
    const keypoints = {};
    const pose = poses[0];
    
    // Get required keypoints
    const keypointNames = [
        'nose',
        'left_shoulder', 'right_shoulder',
        'left_elbow', 'right_elbow',
        'left_wrist', 'right_wrist',
        'left_hip', 'right_hip',
        'left_knee', 'right_knee',
        'left_ankle', 'right_ankle'
    ];

    // Populate keypoints object
    keypointNames.forEach(name => {
        const kp = pose.keypoints.find(k => k.name === name && k.score >= DEFAULTS.KP_MIN);
        if (kp) {
            keypoints[name] = kp;
        }
    });

    // Check if we have all required keypoints
    const requiredKeypoints = [
        'left_shoulder', 'right_shoulder',
        'left_elbow', 'right_elbow',
        'left_wrist', 'right_wrist'
    ];

    const missingKeypoints = requiredKeypoints.filter(k => !keypoints[k]);
    if (missingKeypoints.length > 2) { // Allow some keypoints to be missing
        feedbackRef.current = 'Please ensure your upper body is visible';
        keypointColorsRef.current = DEFAULTS.COLORS.ERROR;
        return getResult(state);
    }

    // Calculate body measurements
    const angles = calculatePushUpAngles(keypoints);
    const handPlacement = checkHandPlacement(keypoints);
    
    // Calculate average elbow angle
    const avgElbowAngle = (angles.leftElbow + angles.rightElbow) / 2;
    
    // State machine
    const currentTime = Date.now();
    const timeInPhase = currentTime - state.lastPhaseChange;
    const minPhaseTime = 300; // ms
    
    if (timeInPhase >= minPhaseTime) {
        // Update min/max angles for range of motion tracking
        state.minElbowAngle = Math.min(state.minElbowAngle, avgElbowAngle);
        state.maxElbowAngle = Math.max(state.maxElbowAngle, avgElbowAngle);
        
        switch (state.phase) {
            case 'IDLE':
                // Check if in starting position
                const isInPosition = handPlacement.isValid && 
                                   angles.bodyAngle < DEFAULTS.SHOULDER_ANGLE_THRESHOLD &&
                                   avgElbowAngle > DEFAULTS.ELBOW_ANGLE_MAX * 0.9; // Almost straight arms
                
                if (isInPosition) {
                    state.phase = 'SETUP';
                    state.lastPhaseChange = currentTime;
                    state.hasStarted = true;
                    feedbackRef.current = DEFAULTS.FEEDBACK.READY;
                    keypointColorsRef.current = DEFAULTS.COLORS.CORRECT;
                    segmentColorsRef.current = DEFAULTS.COLORS.CORRECT;
                } else {
                    // Provide specific feedback on what needs adjustment
                    if (!handPlacement.leftHandAtShoulderHeight || !handPlacement.rightHandAtShoulderHeight) {
                        feedbackRef.current = DEFAULTS.FEEDBACK.SETUP;
                    } else if (handPlacement.isTooWide) {
                        feedbackRef.current = DEFAULTS.FEEDBACK.HANDS_TOO_WIDE;
                    } else if (handPlacement.isTooNarrow) {
                        feedbackRef.current = DEFAULTS.FEEDBACK.HANDS_TOO_NARROW;
                    } else if (angles.bodyAngle >= DEFAULTS.SHOULDER_ANGLE_THRESHOLD) {
                        feedbackRef.current = DEFAULTS.FEEDBACK.POSTURE;
                    } else {
                        feedbackRef.current = DEFAULTS.FEEDBACK.SETUP;
                    }
                    
                    keypointColorsRef.current = DEFAULTS.COLORS.WARNING;
                    segmentColorsRef.current = DEFAULTS.COLORS.WARNING;
                }
                break;
                
            case 'SETUP':
                // Transition to LOWER phase when starting to bend elbows
                if (avgElbowAngle < DEFAULTS.ELBOW_ANGLE_MAX * 0.9) {
                    state.phase = 'LOWER';
                    state.lastPhaseChange = currentTime;
                    feedbackRef.current = DEFAULTS.FEEDBACK.LOWER;
                } else if (timeInPhase > 2000) {
                    // Remind to start the movement
                    feedbackRef.current = DEFAULTS.FEEDBACK.LOWER;
                }
                break;
                
            case 'LOWER':
                // Check if reached bottom position
                if (avgElbowAngle <= DEFAULTS.ELBOW_ANGLE_MIN) {
                    state.phase = 'HOLD';
                    state.holdStartTime = currentTime;
                    state.lastPhaseChange = currentTime;
                    feedbackRef.current = DEFAULTS.FEEDBACK.HOLD;
                } else if (avgElbowAngle > DEFAULTS.ELBOW_ANGLE_MAX * 0.9) {
                    // Moved back up without reaching bottom
                    feedbackRef.current = DEFAULTS.FEEDBACK.LOWER;
                }
                break;
                
            case 'HOLD':
                // Hold at the bottom for specified duration
                if (currentTime - state.holdStartTime > DEFAULTS.HOLD_SECONDS * 1000) {
                    state.phase = 'PUSH';
                    state.lastPhaseChange = currentTime;
                    feedbackRef.current = DEFAULTS.FEEDBACK.PUSH;
                } else {
                    const timeLeft = ((DEFAULTS.HOLD_SECONDS * 1000) - (currentTime - state.holdStartTime)) / 1000;
                    feedbackRef.current = `Hold for ${timeLeft.toFixed(1)}s`;
                }
                break;
                
            case 'PUSH':
                // Check if returned to starting position
                if (avgElbowAngle >= DEFAULTS.ELBOW_ANGLE_MAX * 0.9) {
                    // Count the rep
                    state.repCount++;
                    leftArmCountRef.current = state.repCount;
                    rightArmCountRef.current = state.repCount;
                    repCountRef.current = state.repCount;
                    
                    state.lastRepTime = currentTime;
                    lastRepTimeRef.current = currentTime;
                    
                    // Check if target reps reached
                    if (state.repCount >= targetReps) {
                        state.phase = 'COMPLETE';
                        state.lastPhaseChange = currentTime;
                        state.isComplete = true;
                        feedbackRef.current = DEFAULTS.FEEDBACK.COMPLETE;
                    } else {
                        // Start next rep
                        state.phase = 'SETUP';
                        state.lastPhaseChange = currentTime;
                        feedbackRef.current = 'Ready for next rep';
                    }
                } else if (timeInPhase > 3000) {
                    // Taking too long to push up
                    feedbackRef.current = DEFAULTS.FEEDBACK.PUSH;
                    keypointColorsRef.current = DEFAULTS.COLORS.WARNING;
                }
                break;
                
            case 'COMPLETE':
                if (timeInPhase > 2000) { // Show completion message for 2 seconds
                    handleExerciseComplete(repCountRef.current);
                    return getResult(state, true);
                }
                break;
                
            default:
                break;
        }
    }
    
    // Form feedback
    if (state.phase !== 'IDLE' && state.phase !== 'COMPLETE') {
        if (angles.bodyAngle > DEFAULTS.SHOULDER_ANGLE_THRESHOLD * 1.5) {
            feedbackRef.current = DEFAULTS.FEEDBACK.POSTURE;
            keypointColorsRef.current = DEFAULTS.COLORS.WARNING;
            segmentColorsRef.current = DEFAULTS.COLORS.WARNING;
        } else if (Math.abs(angles.leftShoulder - angles.rightShoulder) > 20) {
            feedbackRef.current = 'Keep both sides even';
            keypointColorsRef.current = DEFAULTS.COLORS.WARNING;
        } else if (state.phase === 'LOWER' && 
                  avgElbowAngle < DEFAULTS.ELBOW_ANGLE_MIN * 1.2 && 
                  currentTime - state.lastFeedbackTime > 3000) {
            feedbackRef.current = DEFAULTS.FEEDBACK.FULL_RANGE;
            state.lastFeedbackTime = currentTime;
        }
    }

    // Set keypoints for visualization
    keypointsRef.current = [
        'left_shoulder', 'right_shoulder',
        'left_elbow', 'right_elbow',
        'left_wrist', 'right_wrist',
        'left_hip', 'right_hip'
    ];

    return getResult(state);

    // Helper function to format the result
    function getResult(state, isComplete = false) {
        const result = {
            keypoints: keypointsRef.current,
            keypointColors: keypointColorsRef.current,
            segmentColors: segmentColorsRef.current,
            feedback: feedbackRef.current || DEFAULTS.FEEDBACK.SETUP,
            leftArmCount: leftArmCountRef.current || 0,
            rightArmCount: rightArmCountRef.current || 0,
            repCount: repCountRef.current || 0,
            isComplete: isComplete || state.isComplete,
            phase: state.phase
        };
        
        // Update the refs for the next frame
        repCountRef.current = result.repCount;
        leftArmCountRef.current = result.leftArmCount;
        rightArmCountRef.current = result.rightArmCount;
        
        return result;
    }
};

export default WallPushUps_repDetection;
