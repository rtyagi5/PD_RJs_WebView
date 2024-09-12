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
    setRepCount,  // Ensure this is passed correctly
    targetReps,
    handleExerciseComplete,
    keypointColorsRef,      
    segmentColorsRef,
    keypointsRef
  ) => {

    let armAngle= null;
    let shoulderAngle = null;
    
    if (poses.length > 0 && poses[0].keypoints) {
      const keypoints = poses[0].keypoints;
      const shoulder = keypoints.find(k => k.name === `${side}_shoulder`);
      const elbow = keypoints.find(k => k.name === `${side}_elbow`);
      const wrist = keypoints.find(k => k.name === `${side}_wrist`);
      const hip = keypoints.find(k => k.name === `${side}_hip`);
    
  
      if (shoulder && elbow && wrist && hip) {
        keypointsRef.current = [shoulder.name, elbow.name, wrist.name, hip.name];
        
        const allKeyPointsDetected = [shoulder, elbow, wrist, hip].every(k => k.score > 0.3);
  
        if (allKeyPointsDetected) {
          armAngle = calculateInteriorAngle(shoulder, elbow, wrist);
          shoulderAngle = calculateInteriorAngle(hip, shoulder, elbow);
        
  
          if (!isNaN(armAngle) && !isNaN(shoulderAngle)) {
            setArmAngle(armAngle);
            setShoulderAngle(shoulderAngle);
  
            let newArmLoweredCount = armLoweredCountRef.current;
            let newArmUpCount = armUpCountRef.current;
            let newArmLoweredFlag = armLoweredFlagRef.current;
  
            // Arm Lowered Logic
            if (shoulderAngle > 0 && shoulderAngle < 30) {
              keypointColorsRef.current="green";
              segmentColorsRef.current="green";

              if (!newArmLoweredFlag) {
                newArmLoweredFlag = true;
                if (newArmLoweredCount === 0) {
                  newArmLoweredCount = 1;
                  setFeedback("Arm lowered 1");
                  console.log("Arm lowered 1 detected");
                  feedbackRef.current = "Arm lowered 1";
                } else if (newArmLoweredCount === 1 && newArmUpCount === 1) {
                  newArmLoweredCount = 2;
                  setFeedback("Arm lowered 2");
                  console.log("Arm lowered 2 detected");
                  feedbackRef.current = "Arm lowered 2";
                }
              }
            }
  
            // Intermediate Range Logic (30 to 70 degrees)
            else if (shoulderAngle >= 30 && shoulderAngle <= 70) {
              keypointColorsRef.current="green";
              segmentColorsRef.current="green";
            setFeedback("Intermediate range");
            feedbackRef.current="Intermediate range";
              console.log("Intermediate Range Logic (30 to 70 degrees) newArmLoweredCount", newArmLoweredCount);
              console.log("Intermediate Range Logic (30 to 70 degrees) newArmLoweredFlag", newArmLoweredFlag);
              console.log("Intermediate Range Logic (30 to 70 degrees) newArmUpCount", newArmUpCount);
            }
  
            // Arm Up Logic
            else if (shoulderAngle > 70 && shoulderAngle <= 90) {
              keypointColorsRef.current="green";
              segmentColorsRef.current="green";
              if (newArmLoweredCount === 1) {
                if (newArmUpCount === 0) {
                  newArmUpCount = 1;
                  setFeedback("Arm up detected");
                  console.log("Arm up detected");
                  feedbackRef.current="Arm up detected";
                }
              }
              newArmLoweredFlag = false;
            }
            else if (shoulderAngle > 90) {
              keypointColorsRef.current="red";
              segmentColorsRef.current="red";
            }
  
            // Rep Count Logic
            if (newArmUpCount === 1 && newArmLoweredCount === 2 && shoulderAngle > 0 && shoulderAngle < 30) {
              if (repCountRef.current < targetReps) {
                repCountRef.current++;
                setRepCount(repCountRef.current);  // Update the state
                feedbackRef.current="Repetition completed";
                setFeedback("Repetition completed");
                console.log("Repetition completed");
                
              }
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
  
            // Debugging logs
            console.log("armDown flag value", armLoweredFlagRef.current);
            console.log("outside any if condition armUpCount value", armUpCountRef.current);
            console.log("outside any if condition armLoweredCount value", armLoweredCountRef.current);
            console.log("current repCount value", repCountRef.current);
          } else {
            setFeedback("Invalid angles detected");
             feedbackRef.current="Invalid angles detected";
          }
        } else {
          setFeedback("Make sure all key points are visible");
           feedbackRef.current="Make sure all key points are visible";
        }
      } else {
        setFeedback(`Move your ${side} arm into the frame`);
         feedbackRef.current=`Move your ${side} arm into the frame`;
      }
    } else {
      setFeedback("No person detected");
       feedbackRef.current="No person detected";
    }
   
    return { 
      armAngle: armAngle !== null ? armAngle : undefined,
      shoulderAngle: shoulderAngle !== null ? shoulderAngle : undefined,
      repCount: repCountRef.current
     };
  };
  