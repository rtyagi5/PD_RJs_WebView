import React, { useState, useEffect } from "react";
import "./App.css";
import ExerciseTracker from "./ExerciseTracker";
import { useLocation } from "react-router-dom";

function useQuery() {
  return new URLSearchParams(useLocation().search);
}

function App() {
  const [isDetecting, setIsDetecting] = useState(false);
  const [targetReps, setTargetReps] = useState(0);
  const [side, setSide] = useState("left");
  const query = useQuery();
  const [exerciseType, setExerciseType] = useState("SelectExercise"); // Default exercise type

  useEffect(() => {
    const repsFromURL = query.get("reps");
    const sideFromURL = query.get("side");
    const exerciseTypeFromURL = query.get("exerciseType"); // Get exercise type from URL

    if (repsFromURL && sideFromURL && exerciseTypeFromURL) {
      setTargetReps(parseInt(repsFromURL));
      setSide(sideFromURL);
      setExerciseType(exerciseTypeFromURL); // set exercise type
      setIsDetecting(true); // Start detection automatically
    }
  }, [query]);

  const handleStartExercise = () => {
    setIsDetecting(true); // Start detection
  };

  return (
    <div className="App">
      <header className="App-header">
        {!isDetecting && (
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
              <option value="StandingStraightUp">Standing Straight Up</option>  {/* New Option */}
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
          />
        )}
      </header>
    </div>
  );
}

export default App;
