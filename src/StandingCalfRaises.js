import { calculateInteriorAngle, calculateDistance, getMidpoint } from './utilities';

// Exercise state machine states
const EXERCISE_STATES = {
    IDLE: 'IDLE',
    ASCEND: 'ASCEND',
    HOLD: 'HOLD',
    DESCEND: 'DESCEND'
};

// Default configuration
const DEFAULTS = {
    // Movement thresholds (as ratio of torso length)
    ANKLE_UP_DY: 0.12,    // 12% of torso length for upward movement (increased for standing)
    ANKLE_DOWN_DY: 0.06,  // 6% of torso length for downward movement
    HOLD_SECONDS: 1.0,    // Minimum hold time at the top
    REFRACTORY_MS: 800,   // Cooldown between reps (increased for standing)
    KP_MIN: 0.65,         // Minimum confidence score for keypoints
    
    // Angle thresholds (in degrees)
    KNEE_ANGLE_MIN: 170,  // Minimum knee angle (nearly straight for standing)
    KNEE_ANGLE_MAX: 185,  // Maximum knee angle (slight hyperextension allowed)
    HIP_ANGLE_MIN: 160,   // Minimum hip angle (torso verticality)
    HIP_ANGLE_MAX: 200,   // Maximum hip angle (slight lean forward/backward)
    
    // Balance thresholds (weight distribution between feet, 0.5 = equal weight)
    WEIGHT_BALANCE_THRESHOLD: 0.3, // Max allowed weight difference between feet (0-1)
    
    // Feedback messages
    FEEDBACK: {
        START: 'Stand tall with feet shoulder-width apart',
        LIFT: 'Rise up onto your toes',
        HOLD: 'Hold at the top',
        LOWER: 'Lower slowly with control',
        COMPLETE: 'Good rep!',
        ADJUST: 'Adjust position for better detection',
        KNEE_ANGLE: 'Keep your legs straight but not locked',
        POSTURE: 'Keep your back straight and core engaged',
        BALANCE: 'Distribute weight evenly between both feet',
        RANGE: 'Lift higher for full range of motion'
    },
    
    // Colors for visualization
    COLORS: {
        DEFAULT: 'aqua',
        CORRECT: '#00FF00',
        WARNING: '#FFA500',
        ERROR: 'red'
    }
};

// Helper function to calculate knee angle
function calculateKneeAngle(hip, knee, ankle) {
    if (!hip || !knee || !ankle) return 0;
    return calculateInteriorAngle(hip, knee, ankle);
}

// Helper function to calculate hip angle
function calculateHipAngle(shoulder, hip, knee) {
    if (!shoulder || !hip || !knee) return 0;
    return calculateInteriorAngle(shoulder, hip, knee);
}

