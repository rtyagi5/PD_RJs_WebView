import { calculateInteriorAngle, calculateDistance, getMidpoint } from './utilities';

// Exercise state machine states
const EXERCISE_STATES = {
    IDLE: 'IDLE',
    DESCEND: 'DESCEND',
    HOLD: 'HOLD',
    ASCEND: 'ASCEND',
    SWITCH: 'SWITCH'
};

// Default configuration
const DEFAULTS = {
    // Angle thresholds (in degrees)
    KNEE_ANGLE_MIN: 90,           // Minimum knee angle at bottom of lunge
    KNEE_ANGLE_MAX: 170,          // Maximum knee angle (standing)
    KNEE_OVER_TOE_THRESHOLD: 0.2, // How far knee can go past toes (ratio of foot length)
    FOOT_WIDTH_THRESHOLD: 0.2,    // How far apart feet should be (ratio of hip width)
    HOLD_SECONDS: 0.5,            // Minimum hold time at bottom (in seconds)
    REFRACTORY_MS: 800,           // Cooldown between reps (milliseconds)
    KP_MIN: 0.6,                  // Minimum confidence score for keypoints
    
    // Movement thresholds
    MIN_KNEE_BEND: 30,            // Minimum knee bend to count as a lunge
    MAX_KNEE_DRIFT: 0.4,          // Maximum knee drift from shoulder (as ratio of torso height)
    
    // Feedback messages
    FEEDBACK: {
        START: 'Stand with feet hip-width apart',
        STEP_FORWARD: 'Take a small step forward',
        DESCEND: 'Lower your body, keep front knee behind toes',
        HOLD: 'Hold at the bottom',
        ASCEND: 'Push through front heel to stand up',
        SWITCH: 'Switch legs',
        COMPLETE: 'Good rep!',
        KNEE_ALIGNMENT: 'Keep front knee behind toes',
        POSTURE: 'Keep torso upright',
        BALANCE: 'Use support if needed for balance',
        TOO_FAST: 'Slow down your movement',
        FOOT_POSITION: 'Feet should be hip-width apart',
        RANGE: 'Lower your body more for full range'
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

// Helper to calculate foot position relative to hip
function getFootPosition(hip, ankle) {
    if (!hip || !ankle) return { x: 0, y: 0 };
    return {
        x: (ankle.x - hip.x) / (Math.abs(hip.y - ankle.y) || 1), // Normalize by leg length
        y: (ankle.y - hip.y) / (Math.abs(hip.y - ankle.y) || 1)
    };
}

// Main exercise detection function
const MiniLunges_repDetection = (
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
        lastKneeAngle: 180,
        lastKneeTime: null,
        kneeVelocity: 0,
        holdStartTime: 0,
        lastPhaseChange: Date.now(),
        activeLeg: side === 'both' ? startLegRef.current : side,
        isComplete: false,
        minKneeAngle: 180,
        maxKneeAngle: 0,
        rangeOfMotion: 0,
        lastFeedbackTime: 0,
        hasSteppedForward: false
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

    // Active side keypoints
    const activeSide = state.activeLeg;
    const activeKeypoints = {
        shoulder: keypoints[`${activeSide}_shoulder`],
        hip: keypoints[`${activeSide}_hip`],
        knee: keypoints[`${activeSide}_knee`],
        ankle: keypoints[`${activeSide}_ankle`],
        heel: keypoints[`${activeSide}_heel`] || keypoints[`${activeSide}_ankle`],
        footIndex: keypoints[`${activeSide}_foot_index`] || keypoints[`${activeSide}_ankle`]
    };

    // Other side keypoints for comparison
    const otherSide = activeSide === 'left' ? 'right' : 'left';
    const otherKeypoints = {
        knee: keypoints[`${otherSide}_knee`],
        ankle: keypoints[`${otherSide}_ankle`],
        heel: keypoints[`${otherSide}_heel`] || keypoints[`${otherSide}_ankle`],
        footIndex: keypoints[`${otherSide}_foot_index`] || keypoints[`${otherSide}_ankle`]
    };

    // Check if we have all required keypoints
    if (!activeKeypoints.shoulder || !activeKeypoints.hip || !activeKeypoints.knee || 
        !activeKeypoints.ankle || !otherKeypoints.knee || !otherKeypoints.ankle) {
        feedbackRef.current = 'Please ensure your legs are visible';
        keypointColorsRef.current = DEFAULTS.COLORS.ERROR;
        return getResult(state);
    }

    // Calculate key metrics
    const torsoHeight = Math.abs(activeKeypoints.shoulder.y - activeKeypoints.hip.y);
    const hipWidth = Math.abs(keypoints.left_hip.x - keypoints.right_hip.x);
    
    // Calculate knee angles
    const frontKneeAngle = calculateKneeAngle(
        activeKeypoints.hip,
        activeKeypoints.knee,
        activeKeypoints.ankle
    );
    
    const backKneeAngle = calculateKneeAngle(
        otherKeypoints.ankle,
        otherKeypoints.knee,
        otherKeypoints.hip
    );

    // Calculate foot positions
    const frontFootPos = getFootPosition(activeKeypoints.hip, activeKeypoints.ankle);
    const backFootPos = getFootPosition(otherKeypoints.hip, otherKeypoints.ankle);
    
    // Check if foot is in front of hip
    const isFrontFootForward = frontFootPos.x > 0.1;
    const isBackFootBack = backFootPos.x < -0.1;
    
    // Check if feet are properly aligned
    const feetWidth = Math.abs(activeKeypoints.ankle.x - otherKeypoints.ankle.x);
    const isFeetAligned = Math.abs(feetWidth - hipWidth) / hipWidth < DEFAULTS.FOOT_WIDTH_THRESHOLD;
    
    // Check knee position relative to toes
    const kneeToAnkleDist = calculateDistance(
        { x: activeKeypoints.knee.x, y: activeKeypoints.knee.y },
        { x: activeKeypoints.ankle.x, y: activeKeypoints.ankle.y }
    );
    
    const kneeOverToe = (activeKeypoints.knee.x - activeKeypoints.ankle.x) / kneeToAnkleDist;
    const isKneeBehindToes = kneeOverToe < DEFAULTS.KNEE_OVER_TOE_THRESHOLD;
    
    // Calculate velocity for controlled movement
    const currentTime = Date.now();
    let kneeVelocity = 0;
    if (state.lastKneeAngle !== null && state.lastKneeTime) {
        const dAngle = frontKneeAngle - state.lastKneeAngle;
        const dt = (currentTime - state.lastKneeTime) / 1000; // Convert to seconds
        kneeVelocity = dt > 0 ? Math.abs(dAngle / dt) : 0;
    }
    state.lastKneeAngle = frontKneeAngle;
    state.lastKneeTime = currentTime;
    state.kneeVelocity = kneeVelocity;

    // Update range of motion tracking
    const currentKneeAngle = Math.min(frontKneeAngle, backKneeAngle);
    state.minKneeAngle = Math.min(state.minKneeAngle, currentKneeAngle);
    state.maxKneeAngle = Math.max(state.maxKneeAngle, currentKneeAngle);
    state.rangeOfMotion = state.maxKneeAngle - state.minKneeAngle;
    
    // Check form validity
    const isKneeAngleValid = frontKneeAngle < DEFAULTS.KNEE_ANGLE_MAX - DEFAULTS.MIN_KNEE_BEND;
    const isPostureGood = Math.abs(activeKeypoints.shoulder.x - activeKeypoints.hip.x) < 0.15 * torsoHeight;
    const isMovementControlled = kneeVelocity < 100; // degrees per second
    const isFullRange = state.rangeOfMotion > 40; // At least 40 degrees of motion
    
    const isFormValid = isKneeAngleValid && isPostureGood && isMovementControlled && isKneeBehindToes;
    const isInRefractory = currentTime - state.lastRepTime < DEFAULTS.REFRACTORY_MS;
    
    // State machine
    if (!isInRefractory) {
        const timeInPhase = currentTime - state.lastPhaseChange;
        const minPhaseTime = 300; // ms
        
        if (timeInPhase >= minPhaseTime) {
            switch (state.phase) {
                case 'IDLE':
                    if (isFrontFootForward && isBackFootBack && isFeetAligned) {
                        state.hasSteppedForward = true;
                        state.phase = 'DESCEND';
                        state.lastPhaseChange = currentTime;
                        feedbackRef.current = DEFAULTS.FEEDBACK.DESCEND;
                        keypointColorsRef.current = DEFAULTS.COLORS.CORRECT;
                        segmentColorsRef.current = DEFAULTS.COLORS.CORRECT;
                    } else if (state.hasSteppedForward) {
                        feedbackRef.current = DEFAULTS.FEEDBACK.STEP_FORWARD;
                        keypointColorsRef.current = DEFAULTS.COLORS.WARNING;
                        segmentColorsRef.current = DEFAULTS.COLORS.WARNING;
                    } else {
                        feedbackRef.current = DEFAULTS.FEEDBACK.START;
                        keypointColorsRef.current = DEFAULTS.COLORS.DEFAULT;
                        segmentColorsRef.current = DEFAULTS.COLORS.DEFAULT;
                    }
                    break;
                    
                case 'DESCEND':
                    if (currentKneeAngle < DEFAULTS.KNEE_ANGLE_MIN) {
                        state.phase = 'HOLD';
                        state.holdStartTime = currentTime;
                        state.lastPhaseChange = currentTime;
                        feedbackRef.current = DEFAULTS.FEEDBACK.HOLD;
                    } else if (currentKneeAngle > DEFAULTS.KNEE_ANGLE_MAX - 10) {
                        // Not low enough
                        state.phase = 'IDLE';
                        state.lastPhaseChange = currentTime;
                        feedbackRef.current = DEFAULTS.FEEDBACK.RANGE;
                        keypointColorsRef.current = DEFAULTS.COLORS.WARNING;
                        segmentColorsRef.current = DEFAULTS.COLORS.WARNING;
                    } else if (!isKneeBehindToes) {
                        feedbackRef.current = DEFAULTS.FEEDBACK.KNEE_ALIGNMENT;
                        keypointColorsRef.current = DEFAULTS.COLORS.ERROR;
                        segmentColorsRef.current = DEFAULTS.COLORS.ERROR;
                    } else if (!isPostureGood) {
                        feedbackRef.current = DEFAULTS.FEEDBACK.POSTURE;
                        keypointColorsRef.current = DEFAULTS.COLORS.ERROR;
                        segmentColorsRef.current = DEFAULTS.COLORS.ERROR;
                    } else {
                        feedbackRef.current = DEFAULTS.FEEDBACK.DESCEND;
                    }
                    break;
                    
                case 'HOLD':
                    if (currentTime - state.holdStartTime > DEFAULTS.HOLD_SECONDS * 1000) {
                        state.phase = 'ASCEND';
                        state.lastPhaseChange = currentTime;
                        feedbackRef.current = DEFAULTS.FEEDBACK.ASCEND;
                    } else {
                        const timeLeft = ((DEFAULTS.HOLD_SECONDS * 1000) - (currentTime - state.holdStartTime)) / 1000;
                        feedbackRef.current = `Hold for ${timeLeft.toFixed(1)}s`;
                    }
                    break;
                    
                case 'ASCEND':
                    if (currentKneeAngle > DEFAULTS.KNEE_ANGLE_MAX * 0.9) {
                        state.phase = 'SWITCH';
                        state.lastPhaseChange = currentTime;
                        
                        // Count the rep
                        repCountRef.current++;
                        if (activeSide === 'left') {
                            leftLegCountRef.current++;
                        } else {
                            rightLegCountRef.current++;
                        }
                        
                        state.lastRepTime = currentTime;
                        lastRepTimeRef.current = currentTime;
                        
                        // Reset range tracking for next rep
                        state.minKneeAngle = 180;
                        state.maxKneeAngle = 0;
                        
                        // Provide feedback on range of motion
                        let romFeedback = '';
                        if (state.rangeOfMotion < 60) {
                            romFeedback = ' (try for a deeper lunge)';
                        } else if (isFullRange) {
                            romFeedback = ' (good range of motion!)';
                        }
                        
                        feedbackRef.current = `${DEFAULTS.FEEDBACK.COMPLETE} ${romFeedback}`.trim();
                        
                        // Switch sides if needed
                        if (side === 'both' && repCountRef.current < targetReps) {
                            const newLeg = activeSide === 'left' ? 'right' : 'left';
                            state.activeLeg = newLeg;
                            startLegRef.current = newLeg;
                            feedbackRef.current += ` ${DEFAULTS.FEEDBACK.SWITCH}`;
                        }
                        
                        // Check if target reps reached
                        if (repCountRef.current >= targetReps) {
                            handleExerciseComplete(repCountRef.current);
                            return getResult(state, true);
                        }
                    } else if (currentKneeAngle < DEFAULTS.KNEE_ANGLE_MIN + 20) {
                        feedbackRef.current = DEFAULTS.FEEDBACK.ASCEND;
                    }
                    break;
                    
                case 'SWITCH':
                    if (timeInPhase > 1000) { // 1 second to switch legs
                        state.phase = 'IDLE';
                        state.lastPhaseChange = currentTime;
                        state.hasSteppedForward = false;
                    }
                    break;
                    
                default:
                    break;
            }
        }
    } else if (!isFormValid) {
        // Provide specific form feedback
        if (!isKneeBehindToes) {
            feedbackRef.current = DEFAULTS.FEEDBACK.KNEE_ALIGNMENT;
        } else if (!isPostureGood) {
            feedbackRef.current = DEFAULTS.FEEDBACK.POSTURE;
        } else if (!isMovementControlled) {
            feedbackRef.current = DEFAULTS.FEEDBACK.TOO_FAST;
        } else if (!isFeetAligned) {
            feedbackRef.current = DEFAULTS.FEEDBACK.FOOT_POSITION;
        } else if (!isFullRange && currentTime - state.lastFeedbackTime > 3000) {
            feedbackRef.current = DEFAULTS.FEEDBACK.RANGE;
            state.lastFeedbackTime = currentTime;
        }
        keypointColorsRef.current = DEFAULTS.COLORS.ERROR;
        segmentColorsRef.current = DEFAULTS.COLORS.ERROR;
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
            rangeOfMotion: state.rangeOfMotion
        };
        
        // Update the refs for the next frame
        repCountRef.current = result.repCount;
        leftLegCountRef.current = result.leftLegCount;
        rightLegCountRef.current = result.rightLegCount;
        startLegRef.current = state.activeLeg;
        
        return result;
    }
};

export default MiniLunges_repDetection;
