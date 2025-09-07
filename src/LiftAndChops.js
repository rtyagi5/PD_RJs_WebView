import { calculateInteriorAngle, calculateDistance, getMidpoint, calculateSlope } from './utilities';

// Exercise state machine states
const EXERCISE_STATES = {
    IDLE: 'IDLE',
    LIFT: 'LIFT',
    CHOP: 'CHOP',
    HOLD: 'HOLD',
    RETURN: 'RETURN',
    SWITCH: 'SWITCH',
    TRANSITION: 'TRANSITION'
};

// Movement types within the exercise
const MOVEMENT_TYPES = {
    LIFT: 'lift',
    CHOP: 'chop'
};

// Default configuration
const DEFAULTS = {
    // Angle thresholds (in degrees)
    TORSO_ROTATION_THRESHOLD: 20,  // Minimum torso rotation to count as a rep
    ARM_ANGLE_THRESHOLD: 45,       // Arm angle threshold for lift/chop detection
    HOLD_SECONDS: 0.5,             // Minimum hold time at end range (in seconds)
    REFRACTORY_MS: 800,            // Cooldown between reps (milliseconds)
    KP_MIN: 0.6,                   // Minimum confidence score for keypoints
    
    // Movement thresholds
    MIN_ARM_MOVEMENT: 0.3,         // Minimum arm movement (as ratio of torso height)
    MAX_ARM_DRIFT: 0.4,            // Maximum arm drift from shoulder (as ratio of torso height)
    
    // Feedback messages
    FEEDBACK: {
        START: 'Stand with feet shoulder-width apart',
        LIFT_START: 'Start with hands low at one side',
        CHOP_START: 'Start with hands high at one side',
        LIFT_MOVE: 'Lift diagonally across your body',
        CHOP_MOVE: 'Chop diagonally down across your body',
        HOLD: 'Hold at the end position',
        RETURN: 'Return to start position',
        SWITCH: 'Switch sides',
        COMPLETE: 'Good rep!',
        POSTURE: 'Keep core engaged and back straight',
        ROTATION: 'Rotate through torso and hips',
        CONTROL: 'Move with control',
        RANGE: 'Increase your range of motion',
        BALANCE: 'Keep weight balanced between both feet'
    },
    
    // Colors for visualization
    COLORS: {
        DEFAULT: 'aqua',
        CORRECT: '#00FF00',
        WARNING: '#FFA500',
        ERROR: 'red'
    }
};

// Helper function to calculate torso rotation
function calculateTorsoRotation(leftShoulder, rightShoulder, leftHip, rightHip) {
    if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) return 0;
    
    const shoulderSlope = calculateSlope(leftShoulder, rightShoulder);
    const hipSlope = calculateSlope(leftHip, rightHip);
    
    // Calculate angle between shoulder and hip lines
    const angle = Math.atan2(
        shoulderSlope - hipSlope,
        1 + shoulderSlope * hipSlope
    ) * (180 / Math.PI);
    
    return Math.abs(angle);
}

// Helper to calculate arm position relative to torso
function getArmPosition(shoulder, elbow, wrist) {
    if (!shoulder || !elbow || !wrist) return { x: 0, y: 0 };
    
    const torsoHeight = Math.abs(shoulder.y - (shoulder.y + 100)); // Approximate torso height
    return {
        x: (wrist.x - shoulder.x) / (torsoHeight || 1),
        y: (wrist.y - shoulder.y) / (torsoHeight || 1)
    };
}

