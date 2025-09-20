import React, { useState, useEffect } from "react";
import "./App.css";
//import ExerciseTracker from "./ExerciseTracker";
import ExerciseTracker from "./ExerciseTracker_refactored";
import { useLocation } from "react-router-dom";
import { jwtDecode } from "jwt-decode";
import axios from "axios";
import { getServiceUrl } from "./config";
import { InstructionUI } from "./steps-descriptions";
export function useQuery() {
  return new URLSearchParams(useLocation().search);
}

function App() {
  const [isDetecting, setIsDetecting] = useState(false);
  const [targetReps, setTargetReps] = useState(0);
  const [side, setSide] = useState("left");
  const query = useQuery();
  const [exerciseType, setExerciseType] = useState(); // Default exercise type
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
    //   console.log('Development mode active. Environment variables:', {
    //     REACT_APP_DEFAULT_REPS: process.env.REACT_APP_DEFAULT_REPS,
    //     REACT_APP_DEFAULT_SIDE: process.env.REACT_APP_DEFAULT_SIDE,
    //     REACT_APP_DEFAULT_EXERCISE: process.env.REACT_APP_DEFAULT_EXERCISE,
    //     REACT_APP_DEFAULT_VIDEO: process.env.REACT_APP_DEFAULT_VIDEO,
    //     REACT_APP_DEFAULT_SKELETON: process.env.REACT_APP_DEFAULT_SKELETON
    //   });

    //   const defaultReps = parseInt(process.env.REACT_APP_DEFAULT_REPS) || 5;
    //   const defaultSide = process.env.REACT_APP_DEFAULT_SIDE || 'left';
    //   const defaultExercise = process.env.REACT_APP_DEFAULT_EXERCISE || 'SideArmRaise';
    //   const defaultVideo = process.env.REACT_APP_DEFAULT_VIDEO === 'true';
    //   const defaultSkeleton = process.env.REACT_APP_DEFAULT_SKELETON === 'true';

    //   console.log(`Setting up with exercise: ${defaultExercise}, reps: ${defaultReps}, side: ${defaultSide}`);

    //   setTargetReps(defaultReps);
    //   setSide(defaultSide);
    //   setExerciseType(defaultExercise);
    //   setIsDetecting(true);
    //   setIsVideoRecording(defaultVideo);
    //   setIsSkeletonRecording(defaultSkeleton);
    //   return;
    // }

    if (process.env.REACT_APP_DEVELOPMENT_MODE === 'true') {
      return;
    }


    try {
      const token = query.get("token");
      const decodeResponse = jwtDecode(token)
      if (decodeResponse) {
        const repsFromURL = decodeResponse?.reps
        const sideFromURL = decodeResponse?.side
        const exerciseTypeFromURL = decodeResponse?.exerciseType
        const activity = await axios.get(`${getServiceUrl(decodeResponse).EXERCISE_SERVICE}/assigned-exercises/${decodeResponse?.activity}`, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        const details = activity.data?.data
        if (details?.status == "completed") {
          setDisplayMessage("Activity is either completed or expired. Please start other exercise.")
          return
        }

        setActivityData(decodeResponse);
        if (repsFromURL && sideFromURL && exerciseTypeFromURL) {
          setTargetReps(parseInt(repsFromURL));
          setSide(sideFromURL);
          setExerciseType(exerciseTypeFromURL); // set exercise type
          setIsDetecting(true);
          setIsVideoRecording(details?.patient?.allowExerciseVideo ?? true);   // video recording
          setIsSkeletonRecording(details?.patient?.allowSkeletonVideo ?? true);   // skeleton recording
        }
      } else {
        setDisplayMessage("Cannot initate exercise. Please contact support")
      }
    } catch (err) {
      setDisplayMessage("Cannot initate exercise. Please contact support")
    }
  }

  const handleStartExercise = () => {
    setIsDetecting(true);
    setIsSkeletonRecording(true);   // new line
    setIsVideoRecording(true);   // new line
  };

  console.log(exerciseType, isDetecting);

  return (
    <div className="App">
      <header className="App-header">

        {displayMessage ? displayMessage : !isDetecting ? <>
          {process.env.REACT_APP_DEVELOPMENT_MODE === 'true' ? <>
            {exerciseType ?
              <div>
                {InstructionUI[exerciseType]}
                <button onClick={() => {
                  setIsDetecting(true);
                }}
                  className="mt-4 px-4 py-2 text-base bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition duration-150 ease-in-out">
                  Start Exercise
                </button>
                <button onClick={() => {
                  setExerciseType(null);
                }}
                  className="mt-4 ml-4 px-4 py-2 text-base bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition duration-150 ease-in-out">
                  Change Exercise
                </button>
              </div> :
              <DropdownSelector
                targetReps={targetReps}
                setTargetReps={setTargetReps}
                exerciseType={exerciseType}
                side={side}
                setSide={setSide}
                setExerciseType={setExerciseType}
                handleStartExercise={handleStartExercise}
              />
            }
          </> : ""}

        </> : (
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

const DropdownSelector = ({ targetReps, setTargetReps, exerciseType, side, setSide, setExerciseType, handleStartExercise }) => {
  return (
    <div style={{ position: "absolute", bottom: 10, left: 10 }}>
      <input
        type="number"
        name="targetReps"
        value={targetReps}
        className="block w-full px-4 py-2 mb-4 text-gray-700 bg-white border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition duration-150 ease-in-out"
        onChange={(e) => setTargetReps(parseInt(e.target.value))}
        placeholder="Enter number of reps"
      />
      {/* Show side selection for all exercises except "SelectExercise" */}
      {exerciseType !== "SelectExercise" && (
        <select value={side} onChange={(e) => setSide(e.target.value)} name="side"
          className="block w-full px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition duration-150 ease-in-out"
        >
          <option value="left">Left</option>
          <option value="right">Right</option>
          <option value="both">Both</option>
        </select>
      )}
      <select
        value={exerciseType}
        name="exerciseType"
        onChange={(e) => setExerciseType(e.target.value)}
        className="block w-full px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition duration-150 ease-in-out"
      >
        <option value="">Select Exercise</option>
        <option value="SideArmRaise">Side Arm Raise</option>
        <option value="SitToStand">Sit to Stand</option>
        <option value="MiniSquats">Mini Squats</option>
        <option value="LongArcQuad">Long Arc Quad</option>
        <option value="SeatedMarch">Seated March</option>
        <option value="StandingMarch">Standing March</option>
        <option value="StandingStraightUp">Standing Straight Up</option>
        <option value="SeatedDorsiflexion">Seated Dorsiflexion</option>
        <option value="StandingDorsiflexion">Standing Dorsiflexion</option>
        <option value="CalfRaisesSeated">Seated Calf Raises</option>
        <option value="CalfRaisesStanding">Standing Calf Raises</option>
        <option value="BicepCurls">Bicep Curls</option>
        <option value="MiniLunges">Mini Lunges</option>
        <option value="LiftsAndChops">Lift and Chops</option>
        <option value="StepUps">Step Ups</option>
        <option value="WallPushUp">Wall Push-Ups</option>
      </select>

      <button onClick={handleStartExercise}>
        Start Exercise
      </button>
    </div>
  )
}

export default App;