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
    handleExerciseComplete,
    keypointColorsRef,      
    segmentColorsRef,
    keypointsRef,
    feedbackLockRef  // Add this parameter
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
                keypointsRef.current = [hip.name, knee.name, ankle.name, shoulder.name];
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

                    if (!feedbackLockRef.current) {

                    // Sit Lowered Logic (when sitting down)
                    if (kneeAngle > 70 && kneeAngle < 110 && 
                        spineAngle >= 70 && spineAngle <= 110) {
                            keypointColorsRef.current="#66FF00";
                            segmentColorsRef.current="#66FF00";
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
                        keypointColorsRef.current="#66FF00";
                        segmentColorsRef.current="#66FF00";
                        setFeedback("Intermediate range");
                        feedbackRef.current = "Intermediate range";
                    }

                    // Sit Up Logic (when standing up)
                    else if (kneeAngle > 150 && kneeAngle <= 180) {
                        keypointColorsRef.current="#66FF00";
                        segmentColorsRef.current="#66FF00";
                        if (newSitLoweredCount === 1) {
                            if (newSitUpCount === 0) {
                                newSitUpCount = 1;
                                setFeedback("Standing detected");
                                feedbackRef.current = "Standing detected";
                            }
                        }
                        newSitLoweredFlag = false;
                    }
                    else if (kneeAngle <= 70 || kneeAngle > 180) {
                        keypointColorsRef.current="red";
                        segmentColorsRef.current="red";
                      }
                      else if ( spineAngle < 70 || spineAngle > 110 ) {
                        keypointColorsRef.current="red";
                        segmentColorsRef.current="red";
                      }
                    }
                    // Rep Count Logic
                    if (newSitUpCount === 1 && newSitLoweredCount === 2 && kneeAngle > 70 && kneeAngle < 100) {
                        if (repCountRef.current < targetReps) {
                            repCountRef.current++;
                            setRepCount(repCountRef.current);
                            setFeedback("Repetition completed");
                            feedbackRef.current = `${repCountRef.current} Rep`;
                            console.log("Repetition completed");
                        }

                        // Activate the feedback lock
                        feedbackLockRef.current = true;

                        // Release the lock after 2 seconds
                        setTimeout(() => {
                            feedbackLockRef.current = false;
                        }, 2000); // Adjust the duration as needed


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
                    if (!feedbackLockRef.current) {
                    setFeedback("Invalid angles detected");
                    feedbackRef.current = "Invalid angles detected";
                    }
                }
            } else {
                if (!feedbackLockRef.current) {
                setFeedback("Make sure all key points are visible");
                feedbackRef.current = "Make sure all key points are visible";
                }
            }
        } else {
            if (!feedbackLockRef.current) {
            setFeedback(`Move your ${side} side into the frame`);
            feedbackRef.current = `Move your ${side} side into the frame`;
            }
        }
    } else {
        if (!feedbackLockRef.current) {
        setFeedback("No person detected");
        feedbackRef.current = "No person detected";
        }
    }

    return { 
        spineAngle: spineAngle !== null ? spineAngle : undefined,
        kneeAngle: kneeAngle !== null ? kneeAngle : undefined,
        hipDistance: hipDistance !== null ? hipDistance : undefined,
        repCount: repCountRef.current
    };
};