// Main exercise detection function
const LiftAndChops_repDetection = (
    poses,
    side = 'both',
    exerciseType = 'lift', // 'lift' or 'chop'
    feedbackRef,
    leftArmCountRef = { current: 0 },
    rightArmCountRef = { current: 0 },
    startArmRef = { current: 'left' },
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
        activeArm: side === 'both' ? startArmRef.current : side,
        currentMovement: MOVEMENT_TYPES.LIFT, // Start with lift
        isComplete: false,
        maxRotation: 0,
        lastFeedbackTime: 0,
        startPosition: { x: 0, y: 0 },
        currentPosition: { x: 0, y: 0 },
        hasStarted: false,
        repCount: 0,
        totalReps: targetReps * 2 // Each full cycle (lift + chop) counts as 1 rep
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

    // Active side keypoints
    const activeSide = state.activeArm;
    const activeKeypoints = {
        shoulder: keypoints[`${activeSide}_shoulder`],
        elbow: keypoints[`${activeSide}_elbow`],
        wrist: keypoints[`${activeSide}_wrist`],
        hip: keypoints[`${activeSide}_hip`],
        knee: keypoints[`${activeSide}_knee`],
        ankle: keypoints[`${activeSide}_ankle`]
    };

    // Other side keypoints for comparison
    const otherSide = activeSide === 'left' ? 'right' : 'left';
    const otherKeypoints = {
        shoulder: keypoints[`${otherSide}_shoulder`],
        elbow: keypoints[`${otherSide}_elbow`],
        wrist: keypoints[`${otherSide}_wrist`],
        hip: keypoints[`${otherSide}_hip`]
    };

    // Check if we have all required keypoints
    if (!activeKeypoints.shoulder || !activeKeypoints.elbow || !activeKeypoints.wrist || 
        !activeKeypoints.hip || !otherKeypoints.shoulder || !otherKeypoints.hip) {
        feedbackRef.current = 'Please ensure your upper body is visible';
        keypointColorsRef.current = DEFAULTS.COLORS.ERROR;
        return getResult(state);
    }

    // Calculate key metrics
    const torsoHeight = Math.abs(activeKeypoints.shoulder.y - activeKeypoints.hip.y);
    
    // Calculate torso rotation
    const torsoRotation = calculateTorsoRotation(
        keypoints.left_shoulder,
        keypoints.right_shoulder,
        keypoints.left_hip,
        keypoints.right_hip
    );
    
    // Calculate arm positions
    const activeArmPos = getArmPosition(
        activeKeypoints.shoulder,
        activeKeypoints.elbow,
        activeKeypoints.wrist
    );
    
    const otherArmPos = getArmPosition(
        otherKeypoints.shoulder,
        otherKeypoints.elbow,
        otherKeypoints.wrist
    );
    
    // Calculate arm angles
    const activeArmAngle = calculateInteriorAngle(
        activeKeypoints.shoulder,
        activeKeypoints.elbow,
        activeKeypoints.wrist
    );
    
    // Check form
    const isPostureGood = Math.abs(activeKeypoints.shoulder.x - activeKeypoints.hip.x) < 0.2 * torsoHeight;
    const isBalanced = Math.abs(keypoints.left_ankle.x - keypoints.right_ankle.x) < 0.4 * torsoHeight;
    
    // Calculate movement direction based on exercise type
    const isLift = state.exerciseType === 'lift';
    const isMovingUp = activeArmPos.y < 0; // Negative Y is up in screen coordinates
    const isMovingAcross = (activeSide === 'left' && activeArmPos.x > 0) || 
                          (activeSide === 'right' && activeArmPos.x < 0);
    
    // State machine
    const currentTime = Date.now();
    const timeInPhase = currentTime - state.lastPhaseChange;
    const minPhaseTime = 300; // ms
    
    if (timeInPhase >= minPhaseTime) {
        // Update feedback based on current movement
        if (state.phase === 'IDLE' || state.phase === 'TRANSITION') {
            feedbackRef.current = state.currentMovement === MOVEMENT_TYPES.LIFT 
                ? DEFAULTS.FEEDBACK.LIFT_START 
                : DEFAULTS.FEEDBACK.CHOP_START;
        }
        
        switch (state.phase) {
            case 'IDLE':
                // Check if in starting position
                const inStartPosition = isLift 
                    ? activeArmPos.y > 0.2 && Math.abs(activeArmPos.x) > 0.3
                    : activeArmPos.y < -0.2 && Math.abs(activeArmPos.x) > 0.3;
                
                if (inStartPosition) {
                    state.phase = state.currentMovement === MOVEMENT_TYPES.LIFT ? 'LIFT' : 'CHOP';
                    state.lastPhaseChange = currentTime;
                    state.startPosition = { ...activeArmPos };
                    feedbackRef.current = state.currentMovement === MOVEMENT_TYPES.LIFT 
                        ? DEFAULTS.FEEDBACK.LIFT_MOVE 
                        : DEFAULTS.FEEDBACK.CHOP_MOVE;
                    keypointColorsRef.current = DEFAULTS.COLORS.CORRECT;
                    segmentColorsRef.current = DEFAULTS.COLORS.CORRECT;
                } else {
                    feedbackRef.current = state.currentMovement === MOVEMENT_TYPES.LIFT 
                        ? DEFAULTS.FEEDBACK.LIFT_START 
                        : DEFAULTS.FEEDBACK.CHOP_START;
                    keypointColorsRef.current = DEFAULTS.COLORS.WARNING;
                    segmentColorsRef.current = DEFAULTS.COLORS.WARNING;
                }
                break;
                
            case 'LIFT':
            case 'CHOP':
                const isLiftPhase = state.phase === 'LIFT';
                const isMovingCorrectly = (isLiftPhase && isMovingUp && isMovingAcross) ||
                                        (!isLiftPhase && !isMovingUp && isMovingAcross);
                
                if (isMovingCorrectly && torsoRotation > DEFAULTS.TORSO_ROTATION_THRESHOLD) {
                    state.phase = 'HOLD';
                    state.holdStartTime = currentTime;
                    state.lastPhaseChange = currentTime;
                    feedbackRef.current = DEFAULTS.FEEDBACK.HOLD;
                } else if (!isMovingCorrectly) {
                    feedbackRef.current = isLiftPhase 
                        ? DEFAULTS.FEEDBACK.LIFT_MOVE 
                        : DEFAULTS.FEEDBACK.CHOP_MOVE;
                }
                break;
                
            case 'HOLD':
                if (currentTime - state.holdStartTime > DEFAULTS.HOLD_SECONDS * 1000) {
                    state.phase = 'RETURN';
                    state.lastPhaseChange = currentTime;
                    feedbackRef.current = DEFAULTS.FEEDBACK.RETURN;
                } else {
                    const timeLeft = ((DEFAULTS.HOLD_SECONDS * 1000) - (currentTime - state.holdStartTime)) / 1000;
                    feedbackRef.current = `Hold for ${timeLeft.toFixed(1)}s`;
                }
                break;
                
            case 'RETURN':
                const returnedToStart = isLift 
                    ? activeArmPos.y > 0.2 && Math.abs(activeArmPos.x) > 0.3
                    : activeArmPos.y < -0.2 && Math.abs(activeArmPos.x) > 0.3;
                
                if (returnedToStart) {
                    // Count the rep
                    state.repCount++;
                    repCountRef.current = Math.ceil(state.repCount / 2); // Count each full cycle (lift+chop) as 1 rep
                    
                    if (activeSide === 'left') {
                        leftArmCountRef.current = state.repCount;
                    } else {
                        rightArmCountRef.current = state.repCount;
                    }
                    
                    state.lastRepTime = currentTime;
                    lastRepTimeRef.current = currentTime;
                    
                    // Switch movement type or side
                    if (state.repCount < state.totalReps) {
                        // Toggle between lift and chop
                        state.currentMovement = state.currentMovement === MOVEMENT_TYPES.LIFT 
                            ? MOVEMENT_TYPES.CHOP 
                            : MOVEMENT_TYPES.LIFT;
                            
                        // Only switch arms after completing a full cycle (lift + chop)
                        const shouldSwitchArm = side === 'both' && state.repCount % 2 === 0;
                        
                        if (shouldSwitchArm) {
                            state.phase = 'SWITCH';
                            const newArm = activeSide === 'left' ? 'right' : 'left';
                            state.activeArm = newArm;
                            startArmRef.current = newArm;
                            feedbackRef.current = `${DEFAULTS.FEEDBACK.COMPLETE} ${DEFAULTS.FEEDBACK.SWITCH}`.trim();
                        } else {
                            state.phase = 'TRANSITION';
                            feedbackRef.current = state.currentMovement === MOVEMENT_TYPES.LIFT 
                                ? DEFAULTS.FEEDBACK.LIFT_START 
                                : DEFAULTS.FEEDBACK.CHOP_START;
                        }
                    } else {
                        state.phase = 'IDLE';
                        state.isComplete = true;
                        feedbackRef.current = 'Exercise complete! Great job!';
                    }
                    
                    state.lastPhaseChange = currentTime;
                    
                    // Check if target reps reached
                    if (repCountRef.current >= targetReps) {
                        handleExerciseComplete(repCountRef.current);
                        return getResult(state, true);
                    }
                }
                break;
                
            case 'SWITCH':
            case 'TRANSITION':
                if (timeInPhase > 1000) { // 1 second to switch/transition
                    state.phase = 'IDLE';
                    state.lastPhaseChange = currentTime;
                    state.startPosition = { ...activeArmPos }; // Reset start position
                }
                break;
                
            default:
                break;
        }
    }
    
    // Form feedback
    if (!isPostureGood) {
        feedbackRef.current = DEFAULTS.FEEDBACK.POSTURE;
        keypointColorsRef.current = DEFAULTS.COLORS.ERROR;
        segmentColorsRef.current = DEFAULTS.COLORS.ERROR;
    } else if (!isBalanced) {
        feedbackRef.current = DEFAULTS.FEEDBACK.BALANCE;
        keypointColorsRef.current = DEFAULTS.COLORS.WARNING;
        segmentColorsRef.current = DEFAULTS.COLORS.WARNING;
    } else if (torsoRotation < DEFAULTS.TORSO_ROTATION_THRESHOLD / 2 && 
               currentTime - state.lastFeedbackTime > 3000) {
        feedbackRef.current = DEFAULTS.FEEDBACK.ROTATION;
        state.lastFeedbackTime = currentTime;
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
            feedback: feedbackRef.current || DEFAULTS.FEEDBACK.START,
            leftArmCount: leftArmCountRef.current || 0,
            rightArmCount: rightArmCountRef.current || 0,
            repCount: repCountRef.current || 0,
            isComplete: isComplete || state.isComplete,
            phase: state.phase,
            exerciseType: state.exerciseType
        };
        
        // Update the refs for the next frame
        repCountRef.current = result.repCount;
        leftArmCountRef.current = result.leftArmCount;
        rightArmCountRef.current = result.rightArmCount;
        startArmRef.current = state.activeArm;
        
        return result;
    }
};

export default LiftAndChops_repDetection;
