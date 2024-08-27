import React, { useRef, useEffect, useState } from "react";
import * as tf from "@tensorflow/tfjs";
import * as posedetection from "@tensorflow-models/pose-detection";
import Webcam from "react-webcam";
import { drawKeypoints, drawSkeleton } from "./utilities";

const ExerciseTracker = ({ side, targetReps, isDetecting, setIsDetecting }) => {

  const webcamRef = useRef(null);
  const canvasRef = useRef(null);
  const detectorRef = useRef(null); // Store the detector here
  const [fps, setFps] = useState(0);
  const [repCount, setRepCount] = useState(0);
  const [armAngle, setArmAngle] = useState(0);
  const [shoulderAngle, setShoulderAngle] = useState(0);
  const [feedback, setFeedback] = useState("");

  const armLoweredCountRef = useRef(0);
  const armUpCountRef = useRef(0);
  const armLoweredFlagRef = useRef(false);
  const repCountRef = useRef(repCount);

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
        detectReps(poses);
        drawCanvas(poses, videoWidth, videoHeight, ctx);

        frameCount++;
        const currentTime = performance.now();
        if (currentTime - lastFpsUpdate > 1000) {
          setFps(Math.round((frameCount / (currentTime - lastFpsUpdate)) * 1000));
          frameCount = 0;
          lastFpsUpdate = currentTime;
          sendUpdates();
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


  const sendUpdates = () => {
    const data = {
      fps,
      repCount,
      armAngle,
      shoulderAngle,
    };
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(data));
    }
  };
  
  const drawCanvas = (poses, videoWidth, videoHeight, ctx) => {
    // const ctx = canvas.current.getContext("2d");
    // canvas.current.width = videoWidth;
    // canvas.current.height = videoHeight;
    ctx.clearRect(0, 0, videoWidth, videoHeight);

    if (poses.length > 0 && poses[0].keypoints) {
      drawKeypoints(poses[0].keypoints, 0.3, ctx);
      drawSkeleton(poses[0].keypoints, 0.3, ctx);
    }
  };

  const detectReps = (poses) => {
    if (poses.length > 0 && poses[0].keypoints) {
      const keypoints = poses[0].keypoints;
      const shoulder = keypoints.find(k => k.name === `${side}_shoulder`);
      const elbow = keypoints.find(k => k.name === `${side}_elbow`);
      const wrist = keypoints.find(k => k.name === `${side}_wrist`);
      const hip = keypoints.find(k => k.name === `${side}_hip`);

      if (shoulder && elbow && wrist && hip) {
        const allKeyPointsDetected = [shoulder, elbow, wrist, hip].every(k => k.score > 0.3);

        if (allKeyPointsDetected) {
          const armAngle = calculateInteriorAngle(shoulder, elbow, wrist);
          const shoulderAngle = calculateInteriorAngle(hip, shoulder, elbow);

          if (!isNaN(armAngle) && !isNaN(shoulderAngle)) {
            setArmAngle(armAngle);
            setShoulderAngle(shoulderAngle);

            let newArmLoweredCount = armLoweredCountRef.current;
            let newArmUpCount = armUpCountRef.current;
            let newArmLoweredFlag = armLoweredFlagRef.current;

            // Arm Lowered Logic
            if (shoulderAngle > 0 && shoulderAngle < 30) {
              if (!newArmLoweredFlag) {
                newArmLoweredFlag = true;
                if (newArmLoweredCount === 0) {
                  newArmLoweredCount = 1;
                  setFeedback("Arm lowered 1");
                  console.log("Arm lowered 1 detected");
                } else if (newArmLoweredCount === 1 && newArmUpCount === 1) {
                  newArmLoweredCount = 2;
                  setFeedback("Arm lowered 2");
                  console.log("Arm lowered 2 detected");
                }
              }
            }

            // Intermediate Range Logic (30 to 70 degrees)
            if (shoulderAngle >= 30 && shoulderAngle <= 70) {
              setFeedback("Intermediate range");
              console.log("Intermediate Range Logic (30 to 70 degrees) newArmLoweredCount", newArmLoweredCount);
              console.log("Intermediate Range Logic (30 to 70 degrees) newArmLoweredFlag", newArmLoweredFlag);
              console.log("Intermediate Range Logic (30 to 70 degrees) newArmUpCount", newArmUpCount);
            }

            // Arm Up Logic
            if (shoulderAngle > 70 && shoulderAngle <= 90) {
              if (newArmLoweredCount === 1) {
                if (newArmUpCount === 0) {
                  newArmUpCount = 1;
                  setFeedback("Arm up detected");
                  console.log("Arm up detected");
                }
              }
              newArmLoweredFlag = false;
            }

            // Rep Count Logic
            if (newArmUpCount === 1 && newArmLoweredCount === 2 && shoulderAngle > 0 && shoulderAngle < 30) {
              if (repCountRef.current < targetReps) {
                repCountRef.current++;
                setRepCount(repCountRef.current);
                setFeedback("Repetition completed");
                console.log("Repetition completed");
              }
              newArmLoweredCount = 0;
              newArmUpCount = 0;
              newArmLoweredFlag = false;

              // Check if target reps achieved
          //     if (repCountRef.current >= targetReps) {
          //       setFeedback("Target reps achieved!");
          //       setIsDetecting(false); // Stop detection
          //       return; // Exit the function
          //     }
          //   }
          if (repCountRef.current >= targetReps) {
              handleExerciseComplete();
              return; // Exit the function
            }
          }
            // Update state at the end
            armLoweredCountRef.current = newArmLoweredCount;
            armUpCountRef.current = newArmUpCount;
            armLoweredFlagRef.current = newArmLoweredFlag;

            // Debugging logs
           // console.log("armUp flag value", armUp);
            console.log("armDown flag value", armLoweredFlagRef.current);
            console.log("outside any if condition armUpCount value", armUpCountRef.current);
            console.log("outside any if condition armLoweredCount value", armLoweredCountRef.current);
            console.log("current repCount value", repCountRef.current);
          } else {
            setFeedback("Invalid angles detected");
          }
        } else {
          setFeedback("Make sure all key points are visible");
        }
      } else {
        setFeedback(`Move your ${side} arm into the frame`);
      }
    } else {
      setFeedback("No person detected");
    }
  };

  const handleExerciseComplete = () => {
    setFeedback("Target reps achieved!");


    // Send the final update to the WebView
     sendUpdates();

    // Delay for 5 seconds before stopping detection and clearing the feedback
    setTimeout(() => {
        setIsDetecting(false); // Stop detection after 5 seconds
        setFeedback(""); // Clear feedback message
        setRepCount(0); // Reset rep count
    }, 5000);
};

