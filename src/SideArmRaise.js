// SideArmRaise.js
import { calculateInteriorAngle } from './utilities';

export const SAR_repDetection = (
  poses,
  side,
  setArmAngle,
  setShoulderAngle,
  setFeedback,
  feedbackRef,
  armLoweredCountRef,
  armUpCountRef,
  armLoweredFlagRef,
  repCountRef,
  setRepCount,
  targetReps,
  handleExerciseComplete,
  keypointColorsRef,
  segmentColorsRef,
  keypointsRef,
  feedbackLockRef  // Add this parameter
) => {
  let armAngle = null;
  let shoulderAngle = null;

  if (poses.length > 0 && poses[0].keypoints) {
    const keypoints = poses[0].keypoints;
    const shoulder = keypoints.find((k) => k.name === `${side}_shoulder`);
    const elbow = keypoints.find((k) => k.name === `${side}_elbow`);
    const wrist = keypoints.find((k) => k.name === `${side}_wrist`);
    const hip = keypoints.find((k) => k.name === `${side}_hip`);

    if (shoulder && elbow && wrist && hip) {
      const allKeyPointsDetected = [shoulder, elbow, wrist, hip].every((k) => k.score > 0.3);

      if (allKeyPointsDetected) {
        keypointsRef.current = [shoulder.name, elbow.name, wrist.name, hip.name];

        armAngle = calculateInteriorAngle(shoulder, elbow, wrist);
        shoulderAngle = calculateInteriorAngle(hip, shoulder, elbow);

        if (!isNaN(armAngle) && !isNaN(shoulderAngle)) {
          setArmAngle(armAngle);
          setShoulderAngle(shoulderAngle);

          let newArmLoweredCount = armLoweredCountRef.current;
          let newArmUpCount = armUpCountRef.current;
          let newArmLoweredFlag = armLoweredFlagRef.current;

          if (!feedbackLockRef.current) {
          // Arm Lowered Logic
          if (shoulderAngle > 0 && shoulderAngle < 35) {
            keypointColorsRef.current = "#66FF00";
            segmentColorsRef.current = "#66FF00";
            feedbackRef.current = "Start The movement";
            if (!newArmLoweredFlag) {
              newArmLoweredFlag = true;
              if (newArmLoweredCount === 0) {
                newArmLoweredCount = 1;
                setFeedback("Arm lowered 1");
               // feedbackRef.current = "Good Start Position";
                console.log("Arm lowered 1 detected");
              } else if (newArmLoweredCount === 1 && newArmUpCount === 1) {
                newArmLoweredCount = 2;
                setFeedback("Arm lowered 2");
              //  feedbackRef.current = "Arm lowered 2";
                console.log("Arm lowered 2 detected");
              }
            }
          }

          // Intermediate Range Logic (30 to 70 degrees)
          else if (shoulderAngle >= 35 && shoulderAngle <= 70) {
            keypointColorsRef.current = "#66FF00";
            segmentColorsRef.current = "#66FF00";
            setFeedback("Intermediate range");
            feedbackRef.current = "Keep Going";
          }

          // Arm Up Logic
          else if (shoulderAngle > 70 && shoulderAngle <= 90) {
            keypointColorsRef.current = "#66FF00";
            segmentColorsRef.current = "#66FF00";
            if (newArmLoweredCount === 1) {
              if (newArmUpCount === 0) {
                newArmUpCount = 1;
                setFeedback("Arm up detected");
                feedbackRef.current = "Arm up detected";
                console.log("Arm up detected");
              }
            }
            newArmLoweredFlag = false;
          } else if (shoulderAngle > 90) {
            keypointColorsRef.current = "red";
            segmentColorsRef.current = "red";
            setFeedback("Arm raise too high");
            feedbackRef.current = "Arm raise too high";
            console.log("Arm raise too high");
          }
        }
          // Rep Count Logic
          if (
            newArmUpCount === 1 &&
            newArmLoweredCount === 2 &&
            shoulderAngle > 0 &&
            shoulderAngle < 35
          ) {
            if (repCountRef.current < targetReps) {
              repCountRef.current++;
              setRepCount(repCountRef.current);
              setFeedback(`${repCountRef.current} Rep completed`);
              feedbackRef.current = `${repCountRef.current} Rep`;
              console.log(`${repCountRef.current} Rep completed`);
            }

              // Activate the feedback lock
              feedbackLockRef.current = true;

              // Release the lock after 2 seconds
              setTimeout(() => {
                feedbackLockRef.current = false;
              }, 2000); // Adjust the duration as needed
            

            newArmLoweredCount = 0;
            newArmUpCount = 0;
            newArmLoweredFlag = false;

            // Check if target reps achieved
            if (repCountRef.current >= targetReps) {
              handleExerciseComplete();
              return { armAngle, shoulderAngle, repCount: repCountRef.current }; // Exit the function
            }
          }

          // Update state at the end
          armLoweredCountRef.current = newArmLoweredCount;
          armUpCountRef.current = newArmUpCount;
          armLoweredFlagRef.current = newArmLoweredFlag;
        } else {
          if (!feedbackLockRef.current) {
          setFeedback("Invalid angles detected");
          //feedbackRef.current = "Invalid angles detected";
          feedbackRef.current = "Make sure all key points are visible";
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
      setFeedback(`Move your ${side} arm into the frame`);
      //feedbackRef.current = `Move your ${side} arm into the frame`;
      feedbackRef.current = "Make sure all key points are visible";
      }
    }
  } else {
    if (!feedbackLockRef.current) {
      setFeedback("No person detected");
      //feedbackRef.current = "No person detected";
      feedbackRef.current = "Make sure all key points are visible";
    }
  }

  return {
    armAngle: armAngle !== null ? armAngle : undefined,
    shoulderAngle: shoulderAngle !== null ? shoulderAngle : undefined,
    repCount: repCountRef.current,
  };
};
