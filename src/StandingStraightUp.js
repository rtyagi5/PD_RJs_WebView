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
    currentTimeRef,
    keypointColorsRef,      
    segmentColorsRef,
    keypointsRef
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

                    // Provide alignment feedback
                    if (headTilt > 15) {
                        keypointsRef.current = [head.name];
                        keypointColorsRef.current="red";
                        segmentColorsRef.current="red";          
                        setFeedback("Keep your head straight.");
                        feedbackRef.current = "Keep your head straight.";
                    } else if (shoulderAlignment > 15) {
                        keypointsRef.current = [leftShoulder.name, rightShoulder.name];
                        keypointColorsRef.current="red";
                        segmentColorsRef.current="red";  
                        setFeedback("Level your shoulders.");
                        feedbackRef.current = "Level your shoulders.";
                    } else if (hipAlignment > 15) {
                        keypointsRef.current = [leftHip.name, rightHip.name];
                        keypointColorsRef.current="red";
                        segmentColorsRef.current="red";  
                        setFeedback("Align your hips.");
                        feedbackRef.current = "Align your hips.";
                    } else if (kneeAlignment > 15) {
                        keypointsRef.current = [leftKnee.name, rightKnee.name];
                        keypointColorsRef.current="red";
                        segmentColorsRef.current="red";  
                        setFeedback("Align your knees.");
                        feedbackRef.current = "Align your knees.";
                    } else if (ankleAlignment < 5 || ankleAlignment > 40) {
                        keypointsRef.current = [leftAnkle.name, rightAnkle.name];
                        keypointColorsRef.current="red";
                        segmentColorsRef.current="red";  
                        setFeedback("Keep your feet hip-width apart.");
                        feedbackRef.current = "Keep your feet hip-width apart.";
                    }
                    else{
                        keypointsRef.current = [leftShoulder.name, rightShoulder.name, leftHip.name, rightHip.name,
                            leftKnee.name, rightKnee.name, leftAnkle.name, rightAnkle.name,head.name];        
                        keypointColorsRef.current="green";
                        segmentColorsRef.current="green"; 
                    }
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
