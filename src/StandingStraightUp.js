export const StandingStraightUp_detection = (
    poses,
    setHeadTilt,
    setShoulderAlignment,
    setHipAlignment,
    setKneeAlignment,
    startTimeRef,  
    setFeedback,
    feedbackRef,
    setTimeElapsed,  
    targetReps,     
    handleExerciseComplete,
    countdownRef,    // Ref to track countdown state
    elapsedTimeRef,
    currentTimeRef
) => {

    let headTilt = null;
    let shoulderAlignment = null;
    let hipAlignment = null;
    let kneeAlignment = null;
    let ankleAlignment = null;

    if (poses.length > 0 && poses[0].keypoints) {
        const keypoints = poses[0].keypoints;
        const leftShoulder = keypoints.find(k => k.name === 'left_shoulder');
        const rightShoulder = keypoints.find(k => k.name === 'right_shoulder');
        const leftHip = keypoints.find(k => k.name === 'left_hip');
        const rightHip = keypoints.find(k => k.name === 'right_hip');
        const leftKnee = keypoints.find(k => k.name === 'left_knee');
        const rightKnee = keypoints.find(k => k.name === 'right_knee');
        const leftAnkle = keypoints.find(k => k.name === 'left_ankle');
        const rightAnkle = keypoints.find(k => k.name === 'right_ankle');
        const head = keypoints.find(k => k.name === 'nose');

        if (leftShoulder && rightShoulder && leftHip && rightHip && leftKnee && rightKnee && leftAnkle && rightAnkle && head) {
            const allKeyPointsDetected = [leftShoulder, rightShoulder, leftHip, rightHip, leftKnee, rightKnee, leftAnkle, rightAnkle, head].every(k => k.score > 0.3);

            if (allKeyPointsDetected) {
                
                // If countdown hasn't started, start it
                if (!countdownRef.current.started && countdownRef.current.value === 5) {
                    countdownRef.current.started = true;  // Mark countdown as started
                    //countdownRef.current.value = 5;  // Set initial countdown value

                    const countdownInterval = setInterval(() => {
                        if (countdownRef.current.value > 0) {
                            setFeedback(`Detection will start in ${countdownRef.current.value} seconds`);
                            feedbackRef.current = `Detection will start in ${countdownRef.current.value} seconds`;
                            countdownRef.current.value--;
                        } else {
                            clearInterval(countdownInterval);
                            startTimeRef.current = new Date().getTime();  // Set the start time
                            setFeedback("Detection started! Hold steady...");
                            feedbackRef.current = "Detection started! Hold steady...";
                            countdownRef.current.value = 0;  // Reset countdown value for potential future use
                        }
                    }, 1000);

                    return;  // Exit the function, wait for countdown to complete
                }
                // Once countdown is complete, proceed with the detection logic
                if (countdownRef.current.value === 0) {
                    headTilt = Math.abs(head.x - ((leftShoulder.x + rightShoulder.x) / 2));
                    shoulderAlignment = Math.abs(leftShoulder.y - rightShoulder.y);
                    hipAlignment = Math.abs(leftHip.y - rightHip.y);
                    kneeAlignment = Math.abs(leftKnee.y - rightKnee.y);
                    ankleAlignment = Math.abs(leftAnkle.x - rightAnkle.x);

                    setHeadTilt(headTilt);
                    setShoulderAlignment(shoulderAlignment);
                    setHipAlignment(hipAlignment);
                    setKneeAlignment(kneeAlignment);

                    // currentTimeRef.current = new Date().getTime();
                    // elapsedTimeRef.current = (currentTimeRef.current - startTimeRef.current) / 1000;  // Convert to seconds
                //    // setTimeElapsed(elapsedTimeRef.current);
                //     console.log(`Start Time: ${startTimeRef.current}`);
                //     console.log(`Current Time: ${new Date().getTime()}`);
                //     console.log(`Elapsed Time: ${elapsedTimeRef.current}`);

                    // if (elapsedTimeRef.current < targetReps) {
                    // console.log(`Elapsed Time: ${elapsedTimeRef.current}, Target Reps: ${targetReps}`);
                    // // Update feedback with the time remaining
                    // setFeedback(`Hold steady... ${Math.max(0, targetReps - elapsedTimeRef.current).toFixed(2)} seconds left`);
                    // feedbackRef.current = `Hold steady... ${Math.max(0, targetReps - elapsedTimeRef.current).toFixed(2)} seconds left`;

                    // Provide alignment feedback
                    if (headTilt > 10) {
                        setFeedback("Keep your head straight.");
                        feedbackRef.current = "Keep your head straight.";
                    } else if (shoulderAlignment > 5) {
                        setFeedback("Level your shoulders.");
                        feedbackRef.current = "Level your shoulders.";
                    } else if (hipAlignment > 5) {
                        setFeedback("Align your hips.");
                        feedbackRef.current = "Align your hips.";
                    } else if (kneeAlignment > 5) {
                        setFeedback("Align your knees.");
                        feedbackRef.current = "Align your knees.";
                    } else if (ankleAlignment < 10 || ankleAlignment > 30) {
                        setFeedback("Keep your feet hip-width apart.");
                        feedbackRef.current = "Keep your feet hip-width apart.";
                    }
                    
                // } else{
                //     // Check if the time is up
                   
                //         handleExerciseComplete();
                //         setFeedback("Exercise complete!");
                //         feedbackRef.current = "Exercise complete!";
                //         console.log("Exercise complete!");
                //         console.log(`Start Time: ${startTimeRef.current}`);
                //         console.log(`Current Time: ${new Date().getTime()}`);
                //         console.log(`Elapsed Time: ${elapsedTimeRef.current}`);
                //         return; // Exit function to stop further processing
                //     }
                }

            } else {
                setFeedback("Make sure all key points are visible.");
                feedbackRef.current = "Make sure all key points are visible.";
            }
        } else {
            setFeedback("Move your body into the frame.");
            feedbackRef.current = "Move your body into the frame.";
        }
    } else {
        setFeedback("No person detected.");
        feedbackRef.current = "No person detected.";
    }

    return {
        headTilt: headTilt !== null ? headTilt : undefined,
        shoulderAlignment: shoulderAlignment !== null ? shoulderAlignment : undefined,
        hipAlignment: hipAlignment !== null ? hipAlignment : undefined,
        kneeAlignment: kneeAlignment !== null ? kneeAlignment : undefined,
        ankleAlignment: ankleAlignment !== null ? ankleAlignment : undefined,
    };
};
