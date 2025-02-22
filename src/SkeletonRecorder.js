// SkeletonRecorder.js
import React, { useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import { drawCanvas } from './utilities'; // or wherever your drawCanvas is

const SkeletonRecorder = forwardRef(
  (
    {
      webcamRef,
      canvasRef,  // The visible canvas ref
      keypointsRef,
      keypointColorsRef,
      segmentColorsRef,
      isSkeletonRecording,
      onRecordingComplete,
    },
    ref
  ) => {
    const hiddenCanvasRef = useRef(null);
    const mediaRecorderRef = useRef(null);
    const recordedChunksRef = useRef([]);

    // Allows parent to call `SkeletonRecorderRef.current.updateFrame(...)`
    useImperativeHandle(ref, () => ({
      updateFrame: (poses, videoWidth, videoHeight) => {
        if (!hiddenCanvasRef.current || !webcamRef.current) return;

        const video = webcamRef.current.video;
        if (!video) return;

        const ctx = hiddenCanvasRef.current.getContext('2d');
        // Make sure canvas is sized to match video
        hiddenCanvasRef.current.width = videoWidth;
        hiddenCanvasRef.current.height = videoHeight;

        // Draw the final composited visible canvas:
        ctx.clearRect(0, 0, videoWidth, videoHeight);
        ctx.drawImage(canvasRef.current, 0, 0, videoWidth, videoHeight);

        // Optionally, draw your skeleton here if you'd like. 
        // But typically, you pass `poses`, etc. to a custom draw function
        // drawCanvas(poses, videoWidth, videoHeight, ctx, 
        //            keypointsRef.current, keypointColorsRef.current, segmentColorsRef.current);
      },
    }));

    // Start/stop recording whenever `isRecording` toggles.
    useEffect(() => {
      if (!hiddenCanvasRef.current) return;

      // START RECORDING
      if (isSkeletonRecording) {
        if (!mediaRecorderRef.current) {
          const canvasStream = hiddenCanvasRef.current.captureStream(30); // 30 FPS
          mediaRecorderRef.current = new MediaRecorder(canvasStream, { mimeType: 'video/webm; codecs=vp9' });
          
          mediaRecorderRef.current.ondataavailable = event => {
            if (event.data.size > 0) {
              recordedChunksRef.current.push(event.data);
            }
          };
          
          mediaRecorderRef.current.onstop = () => {
            if (recordedChunksRef.current.length > 0) { // Ensure data exists
              const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
              const url = URL.createObjectURL(blob);
              console.log('SkeletonRecorder: onstop fired. URL is', url);
              if (onRecordingComplete) {
                onRecordingComplete(url);
              }
              // Clear chunks for next recording
              recordedChunksRef.current = [];
            } else {
              console.log('SkeletonRecorder: onstop fired but no data was recorded.');
            }
          };

          console.log('SkeletonRecorder: Start recording...');
          mediaRecorderRef.current.start();
        }
      }
      // STOP RECORDING
      else {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          console.log('SkeletonRecorder: Stop recording...');
          mediaRecorderRef.current.stop();
        }
        // Reset so it can be re-initialized on next detection
        mediaRecorderRef.current = null;
      }

    //   return () => {
    //     // Cleanup if unmounted or isRecording changes
    //     if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
    //       console.log('SkeletonRecorder: Unmounting. Stopping recorder...');
    //       mediaRecorderRef.current.stop();
    //     }
    //     mediaRecorderRef.current = null;
    //   };
    }, [isSkeletonRecording, onRecordingComplete]);

     // A separate effect that runs only once for true unmount
    useEffect(() => {
    return () => {
        console.log('SkeletonRecorder: truly unmounting from DOM...');
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
        }
        mediaRecorderRef.current = null;
    };
    }, []);

    return (
      <canvas
        ref={hiddenCanvasRef}
        style={{ display: 'none' }}
      />
    );
  }
);

export default SkeletonRecorder;
