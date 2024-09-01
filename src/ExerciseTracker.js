import React, { useRef, useEffect, useState } from "react";
import * as tf from "@tensorflow/tfjs";
import * as posedetection from "@tensorflow-models/pose-detection";
import Webcam from "react-webcam";
import { SAR_repDetection } from "./SideArmRaise"; // Import the function here
import { drawCanvas,sendUpdates } from './utilities';

const ExerciseTracker = ({ exerciseType, side, targetReps, isDetecting, setIsDetecting }) => {

  const webcamRef = useRef(null);
  const canvasRef = useRef(null);
  const detectorRef = useRef(null); // Store the detector here
  const [fps, setFps] = useState(0);
  const [data, setData] = useState({}); // Store dynamic data here
  const [repCount, setRepCount] = useState(0);
  const [armAngle, setArmAngle] = useState(0);
  const [shoulderAngle, setShoulderAngle] = useState(0);
  const [feedback, setFeedback] = useState("Initializing...");
  const feedbackRef = useRef("Initializing...");  // Use ref instead of state for feedback

  const armLoweredCountRef = useRef(0);
  const armUpCountRef = useRef(0);
  const armLoweredFlagRef = useRef(false);
  const repCountRef = useRef(repCount);
  const fpsRef = useRef(0);


  const detect = async () => {
    const detector = detectorRef.current;
    if (!detector || !isDetecting) {
      console.log("Detector not available or detection not started.");
      return;
    }

    let frameCount = 0;
    let lastFpsUpdate = performance.now();

    const detectionLoop = async () => {
      if (
        typeof webcamRef.current !== "undefined" &&
        webcamRef.current !== null &&
        webcamRef.current.video.readyState === 4
      ) {
        const video = webcamRef.current.video;
        const videoWidth = video.videoWidth;
        const videoHeight = video.videoHeight;

        canvasRef.current.width = videoWidth;
        canvasRef.current.height = videoHeight;

        const ctx = canvasRef.current.getContext("2d");
        ctx.clearRect(0, 0, videoWidth, videoHeight);

        console.log("Running pose detection...");
        const poses = await detector.estimatePoses(video);
        console.log("Poses estimated", poses);
        
        let exerciseData = {};
         // Add the condition here
         if (exerciseType === "SideArmRaise") {
    // Pass the required config as an object
           exerciseData =  SAR_repDetection(poses,
                side,
                setArmAngle,
                setShoulderAngle,
              //  feedback,
                setFeedback,
                feedbackRef,
                armLoweredCountRef,
                armUpCountRef,
                armLoweredFlagRef,
                repCountRef,
                setRepCount,  // Make sure to include this line
                targetReps,
                handleExerciseComplete
              );
            }
            if (exerciseData) {
              setData(exerciseData);
              console.log("Updated exercise data:", exerciseData);
          }
  
       drawCanvas(poses, videoWidth, videoHeight, ctx);

        frameCount++;
        const currentTime = performance.now();
        if (currentTime - lastFpsUpdate > 100) {
          const calculatedFps = Math.round((frameCount / (currentTime - lastFpsUpdate)) * 1000);
          setFps(calculatedFps); // This updates the FPS state for display
          fpsRef.current = calculatedFps; // Store in ref for immediate access

          // Send the update every second
          const finalData1 = {
            fps: calculatedFps, // Directly use calculated FPS
            feedback:feedbackRef.current,
            ...exerciseData,
          };
          sendUpdates(finalData1, exerciseType);
    
          frameCount = 0;
          lastFpsUpdate = currentTime;
        }
      }

      if (isDetecting) {
        requestAnimationFrame(detectionLoop);
      }
    };

    detectionLoop();
  };

  // Initialize the model once when the component mounts
  useEffect(() => {
    const initializeModel = async () => {
      try {
        console.log("Initializing MoveNet");
        await tf.setBackend('webgl');
        await tf.ready();
        console.log("TensorFlow.js is ready");

        const modelPath = window.location.hostname === 'localhost'
          ? `/models/movenet/model.json`
          : `${process.env.PUBLIC_URL}/models/movenet/model.json`;

        detectorRef.current = await posedetection.createDetector(posedetection.SupportedModels.MoveNet, {
          modelType: posedetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
          modelUrl: modelPath,
        });

        console.log("MoveNet model loaded successfully");

        if (isDetecting) {
          detect(); // Start detection after model is loaded
        }
      } catch (error) {
        console.error("Error initializing MoveNet:", error);
      }
    };

    // Handle WebGL context loss and restoration
    const handleContextLost = (event) => {
      event.preventDefault();
      console.log("WebGL context lost. Stopping detection...");
      setIsDetecting(false); // Stop detection
    };

    const handleContextRestored = () => {
      console.log("WebGL context restored. Reinitializing model...");
      initializeModel(); // Reinitialize the model
    };

    const canvas = canvasRef.current;
    if (canvas) {
      canvas.addEventListener("webglcontextlost", handleContextLost);
      canvas.addEventListener("webglcontextrestored", handleContextRestored);
    }

    // Run the initialization only if detectorRef.current is not already set
    if (!detectorRef.current) {
      initializeModel();
    }

    return () => {
      // Cleanup function to dispose of the model and event listeners when the component unmounts
      if (detectorRef.current) {
        detectorRef.current.dispose();
      }
      tf.disposeVariables();

      if (canvas) {
        canvas.removeEventListener("webglcontextlost", handleContextLost);
        canvas.removeEventListener("webglcontextrestored", handleContextRestored);
      }
    };
  }, [isDetecting]); // Ensure `detect` is called when `isDetecting` changes


  const handleExerciseComplete = () => {
    setFeedback("Target reps achieved!");

    // Send the final update to the WebView
    // sendUpdates();
    const finalData = {
       fps: fpsRef.current,
      ...data, // Send the latest data available
      feedback: "Target reps achieved!",
    };

    sendUpdates(finalData, exerciseType);

    // Delay for 5 seconds before stopping detection and clearing the feedback
    setTimeout(() => {
        setIsDetecting(false); // Stop detection after 5 seconds
        setFeedback(""); // Clear feedback message
        //setData({}); // Clear data
        setRepCount(0); // Reset rep count
    }, 5000);
};



  return (
    <div>
       <Webcam
        ref={webcamRef}
        playsInline
        controls={false}
        style={{
          position: "absolute",
          top: 0, // Move to the top
          left: 0,
          //right: 0,
          // marginLeft: "auto",
          //marginRight: "auto",
          //textAlign: "center",
          zIndex: 9,
          width: "100%",
          height: "100vh",
          //objectFit: "contain", // Maintains the aspect ratio of the video
          objectFit: "fill", // Ensure the video covers the canvas properly
        }}
        videoConstraints={{
          facingMode: "user",
        }}
      />
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          top: 0, // Move to the top
          left: 0,
          // right: 0,
          // marginLeft: "auto",
          // marginRight: "auto",
          // textAlign: "center",
          zIndex: 10,
          width: "100%",
          height: "100vh",
          objectFit: "fill",
        }}
      />


        {/* Container for all informational elements */}
        <div style={{ 
        position: 'absolute', 
        top: 10, 
        left: 10, 
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'flex-start',  // Align all elements to the start of the flex container
        gap: '5px',  // Reduced gap to keep elements close together
        zIndex: 10 
      }}>
        {/* FPS Display */}
        <div
          style={{
            color: 'white',
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            padding: '5px',
            borderRadius: '5px',
            textAlign: 'left',  // Align text to the left within the box
          }}
        >
          FPS: {fps}
        </div>
  
        {/* Reps Display */}
        <div
          style={{
            color: 'white',
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            padding: '5px',
            borderRadius: '5px',
            textAlign: 'left',  // Align text to the left within the box
          }}
        >
          Reps: {repCount}
        </div>
  
        {/* Feedback Display */}
        <div
          style={{
            color: 'white',
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            padding: '10px',
            borderRadius: '5px',
            textAlign: 'left',  // Align text to the left within the box
          }}
        >
          {feedback}
        </div>
  
        {/* Arm Angle Display */}
        <div
          style={{
            color: 'white',
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            padding: '5px',
            borderRadius: '5px',
            textAlign: 'left',  // Align text to the left within the box
          }}
        >
          Arm Angle: {armAngle.toFixed(2)}
        </div>
  
        {/* Shoulder Angle Display */}
        <div
          style={{
            color: 'white',
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            padding: '5px',
            borderRadius: '5px',
            textAlign: 'left',  // Align text to the left within the box
          }}
        >
          Shoulder Angle: {shoulderAngle.toFixed(2)}
        </div>
      </div>
    </div>
  );
  
};

export default ExerciseTracker;
