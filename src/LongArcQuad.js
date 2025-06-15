import { calculateInteriorAngle } from './utilities';

export const LAQ_repDetection = async (
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
    feedbackLockRef
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
                kneeAngle = calculateInteriorAngle(hip, knee, ankle);
                spineAngle = calculateInteriorAngle(shoulder, hip, knee);

                if (!isNaN(kneeAngle) && !isNaN(spineAngle)) {
                    let newSitLoweredCount = sitLoweredCountRef.current;
                    let newSitUpCount = sitUpCountRef.current;
                    let newSitLoweredFlag = sitLoweredFlagRef.current;

                    // Set default colors to green
                    keypointColorsRef.current = "#66FF00";
                    segmentColorsRef.current = "#66FF00";

                    if (!feedbackLockRef.current) {
                        // Check for proper form first
                        if (spineAngle < 70 || spineAngle > 140) {
                            keypointColorsRef.current = "red";
                            segmentColorsRef.current = "red";
                            feedbackRef.current = "Keep your back straight";
                        }
                        // Leg Lowered Logic (starting position)
                        else if (kneeAngle >= 85 && kneeAngle <= 95) {
                            if (!newSitLoweredFlag) {
                                newSitLoweredFlag = true;
                                if (newSitLoweredCount === 0) {
                                    newSitLoweredCount = 1;
                                    feedbackRef.current = "Good start position";
                                    console.log(`[START] Leg lowered 1 - Knee: ${kneeAngle.toFixed(1)}°`);
                                } else if (newSitLoweredCount === 1 && newSitUpCount === 1) {
                                    newSitLoweredCount = 2;
                                    feedbackRef.current = "Leg returned to start";
                                    console.log(`[RETURN] Leg lowered 2 - Knee: ${kneeAngle.toFixed(1)}°`);
                                    
                                    // Count the rep when returning to start position
                                    if (repCountRef.current < targetReps) {
                                        repCountRef.current++;
                                        feedbackRef.current = `${repCountRef.current} Rep`;
                                        console.log(`[REP] Count: ${repCountRef.current} of ${targetReps}`);
                                        
                                        // Activate feedback lock to prevent double counting
                                        feedbackLockRef.current = true;
                                        
                                        // Reset after a short delay
                                        setTimeout(() => {
                                            sitLoweredCountRef.current = 0;
                                            sitUpCountRef.current = 0;
                                            sitLoweredFlagRef.current = false;
                                            feedbackLockRef.current = false;
                                            console.log("[RESET] Ready for next rep");
                                        }, 300);
                                        
                                        // Reset local variables
                                        newSitLoweredCount = 0;
                                        newSitUpCount = 0;
                                        newSitLoweredFlag = false;
                                        
                                        // Check if target reps achieved
                                        if (repCountRef.current >= targetReps) {
                                            await handleExerciseComplete();
                                            return { kneeAngle, spineAngle, repCount: repCountRef.current };
                                        }
                                    }
                                }
                            }
                        }
                        // Leg Up Logic (end position)
                        else if (kneeAngle >= 150 && kneeAngle <= 180) {
                            if (newSitLoweredCount === 1 && newSitUpCount === 0) {
                                newSitUpCount = 1;
                                feedbackRef.current = "Leg raised";
                                console.log(`[LIFT] Leg raised - Knee: ${kneeAngle.toFixed(1)}°`);
                            }
                            newSitLoweredFlag = false;
                        }
                        // Intermediate Movement Feedback
                        else if (kneeAngle > 95 && kneeAngle < 150) {
                            feedbackRef.current = newSitLoweredCount === 1 ? "Raising leg..." : "Lowering leg...";
                        }
                    }

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
                    feedbackRef.current = "Make sure all key points are visible";
                }
            }
        } else {
            if (!feedbackLockRef.current) {
                feedbackRef.current = `Move your ${side} leg into the frame`;
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
