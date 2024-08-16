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

  useEffect(() => {
    const repsFromURL = query.get("reps");
    const sideFromURL = query.get("side");

    if (repsFromURL && sideFromURL) {
      setTargetReps(parseInt(repsFromURL));
      setSide(sideFromURL);
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
            <select value={side} onChange={(e) => setSide(e.target.value)}>
              <option value="left">Left</option>
              <option value="right">Right</option>
            </select>
            <button onClick={handleStartExercise}>
              Start Exercise
            </button>
          </div>
        )}
        {isDetecting && (
          <ExerciseTracker
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
