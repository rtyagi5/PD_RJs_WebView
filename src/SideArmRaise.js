// SideArmRaise.js
import { calculateInteriorAngle } from './utilities';

export const SAR_repDetection = async (
  poses,
  side,
  feedbackRef,
  armLoweredCountRef,
  armUpCountRef,
  armLoweredFlagRef,
  repCountRef,
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
          let newArmLoweredCount = armLoweredCountRef.current;
          let newArmUpCount = armUpCountRef.current;
          let newArmLoweredFlag = armLoweredFlagRef.current;

          if (!feedbackLockRef.current) {
          // Arm Lowered Logic - More lenient angle range for faster movements
          if (shoulderAngle > 0 && shoulderAngle < 45) {  // Increased from 35 to 45 degrees
            keypointColorsRef.current = "#66FF00";
            segmentColorsRef.current = "#66FF00";
            
            // Only update feedback if we're not in the middle of a rep
            if (newArmUpCount === 0 || newArmUpCount === 1) {
              feedbackRef.current = newArmLoweredCount === 0 ? "Start The movement" : "Lowering arm";
            }
            
            if (!newArmLoweredFlag) {
              newArmLoweredFlag = true;
              if (newArmLoweredCount === 0) {
                newArmLoweredCount = 1;
                feedbackRef.current = "Good Start Position";
                console.log(`Arm lowered 1 detected - Angle: ${shoulderAngle.toFixed(1)}°`);
                console.log(`State - Lowered: ${newArmLoweredCount}, Raised: ${newArmUpCount}, Flag: ${newArmLoweredFlag}`);
              } else if (newArmLoweredCount === 1 && newArmUpCount === 1) {
                newArmLoweredCount = 2;
                feedbackRef.current = "Arm lowered 2";
                console.log(`Arm lowered 2 detected - Angle: ${shoulderAngle.toFixed(1)}°`);
                console.log(`State - Lowered: ${newArmLoweredCount}, Raised: ${newArmUpCount}, Flag: ${newArmLoweredFlag}`);
                
                // Check for rep completion when arm is lowered the second time
                if (repCountRef.current < targetReps) {
                  repCountRef.current++;
                  feedbackRef.current = `${repCountRef.current} Rep`;
                  console.log(`[REP COUNT] ${repCountRef.current} of ${targetReps} completed`);
                  
                  // Activate the feedback lock to prevent double counting
                  feedbackLockRef.current = true;
                  
                  // Reset the movement tracking after a very short delay
                  setTimeout(() => {
                    armLoweredCountRef.current = 0;
                    armUpCountRef.current = 0;
                    armLoweredFlagRef.current = false;
                    feedbackLockRef.current = false;
                    console.log("Reset movement tracking");
                  }, 300); // Reduced from 500ms to 300ms for even faster response
                  
                  // Reset local variables after successful rep count
                  newArmLoweredCount = 0;
                  newArmUpCount = 0;
                  newArmLoweredFlag = false;
                  
                  // Check if target reps achieved
                  if (repCountRef.current >= targetReps) {
                    await handleExerciseComplete();
                    return { armAngle, shoulderAngle, repCount: repCountRef.current };
                  }
                }
              }
            }
          }
          // Intermediate Range Logic (30 to 70 degrees)
          else if (shoulderAngle >= 35 && shoulderAngle <= 70) {
            keypointColorsRef.current = "#66FF00";
            segmentColorsRef.current = "#66FF00";
            feedbackRef.current = "Keep Going";
          }
          // Arm Up Logic - More responsive to faster movements
          else if (shoulderAngle > 65 && shoulderAngle <= 100) {  // Increased range from 70-90 to 65-100
            keypointColorsRef.current = "#66FF00";
            segmentColorsRef.current = "#66FF00";
            
            // Only update state if we're coming from a lowered position
            if (newArmLoweredCount === 1 && newArmUpCount === 0) {
              newArmUpCount = 1;
              feedbackRef.current = "Arm up detected";
              console.log("Arm up detected - Shoulder angle:", shoulderAngle.toFixed(1));
              
              // Log the current state for debugging
              console.log(`State - Lowered: ${newArmLoweredCount}, Raised: ${newArmUpCount}, Flag: ${newArmLoweredFlag}`);
            }
            
            // Reset the lowered flag when arm is raised
            newArmLoweredFlag = false;
          } 
          // Arm Too High - Only show warning if we're not in the middle of a rep
          else if (shoulderAngle > 100) {  // Increased from 90 to 100 degrees
            if (feedbackRef.current !== "Arm raise too high") {
              keypointColorsRef.current = "orange";  // Changed from red to orange for less severity
              segmentColorsRef.current = "orange";
              feedbackRef.current = "Arm raise too high";
              console.log("Arm raise too high - Shoulder angle:", shoulderAngle.toFixed(1));
            }
          }
        }

          // Update state at the end
          armLoweredCountRef.current = newArmLoweredCount;
          armUpCountRef.current = newArmUpCount;
          armLoweredFlagRef.current = newArmLoweredFlag;
        } else {
          if (!feedbackLockRef.current) {
          //feedbackRef.current = "Invalid angles detected";
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
      //feedbackRef.current = `Move your ${side} arm into the frame`;
      feedbackRef.current = "Make sure all key points are visible";
      }
    }
  } else {
    if (!feedbackLockRef.current) {
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
