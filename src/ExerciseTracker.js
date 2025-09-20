import React, { useRef, useEffect, useState } from "react";
import * as tf from "@tensorflow/tfjs";
import * as posedetection from "@tensorflow-models/pose-detection";
import Webcam from "react-webcam";
import { SAR_repDetection } from "./SideArmRaise";
import { SitStand_repDetection } from './SitToStand';
import { MiniSquats_repDetection } from './MiniSquats';
import { LAQ_repDetection } from './LongArcQuad';
import { StandingStraightUp_detection } from './StandingStraightUp';
import { SeatedMarch_repDetection } from './SeatedMarch';
import { StandingMarch_repDetection } from './StandingMarch';
import SeatedCalfRaises_repDetection from './SeatedCalfRaises';
import StandingCalfRaises_repDetection from './StandingCalfRaises';
import SeatedDorsiflexion_repDetection from './SeatedDorsiflexion';
import StandingDorsiflexion_repDetection from './StandingDorsiflexion';
import BicepCurls_repDetection from './BicepCurls';
import MiniLunges_repDetection from './MiniLunges';
import LiftAndChops_repDetection from './LiftAndChops';
import StepUps_repDetection from './StepUps';
import WallPushUps_repDetection from './WallPushUps';
import { drawCanvas, sendUpdates } from './utilities';
import VideoRecorder from './VideoRecorder';
import SkeletonRecorder from './SkeletonRecorder';
import axios from "axios";
import { getServiceUrl } from "./config";

