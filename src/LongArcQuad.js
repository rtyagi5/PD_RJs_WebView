import { calculateInteriorAngle } from './utilities';

export const LAQ_repDetection = (
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
    handleExerciseComplete,
    keypointColorsRef,      
    segmentColorsRef,
    keypointsRef
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
                    setKneeAngle(kneeAngle);
                    setSpineAngle(spineAngle);

                    let newSitLoweredCount = sitLoweredCountRef.current;
                    let newSitUpCount = sitUpCountRef.current;
                    let newSitLoweredFlag = sitLoweredFlagRef.current;

                    // Starting Position Check
                    if (spineAngle >= 80 && spineAngle <= 130 && kneeAngle >= 85 && kneeAngle <= 95) {
                        keypointColorsRef.current="green";
                        segmentColorsRef.current="green";
                        setFeedback("Good starting position!");
                        feedbackRef.current = "Good starting position!";
                    }

                    // Intermediate Movement Logic (kneeAngle between 95 and 170 degrees)
                    if (kneeAngle > 95 && kneeAngle <= 170) {
                        keypointColorsRef.current="green";
                        segmentColorsRef.current="green";
                        setFeedback("Intermediate range");
                        feedbackRef.current = "Intermediate range";
                    }

                    // Leg Lowered Logic (starting position)
                    if (kneeAngle >= 85 && kneeAngle <= 95) {
                        keypointColorsRef.current="green";
                        segmentColorsRef.current="green";
                        if (!newSitLoweredFlag) {
                            newSitLoweredFlag = true;
                            if (newSitLoweredCount === 0) {
                                newSitLoweredCount = 1;
                                setFeedback("Leg lowered 1");
                                console.log("Leg lowered 1 detected");
                                feedbackRef.current = "Leg lowered 1";
                            } else if (newSitLoweredCount === 1 && newSitUpCount === 1) {
                                newSitLoweredCount = 2;
                                setFeedback("Leg lowered 2");
                                console.log("Leg lowered 2 detected");
                                feedbackRef.current = "Leg lowered 2";
                            }
                        }
                    }
                    // Leg Up Logic (end position when kneeAngle is between 170 and 180)
                    if (kneeAngle >= 170 && kneeAngle <= 180) {
                        keypointColorsRef.current="green";
                        segmentColorsRef.current="green";
                        if (newSitLoweredCount === 1) {
                            if (newSitUpCount === 0) {
                                newSitUpCount = 1;
                                setFeedback("Leg up detected");
                                console.log("Leg up detected");
                                feedbackRef.current = "Leg up detected";
                            }
                        }
                        newSitLoweredFlag = false;
                    }

                    if (spineAngle < 80 || spineAngle > 130 || kneeAngle < 85) {
                        keypointColorsRef.current="red";
                        segmentColorsRef.current="red";
                     
                    }

                    // Rep Count Logic
                    if (newSitUpCount === 1 && newSitLoweredCount === 2 && kneeAngle >= 85 && kneeAngle <= 95) {
                        if (repCountRef.current < targetReps) {
                            repCountRef.current++;
                            setRepCount(repCountRef.current);  // Update the state
                            feedbackRef.current = "Repetition completed";
                            setFeedback("Repetition completed");
                            console.log("Repetition completed");
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
                } else {
                    setFeedback("Invalid angles detected");
                    feedbackRef.current = "Invalid angles detected";
                }
            } else {
                setFeedback("Make sure all key points are visible");
                feedbackRef.current = "Make sure all key points are visible";
            }
        } else {
            setFeedback(`Move your ${side} leg into the frame`);
            feedbackRef.current = `Move your ${side} leg into the frame`;
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
