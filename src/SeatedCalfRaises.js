import { calculateInteriorAngle, calculateDistance, getMidpoint } from './utilities';

// Default configuration
const DEFAULTS = {
    // Movement thresholds (as ratio of torso length)
    ANKLE_UP_DY: 0.05,    // tuned default per user preference
    ANKLE_DOWN_DY: 0.025,
    HOLD_SECONDS: 0.3,
    REFRACTORY_MS: 500,
    MERGE_WINDOW_MS: 350,
    KP_MIN: 0.3,
    // Additional movement thresholds
    HIPANKLE_UP_DY: 0.03,
    HIPANKLE_DOWN_DY: 0.015,
    ANGLE_DEV_MAX: 10, // degrees allowed deviation during movement
    // Start posture windows (degrees)
    START_KNEE_MIN: 80,
    START_KNEE_MAX: 110,
    START_HIP_MIN: 50,
    START_HIP_MAX: 130,
    
    // Angle thresholds (in degrees)
    KNEE_ANGLE_MIN: 60,   // Minimum knee angle (more extended)
    KNEE_ANGLE_MAX: 170,  // Maximum knee angle (less extended)
    
    // Feedback messages
    FEEDBACK: {
        START: 'Sit with feet flat and lift your heels',
        LIFT: 'Lift your heels higher',
        HOLD: 'Hold at the top',
        LOWER: 'Lower slowly with control',
        COMPLETE: 'Good rep!',
        ADJUST: 'Adjust position for better detection',
        KNEE_ANGLE: 'Keep your knees at about 150 degrees',
        FOOT_POSITION: 'Keep your feet flat on the ground',
        OTHER_LEG_STABLE: 'Keep your other foot still'
    },
    
    // Colors for feedback
    COLORS: {
        DEFAULT: 'aqua',
        CORRECT: '#00FF00',  // Green
        WARNING: '#FFA500',  // Orange
        ERROR: '#FF0000'     // Red
    }
};

// Debug helper gated by build mode
const DEBUG = process.env.NODE_ENV !== 'production';
const dbg = (...args) => { if (DEBUG) { console.log(...args); } };

// Module-persistent state (used if caller doesn't pass a stateRef)
const _MODULE_STATE = { current: null };

// Helper to initialize a fresh state object
const initState = () => ({
    phase: 'IDLE',
    lastRepTime: 0,
    lastAnkleY: null,
    lastAnkleTime: null,
    ankleVelocity: 0,
    holdStartTime: 0,
    lastPhaseChange: Date.now(),
    isComplete: false,
    baseline: { left: null, right: null },             // normalized rise baseline
    baselineHipAnkle: { left: null, right: null },     // hip-ankle normalized distance baseline
    baselineKneeAngle: { left: null, right: null },
    baselineHipAngle: { left: null, right: null },
    baselineSetTime: { left: 0, right: 0 },
    lastLeftAnkleY: null,
    lastRightAnkleY: null
});

// Helper function to calculate knee angle
const calculateKneeAngle = (hip, knee, ankle) => {
    if (!hip || !knee || !ankle) return 180;
    return calculateInteriorAngle(
        { x: hip.x, y: hip.y },
        { x: knee.x, y: knee.y },
        { x: ankle.x, y: ankle.y }
    ) || 180;
};

