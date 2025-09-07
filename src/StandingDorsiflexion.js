import { calculateInteriorAngle, calculateDistance } from './utilities';

// Exercise state machine states
const EXERCISE_STATES = {
    IDLE: 'IDLE',
    LIFT: 'LIFT',
    HOLD: 'HOLD',
    LOWER: 'LOWER'
};

// Default configuration
const DEFAULTS = {
    // Angle thresholds (in degrees)
    ANKLE_ANGLE_MIN: 70,     // Minimum angle between foot and shin for dorsiflexion
    ANKLE_ANGLE_MAX: 110,    // Maximum angle (resting position)
    HOLD_SECONDS: 1.5,       // Minimum hold time at the top (in seconds)
    REFRACTORY_MS: 500,      // Cooldown between reps (milliseconds)
    KP_MIN: 0.6,             // Minimum confidence score for keypoints
    
    // Feedback messages
    FEEDBACK: {
        START: 'Stand with feet shoulder-width apart and lift your toes',
        LIFT: 'Lift your toes higher',
        HOLD: 'Hold at the top',
        LOWER: 'Lower your toes with control',
        COMPLETE: 'Good rep!',
        KNEE_ANGLE: 'Keep your knees slightly bent',
        FOOT_POSITION: 'Keep your heels on the ground',
        POSTURE: 'Maintain good posture - shoulders back and chest up',
        BALANCE: 'Keep weight even between both feet'
    },
    
    // Colors for visualization
    COLORS: {
        DEFAULT: 'aqua',
        CORRECT: '#00FF00',
        WARNING: '#FFA500',
        ERROR: 'red'
    }
};

