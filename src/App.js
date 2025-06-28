import React, { useState, useEffect } from "react";
import "./App.css";
import ExerciseTracker from "./ExerciseTracker";
import { useLocation } from "react-router-dom";
import {jwtDecode} from "jwt-decode";
import axios from "axios";
import { getServiceUrl } from "./config";
export function useQuery() {
  return new URLSearchParams(useLocation().search);
}

function App() {
  const [isDetecting, setIsDetecting] = useState(false);
  const [targetReps, setTargetReps] = useState(0);
  const [side, setSide] = useState("left");
  const query = useQuery();
  const [exerciseType, setExerciseType] = useState("SelectExercise"); // Default exercise type
  const [isVideoRecording, setIsVideoRecording] = useState(false);
  const [isSkeletonRecording, setIsSkeletonRecording] = useState(false);
  const [displayMessage, setDisplayMessage] = useState()
  const [activityData, setActivityData] = useState({})

  useEffect(() => {
    manageExerciseData()
  }, []);

  const manageExerciseData = async () => {


    // // For local development - bypass token check
    // if (process.env.REACT_APP_DEVELOPMENT_MODE === 'true') {
    //   const defaultReps = parseInt(process.env.REACT_APP_DEFAULT_REPS) || 5;
    //   const defaultSide = process.env.REACT_APP_DEFAULT_SIDE || 'left';
    //   const defaultExercise = process.env.REACT_APP_DEFAULT_EXERCISE || 'SideArmRaise';
    //   setTargetReps(defaultReps);
    //   setSide(defaultSide);
    //   setExerciseType(defaultExercise); // set exercise type
    //   setIsDetecting(true); // Start detection automatically
    //   setIsVideoRecording(true);   // video recording
    //   setIsSkeletonRecording(true);   // skeleton recording
    //   return;
    // } 



    try {
      const token = query.get("token");
      const decodeResponse = jwtDecode(token)
      if(decodeResponse) {
        const repsFromURL = decodeResponse?.reps
        const sideFromURL = decodeResponse?.side
        const exerciseTypeFromURL = decodeResponse?.exerciseType
        const activity = await axios.get(`${getServiceUrl(decodeResponse).EXERCISE_SERVICE}/assigned-exercises/${decodeResponse?.activity}`, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        const details = activity.data?.data
        if(details?.status == "completed") {
           setDisplayMessage("Activity is either completed or expired. Please start other exercise.")
           return
        }
        
        setActivityData(decodeResponse);
        if (repsFromURL && sideFromURL && exerciseTypeFromURL) {
          setTargetReps(parseInt(repsFromURL));
          setSide(sideFromURL);
          setExerciseType(exerciseTypeFromURL); // set exercise type
          setIsDetecting(true); // Start detection automatically
          setIsVideoRecording(details?.patient?.allowExerciseVideo ?? true);   // video recording
          setIsSkeletonRecording(details?.patient?.allowSkeletonVideo ?? true);   // skeleton recording
        }
      } else {
        setDisplayMessage("Cannot initate exercise. Please contact support")
      }
    } catch(err) {
      setDisplayMessage("Cannot initate exercise. Please contact support")
    }
  }

  const handleStartExercise = () => {
    setIsDetecting(true); // Start detection
    setIsSkeletonRecording(true);   // new line
    setIsVideoRecording(true);   // new line
  };

  return (
    <div className="App">
      <header className="App-header">
      {displayMessage ? displayMessage : 
        !isDetecting && (
          <div style={{ position: "absolute", bottom: 10, left: 10 }}>
            <input
              type="number"
              value={targetReps}
              onChange={(e) => setTargetReps(parseInt(e.target.value))}
              placeholder="Enter number of reps"
            />
            {/* Show side selection for all exercises except "SelectExercise" */}
            {exerciseType !== "SelectExercise" && (
              <select value={side} onChange={(e) => setSide(e.target.value)}>
                <option value="left">Left</option>
                <option value="right">Right</option>
              </select>
            )}
            <select 
              value={exerciseType} 
              onChange={(e) => setExerciseType(e.target.value)}
            >
              <option value="SelectExercise">Select Exercise</option>
              <option value="SideArmRaise">Side Arm Raise</option>
              <option value="SitToStand">Sit to Stand</option>
              <option value="MiniSquats">Mini Squats</option>
              <option value="LongArcQuad">Long Arc Quad</option>
              <option value="SeatedMarch">Seated March</option>
              <option value="StandingMarch">Standing March</option>
              <option value="StandingStraightUp">Standing Straight Up</option>
              {/* Add more exercises as needed */}
            </select>
            <button onClick={handleStartExercise}>
              Start Exercise
            </button>
          </div>
        )}
        {isDetecting && (
          <ExerciseTracker
            exerciseType={exerciseType}
            side={side}
            targetReps={targetReps}
            isDetecting={isDetecting}
            setIsDetecting={setIsDetecting}
            isVideoRecording={isVideoRecording}
            setIsVideoRecording={setIsVideoRecording}  
            isSkeletonRecording={isSkeletonRecording}
            setIsSkeletonRecording={setIsSkeletonRecording}
            setDisplayMessage={setDisplayMessage}
            activityData={activityData}
          />
        )}
     </header>
    </div>
  );
}

export default App;