const ExerciseTracker = ({
  exerciseType, side,
  targetReps, isDetecting,
  setIsDetecting, isVideoRecording,
  setIsVideoRecording, isSkeletonRecording,
  setIsSkeletonRecording, setDisplayMessage,
  activityData
}) => {

  const webcamRef = useRef(null);
  const canvasRef = useRef(null);
  const detectorRef = useRef(null); // Store the detector here
  const [data, setData] = useState({}); // Store dynamic data here
  const feedbackRef = useRef("Initializing...");  // Use ref instead of state for feedback
  // Exercise tracking refs
  const leftLegCountRef = useRef(0);      // Track left leg lifts
  const rightLegCountRef = useRef(0);     // Track right leg lifts
  const leftArmCountRef = useRef(0);      // Track left arm movements
  const rightArmCountRef = useRef(0);     // Track right arm movements
  const armLoweredCountRef = useRef(0);   // For arm lowering movement
  const armUpCountRef = useRef(0);        // For arm raising movement
  const armLoweredFlagRef = useRef(false); // Track if arm is lowered
  const startLegRef = useRef(side || 'left'); // Initialize with the side prop, default to 'left'
  const startArmRef = useRef(side || 'left'); // Initialize with the side prop, default to 'left'
  const lastRepTimeRef = useRef(0);       // Track time of last rep
  const repCountRef = useRef(0);          // Track total reps completed
  const fpsRef = useRef(0);               // Track frames per second
  const lastLegRef = useRef('none');      // Track the last leg that was lifted

  // Refs for general exercise tracking
  const sitLoweredCountRef = useRef(0);   // For sit-down movement
  const sitUpCountRef = useRef(0);        // For stand-up movement
  const sitLoweredFlagRef = useRef(false); // For sit-down movement
  const keypointsRef = useRef([]);
  const keypointColorsRef = useRef("aqua");
  const segmentColorsRef = useRef("aqua");
  const completionStatusRef = useRef(false);  // Use ref instead of state for feedback
  const lastFeedbackSentRef = useRef(null);
  const feedbackLockRef = useRef(false);
  const detectionStartTimeRef = useRef(null);
  const previousRemainingTimeRef = useRef(null);
  const videoRecorderRef = useRef(null); // Ref for the video recorder
  const skeletonRecorderRef = useRef(null); // Ref for the video recorder




  const detect = async () => {
    const detector = detectorRef.current;
    if (!detector || !isDetecting) {
      console.log("Detector not available or detection not started.");
      return;
    }
    // Set the detection start time if it's not already set
    if (!detectionStartTimeRef.current) {
      detectionStartTimeRef.current = performance.now();
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


        // console.log("Running pose detection...");
        const poses = await detector.estimatePoses(video);
        // console.log("Poses estimated", poses);


        // Calculate elapsed time since detection started
        const elapsedTimeSinceDetectionStart = performance.now() - detectionStartTimeRef.current;

        const INITIAL_DELAY = 10000; // 5000 milliseconds = 5 seconds
        let exerciseData = {};
        if (elapsedTimeSinceDetectionStart < INITIAL_DELAY) {
          // During initial delay, display "Get ready..." message
          const remainingTime = Math.ceil((INITIAL_DELAY - elapsedTimeSinceDetectionStart) / 1000);
          // setFeedback(`Get ready... ${remainingTime}`);
          // feedbackRef.current = `Get ready in ... ${remainingTime}`;
          // Determine the feedback message
          let feedbackMessage;
          if (remainingTime === INITIAL_DELAY / 1000) {
            feedbackMessage = `Get ready in ${remainingTime}`;
          } else {
            feedbackMessage = `${remainingTime}`;
          }

          // Update feedback only when the remaining time changes
          if (remainingTime !== previousRemainingTimeRef.current) {
            feedbackRef.current = feedbackMessage;
            previousRemainingTimeRef.current = remainingTime;
          }

        }
        else {
          // Reset previousRemainingTimeRef after countdown
          previousRemainingTimeRef.current = null;

          // Add the condition here
          if (exerciseType === "SideArmRaise") {
            // Pass the required config as an object
            exerciseData = await SAR_repDetection(
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
              feedbackLockRef
            );
          } else if (exerciseType === "SitToStand") {
            exerciseData = SitStand_repDetection(
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
              feedbackLockRef
            );
          } else if (exerciseType === "MiniSquats") {
            exerciseData = MiniSquats_repDetection(
              poses,
              side,
              feedbackRef,           // Reference to hold feedback state
              sitLoweredCountRef,    // Ref to track how many times user has squatted down
              sitUpCountRef,         // Ref to track how many times user has stood up
              sitLoweredFlagRef,     // Ref to track if the user has squatted down
              repCountRef,           // Reference to hold rep count
              targetReps,            // Target number of reps
              handleExerciseComplete,// Function to call when target reps are complete
              keypointColorsRef,
              segmentColorsRef,
              keypointsRef,
              feedbackLockRef
            );
          } else if (exerciseType === "LongArcQuad") {
            exerciseData = LAQ_repDetection(
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
              feedbackLockRef
            );
          } else if (exerciseType === "SeatedCalfRaises") {
            exerciseData = SeatedCalfRaises_repDetection(
              poses,
              side,
              feedbackRef,
              leftLegCountRef,
              rightLegCountRef,
              startLegRef,
              repCountRef,
              targetReps,
              handleExerciseComplete,
              keypointColorsRef,
              segmentColorsRef,
              keypointsRef,
              feedbackLockRef,
              lastRepTimeRef
            );
          } else if (exerciseType === "StandingCalfRaises") {
            exerciseData = StandingCalfRaises_repDetection(
              poses,
              side,
              feedbackRef,
              leftLegCountRef,
              rightLegCountRef,
              startLegRef,
              repCountRef,
              targetReps,
              handleExerciseComplete,
              keypointColorsRef,
              segmentColorsRef,
              keypointsRef,
              feedbackLockRef,
              lastRepTimeRef
            );
          } else if (exerciseType === "SeatedDorsiflexion") {
            exerciseData = SeatedDorsiflexion_repDetection(
              poses,
              side,
              feedbackRef,
              leftLegCountRef,
              rightLegCountRef,
              startLegRef,
              repCountRef,
              targetReps,
              handleExerciseComplete,
              keypointColorsRef,
              segmentColorsRef,
              keypointsRef,
              feedbackLockRef,
              lastRepTimeRef
            );
          } else if (exerciseType === "StandingDorsiflexion") {
            exerciseData = StandingDorsiflexion_repDetection(
              poses,
              side,
              feedbackRef,
              leftLegCountRef,
              rightLegCountRef,
              startLegRef,
              repCountRef,
              targetReps,
              handleExerciseComplete,
              keypointColorsRef,
              segmentColorsRef,
              keypointsRef,
              feedbackLockRef,
              lastRepTimeRef
            );
          } else if (exerciseType === "MiniLunges") {
            exerciseData = MiniLunges_repDetection(
              poses,
              side,
              feedbackRef,
              leftLegCountRef,
              rightLegCountRef,
              startLegRef,
              repCountRef,
              targetReps,
              handleExerciseComplete,
              keypointColorsRef,
              segmentColorsRef,
              keypointsRef,
              feedbackLockRef,
              lastRepTimeRef
            );
          } else if (exerciseType === "SeatedDorsiflexion") {
            exerciseData = SeatedDorsiflexion_repDetection(
              poses,
              side,
              feedbackRef,
              leftLegCountRef,
              rightLegCountRef,
              startLegRef,
              repCountRef,
              targetReps,
              handleExerciseComplete,
              keypointColorsRef,
              segmentColorsRef,
              keypointsRef,
              feedbackLockRef,
              lastRepTimeRef
            );
          } else if (exerciseType === "BicepCurls") {
            exerciseData = BicepCurls_repDetection(
              poses,
              side,
              feedbackRef,
              leftArmCountRef,
              rightArmCountRef,
              startArmRef,
              repCountRef,
              targetReps,
              handleExerciseComplete,
              keypointColorsRef,
              segmentColorsRef,
              keypointsRef,
              feedbackLockRef,
              lastRepTimeRef
            );
          } else if (exerciseType === "LiftAndChops") {
            exerciseData = LiftAndChops_repDetection(
              poses,
              side,
              'lift', // Start with lift
              feedbackRef,
              leftArmCountRef,
              rightArmCountRef,
              startArmRef,
              repCountRef,
              targetReps,
              handleExerciseComplete,
              keypointColorsRef,
              segmentColorsRef,
              keypointsRef,
              feedbackLockRef,
              lastRepTimeRef
            );
          } else if (exerciseType === "StandingStraightUp") {
            // Timer-based logic for StandingStraightUp
            exerciseData = StandingStraightUp_detection(
              poses,
              feedbackRef,
              keypointColorsRef,
              segmentColorsRef,
              keypointsRef,
              feedbackLockRef
            );
          } else if (exerciseType === "SeatedMarch") {
            exerciseData = await SeatedMarch_repDetection(
              poses,
              side,
              feedbackRef,
              leftLegCountRef,      // Pass left leg counter
              rightLegCountRef,     // Pass right leg counter
              startLegRef,          // Pass startLegRef to control which leg starts first
              repCountRef,
              targetReps,
              handleExerciseComplete,
              keypointColorsRef,
              segmentColorsRef,
              keypointsRef,
              feedbackLockRef
            );
          } else if (exerciseType === "StandingMarch") {
            exerciseData = await StandingMarch_repDetection(
              poses,
              side,
              feedbackRef,
              leftLegCountRef,      // Pass left leg counter
              rightLegCountRef,     // Pass right leg counter
              startLegRef,           // Pass last leg reference
              repCountRef,
              targetReps,
              handleExerciseComplete,
              keypointColorsRef,
              segmentColorsRef,
              keypointsRef,
              feedbackLockRef
            );
          }

          if (exerciseData) {
            setData(exerciseData);
            // console.log("Updated exercise data:", exerciseData);
          }
        }
        // console.log("Updated keypoints data:", keypointsRef.current);
        // console.log("Updated keypointColors data:", keypointColorsRef.current);
        // console.log("Updated segmentColors data:", segmentColorsRef.current);

        drawCanvas(poses, videoWidth, videoHeight, ctx, keypointsRef.current, keypointColorsRef.current, segmentColorsRef.current);

        // Update the hidden canvas for video recording
        if (videoRecorderRef.current && videoRecorderRef.current.updateFrame) {
          videoRecorderRef.current.updateFrame(poses, videoWidth, videoHeight);
        }

        // Update the hidden canvas for skeleton recording
        if (skeletonRecorderRef.current && skeletonRecorderRef.current.updateFrame) {
          skeletonRecorderRef.current.updateFrame(poses, videoWidth, videoHeight);
        }


        frameCount++;
        const currentTime = performance.now();
        if (currentTime - lastFpsUpdate > 100) {
          const calculatedFps = Math.round((frameCount / (currentTime - lastFpsUpdate)) * 1000);
          fpsRef.current = calculatedFps; // Store in ref for immediate access

          // Send the update every second
          const finalData1 = {
            fps: calculatedFps, // Directly use calculated FPS
            feedback: feedbackRef.current,
            completionStatusRef: completionStatusRef.current,
            ...exerciseData,
            repCount: repCountRef.current
          };


          // Only send feedback if initial delay has passed
          if (feedbackRef.current !== lastFeedbackSentRef.current) {
            lastFeedbackSentRef.current = feedbackRef.current;
            await sendUpdates(finalData1, exerciseType, activityData, setDisplayMessage);
          }


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
        // console.log("Initializing MoveNet");
        await tf.setBackend('webgl');
        await tf.ready();
        // console.log("TensorFlow.js is ready");

        const modelPath = window.location.hostname === 'localhost'
          ? `/models/movenet/model.json`
          : `${process.env.PUBLIC_URL}/models/movenet/model.json`;

        detectorRef.current = await posedetection.createDetector(posedetection.SupportedModels.MoveNet, {
          modelType: posedetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
          modelUrl: modelPath,
        });

        // console.log("MoveNet model loaded successfully");

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
      // console.log("WebGL context lost. Stopping detection...");
      setIsDetecting(false); // Stop detection
    };

    const handleContextRestored = () => {
      // console.log("WebGL context restored. Reinitializing model...");
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


  const handleExerciseComplete = async () => {
    // Send the final update to the WebView
    // sendUpdates();
    const finalData = {
      fps: fpsRef.current,
      ...data, // Send the latest data available
      feedback: "Target reps achieved!",
      completionStatusRef: true,
      repCount: repCountRef.current
    };

    await sendUpdates(finalData, exerciseType, activityData, setDisplayMessage);
    setIsDetecting(false);
    setIsVideoRecording(false);  // This triggers the video recorder to stop
    setIsSkeletonRecording(false);  // This triggers the video recorder to stop

    // Reset detection start time and countdown refs
    detectionStartTimeRef.current = null;
    previousRemainingTimeRef.current = null;
    // Delay for 5 seconds before stopping detection and clearing the feedback
    // setTimeout(() => {
    //     setIsDetecting(false); // Stop detection after 5 seconds
    //     setFeedback(""); // Clear feedback message
    //     //setData({}); // Clear data
    //     setRepCount(0); // Reset rep count
    // }, 5000);
  };

  const handleVideoRecordingComplete = async (videoUrl) => {
    console.log("Video recording complete. URL:", videoUrl);
    // const a = document.createElement('a');
    // a.href = videoUrl;
    // a.download = 'exercise_video_recording.webm';
    // a.click();
    setDisplayMessage("Syncing video. Please wait...")
    await uploadVideo(videoUrl, "videoRecording")
    setDisplayMessage("Exericise video synced successfully!!")
  };

  const handleSkeletonRecordingComplete = async (videoUrl) => {
    console.log("Skeleton recording complete. URL:", videoUrl);
    // const a = document.createElement('a');
    // a.href = videoUrl;
    // a.download = 'exercise_skeleton_recording.webm';
    // a.click();
    setDisplayMessage("Syncing skeleton video. Please wait...")
    await uploadVideo(videoUrl, "skeleton")
    setDisplayMessage("Skeleton video synced successfully!!")
  };

  async function uploadVideo(file, type) {
    // Skip upload in development mode 
    // uncomment this only while local dev
    // if (process.env.NODE_ENV === 'development' || process.env.REACT_APP_DEVELOPMENT_MODE === 'true') {
    //   console.log('[DEV] Skipping video upload in development mode');
    //   return { success: true, message: 'Skipped in development mode' };
    // }

    const query = new URLSearchParams(window.location.search);

    if (!activityData?.tenant) {
      console.error('Cannot upload video: Missing tenant data in activityData');
      throw new Error('Missing tenant information');
    }

    try {
      const serviceUrl = getServiceUrl(activityData);
      if (!serviceUrl?.USER_SERVICE) {
        throw new Error('Invalid service URL configuration');
      }

      const response = await axios.post(
        `${serviceUrl.USER_SERVICE}/files/stream`,
        file,
        {
          headers: {
            'Content-Type': 'application/octet-stream',
            Authorization: `Bearer ${query.get("token")}`,
            tenantId: activityData.tenant
          },
          params: {
            fileName: `${activityData.activity || 'exercise'}_${type}_${Date.now()}_exercise.webm`,
            isExerciseSync: true
          },
          timeout: 30000 // 30 second timeout
        }
      );

      console.log('Upload successful: ', response.data);
      return response.data;
    } catch (error) {
      console.error('Error uploading video: ', error);
      if (error.response) {
        // The request was made and the server responded with a status code
        console.error('Response data:', error.response.data);
        console.error('Response status:', error.response.status);
        console.error('Response headers:', error.response.headers);
      } else if (error.request) {
        // The request was made but no response was received
        console.error('No response received:', error.request);
      } else {
        // Something happened in setting up the request
        console.error('Error:', error.message);
      }
      throw error;
    }
  }



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
          transform: "scaleX(-1)", // This flips the video horizontally
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
          transform: "scaleX(-1)", // This flips the video horizontally
        }}
      />
      {/* Invisible VideoRecorder Component */}
      <VideoRecorder
        ref={videoRecorderRef}
        webcamRef={webcamRef}
        canvasRef={canvasRef}         // <-- add this
        keypointsRef={keypointsRef}
        keypointColorsRef={keypointColorsRef}
        segmentColorsRef={segmentColorsRef}
        isVideoRecording={isVideoRecording}
        onRecordingComplete={handleVideoRecordingComplete}
      />
      {/* Invisible SkeletonRecorder Component */}
      <SkeletonRecorder
        ref={skeletonRecorderRef}
        webcamRef={webcamRef}
        canvasRef={canvasRef}         // <-- add this
        keypointsRef={keypointsRef}
        keypointColorsRef={keypointColorsRef}
        segmentColorsRef={segmentColorsRef}
        isSkeletonRecording={isSkeletonRecording}
        onRecordingComplete={handleSkeletonRecordingComplete}
      />
      {/* Container for all informational elements */}
      {/* <div style={{ 
        position: 'absolute', 
        top: 10, 
        left: 10, 
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'flex-start',  // Align all elements to the start of the flex container
        gap: '5px',  // Reduced gap to keep elements close together
        zIndex: 10 
      }}> */}
      {/* FPS Display */}
      {/* <div
          style={{
            color: 'white',
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            padding: '5px',
            borderRadius: '5px',
            textAlign: 'left',  // Align text to the left within the box
          }}
        >
          FPS: {fps}
        </div> */}

      {/* Reps Display */}
      {/* <div
          style={{
            color: 'white',
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            padding: '5px',
            borderRadius: '5px',
            textAlign: 'left',  // Align text to the left within the box
          }}
        >
          Reps: {repCount}
        </div> */}

      {/* Feedback Display */}
      {/* <div
          style={{
            color: 'white',
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            padding: '10px',
            borderRadius: '5px',
            textAlign: 'left',  // Align text to the left within the box
          }}
        >
          {feedback}
        </div> */}

      {/* Conditional Rendering Based on Exercise Type */}
      {/* {exerciseType === "SideArmRaise" && ( */}
      <>
        {/* Arm Angle Display */}
        {/* <div
      style={{
        color: "white",
        backgroundColor: "rgba(0, 0, 0, 0.6)",
        padding: "5px",
        borderRadius: "5px",
        textAlign: "left", // Align text to the left within the box
      }}
    >
      Arm Angle: {armAngle?.toFixed(2)}
    </div> */}

        {/* Shoulder Angle Display */}
        {/* <div
      style={{
        color: "white",
        backgroundColor: "rgba(0, 0, 0, 0.6)",
        padding: "5px",
        borderRadius: "5px",
        textAlign: "left", // Align text to the left within the box
      }}
    >
      Shoulder Angle: {shoulderAngle?.toFixed(2)}
    </div> */}
      </>
      {/* )} */}

      {/* {exerciseType === "SitToStand" && ( */}
      <>
        {/* <div
      style={{
        color: 'white',
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        padding: '5px',
        borderRadius: '5px',
        textAlign: 'left', 
      }}
    >
      Spine Angle: {spineAngle?.toFixed(2)}
    </div>
    <div
      style={{
        color: 'white',
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        padding: '5px',
        borderRadius: '5px',
        textAlign: 'left', 
      }}
    >
      Knee Angle: {kneeAngle?.toFixed(2)}
    </div>
    <div
      style={{
        color: 'white',
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        padding: '5px',
        borderRadius: '5px',
        textAlign: 'left', 
      }}
    >
      Hip Distance: {hipDistance?.toFixed(2)}
    </div> */}
      </>
      {/* )} */}

      {/* Conditional Rendering Based on Exercise Type */}
      {/* {exerciseType === "MiniSquats" && ( */}
      <>
        {/* <div
      style={{
        color: "white",
        backgroundColor: "rgba(0, 0, 0, 0.6)",
        padding: "5px",
        borderRadius: "5px",
        textAlign: "left", // Align text to the left within the box
      }}
    >
      Knee Angle: {kneeAngle?.toFixed(2)}
    </div>

    <div
      style={{
        color: "white",
        backgroundColor: "rgba(0, 0, 0, 0.6)",
        padding: "5px",
        borderRadius: "5px",
        textAlign: "left", // Align text to the left within the box
      }}
    >
      Spine Angle: {spineAngle?.toFixed(2)}
    </div> */}
      </>
      {/* )} */}
      {/* Conditional Rendering Based on Exercise Type */}
      {/* {exerciseType === "LongArcQuad" && ( */}
      <>
        {/* <div
      style={{
        color: "white",
        backgroundColor: "rgba(0, 0, 0, 0.6)",
        padding: "5px",
        borderRadius: "5px",
        textAlign: "left", // Align text to the left within the box
      }}
    >
      Knee Angle: {kneeAngle?.toFixed(2)}
    </div>

    <div
      style={{
        color: "white",
        backgroundColor: "rgba(0, 0, 0, 0.6)",
        padding: "5px",
        borderRadius: "5px",
        textAlign: "left", // Align text to the left within the box
      }}
    >
      Spine Angle: {spineAngle?.toFixed(2)}
    </div> */}
      </>
      {/* )} */}
      {/* {exerciseType === "StandingStraightUp" && ( */}
      <>
        {/* Head Angle Display */}
        {/* <div
      style={{
        color: 'white',
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        padding: '5px',
        borderRadius: '5px',
        textAlign: 'left', // Align text to the left within the box
      }}
    >
      Head Angle: {headTilt?.toFixed(2)}°
    </div> */}

        {/* Shoulder Alignment Display */}
        {/* <div
      style={{
        color: 'white',
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        padding: '5px',
        borderRadius: '5px',
        textAlign: 'left',
      }}
    >
      Shoulder Alignment: {shoulderAlignment?.toFixed(2)}°
    </div> */}

        {/* Hip Alignment Display */}
        {/* <div
      style={{
        color: 'white',
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        padding: '5px',
        borderRadius: '5px',
        textAlign: 'left',
      }}
    >
      Hip Alignment: {hipAlignment?.toFixed(2)}°
    </div> */}

        {/* Knee Alignment Display */}
        {/* <div
      style={{
        color: 'white',
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        padding: '5px',
        borderRadius: '5px',
        textAlign: 'left',
      }}
    >
      Knee Alignment: {kneeAlignment?.toFixed(2)}°
    </div> */}
        {/* <div
            style={{
              color: 'white',
              backgroundColor: 'rgba(0, 0, 0, 0.6)',
              padding: '5px',
              borderRadius: '5px',
              textAlign: 'left',
            }}
          >
            Time Elapsed: {timeElapsed.toFixed(2)} seconds
          </div> */}
      </>
      {/* )} */}

      {/* </div> */}
    </div>
  );

};

export default ExerciseTracker;
