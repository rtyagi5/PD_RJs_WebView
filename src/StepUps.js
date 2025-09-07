import { calculateInteriorAngle, calculateDistance, getMidpoint, calculateSlope } from './utilities';

// Exercise state machine states
const EXERCISE_STATES = {
    IDLE: 'IDLE',
    STEP_UP: 'STEP_UP',
    HOLD: 'HOLD',
    STEP_DOWN: 'STEP_DOWN',
    SWITCH: 'SWITCH',
    COMPLETE: 'COMPLETE'
};

// Default configuration
const DEFAULTS = {
    // Angle thresholds (in degrees)
    KNEE_ANGLE_THRESHOLD: 90,       // Target knee angle for step up
    HIP_ANGLE_THRESHOLD: 170,       // Target hip angle when standing tall
    HOLD_SECONDS: 1.0,              // Hold time at the top (in seconds)
    REFRACTORY_MS: 500,             // Cooldown between reps (milliseconds)
    KP_MIN: 0.6,                    // Minimum confidence score for keypoints
    
    // Movement thresholds
    MIN_STEP_HEIGHT: 0.15,          // Minimum step height (as ratio of leg length)
    MAX_LEAN_ANGLE: 15,             // Maximum forward/backward lean (degrees)
    
    // Feedback messages
    FEEDBACK: {
        START: 'Stand facing the step, feet shoulder-width apart',
        STEP_UP: 'Step up onto the platform, pressing through your heel',
        HOLD: 'Stand tall on the step',
        STEP_DOWN: 'Step back down with control',
        SWITCH: 'Switch leading legs',
        COMPLETE: 'Great job! Exercise complete!',
        POSTURE: 'Keep your back straight and core engaged',
        BALANCE: 'Hold onto support if needed for balance',
        HEEL_PRESS: 'Press through your heel to lift',
        CONTROLLED_MOVEMENT: 'Move with control, especially when stepping down',
        FULL_RANGE: 'Make sure to fully extend your hip at the top'
    },
    
    // Colors for visualization
    COLORS: {
        DEFAULT: 'aqua',
        CORRECT: '#00FF00',
        WARNING: '#FFA500',
        ERROR: 'red'
    }
};

// Helper function to calculate body angles
function calculateBodyAngles(keypoints) {
    const angles = {
        leftKnee: 180,
        rightKnee: 180,
        leftHip: 180,
        rightHip: 180
    };

    // Calculate knee angles
    if (keypoints.leftHip && keypoints.leftKnee && keypoints.leftAnkle) {
        angles.leftKnee = calculateInteriorAngle(
            keypoints.leftHip,
            keypoints.leftKnee,
            keypoints.leftAnkle
        );
    }
    
    if (keypoints.rightHip && keypoints.rightKnee && keypoints.rightAnkle) {
        angles.rightKnee = calculateInteriorAngle(
            keypoints.rightHip,
            keypoints.rightKnee,
            keypoints.rightAnkle
        );
    }

    // Calculate hip angles (simplified as angle between hip, shoulder, knee)
    if (keypoints.leftShoulder && keypoints.leftHip && keypoints.leftKnee) {
        angles.leftHip = calculateInteriorAngle(
            keypoints.leftShoulder,
            keypoints.leftHip,
            keypoints.leftKnee
        );
    }
    
    if (keypoints.rightShoulder && keypoints.rightHip && keypoints.rightKnee) {
        angles.rightHip = calculateInteriorAngle(
            keypoints.rightShoulder,
            keypoints.rightHip,
            keypoints.rightKnee
        );
    }

    return angles;
}

// Helper to check balance (lateral lean)
function checkBalance(keypoints) {
    if (!keypoints.leftShoulder || !keypoints.rightShoulder || 
        !keypoints.leftHip || !keypoints.rightHip) {
        return { isBalanced: false, leanAngle: 0 };
    }

    const shoulderMid = getMidpoint(keypoints.leftShoulder, keypoints.rightShoulder);
    const hipMid = getMidpoint(keypoints.leftHip, keypoints.rightHip);
    
    // Calculate vertical line (straight down from shoulders)
    const verticalSlope = 1000; // Near vertical
    const shoulderHipSlope = calculateSlope(shoulderMid, hipMid);
    
    // Calculate angle between vertical and shoulder-hip line
    const leanAngle = Math.abs(Math.atan2(
        verticalSlope - shoulderHipSlope,
        1 + verticalSlope * shoulderHipSlope
    ) * (180 / Math.PI));
    
    return {
        isBalanced: leanAngle < DEFAULTS.MAX_LEAN_ANGLE,
        leanAngle
    };
}

