// VideoRecorder.js
import React, { useRef, useEffect, useImperativeHandle, forwardRef } from 'react';

const VideoRecorder = forwardRef(
  (
    {
      webcamRef,
      canvasRef,  // The visible canvas ref
      keypointsRef,
      keypointColorsRef,
      segmentColorsRef,
      isVideoRecording,
      onRecordingComplete,
    },
    ref
  ) => {
    const hiddenCanvasRef = useRef(null);
    const mediaRecorderRef = useRef(null);
    const recordedChunksRef = useRef([]);

    // Allows parent to call `videoRecorderRef.current.updateFrame(...)`
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
        ctx.drawImage(webcamRef.current.video, 0, 0, videoWidth, videoHeight);
        // Overlay the already-rendered visible canvas (which has the skeleton) on top
        if (canvasRef?.current) {
          ctx.drawImage(canvasRef.current, 0, 0, videoWidth, videoHeight);
        }
      },
    }));

    // Start/stop recording whenever `isRecording` toggles.
    useEffect(() => {
      if (!hiddenCanvasRef.current) return;

      // START RECORDING
      if (isVideoRecording) {
        if (!mediaRecorderRef.current) {
          const canvasStream = hiddenCanvasRef.current.captureStream(30); // 30 FPS
          // Choose a supported mimeType for broader compatibility
          const candidates = [
            'video/webm;codecs=vp9',
            'video/webm;codecs=vp8',
            'video/webm'
          ];
          const supported = candidates.find(t => {
            try { return typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t); }
            catch { return false; }
          }) || 'video/webm';
          mediaRecorderRef.current = new MediaRecorder(canvasStream, { mimeType: supported });
          
          mediaRecorderRef.current.ondataavailable = event => {
            if (event.data.size > 0) {
              recordedChunksRef.current.push(event.data);
            }
          };
          
          mediaRecorderRef.current.onstop = () => {
            if (recordedChunksRef.current.length > 0) { // Ensure data exists
                const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
                // const url = URL.createObjectURL(blob);
                // console.log('VideoRecorder: onstop fired. URL is', url);
                if (onRecordingComplete) {
                onRecordingComplete(blob);
                }
                // Clear chunks for next recording
                recordedChunksRef.current = [];
            } else {
                console.log('VideoRecorder: onstop fired but no data was recorded.');
              }
          };

          // console.log('VideoRecorder: Start recording...');
          mediaRecorderRef.current.start();
        }
      }
      // STOP RECORDING
      else {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          console.log('VideoRecorder: Stop recording...');
          mediaRecorderRef.current.stop();
        }
        // Reset so it can be re-initialized on next detection
        mediaRecorderRef.current = null;
      }

    }, [isVideoRecording, onRecordingComplete]);

     // A separate effect that runs only once for true unmount
    useEffect(() => {
    return () => {
        console.log('VideoRecorder: truly unmounting from DOM...');
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

export default VideoRecorder;