const calculateInteriorAngle = (p1, p2, p3) => {
  const v1 = { x: p1.x - p2.x, y: p1.y - p2.y };
  const v2 = { x: p3.x - p2.x, y: p3.y - p2.y };

  const dotProduct = v1.x * v2.x + v1.y * v2.y;
  const magnitude1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
  const magnitude2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);

  if (magnitude1 === 0 || magnitude2 === 0) {
    return NaN;
  }

  const angle = Math.acos(dotProduct / (magnitude1 * magnitude2)) * (180 / Math.PI);
  return angle;
};

  return (
    <div>
      <Webcam
        ref={webcamRef}
        playsInline
        controls={false}
        style={{
            position: "absolute",
            top: 0,  // Move to the top
            left: 0,
            //right: 0,
           // marginLeft: "auto",
            //marginRight: "auto",
            //textAlign: "center",
            zIndex: 9,
            width: "100%",
            height: "auto",
            //objectFit: "contain", // Maintains the aspect ratio of the video
            objectFit: "cover",  // Ensure the video covers the canvas properly
          }}
          videoConstraints={{
            facingMode: "user",
          }}
      />
      <canvas
        ref={canvasRef}
        style={{
            position: "absolute",
            top: 0,  // Move to the top
            left: 0,
           // right: 0,
           // marginLeft: "auto",
           // marginRight: "auto",
           // textAlign: "center",
            zIndex: 10,
            width: "100%",
            height: "auto",
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
