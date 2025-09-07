import { calculateInteriorAngle } from './utilities';

// Simple configuration
const DEFAULTS = {
    // Angle thresholds (in degrees)
    ELBOW_ANGLE_MIN: 30,      // Flexed threshold (curl complete)
    ELBOW_ANGLE_MAX: 160,     // Extended threshold (start position)
    
    // Feedback messages
    FEEDBACK: {
        START: 'Start with arms down',
        CURL: 'Curl up',
        LOWER: 'Lower down',
        COMPLETE: 'Good rep!',
        NO_POSE: 'Position yourself in view',
        READY: 'Ready for bicep curls!'
    },
    
    // Colors for visualization
    COLORS: {
        DEFAULT: 'aqua',
        CORRECT: '#00FF00',  // Green for extended
        WARNING: '#FFA500',  // Orange for flexed
        ERROR: 'red'
    }
};

// Helper function to calculate elbow angle at the elbow joint
function calculateElbowAngle(shoulder, elbow, wrist) {
    if (!wrist || !elbow || !shoulder) return 0;
    return calculateInteriorAngle(shoulder, elbow, wrist);
}

// (unused helper removed)

// Simple bicep curl detection
const BicepCurls_repDetection = (
    poses,
    side = 'both',
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
// Simple state (persist across frames via refs)
    const state = {
        phase: feedbackLockRef?.current?.phase || 'IDLE',
        lastRepTime: lastRepTimeRef?.current || 0,
        side: side === 'both' ? (startArmRef.current || 'left') : side
    };

    // Merge window for bilateral counting (ms)
    const MERGE_WINDOW_MS = 350;
    // Gating params to avoid false positives
    const FLEX_DWELL_MS = 150; // must hold FLEXED at least this long
    const FLEX_DEPTH_MARGIN = 5; // require min angle go at least this much below MIN

    // Normalize feedbackLockRef to an object so we can store __meta for per-arm state
    if (!feedbackLockRef.current || typeof feedbackLockRef.current !== 'object') {
        feedbackLockRef.current = { locked: !!feedbackLockRef.current };
    }

    // Helpers to handle lock ref in either boolean or object form (compat with SideArmRaise)
    const getLocked = () => {
        const cur = feedbackLockRef && feedbackLockRef.current;
        if (cur == null) return false;
        if (typeof cur === 'boolean') return cur;
        if (typeof cur === 'object' && 'locked' in cur) return !!cur.locked;
        return false;
    };
    const setLocked = (val) => {
        if (!feedbackLockRef) return;
        if (typeof feedbackLockRef.current === 'boolean') {
            feedbackLockRef.current = !!val;
        } else if (feedbackLockRef.current && typeof feedbackLockRef.current === 'object') {
            feedbackLockRef.current.locked = !!val;
        } else {
            feedbackLockRef.current = !!val; // fall back to boolean
        }
        if (process.env.REACT_APP_DEVELOPMENT_MODE === 'true') {
            console.log(`[BicepCurls] lock=${val}`);
        }
    };
    const getMeta = (key, defVal) => {
        const cur = feedbackLockRef && feedbackLockRef.current;
        if (cur && typeof cur === 'object') {
            if (!cur.__meta) cur.__meta = {};
            return cur.__meta[key] ?? defVal;
        }
        return defVal;
    };
    const setMeta = (key, val) => {
        const cur = feedbackLockRef && feedbackLockRef.current;
        if (cur && typeof cur === 'object') {
            if (!cur.__meta) cur.__meta = {};
            cur.__meta[key] = val;
        }
    };

    // Early return if no poses detected
    if (!poses?.[0]?.keypoints?.length) {
        feedbackRef.current = DEFAULTS.FEEDBACK.NO_POSE;
        keypointColorsRef.current = DEFAULTS.COLORS.ERROR;
        return getResult(state);
    }
    
    const pose = poses[0];

    // Helper to fetch named keypoint
    const getKeypoint = (side, name) => pose.keypoints.find(kp => kp.name === `${side}_${name}`);

    // Auto-select side when 'both': prefer current side unless it's not visible; otherwise choose the more flexed.
    let activeSide = state.side;
    let shoulder, elbow, wrist;
    if (side === 'both') {
        const ls = getKeypoint('left', 'shoulder');
        const le = getKeypoint('left', 'elbow');
        const lw = getKeypoint('left', 'wrist');
        const rs = getKeypoint('right', 'shoulder');
        const re = getKeypoint('right', 'elbow');
        const rw = getKeypoint('right', 'wrist');

        const lAngle = (ls && le && lw) ? calculateInteriorAngle(lw, le, ls) : Number.POSITIVE_INFINITY;
        const rAngle = (rs && re && rw) ? calculateInteriorAngle(rw, re, rs) : Number.POSITIVE_INFINITY;

        // Per-arm state and lock logic (counts reps independently per arm)
        const nowTs = Date.now();
        const lockMs = 300;
        // Left unlock check
        const lLocked = !!getMeta('leftLocked', false);
        const lLockTs = getMeta('leftLockTs', 0);
        if (lLocked && nowTs - lLockTs > lockMs) { setMeta('leftLocked', false); }
        // Right unlock check
        const rLocked = !!getMeta('rightLocked', false);
        const rLockTs = getMeta('rightLockTs', 0);
        if (rLocked && nowTs - rLockTs > lockMs) { setMeta('rightLocked', false); }

        // Helper: count one cycle if outside merge window; otherwise suppress
        const incPerCycleIfAllowed = (origin) => {
            const lastCycleTs = getMeta('lastCycleTs', 0);
            if (nowTs - lastCycleTs > MERGE_WINDOW_MS) {
                repCountRef.current++;
                setMeta('lastCycleTs', nowTs);
                if (process.env.REACT_APP_DEVELOPMENT_MODE === 'true') {
                    console.log(`[BicepCurls] Cycle rep +1 by ${origin}. total=${repCountRef.current}`);
                }
            } else {
                if (process.env.REACT_APP_DEVELOPMENT_MODE === 'true') {
                    console.log(`[BicepCurls] Merged within ${MERGE_WINDOW_MS}ms; suppress +1 from ${origin}`);
                }
            }
        };

        // Left phase update and transition
        let leftPhase = getMeta('leftPhase', 'IDLE');
        if (isFinite(lAngle)) {
            if (lAngle <= DEFAULTS.ELBOW_ANGLE_MIN) {
                leftPhase = 'FLEXED';
                if (process.env.REACT_APP_DEVELOPMENT_MODE === 'true') {
                    const last = getMeta('leftFlexLogTs', 0); const now = Date.now();
                    if (now - last > 400) { console.log(`[BicepCurls] L FLEXED angle=${Math.round(lAngle)}`); setMeta('leftFlexLogTs', now);} }
                // Start flex dwell tracking
                if (getMeta('leftPhase','IDLE') !== 'FLEXED') {
                    setMeta('leftFlexStart', nowTs);
                    setMeta('leftFlexMin', lAngle);
                } else {
                    const curMin = getMeta('leftFlexMin', lAngle);
                    if (lAngle < curMin) setMeta('leftFlexMin', lAngle);
                }
            } else if (lAngle >= DEFAULTS.ELBOW_ANGLE_MAX) {
                if (leftPhase === 'FLEXED' && !getMeta('leftLocked', false)) {
                    const flexStart = getMeta('leftFlexStart', nowTs);
                    const flexMin = getMeta('leftFlexMin', 999);
                    const dwellOK = (nowTs - flexStart) >= FLEX_DWELL_MS;
                    const depthOK = flexMin <= (DEFAULTS.ELBOW_ANGLE_MIN - FLEX_DEPTH_MARGIN);
                    if (dwellOK && depthOK) {
                    // Count left arm rep; total handled by merge-window logic
                    leftArmCountRef.current++;
                    if (process.env.REACT_APP_DEVELOPMENT_MODE === 'true') {
                        console.log(`[BicepCurls] Left rep completed.`);
                    }
                    setMeta('leftLocked', true);
                    setMeta('leftLockTs', nowTs);
                    incPerCycleIfAllowed('left');
                    } else {
                        if (process.env.REACT_APP_DEVELOPMENT_MODE === 'true') {
                            console.log(`[BicepCurls] Left suppress: dwellOK=${dwellOK} depthOK=${depthOK} min=${Math.round(flexMin)}`);
                        }
                    }
                }
                leftPhase = 'EXTENDED';
                if (process.env.REACT_APP_DEVELOPMENT_MODE === 'true') {
                    const last = getMeta('leftExtLogTs', 0); const now = Date.now();
                    if (now - last > 400) { console.log(`[BicepCurls] L EXTENDED angle=${Math.round(lAngle)} phaseWas=${getMeta('leftPhase','IDLE')}`); setMeta('leftExtLogTs', now);} }
            }
            setMeta('leftPhase', leftPhase);
        }

        // Right phase update and transition
        let rightPhase = getMeta('rightPhase', 'IDLE');
        if (isFinite(rAngle)) {
            if (rAngle <= DEFAULTS.ELBOW_ANGLE_MIN) {
                rightPhase = 'FLEXED';
                if (process.env.REACT_APP_DEVELOPMENT_MODE === 'true') {
                    const last = getMeta('rightFlexLogTs', 0); const now = Date.now();
                    if (now - last > 400) { console.log(`[BicepCurls] R FLEXED angle=${Math.round(rAngle)}`); setMeta('rightFlexLogTs', now);} }
                // Start flex dwell tracking
                if (getMeta('rightPhase','IDLE') !== 'FLEXED') {
                    setMeta('rightFlexStart', nowTs);
                    setMeta('rightFlexMin', rAngle);
                } else {
                    const curMin = getMeta('rightFlexMin', rAngle);
                    if (rAngle < curMin) setMeta('rightFlexMin', rAngle);
                }
            } else if (rAngle >= DEFAULTS.ELBOW_ANGLE_MAX) {
                if (rightPhase === 'FLEXED' && !getMeta('rightLocked', false)) {
                    const flexStart = getMeta('rightFlexStart', nowTs);
                    const flexMin = getMeta('rightFlexMin', 999);
                    const dwellOK = (nowTs - flexStart) >= FLEX_DWELL_MS;
                    const depthOK = flexMin <= (DEFAULTS.ELBOW_ANGLE_MIN - FLEX_DEPTH_MARGIN);
                    if (dwellOK && depthOK) {
                    // Count right arm rep; total handled by merge-window logic
                    rightArmCountRef.current++;
                    if (process.env.REACT_APP_DEVELOPMENT_MODE === 'true') {
                        console.log(`[BicepCurls] Right rep completed.`);
                    }
                    setMeta('rightLocked', true);
                    setMeta('rightLockTs', nowTs);
                    incPerCycleIfAllowed('right');
                    } else {
                        if (process.env.REACT_APP_DEVELOPMENT_MODE === 'true') {
                            console.log(`[BicepCurls] Right suppress: dwellOK=${dwellOK} depthOK=${depthOK} min=${Math.round(flexMin)}`);
                        }
                    }
                }
                rightPhase = 'EXTENDED';
                if (process.env.REACT_APP_DEVELOPMENT_MODE === 'true') {
                    const last = getMeta('rightExtLogTs', 0); const now = Date.now();
                    if (now - last > 400) { console.log(`[BicepCurls] R EXTENDED angle=${Math.round(rAngle)} phaseWas=${getMeta('rightPhase','IDLE')}`); setMeta('rightExtLogTs', now);} }
            }
            setMeta('rightPhase', rightPhase);
        }

        // Completion check
        if (repCountRef.current >= targetReps) {
            handleExerciseComplete(repCountRef.current);
            // Keep going to build visual selection; getResult will mark complete via isComplete flag from call sites where used
        }

        // DEV: log angles for both sides
        if (process.env.REACT_APP_DEVELOPMENT_MODE === 'true') {
            const last = getMeta('lastSidesLogTs', 0);
            const now = Date.now();
            if (now - last > 500) {
                console.log(`[BicepCurls] sides left=${isFinite(lAngle)?Math.round(lAngle):'NA'} right=${isFinite(rAngle)?Math.round(rAngle):'NA'} current=${state.side}`);
                setMeta('lastSidesLogTs', now);
            }
        }

        const curVisible = state.side === 'left' ? (ls && le && lw) : (rs && re && rw);
        const otherSide = state.side === 'left' ? 'right' : 'left';
        const otherVisible = otherSide === 'left' ? (ls && le && lw) : (rs && re && rw);
        const curAngle = state.side === 'left' ? lAngle : rAngle;
        const othAngle = otherSide === 'left' ? lAngle : rAngle;
        const margin = 10; // degrees hysteresis

        if (!curVisible && otherVisible) {
            activeSide = otherSide;
        } else if (state.phase === 'FLEXED') {
            // Latch to current side during a curl to avoid flipping mid-rep
            activeSide = state.side;
        } else {
            // If the other side is clearly more flexed, follow it
            const otherClearlyFlexed = isFinite(othAngle) && (othAngle + margin < curAngle || othAngle <= (DEFAULTS.ELBOW_ANGLE_MIN + 5));
            activeSide = otherClearlyFlexed ? otherSide : state.side;
        }

        if (process.env.REACT_APP_DEVELOPMENT_MODE === 'true' && activeSide !== state.side) {
            console.log(`[BicepCurls] switching side ${state.side} -> ${activeSide} (cur=${isFinite(curAngle)?Math.round(curAngle):'NA'}, other=${isFinite(othAngle)?Math.round(othAngle):'NA'})`);
        }

        state.side = activeSide;
        shoulder = activeSide === 'left' ? ls : rs;
        elbow = activeSide === 'left' ? le : re;
        wrist = activeSide === 'left' ? lw : rw;
    } else {
        activeSide = state.side;
        shoulder = getKeypoint(activeSide, 'shoulder');
        elbow = getKeypoint(activeSide, 'elbow');
        wrist = getKeypoint(activeSide, 'wrist');
    }
    
    if (!shoulder || !elbow || !wrist) {
        feedbackRef.current = `Please ensure your ${activeSide} arm is visible`;
        keypointColorsRef.current = DEFAULTS.COLORS.ERROR;
        return getResult(state);
    }

    // Calculate elbow angle
    const currentTime = Date.now();
    const elbowAngle = calculateElbowAngle(
        shoulder,
        elbow,
        wrist
    );
    
    // Three-zone logic with rep counted on FLEXED -> EXTENDED transition
    const isLocked = getLocked();
    const DEV = process.env.REACT_APP_DEVELOPMENT_MODE === 'true';

    // Mark zones and set phase/colors
    if (elbowAngle >= DEFAULTS.ELBOW_ANGLE_MAX) {
        // Extended zone (start position) - green
        keypointColorsRef.current = DEFAULTS.COLORS.CORRECT;
        segmentColorsRef.current = DEFAULTS.COLORS.CORRECT;
        feedbackRef.current = `${DEFAULTS.FEEDBACK.READY} (${Math.round(elbowAngle)}°) - Reps: ${repCountRef.current}`;
        // Unconditional low-frequency log to verify runtime path
        const lastAny = getMeta('lastAnyLogTs', 0);
        const nowAny = Date.now();
        if (nowAny - lastAny > 1000) {
            console.log(`[BicepCurls] (heartbeat) phase=EXTENDED angle=${Math.round(elbowAngle)} reps=${repCountRef.current}`);
            setMeta('lastAnyLogTs', nowAny);
        }
        if (DEV) {
            const last = getMeta('lastLogTs', 0);
            const now = Date.now();
            if (now - last > 200) {
                console.log(`[BicepCurls] phase=EXTENDED angle=${Math.round(elbowAngle)}`);
                setMeta('lastLogTs', now);
            }
        }

        // If single-arm mode, use global phase/lock; in both-arm mode, counting handled above per-arm
        if (side !== 'both') {
            // If coming back from FLEXED and not locked, count a rep
            if (!isLocked && state.phase === 'FLEXED') {
                state.phase = 'EXTENDED';
                state.lastRepTime = currentTime;
                repCountRef.current++;
                if (activeSide === 'left') {
                    leftArmCountRef.current++;
                } else {
                    rightArmCountRef.current++;
                }
                if (DEV) console.log(`[BicepCurls] Rep completed. total=${repCountRef.current}`);
                setLocked(true);
                setTimeout(() => setLocked(false), 300);

                if (repCountRef.current >= targetReps) {
                    handleExerciseComplete(repCountRef.current);
                    return getResult(state, true);
                }
            } else {
                state.phase = 'EXTENDED';
            }
        } else {
            state.phase = 'EXTENDED';
        }
    } else if (elbowAngle <= DEFAULTS.ELBOW_ANGLE_MIN) {
        // Flexed zone (curl complete) - orange
        keypointColorsRef.current = DEFAULTS.COLORS.WARNING;
        segmentColorsRef.current = DEFAULTS.COLORS.WARNING;
        feedbackRef.current = `${DEFAULTS.FEEDBACK.CURL} (${Math.round(elbowAngle)}°)`;
        state.phase = 'FLEXED';
        // Unconditional low-frequency log
        {
            const lastAny = getMeta('lastAnyLogTs', 0);
            const nowAny = Date.now();
            if (nowAny - lastAny > 1000) {
                console.log(`[BicepCurls] (heartbeat) phase=FLEXED angle=${Math.round(elbowAngle)} reps=${repCountRef.current}`);
                setMeta('lastAnyLogTs', nowAny);
            }
        }
        if (DEV) {
            const last = getMeta('lastLogTs', 0);
            const now = Date.now();
            if (now - last > 200) {
                console.log(`[BicepCurls] phase=FLEXED angle=${Math.round(elbowAngle)}`);
                setMeta('lastLogTs', now);
            }
        }
    } else {
        // In-between zone - default color
        keypointColorsRef.current = DEFAULTS.COLORS.DEFAULT;
        segmentColorsRef.current = DEFAULTS.COLORS.DEFAULT;
        feedbackRef.current = `Keep going (${Math.round(elbowAngle)}°)`;
        // Unconditional low-frequency log
        {
            const lastAny = getMeta('lastAnyLogTs', 0);
            const nowAny = Date.now();
            if (nowAny - lastAny > 1000) {
                console.log(`[BicepCurls] (heartbeat) phase=${state.phase} angle=${Math.round(elbowAngle)} reps=${repCountRef.current}`);
                setMeta('lastAnyLogTs', nowAny);
            }
        }
        if (DEV) {
            const last = getMeta('lastLogTs', 0);
            const now = Date.now();
            if (now - last > 200) {
                console.log(`[BicepCurls] phase=${state.phase} angle=${Math.round(elbowAngle)}`);
                setMeta('lastLogTs', now);
            }
        }
        // Keep phase as-is to ensure proper transition counting
    }

    // Set keypoints for visualization
    keypointsRef.current = [
        'left_shoulder', 'right_shoulder',
        'left_elbow', 'right_elbow',
        'left_wrist', 'right_wrist'
    ];

    // Default feedback if no other feedback was set
    if (!feedbackRef.current) {
        feedbackRef.current = DEFAULTS.FEEDBACK.READY;
    }

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
            isComplete: !!isComplete,
            phase: state.phase
        };
        
        // Update the refs for the next frame
        repCountRef.current = result.repCount;
        leftArmCountRef.current = result.leftArmCount;
        rightArmCountRef.current = result.rightArmCount;
        startArmRef.current = state.side;
        if (feedbackLockRef && feedbackLockRef.current) {
            feedbackLockRef.current.phase = state.phase;
        }
        if (lastRepTimeRef) {
            lastRepTimeRef.current = state.lastRepTime;
        }
        
        return result;
    }
};

export default BicepCurls_repDetection;