// Helper function to validate form
const validateForm = (keypoints, side) => {
    // Bilateral mode: validate both sides independently, skip other-leg-stability rule
    if (side === 'both') {
        const sides = ['left', 'right'];
        for (const s of sides) {
            const hip = keypoints[s]?.hip;
            const knee = keypoints[s]?.knee;
            const ankle = keypoints[s]?.ankle;
            if (!hip || !knee || !ankle || hip.score < DEFAULTS.KP_MIN || knee.score < DEFAULTS.KP_MIN || ankle.score < DEFAULTS.KP_MIN) {
                return { isValid: false, message: DEFAULTS.FEEDBACK.ADJUST };
            }
            const angle = calculateKneeAngle(hip, knee, ankle);
            if (DEBUG) {
                dbg('[SeatedCalfRaises][validateForm][both]', { s, kneeAngle: Number.isFinite(angle) ? Number(angle.toFixed(1)) : angle });
            }
            if (angle < DEFAULTS.KNEE_ANGLE_MIN || angle > DEFAULTS.KNEE_ANGLE_MAX) {
                return { isValid: false, message: DEFAULTS.FEEDBACK.KNEE_ANGLE, color: DEFAULTS.COLORS.WARNING };
            }
        }
        return { isValid: true };
    }

    const { hip, knee, ankle } = keypoints[side];
    const otherSide = side === 'left' ? 'right' : 'left';
    
    // Check if keypoints exist and have good confidence
    if (!hip || !knee || !ankle || 
        hip.score < DEFAULTS.KP_MIN || 
        knee.score < DEFAULTS.KP_MIN || 
        ankle.score < DEFAULTS.KP_MIN) {
        return { isValid: false, message: DEFAULTS.FEEDBACK.ADJUST };
    }
    
    // Check knee angle (internal angle at the knee)
    const kneeAngle = calculateKneeAngle(hip, knee, ankle);
    if (DEBUG) {
        const o = keypoints[otherSide] || {};
        dbg('[SeatedCalfRaises][validateForm]', {
            side,
            kneeAngle: Number.isFinite(kneeAngle) ? Number(kneeAngle.toFixed(1)) : kneeAngle,
            scores: {
                hip: hip?.score,
                knee: knee?.score,
                ankle: ankle?.score
            },
            otherPresent: !!(o?.hip && o?.ankle)
        });
    }
    if (kneeAngle < DEFAULTS.KNEE_ANGLE_MIN || kneeAngle > DEFAULTS.KNEE_ANGLE_MAX) {
        return { 
            isValid: false, 
            message: DEFAULTS.FEEDBACK.KNEE_ANGLE,
            color: DEFAULTS.COLORS.WARNING
        };
    }
    
    // Check if other leg is stable
    const otherAnkle = keypoints[otherSide]?.ankle;
    const otherHip = keypoints[otherSide]?.hip;
    if (otherAnkle && otherHip) {
        const otherAnkleRise = otherHip.y - otherAnkle.y;
        const shoulderMid = getMidpoint(
            keypoints.left?.shoulder, 
            keypoints.right?.shoulder
        );
        const hipMid = getMidpoint(
            keypoints.left?.hip,
            keypoints.right?.hip
        );
        const torsoLen = calculateDistance(shoulderMid, hipMid);
        const normalizedRise = otherAnkleRise / torsoLen;
        if (DEBUG) {
            dbg('[SeatedCalfRaises][validateForm] other leg rise', {
                side,
                otherSide,
                normalizedRise: Number(normalizedRise.toFixed(3))
            });
        }
        
        if (normalizedRise > DEFAULTS.ANKLE_UP_DY * 0.5) {
            return {
                isValid: false,
                message: DEFAULTS.FEEDBACK.OTHER_LEG_STABLE,
                color: DEFAULTS.COLORS.WARNING
            };
        }
    }
    
    return { isValid: true };
};

