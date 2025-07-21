import { calculateInteriorAngle } from './utilities';

export const MiniSquats_repDetection = (
    poses,
    side,
    feedbackRef,
    sitLoweredCountRef,
    sitUpCountRef,
    sitLoweredFlagRef,
    repCountRef,
    targetReps,
    handleExerciseComplete,
    keypointColorsRef,      
    segmentColorsRef,
    keypointsRef,
    feedbackLockRef  // Add this parameter
) => {

    let kneeAngle = null;
    let spineAngle = null;

    if (poses.length > 0 && poses[0].keypoints) {
        const keypoints = poses[0].keypoints;
        const hip = keypoints.find(k => k.name === `${side}_hip`);
        const knee = keypoints.find(k => k.name === `${side}_knee`);
        const ankle = keypoints.find(k => k.name === `${side}_ankle`);
        const shoulder = keypoints.find(k => k.name === `${side}_shoulder`);

        if (hip && knee && ankle && shoulder) {
            const allKeyPointsDetected = [hip, knee, ankle, shoulder].every(k => k.score > 0.3);

            if (allKeyPointsDetected) {
                keypointsRef.current = [hip.name, knee.name, ankle.name, shoulder.name];
                // Calculate angles
                kneeAngle = calculateInteriorAngle(hip, knee, ankle);
                spineAngle = calculateInteriorAngle(shoulder, hip, knee);
                

                let newSitLoweredCount = sitLoweredCountRef.current;
                let newSitUpCount = sitUpCountRef.current;
                let newSitLoweredFlag = sitLoweredFlagRef.current;

                // Set default color to green
                keypointColorsRef.current = "#66FF00";
                segmentColorsRef.current = "#66FF00";

                // Initialize state if needed
                if (!window.squatState) {
                    window.squatState = {
                        lastKneeAngle: kneeAngle,
                        currentState: 'standing',  // Possible states: 'standing', 'going_down', 'at_bottom', 'coming_up'
                        lastRepTime: 0,
                        lastRepAngle: 0
                    };
                }

                // Simple state machine for rep counting
                if (!feedbackLockRef.current) {
                    const now = Date.now();
                    const angleDiff = kneeAngle - window.squatState.lastKneeAngle;
                    const isGoingDown = angleDiff < -1;  // More sensitive to small movements
                    const isGoingUp = angleDiff > 1;
                    
                    // Log current state for debugging
                    console.log(`Knee: ${kneeAngle.toFixed(1)}° | ` +
                              `Diff: ${angleDiff.toFixed(1)}° | ` +
                              `State: ${window.squatState.currentState} | ` +
                              `Reps: ${repCountRef.current}`);
                    
                    // State 1: Standing -> Going down
                    if ((window.squatState.currentState === 'standing' || 
                         window.squatState.currentState === 'coming_up') && 
                        kneeAngle < 160 && isGoingDown) {
                        window.squatState.currentState = 'going_down';
                        console.log('[STATE] Going down into squat');
                    }
                    // State 2: Going down -> At bottom
                    else if (window.squatState.currentState === 'going_down' && 
                             kneeAngle <= 130 && isGoingUp) {
                        window.squatState.currentState = 'at_bottom';
                        console.log('[STATE] At bottom - start standing up');
                        newSitLoweredFlag = true;
                        feedbackRef.current = "Good! Now stand up";
                    }
                    // State 3: At bottom -> Coming up (count rep)
                    else if (window.squatState.currentState === 'at_bottom' && 
                             kneeAngle > 130 && isGoingUp && 
                             (now - window.squatState.lastRepTime > 500)) {  // Prevent double counting
                        window.squatState.currentState = 'coming_up';
                        window.squatState.lastRepTime = now;
                        window.squatState.lastRepAngle = kneeAngle;
                        
                        repCountRef.current++;
                        console.log(`[REP] Count: ${repCountRef.current} - Knee angle: ${kneeAngle.toFixed(1)}°`);
                        feedbackRef.current = `${repCountRef.current} Rep`;
                        
                        // Reset flag and activate feedback lock
                        newSitLoweredFlag = false;
                        feedbackLockRef.current = true;
                        
                        setTimeout(() => {
                            feedbackLockRef.current = false;
                        }, 500);
                        
                        if (repCountRef.current >= targetReps) {
                            handleExerciseComplete();
                        }
                    }
                    // State 4: Coming up -> Standing
                    else if (kneeAngle > 160) {
                        if (window.squatState.currentState !== 'standing') {
                            console.log('[STATE] Standing straight');
                            window.squatState.currentState = 'standing';
                            newSitLoweredFlag = false;
                            feedbackRef.current = "Stand up straight";
                        }
                    }
                    
                    // Update last knee angle for next frame
                    window.squatState.lastKneeAngle = kneeAngle;
                    
                    // Visual feedback for form - set color to red only if form is bad
                    if (spineAngle < 70 || spineAngle > 110) {
                        feedbackRef.current = "Keep your back straight";
                        // Only set color to red if we're not in a rep counting state
                        if (newSitLoweredFlag) {
                            keypointColorsRef.current = "red";
                            segmentColorsRef.current = "red";
                        }
                    }
                }

                // Debugging logs
                console.log("sitLoweredFlag:", newSitLoweredFlag, 
                    "sitUpCount:", newSitUpCount,
                    "sitLoweredCount:", newSitLoweredCount,
                    "repCount:", repCountRef.current);
                
                // Update state at the end
                sitLoweredCountRef.current = newSitLoweredCount;
                sitUpCountRef.current = newSitUpCount;
                sitLoweredFlagRef.current = newSitLoweredFlag;
            } else {
                if (!feedbackLockRef.current) {
                    feedbackRef.current = "Make sure all key points are visible";
                }
            }
        } else {
            if (!feedbackLockRef.current) {
                feedbackRef.current = `Move your ${side} side into the frame`;
            }
        }
    } else {
        if (!feedbackLockRef.current) {
            feedbackRef.current = "No person detected";
        }
    }

    return { 
        kneeAngle: kneeAngle !== null ? kneeAngle : undefined,
        spineAngle: spineAngle !== null ? spineAngle : undefined,
        repCount: repCountRef.current
    };
};