// Main exercise detection function
const StandingDorsiflexion_repDetection = (
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
        lastToeY: null,
        lastToeTime: null,
        toeVelocity: 0,
        holdStartTime: 0,
        lastPhaseChange: Date.now(),
        side: side === 'both' ? startLegRef.current : side,
        isComplete: false,
        maxAnkleAngle: 0,
        minAnkleAngle: 180,
        rangeOfMotion: 0,
        lastFeedbackTime: 0
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
        'left_foot_index', 'right_foot_index',
        'left_heel', 'right_heel'
    ];

    // Populate keypoints object
    keypointNames.forEach(name => {
        const kp = pose.keypoints.find(k => k.name === name && k.score >= DEFAULTS.KP_MIN);
        if (kp) {
            keypoints[name] = kp;
        }
    });

    // Active side keypoints
    const activeSide = state.side;
    const activeKeypoints = {
        shoulder: keypoints[`${activeSide}_shoulder`],
        hip: keypoints[`${activeSide}_hip`],
        knee: keypoints[`${activeSide}_knee`],
        ankle: keypoints[`${activeSide}_ankle`],
        foot_index: keypoints[`${activeSide}_foot_index`],
        heel: keypoints[`${activeSide}_heel`] || keypoints[`${activeSide}_ankle`] // Fallback to ankle if heel not detected
    };

    // Other side keypoints for balance check
    const otherSide = activeSide === 'left' ? 'right' : 'left';
    const otherKeypoints = {
        ankle: keypoints[`${otherSide}_ankle`],
        heel: keypoints[`${otherSide}_heel`] || keypoints[`${otherSide}_ankle`]
    };

    // Check if we have all required keypoints
    if (!activeKeypoints.shoulder || !activeKeypoints.hip || !activeKeypoints.knee || 
        !activeKeypoints.ankle || !activeKeypoints.foot_index) {
        feedbackRef.current = `Please ensure your ${activeSide} side is visible`;
        keypointColorsRef.current = DEFAULTS.COLORS.ERROR;
        return getResult(state);
    }

    // Calculate angles
    const ankleAngle = calculateInteriorAngle(
        activeKeypoints.knee, 
        activeKeypoints.ankle, 
        activeKeypoints.foot_index
    );
    
    const kneeAngle = calculateInteriorAngle(
        activeKeypoints.hip,
        activeKeypoints.knee,
        activeKeypoints.ankle
    );

    // Calculate vertical alignment (for posture check)
    const shoulderHipDistance = calculateDistance(
        { x: activeKeypoints.shoulder.x, y: activeKeypoints.shoulder.y },
        { x: activeKeypoints.hip.x, y: activeKeypoints.hip.y }
    );
    
    const hipKneeDistance = calculateDistance(
        { x: activeKeypoints.hip.x, y: activeKeypoints.hip.y },
        { x: activeKeypoints.knee.x, y: activeKeypoints.knee.y }
    );

    // Check form validity
    const isKneeSlightlyBent = kneeAngle > 160 && kneeAngle < 190; // Allow some flexibility
    const isHeelDown = activeKeypoints.heel ? 
        Math.abs(activeKeypoints.ankle.y - activeKeypoints.heel.y) < 20 : 
        true;
    
    // Check if other foot is stable (if visible)
    const isOtherFootStable = otherKeypoints.ankle && otherKeypoints.heel ? 
        Math.abs(otherKeypoints.ankle.y - otherKeypoints.heel.y) < 25 : 
        true;

    // Posture check - shoulders should be above hips
    const isGoodPosture = activeKeypoints.shoulder && activeKeypoints.hip ?
        activeKeypoints.shoulder.y < activeKeypoints.hip.y : true;

    const isFormValid = isKneeSlightlyBent && isHeelDown && isOtherFootStable && isGoodPosture;
    const currentTime = Date.now();
    const isInRefractory = currentTime - state.lastRepTime < DEFAULTS.REFRACTORY_MS;

    // Update range of motion tracking
    state.maxAnkleAngle = Math.max(state.maxAnkleAngle, ankleAngle);
    state.minAnkleAngle = Math.min(state.minAnkleAngle, ankleAngle);
    state.rangeOfMotion = state.maxAnkleAngle - state.minAnkleAngle;

    // State machine
    if (!isInRefractory && isFormValid) {
        const timeInPhase = currentTime - state.lastPhaseChange;
        const minPhaseTime = 300; // ms
        
        if (timeInPhase >= minPhaseTime) {
            switch (state.phase) {
                case 'IDLE':
                    if (ankleAngle < DEFAULTS.ANKLE_ANGLE_MIN) {
                        state.phase = 'LIFT';
                        state.holdStartTime = currentTime;
                        state.lastPhaseChange = currentTime;
                        feedbackRef.current = DEFAULTS.FEEDBACK.HOLD;
                        keypointColorsRef.current = DEFAULTS.COLORS.CORRECT;
                        segmentColorsRef.current = DEFAULTS.COLORS.CORRECT;
                    } else if (ankleAngle < DEFAULTS.ANKLE_ANGLE_MIN + 15) {
                        feedbackRef.current = DEFAULTS.FEEDBACK.LIFT;
                        keypointColorsRef.current = DEFAULTS.COLORS.WARNING;
                        segmentColorsRef.current = DEFAULTS.COLORS.WARNING;
                    } else {
                        feedbackRef.current = DEFAULTS.FEEDBACK.START;
                        keypointColorsRef.current = DEFAULTS.COLORS.DEFAULT;
                        segmentColorsRef.current = DEFAULTS.COLORS.DEFAULT;
                    }
                    break;
                    
                case 'LIFT':
                    if (ankleAngle > DEFAULTS.ANKLE_ANGLE_MIN + 10) {
                        // Not lifting high enough
                        state.phase = 'IDLE';
                        state.lastPhaseChange = currentTime;
                        feedbackRef.current = DEFAULTS.FEEDBACK.LIFT;
                        keypointColorsRef.current = DEFAULTS.COLORS.WARNING;
                        segmentColorsRef.current = DEFAULTS.COLORS.WARNING;
                    } else if (currentTime - state.holdStartTime > DEFAULTS.HOLD_SECONDS * 1000) {
                        // Held long enough, now lower
                        state.phase = 'LOWER';
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
                    
                case 'LOWER':
                    if (ankleAngle > DEFAULTS.ANKLE_ANGLE_MAX * 0.9) {
                        // Complete rep
                        repCountRef.current++;
                        
                        // Update the appropriate leg counter
                        if (activeSide === 'left') {
                            leftLegCountRef.current++;
                        } else {
                            rightLegCountRef.current++;
                        }
                        
                        state.lastRepTime = currentTime;
                        lastRepTimeRef.current = currentTime;
                        state.phase = 'IDLE';
                        state.lastPhaseChange = currentTime;
                        
                        // Reset range tracking for next rep
                        state.maxAnkleAngle = 0;
                        state.minAnkleAngle = 180;
                        
                        // Provide feedback on range of motion
                        let romFeedback = '';
                        if (state.rangeOfMotion < 20) {
                            romFeedback = ' (try for a greater range of motion)';
                        }
                        
                        feedbackRef.current = `${DEFAULTS.FEEDBACK.COMPLETE} ${romFeedback}`.trim();
                        
                        // Switch sides if needed
                        if (side === 'both') {
                            const newSide = activeSide === 'left' ? 'right' : 'left';
                            state.side = newSide;
                            startLegRef.current = newSide;
                            feedbackRef.current += ` Switch to ${newSide} foot.`;
                        }
                        
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
        if (!isKneeSlightlyBent) {
            feedbackRef.current = DEFAULTS.FEEDBACK.KNEE_ANGLE;
        } else if (!isHeelDown) {
            feedbackRef.current = DEFAULTS.FEEDBACK.FOOT_POSITION;
        } else if (!isGoodPosture) {
            feedbackRef.current = DEFAULTS.FEEDBACK.POSTURE;
        } else if (!isOtherFootStable) {
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
        'left_foot_index', 'right_foot_index',
        'left_heel', 'right_heel'
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
        startLegRef.current = state.side;
        
        return result;
    }
};

export default StandingDorsiflexion_repDetection;
