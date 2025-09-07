import { calculateInteriorAngle, calculateDistance, getMidpoint } from './utilities';

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
    ANKLE_ANGLE_MIN: 80,     // Minimum angle between foot and shin for dorsiflexion
    ANKLE_ANGLE_MAX: 120,    // Maximum angle (resting position)
    HOLD_SECONDS: 1.0,       // Minimum hold time at the top (in seconds)
    REFRACTORY_MS: 500,      // Cooldown between reps (milliseconds)
    KP_MIN: 0.6,             // Minimum confidence score for keypoints
    
    // Movement thresholds (as ratio of foot length)
    TOE_LIFT_DY: 0.15,       // Minimum toe lift (15% of foot length)
    
    // Feedback messages
    FEEDBACK: {
        START: 'Sit with feet flat and lift your toes up',
        LIFT: 'Lift your toes higher',
        HOLD: 'Hold at the top',
        LOWER: 'Lower your toes with control',
        COMPLETE: 'Good rep!',
        KNEE_ANGLE: 'Keep your knee at about 90 degrees',
        FOOT_POSITION: 'Keep your heel on the ground',
        SWITCH_LEGS: 'Switch legs',
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

// Helper function to calculate ankle angle (dorsiflexion/plantarflexion)
// Using foot_index as the reference point for the front of the foot
function calculateAnkleAngle(knee, ankle, footIndex) {
    if (!knee || !ankle || !footIndex) return 0;
    return calculateInteriorAngle(knee, ankle, footIndex);
}

// Helper function to calculate knee angle
function calculateKneeAngle(hip, knee, ankle) {
    if (!hip || !knee || !ankle) return 0;
    return calculateInteriorAngle(hip, knee, ankle);
}

// Main exercise detection function
const SeatedDorsiflexion_repDetection = (
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
    
    // Get required keypoints - only using available keypoints from MoveNet
    const keypointNames = [
        'left_hip', 'right_hip',
        'left_knee', 'right_knee',
        'left_ankle', 'right_ankle',
        'left_foot_index', 'right_foot_index',
        'left_heel', 'right_heel'
    ];
    
    // Note: MoveNet provides these keypoints:
    // - nose, left_eye, right_eye, left_ear, right_ear
    // - left_shoulder, right_shoulder, left_elbow, right_elbow
    // - left_wrist, right_wrist, left_hip, right_hip
    // - left_knee, right_knee, left_ankle, right_ankle

    // Populate keypoints object
    keypointNames.forEach(name => {
        const kp = pose.keypoints.find(k => k.name === name && k.score >= DEFAULTS.KP_MIN);
        if (kp) {
            keypoints[name] = kp;
        }
    });

    // Check if we have all required keypoints for the active side
    const activeSide = state.side;
    const activeKeypoints = {
        hip: keypoints[`${activeSide}_hip`],
        knee: keypoints[`${activeSide}_knee`],
        ankle: keypoints[`${activeSide}_ankle`],
        foot_index: keypoints[`${activeSide}_foot_index`],
        heel: keypoints[`${activeSide}_heel`] || keypoints[`${activeSide}_ankle`] // Fallback to ankle if heel not detected
    };

    const otherSide = activeSide === 'left' ? 'right' : 'left';
    const otherKeypoints = {
        ankle: keypoints[`${otherSide}_ankle`],
        heel: keypoints[`${otherSide}_heel`]
    };

    // Check if we have all required keypoints
    if (!activeKeypoints.hip || !activeKeypoints.knee || !activeKeypoints.ankle || 
        !activeKeypoints.toe || !activeKeypoints.heel) {
        feedbackRef.current = `Please ensure your ${activeSide} leg is visible`;
        keypointColorsRef.current = DEFAULTS.COLORS.ERROR;
        return getResult(state);
    }

    // Calculate angles and positions
    const ankleAngle = calculateAnkleAngle(
        activeKeypoints.knee, 
        activeKeypoints.ankle, 
        activeKeypoints.toe
    );
    
    const kneeAngle = calculateKneeAngle(
        activeKeypoints.hip,
        activeKeypoints.knee,
        activeKeypoints.ankle
    );

    // Calculate foot lift (vertical distance from heel to foot_index)
    // Using foot_index as the reference point for the front of the foot
    const footLift = activeKeypoints.ankle.y - activeKeypoints.foot_index.y;
    const heelToFootIndexDistance = calculateDistance(
        { x: activeKeypoints.heel.x, y: activeKeypoints.heel.y },
        { x: activeKeypoints.foot_index.x, y: activeKeypoints.foot_index.y }
    );
    const normalizedLift = footLift / (heelToFootIndexDistance || 1); // Prevent division by zero

    // Update range of motion tracking
    state.maxAnkleAngle = Math.max(state.maxAnkleAngle, ankleAngle);
    state.minAnkleAngle = Math.min(state.minAnkleAngle, ankleAngle);
    state.rangeOfMotion = state.maxAnkleAngle - state.minAnkleAngle;

    // Calculate toe velocity (pixels per second)
    const currentTime = Date.now();
    let toeVelocity = 0;
    if (state.lastToeY !== null && state.lastToeTime) {
        const dy = activeKeypoints.toe.y - state.lastToeY;
        const dt = (currentTime - state.lastToeTime) / 1000; // Convert to seconds
        toeVelocity = dt > 0 ? Math.abs(dy / dt) : 0;
    }

    // Update state with current position
    state.lastToeY = activeKeypoints.toe.y;
    state.lastToeTime = currentTime;
    state.toeVelocity = toeVelocity;
    
    // Check form validity using available keypoints
    const isKneeAt90 = kneeAngle > 80 && kneeAngle < 100; // Allow some flexibility
    
    // Check if heel is down by comparing ankle and heel y-positions
    // If heel keypoint is not available, use ankle position as fallback
    const isHeelDown = activeKeypoints.heel ? 
        Math.abs(activeKeypoints.ankle.y - activeKeypoints.heel.y) < 20 : 
        true; // If we can't detect heel, assume it's down
        
    // Check if other foot is stable (if visible)
    const isOtherFootStable = otherKeypoints.ankle && otherKeypoints.heel ? 
        Math.abs(otherKeypoints.ankle.y - otherKeypoints.heel.y) < 20 : 
        true; // If we can't see the other foot, assume it's stable
    
    const isFormValid = isKneeAt90 && isHeelDown && isOtherFootStable;
    const isInRefractory = currentTime - state.lastRepTime < DEFAULTS.REFRACTORY_MS;

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
                    } else if (ankleAngle < DEFAULTS.ANKLE_ANGLE_MIN + 20) {
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
                        if (state.rangeOfMotion < 30) {
                            romFeedback = ' (try for a greater range of motion)';
                        }
                        
                        feedbackRef.current = `${DEFAULTS.FEEDBACK.COMPLETE} ${romFeedback}`.trim();
                        
                        // Switch sides if needed
                        if (side === 'both') {
                            const newSide = activeSide === 'left' ? 'right' : 'left';
                            state.side = newSide;
                            startLegRef.current = newSide;
                            feedbackRef.current += ` ${DEFAULTS.FEEDBACK.SWITCH_LEGS}`;
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
        if (!isKneeAt90) {
            feedbackRef.current = DEFAULTS.FEEDBACK.KNEE_ANGLE;
        } else if (!isHeelDown) {
            feedbackRef.current = DEFAULTS.FEEDBACK.FOOT_POSITION;
        } else if (!isOtherFootStable) {
            feedbackRef.current = DEFAULTS.FEEDBACK.BALANCE;
        }
        keypointColorsRef.current = DEFAULTS.COLORS.ERROR;
        segmentColorsRef.current = DEFAULTS.COLORS.ERROR;
    }

    // Set keypoints for visualization - only using available keypoints
    keypointsRef.current = [
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

export default SeatedDorsiflexion_repDetection;
