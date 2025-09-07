// Import common utility functions
import { calculateInteriorAngle } from './utilities';

// Track initialization state
let hasInitialized = false;

// Create refs at the module level
const lastLegSwitchTimeRef = { current: 0 };

export const SeatedMarch_repDetection = async (
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
    lastLegSwitchTime = lastLegSwitchTimeRef
) => {
    // Initialize refs if not set
    if (startLegRef.current === undefined) {
        startLegRef.current = 'left';
    }
    if (!feedbackLockRef.current) {
        feedbackLockRef.current = { locked: false };
    }

    // Track which leg we're currently working on
    const currentLeg = startLegRef.current;
    
    // Track leg states with more descriptive values
    const LEG_STATES = {
        NONE: 0,    // Leg hasn't moved yet
        LIFTED: 1,  // Leg is lifted
        LOWERED: 2  // Leg has been lifted and lowered (complete movement)
    };

    // Only log initialization on first run
    if (!hasInitialized) {
        console.log(`[SeatedMarch] Starting exercise - Target: ${targetReps} reps`);
        console.log(`[SeatedMarch] Starting with ${currentLeg} leg first`);
        hasInitialized = true;
    }

    // Keypoints for both legs
    const keypoints = {
        left: { hip: null, knee: null, ankle: null, shoulder: null },
        right: { hip: null, knee: null, ankle: null, shoulder: null }
    };

    // Thresholds for exercise detection
    const THRESHOLDS = {
        LIFTED_HIP_ANGLE: 100,     // Slightly reduced for better detection
        LIFTED_KNEE_ANGLE: 80,     // Slightly reduced for better detection
        LOWERED_HIP_ANGLE: 160,    // Slightly increased for better detection
        LOWERED_KNEE_ANGLE: 160,   // Slightly increased for better detection
        LEG_SWITCH_COOLDOWN: 1000,  // ms - time between leg switches
        MIN_CONFIDENCE: 0.4,        // Slightly increased confidence threshold
        MIN_KEYPOINTS: 3            // Minimum number of keypoints needed for a valid leg
    };

    // Extract keypoints from poses if available
    if (poses[0]?.keypoints) {
        keypoints.left.shoulder = poses[0].keypoints.find(k => k.name === 'left_shoulder');
        keypoints.left.hip = poses[0].keypoints.find(k => k.name === 'left_hip');
        keypoints.left.knee = poses[0].keypoints.find(k => k.name === 'left_knee');
        keypoints.left.ankle = poses[0].keypoints.find(k => k.name === 'left_ankle');
        keypoints.right.shoulder = poses[0].keypoints.find(k => k.name === 'right_shoulder');
        keypoints.right.hip = poses[0].keypoints.find(k => k.name === 'right_hip');
        keypoints.right.knee = poses[0].keypoints.find(k => k.name === 'right_knee');
        keypoints.right.ankle = poses[0].keypoints.find(k => k.name === 'right_ankle');
    }

    // Initialize angles
    const angles = {
        left: { hip: 180, knee: 180 },
        right: { hip: 180, knee: 180 }
    };

    if (poses.length > 0 && poses[0].keypoints) {
        const poseKeypoints = poses[0].keypoints;

        // Get all keypoints for both sides
        ['left', 'right'].forEach(side => {
            keypoints[side].shoulder = poseKeypoints.find(k => k.name === `${side}_shoulder`);
            keypoints[side].hip = poseKeypoints.find(k => k.name === `${side}_hip`);
            keypoints[side].knee = poseKeypoints.find(k => k.name === `${side}_knee`);
            keypoints[side].ankle = poseKeypoints.find(k => k.name === `${side}_ankle`);
        });

        // Calculate angles for both legs with validation
        const calculateAngles = (side) => {
            const parts = keypoints[side];
            const angles = { hip: 180, knee: 180 };
            
            // Only calculate angles if we have enough confidence in the keypoints
            const hasShoulder = parts.shoulder?.score > THRESHOLDS.MIN_CONFIDENCE;
            const hasHip = parts.hip?.score > THRESHOLDS.MIN_CONFIDENCE;
            const hasKnee = parts.knee?.score > THRESHOLDS.MIN_CONFIDENCE;
            const hasAnkle = parts.ankle?.score > THRESHOLDS.MIN_CONFIDENCE;
            
            // Calculate hip angle (shoulder-hip-knee)
            if (hasShoulder && hasHip && hasKnee) {
                angles.hip = calculateInteriorAngle(
                    parts.shoulder,
                    parts.hip,
                    parts.knee
                ) || 180;
            }

            // Calculate knee angle (hip-knee-ankle)
            if (hasHip && hasKnee && hasAnkle) {
                angles.knee = calculateInteriorAngle(
                    parts.hip,
                    parts.knee,
                    parts.ankle
                ) || 180;
            }

            return angles;
        };

        // Check if we have enough keypoints with good confidence
        const hasGoodKeypoints = 
            keypoints.left.hip?.score > THRESHOLDS.MIN_CONFIDENCE &&
            keypoints.left.knee?.score > THRESHOLDS.MIN_CONFIDENCE &&
            keypoints.right.hip?.score > THRESHOLDS.MIN_CONFIDENCE &&
            keypoints.right.knee?.score > THRESHOLDS.MIN_CONFIDENCE;
            
        // Visual feedback for keypoint confidence
        if (!hasGoodKeypoints) {
            keypointColorsRef.current = '#FFA500'; // Orange for low confidence
            segmentColorsRef.current = '#FFA500';
            feedbackRef.current = 'Adjust position for better detection';
        }

        if (hasGoodKeypoints) {
            // Update keypoints for visualization
            keypointsRef.current = [
                'left_shoulder', 'left_hip', 'left_knee', 'left_ankle',
                'right_shoulder', 'right_hip', 'right_knee', 'right_ankle'
            ];

            // Set default colors
            keypointColorsRef.current = 'aqua';
            segmentColorsRef.current = 'aqua';

            // Calculate angles for both legs
            angles.left = calculateAngles('left');
            angles.right = calculateAngles('right');
            
            // Log current angles for debugging
            console.log(`[Angles] Left - Hip: ${angles.left.hip.toFixed(1)}°, Knee: ${angles.left.knee.toFixed(1)}° | ` +
                      `Right - Hip: ${angles.right.hip.toFixed(1)}°, Knee: ${angles.right.knee.toFixed(1)}°`);

            // Define leg movement detection with angle logging
            const leftHipAngle = angles.left.hip;
            const leftKneeAngle = angles.left.knee;
            const rightHipAngle = angles.right.hip;
            const rightKneeAngle = angles.right.knee;

            // Check if legs are lifted or lowered with better state management
            const isLeftLegLifted = leftKneeAngle < THRESHOLDS.LIFTED_KNEE_ANGLE && 
                                 leftHipAngle < THRESHOLDS.LIFTED_HIP_ANGLE &&
                                 leftKneeAngle > 0 && leftHipAngle > 0;  // Ensure valid angles
                                  
            const isRightLegLifted = rightKneeAngle < THRESHOLDS.LIFTED_KNEE_ANGLE && 
                                  rightHipAngle < THRESHOLDS.LIFTED_HIP_ANGLE &&
                                  rightKneeAngle > 0 && rightHipAngle > 0;  // Ensure valid angles
            
            // A leg is considered lowered if the knee is straight (large knee angle) and hip is extended (large hip angle)
            const isLeftLegLowered = leftKneeAngle > THRESHOLDS.LOWERED_KNEE_ANGLE && 
                                  leftHipAngle > THRESHOLDS.LOWERED_HIP_ANGLE;
                                  
            const isRightLegLowered = rightKneeAngle > THRESHOLDS.LOWERED_KNEE_ANGLE && 
                                   rightHipAngle > THRESHOLDS.LOWERED_HIP_ANGLE;
            
            // Debug: Log state changes
            if (isLeftLegLifted && leftLegCountRef.current !== LEG_STATES.LIFTED) {
                console.log(`[${side}] Leg lifted - Hip: ${leftHipAngle.toFixed(1)}°, Knee: ${leftKneeAngle.toFixed(1)}°`);
            }
            if (isRightLegLifted && rightLegCountRef.current !== LEG_STATES.LIFTED) {
                console.log(`[${side}] Leg lifted - Hip: ${rightHipAngle.toFixed(1)}°, Knee: ${rightKneeAngle.toFixed(1)}°`);
            }
            
            // Track previous states for edge detection
            const prevLeftLegState = leftLegCountRef.current;
            const prevRightLegState = rightLegCountRef.current;
            
            // Enhanced debug logging for leg states
            const leftState = isLeftLegLifted ? 'LIFTED' : isLeftLegLowered ? 'LOWERED' : 'MOVING';
            const rightState = isRightLegLifted ? 'LIFTED' : isRightLegLowered ? 'LOWERED' : 'MOVING';
            
            // Log state changes with more context
            if (leftState !== (window.lastLeftState || '') || rightState !== (window.lastRightState || '')) {
                console.log(`[LEFT] Hip: ${leftHipAngle.toFixed(1)}° (${keypoints.left.hip?.score?.toFixed(2)}), ` +
                          `Knee: ${leftKneeAngle.toFixed(1)}° (${keypoints.left.knee?.score?.toFixed(2)}) - ${leftState}`);
                console.log(`[RIGHT] Hip: ${rightHipAngle.toFixed(1)}° (${keypoints.right.hip?.score?.toFixed(2)}), ` +
                          `Knee: ${rightKneeAngle.toFixed(1)}° (${keypoints.right.knee?.score?.toFixed(2)}) - ${rightState}`);
                window.lastLeftState = leftState;
                window.lastRightState = rightState;
            }
            
            // Only process if we're not locked and have good keypoint confidence
            const hasGoodConfidence = 
                keypoints.left.hip?.score > THRESHOLDS.MIN_CONFIDENCE &&
                keypoints.left.knee?.score > THRESHOLDS.MIN_CONFIDENCE &&
                keypoints.right.hip?.score > THRESHOLDS.MIN_CONFIDENCE &&
                keypoints.right.knee?.score > THRESHOLDS.MIN_CONFIDENCE;
                
            if (!feedbackLockRef.current.locked && hasGoodConfidence) {
                const now = Date.now();
                const canSwitchLegs = now - lastLegSwitchTime.current > THRESHOLDS.LEG_SWITCH_COOLDOWN;
                
                // Handle left leg state changes
                if (isLeftLegLifted && prevLeftLegState !== LEG_STATES.LIFTED) {
                    leftLegCountRef.current = LEG_STATES.LIFTED;
                    console.log(`[SeatedMarch] Left leg lifted (Hip: ${leftHipAngle.toFixed(1)}°, Knee: ${leftKneeAngle.toFixed(1)}°)`);
                    feedbackRef.current = 'Left leg up';
                    
                    // Show left leg in green when lifted
                    keypointColorsRef.current = '#00FF00';
                    segmentColorsRef.current = '#00FF00';
                    keypointsRef.current = ['left_hip', 'left_knee', 'left_ankle'];
                    
                    // Lock briefly to prevent rapid state changes
                    feedbackLockRef.current.locked = true;
                    setTimeout(() => {
                        feedbackLockRef.current.locked = false;
                    }, 300);
                } 
                else if (isLeftLegLowered && prevLeftLegState === LEG_STATES.LIFTED) {
                    leftLegCountRef.current = LEG_STATES.LOWERED;
                    console.log(`[SeatedMarch] Left leg lowered (Hip: ${leftHipAngle.toFixed(1)}°, Knee: ${leftKneeAngle.toFixed(1)}°)`);
                    feedbackRef.current = 'Left leg down';
                    
                    // Reset colors to default
                    keypointColorsRef.current = 'aqua';
                    segmentColorsRef.current = 'aqua';
                    keypointsRef.current = [];
                    
                    // Lock briefly to prevent rapid state changes
                    feedbackLockRef.current.locked = true;
                    setTimeout(() => {
                        feedbackLockRef.current.locked = false;
                    }, 300);
                }

                // Handle right leg state changes
                if (isRightLegLifted && prevRightLegState !== LEG_STATES.LIFTED) {
                    rightLegCountRef.current = LEG_STATES.LIFTED;
                    console.log(`[SeatedMarch] Right leg lifted (Hip: ${rightHipAngle.toFixed(1)}°, Knee: ${rightKneeAngle.toFixed(1)}°)`);
                    feedbackRef.current = 'Right leg up';
                    
                    // Show right leg in green when lifted
                    keypointColorsRef.current = '#00FF00';
                    segmentColorsRef.current = '#00FF00';
                    keypointsRef.current = ['right_hip', 'right_knee', 'right_ankle'];
                    
                    // Lock briefly to prevent rapid state changes
                    feedbackLockRef.current.locked = true;
                    setTimeout(() => {
                        feedbackLockRef.current.locked = false;
                    }, 300);
                }
                else if (isRightLegLowered && prevRightLegState === LEG_STATES.LIFTED) {
                    rightLegCountRef.current = LEG_STATES.LOWERED;
                    console.log(`[SeatedMarch] Right leg lowered (Hip: ${rightHipAngle.toFixed(1)}°, Knee: ${rightKneeAngle.toFixed(1)}°)`);
                    feedbackRef.current = 'Right leg down';
                    
                    // Reset colors to default
                    keypointColorsRef.current = 'aqua';
                    segmentColorsRef.current = 'aqua';
                    keypointsRef.current = [];
                    
                    // Lock briefly to prevent rapid state changes
                    feedbackLockRef.current.locked = true;
                    setTimeout(() => {
                        feedbackLockRef.current.locked = false;
                    }, 300);
                }

                // Handle leg switching when current leg completes its movement
                if (currentLeg === 'left' && leftLegCountRef.current === LEG_STATES.LOWERED && canSwitchLegs) {
                    startLegRef.current = 'right';
                    lastLegSwitchTime.current = now;
                    feedbackRef.current = 'Now lift your right knee';
                    console.log('[SeatedMarch] Switching to right leg');
                }
                else if (currentLeg === 'right' && rightLegCountRef.current === LEG_STATES.LOWERED && canSwitchLegs) {
                    startLegRef.current = 'left';
                    lastLegSwitchTime.current = now;
                    
                    // Check if we've completed a full rep (both legs lifted and lowered)
                    if (leftLegCountRef.current === LEG_STATES.LOWERED && rightLegCountRef.current === LEG_STATES.LOWERED) {
                        repCountRef.current++;
                        console.log(`[SeatedMarch] Rep ${repCountRef.current} completed!`);
                        feedbackRef.current = `Great! Rep ${repCountRef.current} of ${targetReps} completed`;
                        
                        // Reset leg states for next rep
                        leftLegCountRef.current = LEG_STATES.NONE;
                        rightLegCountRef.current = LEG_STATES.NONE;
                        
                        // If we've reached the target reps, complete the exercise
                        if (repCountRef.current >= targetReps) {
                            handleExerciseComplete(repCountRef.current);
                            return {
                                keypoints: keypointsRef.current,
                                keypointColors: keypointColorsRef.current,
                                segmentColors: segmentColorsRef.current,
                                feedback: feedbackRef.current,
                                leftLegCount: leftLegCountRef.current,
                                rightLegCount: rightLegCountRef.current,
                                repCount: repCountRef.current,
                                isComplete: true
                            };
                        }
                    } else {
                        feedbackRef.current = 'Now lift your left knee';
                    }
                    
                    console.log('[SeatedMarch] Switching to left leg');
                }
                
                // Visual feedback for current leg to move
                if (!isLeftLegLifted && !isLeftLegLowered && currentLeg === 'left') {
                    feedbackRef.current = 'Lift your left knee higher';
                    keypointColorsRef.current = '#FF0000';
                    segmentColorsRef.current = '#FF0000';
                    keypointsRef.current = ['left_hip', 'left_knee', 'left_ankle'];
                }
                else if (!isRightLegLifted && !isRightLegLowered && currentLeg === 'right') {
                    feedbackRef.current = 'Lift your right knee higher';
                    keypointColorsRef.current = '#FF0000';
                    segmentColorsRef.current = '#FF0000';
                    keypointsRef.current = ['right_hip', 'right_knee', 'right_ankle'];
                }
            }
        } else {
            // Handle case when not all keypoints are detected
            const missingKeypoints = [];
            
            ['left', 'right'].forEach(side => {
                const hip = keypoints[`${side}_hip`];
                const knee = keypoints[`${side}_knee`];
                const ankle = keypoints[`${side}_ankle`];
                const shoulder = keypoints[`${side}_shoulder`];
                
                if (!hip || !hip.score || hip.score < THRESHOLDS.MIN_CONFIDENCE) 
                    missingKeypoints.push(`${side} hip`);
                if (!knee || !knee.score || knee.score < THRESHOLDS.MIN_CONFIDENCE) 
                    missingKeypoints.push(`${side} knee`);
                if (!ankle || !ankle.score || ankle.score < THRESHOLDS.MIN_CONFIDENCE) 
                    missingKeypoints.push(`${side} ankle`);
                if (!shoulder || !shoulder.score || shoulder.score < THRESHOLDS.MIN_CONFIDENCE) 
                    missingKeypoints.push(`${side} shoulder`);
            });
            
            if (missingKeypoints.length > 0) {
                console.warn(`Missing or low confidence keypoints: ${missingKeypoints.join(', ')}`);
                feedbackRef.current = `Adjust position - can't detect: ${missingKeypoints.slice(0, 2).join(', ')}${missingKeypoints.length > 2 ? '...' : ''}`;
                
                // Reset colors to default
                keypointColorsRef.current = '#FF0000';
                segmentColorsRef.current = '#FF0000';
                keypointsRef.current = [];
            }
        }
    }

    // Return the current state for the parent component
    return {
        keypoints: keypointsRef.current,
        keypointColors: keypointColorsRef.current,
        segmentColors: segmentColorsRef.current,
        feedback: feedbackRef.current,
        leftLegCount: leftLegCountRef.current,
        rightLegCount: rightLegCountRef.current,
        repCount: repCountRef.current,
        isComplete: repCountRef.current >= targetReps
    };
};

export default SeatedMarch_repDetection;
