import { calculateInteriorAngle, calculateDistance } from './utilities';

export const SitStand_repDetection = (
    poses,
    side,
    setSpineAngle,
    setKneeAngle,
    setHipDistance,
    setFeedback,
    feedbackRef,
    sitLoweredCountRef,
    sitUpCountRef,
    sitLoweredFlagRef,
    repCountRef,
    setRepCount, 
    targetReps,
    handleExerciseComplete
) => {
  
    let spineAngle = null;
    let kneeAngle = null;
    let hipDistance = null;

    if (poses.length > 0 && poses[0].keypoints) {
        const keypoints = poses[0].keypoints;
        const hip = keypoints.find(k => k.name === `${side}_hip`);
        const knee = keypoints.find(k => k.name === `${side}_knee`);
        const ankle = keypoints.find(k => k.name === `${side}_ankle`);
        const shoulder = keypoints.find(k => k.name === `${side}_shoulder`);

        if (hip && knee && ankle && shoulder) {
            const allKeyPointsDetected = [hip, knee, ankle, shoulder].every(k => k.score > 0.3);

            if (allKeyPointsDetected) {
                spineAngle = calculateInteriorAngle(shoulder, hip, knee);
                kneeAngle = calculateInteriorAngle(hip, knee, ankle);
                hipDistance = calculateDistance(hip, knee);

                if (!isNaN(spineAngle) && !isNaN(kneeAngle) && !isNaN(hipDistance)) {
                    setSpineAngle(spineAngle);
                    setKneeAngle(kneeAngle);
                    setHipDistance(hipDistance);

                    let newSitLoweredCount = sitLoweredCountRef.current;
                    let newSitUpCount = sitUpCountRef.current;
                    let newSitLoweredFlag = sitLoweredFlagRef.current;

                    // Sit Lowered Logic (when sitting down)
                    if (kneeAngle > 70 && kneeAngle < 110 && 
                        spineAngle >= 70 && spineAngle <= 110) {
                        if (!newSitLoweredFlag) {
                            newSitLoweredFlag = true;
                            if (newSitLoweredCount === 0) {
                                newSitLoweredCount = 1;
                                setFeedback("Sit-down started");
                                feedbackRef.current = "Sit-down started";
                                console.log("Sit-down 1 detected");
                            } else if (newSitLoweredCount === 1 && newSitUpCount === 1) {
                                newSitLoweredCount = 2;
                                setFeedback("Sit-down complete");
                                feedbackRef.current = "Sit-down complete";
                                console.log("Sit-down 2 detected");
                            }
                        }
                    }

                    // Intermediate Range Logic (kneeAngle between 100 and 150 degrees)
                    else if (kneeAngle > 110 && kneeAngle <= 150) {
                        setFeedback("Intermediate range");
                        feedbackRef.current = "Intermediate range";
                    }

                    // Sit Up Logic (when standing up)
                    else if (kneeAngle > 150 && kneeAngle <= 180) {
                        if (newSitLoweredCount === 1) {
                            if (newSitUpCount === 0) {
                                newSitUpCount = 1;
                                setFeedback("Standing detected");
                                feedbackRef.current = "Standing detected";
                            }
                        }
                        newSitLoweredFlag = false;
                    }

                    // Rep Count Logic
                    if (newSitUpCount === 1 && newSitLoweredCount === 2 && kneeAngle > 70 && kneeAngle < 100) {
                        if (repCountRef.current < targetReps) {
                            repCountRef.current++;
                            setRepCount(repCountRef.current);
                            setFeedback("Repetition completed");
                            feedbackRef.current = "Repetition completed";
                            console.log("Repetition completed");
                        }
                        newSitLoweredCount = 0;
                        newSitUpCount = 0;
                        newSitLoweredFlag = false;

                        // Check if target reps achieved
                        if (repCountRef.current >= targetReps) {
                            handleExerciseComplete();
                            return { spineAngle, kneeAngle, hipDistance, repCount: repCountRef.current };
                        }
                    }

                    // Update state at the end
                    sitLoweredCountRef.current = newSitLoweredCount;
                    sitUpCountRef.current = newSitUpCount;
                    sitLoweredFlagRef.current = newSitLoweredFlag;
                } else {
                    setFeedback("Invalid angles detected");
                    feedbackRef.current = "Invalid angles detected";
                }
            } else {
                setFeedback("Make sure all key points are visible");
                feedbackRef.current = "Make sure all key points are visible";
            }
        } else {
            setFeedback(`Move your ${side} side into the frame`);
            feedbackRef.current = `Move your ${side} side into the frame`;
        }
    } else {
        setFeedback("No person detected");
        feedbackRef.current = "No person detected";
    }

    return { 
        spineAngle: spineAngle !== null ? spineAngle : undefined,
        kneeAngle: kneeAngle !== null ? kneeAngle : undefined,
        hipDistance: hipDistance !== null ? hipDistance : undefined,
        repCount: repCountRef.current
    };
};