// Main exercise detection function
const StandingCalfRaises_repDetection = (
    poses,
    feedbackRef,
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
        lastAnkleY: null,
        lastAnkleTime: null,
        ankleVelocity: 0,
        holdStartTime: 0,
        lastPhaseChange: Date.now(),
        isComplete: false,
        maxAnkleRise: 0,
        minAnkleRise: Infinity,
        rangeOfMotion: 0
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
        'left_toe', 'right_toe'
    ];

    // Populate keypoints object
    keypointNames.forEach(name => {
        const kp = pose.keypoints.find(k => k.name === name && k.score >= DEFAULTS.KP_MIN);
        if (kp) {
            keypoints[name] = kp;
        }
    });

    // Calculate midpoints and lengths
    const shoulderMid = getMidpoint(keypoints.left_shoulder, keypoints.right_shoulder);
    const hipMid = getMidpoint(keypoints.left_hip, keypoints.right_hip);
    const torsoLen = calculateDistance(shoulderMid, hipMid);
    
    // Check if we have all required keypoints
    const requiredKeypoints = [
        'left_ankle', 'right_ankle', 'left_knee', 'right_knee',
        'left_hip', 'right_hip', 'left_shoulder', 'right_shoulder'
    ];
    
    if (requiredKeypoints.some(kp => !keypoints[kp])) {
        feedbackRef.current = 'Please ensure full body is visible';
        keypointColorsRef.current = DEFAULTS.COLORS.ERROR;
        return getResult(state);
    }

    // Calculate angles and positions
    const leftKneeAngle = calculateKneeAngle(
        keypoints.left_hip, keypoints.left_knee, keypoints.left_ankle
    );
    const rightKneeAngle = calculateKneeAngle(
        keypoints.right_hip, keypoints.right_knee, keypoints.right_ankle
    );
    
    const leftHipAngle = calculateHipAngle(
        keypoints.left_shoulder, keypoints.left_hip, keypoints.left_knee
    );
    const rightHipAngle = calculateHipAngle(
        keypoints.right_shoulder, keypoints.right_hip, keypoints.right_knee
    );

    // Calculate ankle rise (distance from hip to ankle, averaged for both legs)
    const leftAnkleRise = keypoints.left_hip.y - keypoints.left_ankle.y;
    const rightAnkleRise = keypoints.right_hip.y - keypoints.right_ankle.y;
    const avgAnkleRise = (leftAnkleRise + rightAnkleRise) / 2;
    const normalizedRise = avgAnkleRise / torsoLen;
    
    // Update range of motion tracking
    state.maxAnkleRise = Math.max(state.maxAnkleRise, normalizedRise);
    state.minAnkleRise = Math.min(state.minAnkleRise, normalizedRise);
    state.rangeOfMotion = state.maxAnkleRise - state.minAnkleRise;

    // Calculate balance (weight distribution between feet)
    const leftFootHeight = keypoints.left_ankle.y - (keypoints.left_heel?.y || keypoints.left_ankle.y);
    const rightFootHeight = keypoints.right_ankle.y - (keypoints.right_heel?.y || keypoints.right_ankle.y);
    const balanceRatio = leftFootHeight / (leftFootHeight + rightFootHeight);
    const isBalanced = Math.abs(balanceRatio - 0.5) <= DEFAULTS.WEIGHT_BALANCE_THRESHOLD;

    // Get current time
    const currentTime = Date.now();
    const isInRefractory = currentTime - state.lastRepTime < DEFAULTS.REFRACTORY_MS;

    // Calculate ankle velocity (pixels per second)
    let ankleVelocity = 0;
    if (state.lastAnkleY !== null && state.lastAnkleTime) {
        const dy = (keypoints.left_ankle.y + keypoints.right_ankle.y) / 2 - state.lastAnkleY;
        const dt = (currentTime - state.lastAnkleTime) / 1000; // Convert to seconds
        ankleVelocity = dt > 0 ? Math.abs(dy / dt) : 0;
    }

    // Update state with current position
    state.lastAnkleY = (keypoints.left_ankle.y + keypoints.right_ankle.y) / 2;
    state.lastAnkleTime = currentTime;
    state.ankleVelocity = ankleVelocity;
    
    // Check form validity
    const isLeftLegExtended = leftKneeAngle >= DEFAULTS.KNEE_ANGLE_MIN && 
                            leftKneeAngle <= DEFAULTS.KNEE_ANGLE_MAX;
    const isRightLegExtended = rightKneeAngle >= DEFAULTS.KNEE_ANGLE_MIN && 
                             rightKneeAngle <= DEFAULTS.KNEE_ANGLE_MAX;
    const isLeftHipAligned = leftHipAngle >= DEFAULTS.HIP_ANGLE_MIN && 
                           leftHipAngle <= DEFAULTS.HIP_ANGLE_MAX;
    const isRightHipAligned = rightHipAngle >= DEFAULTS.HIP_ANGLE_MIN && 
                            rightHipAngle <= DEFAULTS.HIP_ANGLE_MAX;
    
    const isFormValid = isLeftLegExtended && isRightLegExtended && 
                       isLeftHipAligned && isRightHipAligned && isBalanced;

    // State machine
    if (!isInRefractory && isFormValid) {
        const timeInPhase = currentTime - state.lastPhaseChange;
        const minPhaseTime = 300; // ms
        
        if (timeInPhase >= minPhaseTime) {
            switch (state.phase) {
                case 'IDLE':
                    if (normalizedRise > DEFAULTS.ANKLE_UP_DY * 0.7) {
                        state.phase = 'ASCEND';
                        state.holdStartTime = currentTime;
                        state.lastPhaseChange = currentTime;
                        feedbackRef.current = DEFAULTS.FEEDBACK.HOLD;
                        keypointColorsRef.current = DEFAULTS.COLORS.CORRECT;
                        segmentColorsRef.current = DEFAULTS.COLORS.CORRECT;
                    } else if (normalizedRise > DEFAULTS.ANKLE_UP_DY * 0.4) {
                        feedbackRef.current = DEFAULTS.FEEDBACK.LIFT;
                        keypointColorsRef.current = DEFAULTS.COLORS.WARNING;
                        segmentColorsRef.current = DEFAULTS.COLORS.WARNING;
                    } else {
                        feedbackRef.current = DEFAULTS.FEEDBACK.START;
                        keypointColorsRef.current = DEFAULTS.COLORS.DEFAULT;
                        segmentColorsRef.current = DEFAULTS.COLORS.DEFAULT;
                    }
                    break;
                    
                case 'ASCEND':
                    if (normalizedRise < DEFAULTS.ANKLE_UP_DY * 0.6) {
                        // Not lifting high enough
                        state.phase = 'IDLE';
                        state.lastPhaseChange = currentTime;
                        feedbackRef.current = DEFAULTS.FEEDBACK.RANGE;
                        keypointColorsRef.current = DEFAULTS.COLORS.WARNING;
                        segmentColorsRef.current = DEFAULTS.COLORS.WARNING;
                    } else if (currentTime - state.holdStartTime > DEFAULTS.HOLD_SECONDS * 1000) {
                        // Held long enough, now lower
                        state.phase = 'HOLD';
                        state.lastPhaseChange = currentTime;
                        feedbackRef.current = DEFAULTS.FEEDBACK.LOWER;
                        keypointColorsRef.current = DEFAULTS.COLORS.CORRECT;
                        segmentColorsRef.current = DEFAULTS.COLORS.CORRECT;
                    } else {
                        // Still holding at the top
                        const timeLeft = ((DEFAULTS.HOLD_SECONDS * 1000) - (currentTime - state.holdStartTime)) / 1000;
                        feedbackRef.current = `Hold for ${timeLeft.toFixed(1)}s`;
                    }
                    break;
                    
                case 'HOLD':
                    if (normalizedRise < DEFAULTS.ANKLE_DOWN_DY) {
                        // Complete rep
                        repCountRef.current++;
                        state.lastRepTime = currentTime;
                        lastRepTimeRef.current = currentTime;
                        state.phase = 'IDLE';
                        state.lastPhaseChange = currentTime;
                        
                        // Provide feedback on range of motion
                        let romFeedback = '';
                        if (state.rangeOfMotion < DEFAULTS.ANKLE_UP_DY * 0.7) {
                            romFeedback = ' (try for a deeper range of motion)';
                        }
                        
                        feedbackRef.current = `${DEFAULTS.FEEDBACK.COMPLETE} ${romFeedback}`.trim();
                        
                        // Reset range tracking for next rep
                        state.maxAnkleRise = 0;
                        state.minAnkleRise = Infinity;
                        
                        // Check if target reps reached
                        if (repCountRef.current >= targetReps) {
                            handleExerciseComplete(repCountRef.current);
                            return getResult(state, true);
                        }
                    }
                    break;
                    
                default:
                    break;
            }
        }
    } else if (!isFormValid) {
        // Provide specific form feedback
        if (!isLeftLegExtended || !isRightLegExtended) {
            feedbackRef.current = DEFAULTS.FEEDBACK.KNEE_ANGLE;
        } else if (!isLeftHipAligned || !isRightHipAligned) {
            feedbackRef.current = DEFAULTS.FEEDBACK.POSTURE;
        } else if (!isBalanced) {
            feedbackRef.current = DEFAULTS.FEEDBACK.BALANCE;
        }
        keypointColorsRef.current = DEFAULTS.COLORS.ERROR;
        segmentColorsRef.current = DEFAULTS.COLORS.ERROR;
    }

    // Set keypoints for visualization
    keypointsRef.current = [
        'left_shoulder', 'right_shoulder',
        'left_hip', 'right_hip',
        'left_knee', 'right_knee',
        'left_ankle', 'right_ankle',
        'left_heel', 'right_heel',
        'left_toe', 'right_toe'
    ];

    return getResult(state);
};

// Helper function to format the result
function getResult(state, isComplete = false) {
    return {
        phase: state.phase,
        lastRepTime: state.lastRepTime,
        repCount: state.repCount,
        rangeOfMotion: state.rangeOfMotion,
        isComplete: isComplete || state.isComplete,
        feedback: state.feedback || ''
    };
}

export default StandingCalfRaises_repDetection;
