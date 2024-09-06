import { calculateInteriorAngle } from './utilities';

export const MiniSquats_repDetection = (
    poses,
    side,
    setKneeAngle,
    setSpineAngle,
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
                // Calculate angles
                kneeAngle = calculateInteriorAngle(hip, knee, ankle);
                spineAngle = calculateInteriorAngle(shoulder, hip, knee);
                
                // Update angles in state
                setKneeAngle(kneeAngle); 
                setSpineAngle(spineAngle);

                let newSitLoweredCount = sitLoweredCountRef.current;
                let newSitUpCount = sitUpCountRef.current;
                let newSitLoweredFlag = sitLoweredFlagRef.current;

                // Standing Position (Initial): Knee angle between 170° to 180°
                if (kneeAngle >= 170 && kneeAngle <= 180) {
                    setFeedback("Good standing position");
                    feedbackRef.current = "Good standing position";
                }

                // Squat Movement: Knee angle between 150° to 140°
                if (kneeAngle >= 140 && kneeAngle <= 150) {
                    if (!newSitLoweredFlag) {
                        newSitLoweredFlag = true;
                        if (newSitLoweredCount === 0) {
                            newSitLoweredCount = 1;
                            setFeedback("Squat detected");
                            feedbackRef.current = "Squat detected";
                        } else if (newSitLoweredCount === 1 && newSitUpCount === 1) {
                            newSitLoweredCount = 2;
                            setFeedback("Squat deepened");
                            feedbackRef.current = "Squat deepened";
                        }
                    }
                }

                // Intermediate Range: Knee angle between 150° to 170°
                else if (kneeAngle > 150 && kneeAngle < 170) {
                    setFeedback("Intermediate range");
                    feedbackRef.current = "Intermediate range";
                }

                // Standing Up Movement: Knee angle returns to 170° to 180°
                else if (kneeAngle > 170) {
                    if (newSitLoweredCount === 1) {
                        if (newSitUpCount === 0) {
                            newSitUpCount = 1;
                            setFeedback("Standing up detected");
                            feedbackRef.current = "Standing up detected";
                        }
                    }
                    newSitLoweredFlag = false;
                }

                // Rep Count Logic: When squat and stand-up complete
                if (newSitUpCount === 1 && newSitLoweredCount === 2 && kneeAngle > 140 && kneeAngle < 150) {
                    if (repCountRef.current < targetReps) {
                        repCountRef.current++;
                        setRepCount(repCountRef.current);  // Update the state
                        setFeedback("Repetition completed");
                        feedbackRef.current = "Repetition completed";
                    }
                    newSitLoweredCount = 0;
                    newSitUpCount = 0;
                    newSitLoweredFlag = false;

                    // Check if target reps achieved
                    if (repCountRef.current >= targetReps) {
                        handleExerciseComplete();
                        return { kneeAngle, spineAngle, repCount: repCountRef.current }; // Exit the function
                    }
                }

                // Update state at the end
                sitLoweredCountRef.current = newSitLoweredCount;
                sitUpCountRef.current = newSitUpCount;
                sitLoweredFlagRef.current = newSitLoweredFlag;

                // Debugging logs
                console.log("sitLoweredFlag value", sitLoweredFlagRef.current);
                console.log("sitUpCount value", sitUpCountRef.current);
                console.log("sitLoweredCount value", sitLoweredCountRef.current);
                console.log("current repCount value", repCountRef.current);

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
        kneeAngle: kneeAngle !== null ? kneeAngle : undefined,
        spineAngle: spineAngle !== null ? spineAngle : undefined,
        repCount: repCountRef.current
    };
};
