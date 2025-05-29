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

                if (!feedbackLockRef.current) {

                // Standing Position (Initial): Knee angle between 170° to 180°
                if (kneeAngle >= 170 && kneeAngle <= 180) {
                    keypointColorsRef.current="#66FF00";
                    segmentColorsRef.current="#66FF00";
                    feedbackRef.current = "Good standing position";
                }

                // Squat Movement: Knee angle between 150° to 140°
                if (kneeAngle >= 110 && kneeAngle <= 120) {
                    keypointColorsRef.current="#66FF00";
                    segmentColorsRef.current="#66FF00";
                    if (!newSitLoweredFlag) {
                        newSitLoweredFlag = true;
                        if (newSitLoweredCount === 0) {
                            newSitLoweredCount = 1;
                            feedbackRef.current = "Squat detected";
                        } else if (newSitLoweredCount === 1 && newSitUpCount === 1) {
                            newSitLoweredCount = 2;
                            feedbackRef.current = "Squat deepened";
                        }
                    }
                }

                // Intermediate Range: Knee angle between 150° to 170°
                else if (kneeAngle > 120 && kneeAngle < 170) {
                    keypointColorsRef.current="#66FF00";
                    segmentColorsRef.current="#66FF00";
                    feedbackRef.current = "Intermediate range";
                }

                // Standing Up Movement: Knee angle returns to 170° to 180°
                else if (kneeAngle > 170) {
                    keypointColorsRef.current="#66FF00";
                    segmentColorsRef.current="#66FF00";
                    if (newSitLoweredCount === 1) {
                        if (newSitUpCount === 0) {
                            newSitUpCount = 1;
                            feedbackRef.current = "Standing up detected";
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

                // Rep Count Logic: When squat and stand-up complete
                if (newSitUpCount === 1 && newSitLoweredCount === 2 && kneeAngle > 140 && kneeAngle < 150) {
                    if (repCountRef.current < targetReps) {
                        repCountRef.current++;
                        feedbackRef.current = `${repCountRef.current} Rep`;
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
                        return { kneeAngle, spineAngle, repCount: repCountRef.current }; // Exit the function
                    }
                }

                // Update state at the end
                sitLoweredCountRef.current = newSitLoweredCount;
                sitUpCountRef.current = newSitUpCount;
                sitLoweredFlagRef.current = newSitLoweredFlag;

                // Debugging logs
                // console.log("sitLoweredFlag value", sitLoweredFlagRef.current);
                // console.log("sitUpCount value", sitUpCountRef.current);
                // console.log("sitLoweredCount value", sitLoweredCountRef.current);
                // console.log("current repCount value", repCountRef.current);

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