// Main exercise detection function
const StepUps_repDetection = (
    poses,
    side = 'both',
    feedbackRef,
    leftLegCountRef = { current: 0 },
    rightLegCountRef = { current: 0 },
    startLegRef = { current: 'left' },
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
        activeLeg: side === 'both' ? startLegRef.current : side,
        isComplete: false,
        lastFeedbackTime: 0,
        repCount: 0,
        totalReps: targetReps * (side === 'both' ? 2 : 1), // Double for both sides
        stepHeight: 0,
        startPosition: { x: 0, y: 0 },
        currentPosition: { x: 0, y: 0 }
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
        'left_shoulder', 'right_shoulder',
        'left_hip', 'right_hip',
        'left_knee', 'right_knee',
        'left_ankle', 'right_ankle',
        'left_heel', 'right_heel',
        'left_foot_index', 'right_foot_index'
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
        'left_hip', 'right_hip',
        'left_knee', 'right_knee',
        'left_ankle', 'right_ankle'
    ];

    const missingKeypoints = requiredKeypoints.filter(k => !keypoints[k]);
    if (missingKeypoints.length > 3) { // Allow some keypoints to be missing
        feedbackRef.current = 'Please ensure your full body is visible';
        keypointColorsRef.current = DEFAULTS.COLORS.ERROR;
        return getResult(state);
    }

    // Calculate body measurements
    const angles = calculateBodyAngles(keypoints);
    const { isBalanced, leanAngle } = checkBalance(keypoints);
    
    // Calculate leg lengths for normalization
    const leftLegLength = calculateDistance(keypoints.leftHip, keypoints.leftKnee) + 
                         calculateDistance(keypoints.leftKnee, keypoints.leftAnkle);
    const rightLegLength = calculateDistance(keypoints.rightHip, keypoints.rightKnee) + 
                          calculateDistance(keypoints.rightKnee, keypoints.rightAnkle);
    const avgLegLength = (leftLegLength + rightLegLength) / 2;

    // Determine active and supporting legs
    const activeLegKey = `${state.activeLeg}_`;
    const activeKnee = keypoints[`${activeLegKey}knee`];
    const activeAnkle = keypoints[`${activeLegKey}ankle`];
    const activeHip = keypoints[`${activeLegKey}hip`];
    
    const otherLeg = state.activeLeg === 'left' ? 'right' : 'left';
    const otherLegKey = `${otherLeg}_`;
    const otherKnee = keypoints[`${otherLegKey}knee`];
    const otherAnkle = keypoints[`${otherLegKey}ankle`];
    const otherHip = keypoints[`${otherLegKey}hip`];

    // Calculate step height (vertical distance between ankles)
    const stepHeight = activeAnkle && otherAnkle 
        ? Math.abs(activeAnkle.y - otherAnkle.y) / avgLegLength 
        : 0;

    // State machine
    const currentTime = Date.now();
    const timeInPhase = currentTime - state.lastPhaseChange;
    const minPhaseTime = 300; // ms
    
    if (timeInPhase >= minPhaseTime) {
        switch (state.phase) {
            case 'IDLE':
                // Check if in starting position (feet shoulder-width apart, facing forward)
                const shoulderWidth = calculateDistance(keypoints.left_shoulder, keypoints.right_shoulder);
                const ankleDistance = calculateDistance(
                    keypoints.left_ankle || keypoints.left_heel || keypoints.left_foot_index,
                    keypoints.right_ankle || keypoints.right_heel || keypoints.right_foot_index
                );
                
                const isGoodStart = ankleDistance >= shoulderWidth * 0.8 && 
                                  ankleDistance <= shoulderWidth * 1.5;
                
                if (isGoodStart) {
                    state.phase = 'STEP_UP';
                    state.lastPhaseChange = currentTime;
                    state.stepHeight = 0; // Reset step height
                    feedbackRef.current = DEFAULTS.FEEDBACK.STEP_UP;
                    keypointColorsRef.current = DEFAULTS.COLORS.CORRECT;
                    segmentColorsRef.current = DEFAULTS.COLORS.CORRECT;
                } else {
                    feedbackRef.current = DEFAULTS.FEEDBACK.START;
                    keypointColorsRef.current = DEFAULTS.COLORS.WARNING;
                    segmentColorsRef.current = DEFAULTS.COLORS.WARNING;
                }
                break;
                
            case 'STEP_UP':
                // Check if stepping up (one foot higher than the other)
                const minStepHeight = DEFAULTS.MIN_STEP_HEIGHT * avgLegLength;
                const isSteppingUp = stepHeight > minStepHeight && 
                                   angles[`${state.activeLeg}Knee`] < 120;
                
                if (isSteppingUp) {
                    // Update max step height
                    state.stepHeight = Math.max(state.stepHeight, stepHeight);
                    
                    // Check if reached top position
                    if (angles[`${state.activeLeg}Knee`] > 160 && 
                        angles[`${state.activeLeg}Hip`] > 160) {
                        state.phase = 'HOLD';
                        state.holdStartTime = currentTime;
                        state.lastPhaseChange = currentTime;
                        feedbackRef.current = DEFAULTS.FEEDBACK.HOLD;
                    }
                } else if (timeInPhase > 2000) { // Give them time to start moving
                    feedbackRef.current = DEFAULTS.FEEDBACK.HEEL_PRESS;
                    keypointColorsRef.current = DEFAULTS.COLORS.WARNING;
                }
                break;
                
            case 'HOLD':
                // Hold at the top for specified duration
                if (currentTime - state.holdStartTime > DEFAULTS.HOLD_SECONDS * 1000) {
                    state.phase = 'STEP_DOWN';
                    state.lastPhaseChange = currentTime;
                    feedbackRef.current = DEFAULTS.FEEDBACK.STEP_DOWN;
                } else {
                    const timeLeft = ((DEFAULTS.HOLD_SECONDS * 1000) - (currentTime - state.holdStartTime)) / 1000;
                    feedbackRef.current = `Hold for ${timeLeft.toFixed(1)}s`;
                }
                break;
                
            case 'STEP_DOWN':
                // Check if returned to starting position
                const isSteppedDown = stepHeight < (minStepHeight * 0.5);
                
                if (isSteppedDown) {
                    // Count the rep
                    state.repCount++;
                    if (state.activeLeg === 'left') {
                        leftLegCountRef.current++;
                    } else {
                        rightLegCountRef.current++;
                    }
                    
                    state.lastRepTime = currentTime;
                    lastRepTimeRef.current = currentTime;
                    repCountRef.current = Math.ceil(state.repCount / (side === 'both' ? 2 : 1));
                    
                    // Check if we need to switch legs or complete
                    if (state.repCount < state.totalReps) {
                        if (side === 'both' && state.repCount % 2 === 0) {
                            // Switch legs after each rep when doing both sides
                            state.phase = 'SWITCH';
                            const newLeg = state.activeLeg === 'left' ? 'right' : 'left';
                            state.activeLeg = newLeg;
                            startLegRef.current = newLeg;
                            feedbackRef.current = DEFAULTS.FEEDBACK.SWITCH;
                        } else {
                            // Continue with same leg
                            state.phase = 'STEP_UP';
                            state.lastPhaseChange = currentTime;
                            feedbackRef.current = DEFAULTS.FEEDBACK.STEP_UP;
                        }
                    } else {
                        // All reps complete
                        state.phase = 'COMPLETE';
                        state.lastPhaseChange = currentTime;
                        state.isComplete = true;
                        feedbackRef.current = DEFAULTS.FEEDBACK.COMPLETE;
                    }
                } else if (timeInPhase > 3000) {
                    feedbackRef.current = DEFAULTS.FEEDBACK.CONTROLLED_MOVEMENT;
                    keypointColorsRef.current = DEFAULTS.COLORS.WARNING;
                }
                break;
                
            case 'SWITCH':
                if (timeInPhase > 1000) { // 1 second to switch legs
                    state.phase = 'STEP_UP';
                    state.lastPhaseChange = currentTime;
                    feedbackRef.current = DEFAULTS.FEEDBACK.STEP_UP;
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
    if (!isBalanced) {
        feedbackRef.current = DEFAULTS.FEEDBACK.BALANCE;
        keypointColorsRef.current = DEFAULTS.COLORS.WARNING;
        segmentColorsRef.current = DEFAULTS.COLORS.WARNING;
    } else if (state.phase === 'STEP_UP' && angles[`${state.activeLeg}Hip`] < 150 && 
               currentTime - state.lastFeedbackTime > 3000) {
        feedbackRef.current = DEFAULTS.FEEDBACK.FULL_RANGE;
        state.lastFeedbackTime = currentTime;
    }

    // Set keypoints for visualization
    keypointsRef.current = [
        'left_shoulder', 'right_shoulder',
        'left_hip', 'right_hip',
        'left_knee', 'right_knee',
        'left_ankle', 'right_ankle'
    ];

    return getResult(state);

    // Helper function to format the result
    function getResult(state, isComplete = false) {
        const result = {
            keypoints: keypointsRef.current,
            keypointColors: keypointColorsRef.current,
            segmentColors: segmentColorsRef.current,
            feedback: feedbackRef.current || DEFAULTS.FEEDBACK.START,
            leftLegCount: leftLegCountRef.current || 0,
            rightLegCount: rightLegCountRef.current || 0,
            repCount: repCountRef.current || 0,
            isComplete: isComplete || state.isComplete,
            phase: state.phase,
            activeLeg: state.activeLeg
        };
        
        // Update the refs for the next frame
        repCountRef.current = result.repCount;
        leftLegCountRef.current = result.leftLegCount;
        rightLegCountRef.current = result.rightLegCount;
        startLegRef.current = state.activeLeg;
        
        return result;
    }
};

export default StepUps_repDetection;