export const SeatedCalfRaises_repDetection = async (
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
    lastRepTimeRef = { current: 0 },
    stateRef = null // <-- optional; if not provided, we use module-persistent state
) => {
    // Use a persistent state (module-level by default, or user-provided ref)
    const _stateRef = stateRef || _MODULE_STATE;
    if (!_stateRef.current) _stateRef.current = initState();
    const state = _stateRef.current;

    // Early return if no poses detected
    if (!poses?.[0]?.keypoints?.length) {
        feedbackRef.current = 'No pose detected. Please position yourself in view.';
        keypointColorsRef.current = DEFAULTS.COLORS.ERROR;
        dbg('[SeatedCalfRaises] No poses detected');
        return getResult(state, {
            keypointColorsRef,
            segmentColorsRef,
            keypointsRef,
            feedbackRef,
            leftLegCountRef,
            rightLegCountRef,
            repCountRef,
            startLegRef,
            targetReps
        });
    }

    // Extract and process keypoints
    const keypoints = { left: {}, right: {} };
    poses[0].keypoints.forEach(kp => {
        const parts = kp.name?.split('_');
        if (parts?.length === 2) {
            const [sd, part] = parts;
            if (keypoints[sd] && keypoints[sd][part] === undefined) {
                keypoints[sd][part] = kp;
            }
        }
    });
    
    // Calculate additional properties for each side
    ['left', 'right'].forEach(sd => {
        const { hip, knee, ankle, shoulder } = keypoints[sd];
        const confScores = [hip, knee, ankle, shoulder].filter(Boolean).map(kp => kp.score);
        keypoints[sd].confidence = confScores.length > 0 
            ? confScores.reduce((a, b) => a + b, 0) / confScores.length 
            : 0;
        keypoints[sd].angle = calculateKneeAngle(hip, knee, ankle);
        if (shoulder && hip && knee) {
            keypoints[sd].hipAngle = calculateInteriorAngle(
                { x: shoulder.x, y: shoulder.y },
                { x: hip.x, y: hip.y },
                { x: knee.x, y: knee.y }
            );
        } else {
            keypoints[sd].hipAngle = null;
        }
    });

    // Per-leg structs
    const leftLeg = {
        ankle: keypoints.left.ankle,
        hip: keypoints.left.hip,
        knee: keypoints.left.knee,
        angle: keypoints.left.angle,
        hipAngle: keypoints.left.hipAngle
    };
    const rightLeg = {
        ankle: keypoints.right.ankle,
        hip: keypoints.right.hip,
        knee: keypoints.right.knee,
        angle: keypoints.right.angle,
        hipAngle: keypoints.right.hipAngle
    };
    {
        const lA = Number.isFinite(leftLeg.angle) ? Number(leftLeg.angle.toFixed(1)) : leftLeg.angle;
        const rA = Number.isFinite(rightLeg.angle) ? Number(rightLeg.angle.toFixed(1)) : rightLeg.angle;
        dbg('[SeatedCalfRaises] Knee angles', { left: lA, right: rA });
    }
    
    // Ankle/hip Y for velocity
    const avgAnkleY = (leftLeg.ankle?.y + rightLeg.ankle?.y) / 2;
    const avgHipY = (leftLeg.hip?.y + rightLeg.hip?.y) / 2; // (not used directly but kept for completeness)
    
    // Validate form before processing
    const evalSide = side;
    const formValidation = validateForm(keypoints, evalSide);
    if (!formValidation.isValid) {
        feedbackRef.current = formValidation.message;
        keypointColorsRef.current = formValidation.color || DEFAULTS.COLORS.ERROR;
        segmentColorsRef.current = formValidation.color || DEFAULTS.COLORS.ERROR;
        dbg('[SeatedCalfRaises] Form invalid', { side: evalSide, message: formValidation.message });
        return getResult(state, {
            keypointColorsRef,
            segmentColorsRef,
            keypointsRef: { current: [
                'left_hip', 'left_knee', 'left_ankle',
                'right_hip', 'right_knee', 'right_ankle'
            ]},
            feedbackRef,
            leftLegCountRef,
            rightLegCountRef,
            repCountRef,
            startLegRef,
            targetReps
        });
    }
    
    // Visualization keypoints
    keypointsRef.current = [
        'left_hip', 'left_knee', 'left_ankle',
        'right_hip', 'right_knee', 'right_ankle'
    ];
    
    // Torso length normalization (fallback if shoulders/hips are missing)
    const shoulderMid = getMidpoint(keypoints.left.shoulder, keypoints.right.shoulder);
    const hipMid = getMidpoint(keypoints.left.hip, keypoints.right.hip);
    let torsoLen = calculateDistance(shoulderMid, hipMid);
    if (!Number.isFinite(torsoLen) || torsoLen < 1) {
        const leftScale = leftLeg.hip && leftLeg.ankle ? calculateDistance(leftLeg.hip, leftLeg.ankle) : 0;
        const rightScale = rightLeg.hip && rightLeg.ankle ? calculateDistance(rightLeg.hip, rightLeg.ankle) : 0;
        torsoLen = Math.max(leftScale, rightScale, 1);
        dbg('[SeatedCalfRaises] TorsoLen fallback', { torsoLen, leftScale, rightScale });
    }
    
    // Required keypoints present?
    const needLeft = side !== 'right';
    const needRight = side !== 'left';
    const missingLeft = needLeft && (!keypoints.left.ankle || !keypoints.left.knee || !keypoints.left.hip);
    const missingRight = needRight && (!keypoints.right.ankle || !keypoints.right.knee || !keypoints.right.hip);
    if (missingLeft || missingRight) {
        feedbackRef.current = side === 'both' ? 'Please ensure both legs are visible' : `Please ensure ${side} leg is visible`;
        keypointColorsRef.current = DEFAULTS.COLORS.ERROR;
        segmentColorsRef.current = DEFAULTS.COLORS.ERROR;
        dbg('[SeatedCalfRaises] Missing keypoints', { needLeft, needRight, missingLeft, missingRight });
        return getResult(state, {
            keypointColorsRef,
            segmentColorsRef,
            keypointsRef,
            feedbackRef,
            repCountRef,
            startLegRef,
            targetReps
        });
    }
    
    const currentTime = Date.now();
    const isInRefractory = currentTime - state.lastRepTime < DEFAULTS.REFRACTORY_MS;
    dbg('[SeatedCalfRaises] Refractory', {
        isInRefractory,
        sinceLast: state.lastRepTime ? (currentTime - state.lastRepTime) : null,
        windowMs: DEFAULTS.REFRACTORY_MS
    });
    
    // Per-side normalized rises (note: your camera has heel-up negative; we use abs on deltas later)
    const leftRiseNorm = (leftLeg.hip.y - leftLeg.ankle.y) / torsoLen;
    const rightRiseNorm = (rightLeg.hip.y - rightLeg.ankle.y) / torsoLen;
    dbg('[SeatedCalfRaises] Normalized rise (absolute)', {
        left: Number(leftRiseNorm.toFixed(3)),
        right: Number(rightRiseNorm.toFixed(3))
    });

    // Hip-ankle normalized distances (always positive)
    const leftHipAnkleNorm = calculateDistance(leftLeg.hip, leftLeg.ankle) / torsoLen;
    const rightHipAnkleNorm = calculateDistance(rightLeg.hip, rightLeg.ankle) / torsoLen;
    dbg('[SeatedCalfRaises] Hip-Ankle norm (absolute)', {
        left: Number(leftHipAnkleNorm.toFixed(3)),
        right: Number(rightHipAnkleNorm.toFixed(3))
    });
    
    // Ankle velocity (px/s)
    let ankleVelocity = 0;
    if (state.lastAnkleY !== null && state.lastAnkleTime) {
        const dy = avgAnkleY - state.lastAnkleY;
        const dt = (currentTime - state.lastAnkleTime) / 1000; // seconds
        ankleVelocity = dt > 0 ? Math.abs(dy / dt) : 0;
    }
    state.lastAnkleY = avgAnkleY;
    state.lastAnkleTime = currentTime;
    state.ankleVelocity = ankleVelocity;

    // Establish/update baselines in IDLE when stable and in start posture windows
    const STABLE_VEL_PX_S = 30; // heuristic
    if (state.phase === 'IDLE' && ankleVelocity < STABLE_VEL_PX_S && !isInRefractory) {
        const trySetSide = (sLeg, label) => {
            const kneeA = sLeg.angle;
            const hipA = sLeg.hipAngle;
            if (
                Number.isFinite(kneeA) && Number.isFinite(hipA) &&
                kneeA >= DEFAULTS.START_KNEE_MIN && kneeA <= DEFAULTS.START_KNEE_MAX &&
                hipA >= DEFAULTS.START_HIP_MIN && hipA <= DEFAULTS.START_HIP_MAX
            ) {
                if (state.baseline[label] === null) {
                    state.baseline[label] = (label === 'left' ? leftRiseNorm : rightRiseNorm);
                    state.baselineHipAnkle[label] = (label === 'left' ? leftHipAnkleNorm : rightHipAnkleNorm);
                    state.baselineKneeAngle[label] = kneeA;
                    state.baselineHipAngle[label] = hipA;
                    state.baselineSetTime[label] = currentTime;
                    dbg(`[SeatedCalfRaises] Set baselines ${label}`, {
                        rise: Number((label === 'left' ? leftRiseNorm : rightRiseNorm).toFixed(3)),
                        hipAnkle: Number((label === 'left' ? leftHipAnkleNorm : rightHipAnkleNorm).toFixed(3)),
                        kneeAngle: Number(kneeA.toFixed(1)),
                        hipAngle: Number(hipA.toFixed(1))
                    });
                }
            }
        };
        trySetSide(leftLeg, 'left');
        trySetSide(rightLeg, 'right');
    }

    // Compute deltas from baseline (fallback 0 if baseline missing)
    const deltaLeft = state.baseline.left === null ? 0 : (leftRiseNorm - state.baseline.left);
    const deltaRight = state.baseline.right === null ? 0 : (rightRiseNorm - state.baseline.right);
    const deltaRise = side === 'left' ? deltaLeft : side === 'right' ? deltaRight : Math.max(Math.abs(deltaLeft), Math.abs(deltaRight)) * Math.sign(Math.abs(deltaLeft) >= Math.abs(deltaRight) ? deltaLeft : deltaRight);
    const deltaLeftHipAnkle = state.baselineHipAnkle.left === null ? 0 : (leftHipAnkleNorm - state.baselineHipAnkle.left);
    const deltaRightHipAnkle = state.baselineHipAnkle.right === null ? 0 : (rightHipAnkleNorm - state.baselineHipAnkle.right);
    const deltaHipAnkle = side === 'left' ? deltaLeftHipAnkle : side === 'right' ? deltaRightHipAnkle : Math.max(Math.abs(deltaLeftHipAnkle), Math.abs(deltaRightHipAnkle)) * Math.sign(Math.abs(deltaLeftHipAnkle) >= Math.abs(deltaRightHipAnkle) ? deltaLeftHipAnkle : deltaRightHipAnkle);

    dbg('[SeatedCalfRaises] Delta rise', {
        side,
        left: Number(deltaLeft.toFixed(3)),
        right: Number(deltaRight.toFixed(3)),
        used: Number(deltaRise.toFixed(3))
    });
    dbg('[SeatedCalfRaises] Delta hip-ankle', {
        side,
        left: Number(deltaLeftHipAnkle.toFixed(3)),
        right: Number(deltaRightHipAnkle.toFixed(3)),
        used: Number(deltaHipAnkle.toFixed(3))
    });
    
    if (!isInRefractory) {
        // Check extension window (both sides if "both")
        const isLeftLegExtended = leftLeg.angle > DEFAULTS.KNEE_ANGLE_MIN && leftLeg.angle < DEFAULTS.KNEE_ANGLE_MAX;
        const isRightLegExtended = rightLeg.angle > DEFAULTS.KNEE_ANGLE_MIN && rightLeg.angle < DEFAULTS.KNEE_ANGLE_MAX;

        const formOK = side === 'left'
            ? isLeftLegExtended
            : side === 'right'
                ? isRightLegExtended
                : (isLeftLegExtended && isRightLegExtended);
        dbg('[SeatedCalfRaises] Form check', {
            side,
            isLeftLegExtended,
            isRightLegExtended,
            formOK
        });

        // Ensure baselines exist for the evaluated side(s)
        const needLeftBase = side !== 'right';
        const needRightBase = side !== 'left';
        const hasLeftBase = !needLeftBase || (state.baseline.left !== null && state.baselineHipAnkle.left !== null && state.baselineKneeAngle.left !== null && state.baselineHipAngle.left !== null);
        const hasRightBase = !needRightBase || (state.baseline.right !== null && state.baselineHipAnkle.right !== null && state.baselineKneeAngle.right !== null && state.baselineHipAngle.right !== null);

        if (!hasLeftBase || !hasRightBase) {
            feedbackRef.current = 'Get into start posture: knees ~90°, hips ~90°';
            keypointColorsRef.current = DEFAULTS.COLORS.DEFAULT;
            segmentColorsRef.current = DEFAULTS.COLORS.DEFAULT;
            dbg('[SeatedCalfRaises] Waiting for baseline', { needLeftBase, needRightBase, hasLeftBase, hasRightBase });
        } else if (formOK) {
            const timeInPhase = currentTime - state.lastPhaseChange;
            const minPhaseTime = 300; // ms
            
            if (timeInPhase >= minPhaseTime) {
                switch (state.phase) {
                    case 'IDLE': {
                        // Angle deviations must be within limit from baselines
                        const kneeDev = (side === 'left'
                            ? Math.abs(leftLeg.angle - state.baselineKneeAngle.left)
                            : side === 'right'
                                ? Math.abs(rightLeg.angle - state.baselineKneeAngle.right)
                                : Math.max(
                                    Math.abs(leftLeg.angle - state.baselineKneeAngle.left),
                                    Math.abs(rightLeg.angle - state.baselineKneeAngle.right)
                                ));
                        const hipDev = (side === 'left'
                            ? Math.abs(leftLeg.hipAngle - state.baselineHipAngle.left)
                            : side === 'right'
                                ? Math.abs(rightLeg.hipAngle - state.baselineHipAngle.right)
                                : Math.max(
                                    Math.abs(leftLeg.hipAngle - state.baselineHipAngle.left),
                                    Math.abs(rightLeg.hipAngle - state.baselineHipAngle.right)
                                ));
                        const angleOK = kneeDev <= DEFAULTS.ANGLE_DEV_MAX && hipDev <= DEFAULTS.ANGLE_DEV_MAX;

                        if ((Math.abs(deltaRise) > DEFAULTS.ANKLE_UP_DY || Math.abs(deltaHipAnkle) > DEFAULTS.HIPANKLE_UP_DY) && angleOK) {
                            state.phase = 'ASCEND';
                            state.holdStartTime = currentTime;
                            state.lastPhaseChange = currentTime;
                            feedbackRef.current = DEFAULTS.FEEDBACK.HOLD;
                            keypointColorsRef.current = DEFAULTS.COLORS.CORRECT;
                            segmentColorsRef.current = DEFAULTS.COLORS.CORRECT;
                            dbg('[SeatedCalfRaises] Phase IDLE -> ASCEND', {
                                side,
                                deltaRise: deltaRise.toFixed(3),
                                deltaHipAnkle: deltaHipAnkle.toFixed(3),
                                kneeDev: kneeDev.toFixed(1),
                                hipDev: hipDev.toFixed(1)
                            });
                        } else if (Math.abs(deltaRise) > DEFAULTS.ANKLE_UP_DY * 0.7 || Math.abs(deltaHipAnkle) > DEFAULTS.HIPANKLE_UP_DY * 0.7) {
                            feedbackRef.current = 'Almost there, lift a bit higher';
                            keypointColorsRef.current = DEFAULTS.COLORS.WARNING;
                            segmentColorsRef.current = DEFAULTS.COLORS.WARNING;
                        } else {
                            feedbackRef.current = DEFAULTS.FEEDBACK.LIFT;
                            keypointColorsRef.current = DEFAULTS.COLORS.DEFAULT;
                            segmentColorsRef.current = DEFAULTS.COLORS.DEFAULT;
                        }
                        break;
                    }
                        
                    case 'ASCEND': {
                        const kneeDevAsc = (side === 'left'
                            ? Math.abs(leftLeg.angle - state.baselineKneeAngle.left)
                            : side === 'right'
                                ? Math.abs(rightLeg.angle - state.baselineKneeAngle.right)
                                : Math.max(
                                    Math.abs(leftLeg.angle - state.baselineKneeAngle.left),
                                    Math.abs(rightLeg.angle - state.baselineKneeAngle.right)
                                ));
                        const hipDevAsc = (side === 'left'
                            ? Math.abs(leftLeg.hipAngle - state.baselineHipAngle.left)
                            : side === 'right'
                                ? Math.abs(rightLeg.hipAngle - state.baselineHipAngle.right)
                                : Math.max(
                                    Math.abs(leftLeg.hipAngle - state.baselineHipAngle.left),
                                    Math.abs(rightLeg.hipAngle - state.baselineHipAngle.right)
                                ));
                        const dropped = (Math.abs(deltaRise) < DEFAULTS.ANKLE_UP_DY * 0.8 && Math.abs(deltaHipAnkle) < DEFAULTS.HIPANKLE_UP_DY * 0.8);
                        const angleOKAsc = kneeDevAsc <= DEFAULTS.ANGLE_DEV_MAX && hipDevAsc <= DEFAULTS.ANGLE_DEV_MAX;

                        if (dropped || !angleOKAsc) {
                            state.phase = 'IDLE';
                            state.lastPhaseChange = currentTime;
                            feedbackRef.current = 'Lift higher and hold';
                            keypointColorsRef.current = DEFAULTS.COLORS.ERROR;
                            segmentColorsRef.current = DEFAULTS.COLORS.ERROR;
                            dbg('[SeatedCalfRaises] Phase ASCEND -> IDLE (drop/angle)', {
                                side,
                                deltaRise: deltaRise.toFixed(3),
                                deltaHipAnkle: deltaHipAnkle.toFixed(3),
                                kneeDev: kneeDevAsc.toFixed(1),
                                hipDev: hipDevAsc.toFixed(1)
                            });
                        } else if (currentTime - state.holdStartTime > DEFAULTS.HOLD_SECONDS * 1000) {
                            state.phase = 'HOLD';
                            state.lastPhaseChange = currentTime;
                            feedbackRef.current = DEFAULTS.FEEDBACK.LOWER;
                            keypointColorsRef.current = DEFAULTS.COLORS.CORRECT;
                            segmentColorsRef.current = DEFAULTS.COLORS.CORRECT;
                            dbg('[SeatedCalfRaises] Phase ASCEND -> HOLD');
                        } else {
                            const timeLeft = ((DEFAULTS.HOLD_SECONDS * 1000) - (currentTime - state.holdStartTime)) / 1000;
                            feedbackRef.current = `Hold for ${timeLeft.toFixed(1)}s`;
                        }
                        break;
                    }
                        
                    case 'HOLD': {
                        // Complete rep when we return close to baseline (sign-agnostic)
                        if (Math.abs(deltaRise) < DEFAULTS.ANKLE_DOWN_DY && Math.abs(deltaHipAnkle) < DEFAULTS.HIPANKLE_DOWN_DY) {
                            state.lastRepTime = currentTime;
                            state.phase = 'IDLE';
                            state.lastPhaseChange = currentTime;
                            feedbackRef.current = DEFAULTS.FEEDBACK.COMPLETE;

                            // Increment per-side counters
                            if (side === 'left') {
                                leftLegCountRef.current++;
                            } else if (side === 'right') {
                                rightLegCountRef.current++;
                            } else {
                                // Attribute to the leg with greater magnitude delta at completion
                                if (Math.abs(deltaLeft) >= Math.abs(deltaRight)) leftLegCountRef.current++; else rightLegCountRef.current++;
                            }

                            // Merge-window for total reps
                            const withinMerge = (currentTime - (lastRepTimeRef.current || 0)) <= DEFAULTS.MERGE_WINDOW_MS;
                            if (!withinMerge) {
                                repCountRef.current++;
                                lastRepTimeRef.current = currentTime;
                                dbg('[SeatedCalfRaises] Rep++', {
                                    side,
                                    rep: repCountRef.current,
                                    leftLegCount: leftLegCountRef.current,
                                    rightLegCount: rightLegCountRef.current
                                });
                            } else {
                                dbg('[SeatedCalfRaises] Merge-window suppression (no total rep increment)', {
                                    sinceLast: currentTime - lastRepTimeRef.current,
                                    mergeWindow: DEFAULTS.MERGE_WINDOW_MS
                                });
                            }

                            // Target reached?
                            if (repCountRef.current >= targetReps) {
                                handleExerciseComplete(repCountRef.current);
                                return {
                                    keypoints: keypointsRef.current,
                                    keypointColors: keypointColorsRef.current,
                                    segmentColors: segmentColorsRef.current,
                                    feedback: feedbackRef.current,
                                    leftLegCount: leftLegCountRef.current,
                                    rightLegCount: rightLegCountRef.current,
                                    repCount: repCountRef.current,
                                    isComplete: true
                                };
                            }
                        }
                        break;
                    }
                        
                    default:
                        break;
                }
            }
        } else {
            // Form validation passed earlier, but extension posture not OK yet: show neutral guidance
            feedbackRef.current = DEFAULTS.FEEDBACK.LIFT;
            keypointColorsRef.current = DEFAULTS.COLORS.DEFAULT;
            segmentColorsRef.current = DEFAULTS.COLORS.DEFAULT;
        }
    }
    
    // Return the current state
    return getResult(state, {
        keypointColorsRef,
        segmentColorsRef,
        keypointsRef,
        feedbackRef,
        leftLegCountRef,
        rightLegCountRef,
        repCountRef,
        startLegRef,
        targetReps
    });
};

// Helper function to format the result
function getResult(state, refs) {
    const result = {
        keypoints: refs.keypointsRef.current,
        keypointColors: refs.keypointColorsRef.current,
        segmentColors: refs.segmentColorsRef.current,
        feedback: refs.feedbackRef.current || DEFAULTS.FEEDBACK.START,
        leftLegCount: refs.leftLegCountRef.current || 0,
        rightLegCount: refs.rightLegCountRef.current || 0,
        repCount: refs.repCountRef.current || 0,
        isComplete: state.isComplete || false,
        state: state.phase
    };
    
    // Update the refs for the next frame
    refs.repCountRef.current = result.repCount;
    refs.leftLegCountRef.current = result.leftLegCount;
    refs.rightLegCountRef.current = result.rightLegCount;
    refs.startLegRef.current = state.activeSide;
    
    return result;
}

export default SeatedCalfRaises_repDetection;
