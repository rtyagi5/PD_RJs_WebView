// detectors.js
import * as posedetection from '@tensorflow-models/pose-detection';
import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import * as tf from '@tensorflow/tfjs';

/**
 * Select the fastest TF.js backend the device actually supports.
 * WebGL is required for usable frame rates, but some in-app WebViews and older
 * devices don't expose it — previously that threw and left the patient staring at
 * a frozen "Initializing…" screen. Falling back to CPU is slow but functional.
 */
async function selectBackend() {
  for (const backend of ['webgl', 'cpu']) {
    try {
      if (await tf.setBackend(backend)) {
        await tf.ready();
        if (backend !== 'webgl') {
          console.warn(`[TF] WebGL unavailable — running on "${backend}". Expect reduced frame rate.`);
        }
        return backend;
      }
    } catch (err) {
      console.warn(`[TF] backend "${backend}" failed to initialise:`, err?.message || err);
    }
  }
  throw new Error('No usable TensorFlow.js backend (tried webgl, cpu)');
}

export async function createMoveNet() {
    await selectBackend();
    console.log('[TF] backend:', tf.getBackend(), '| webgl version:', tf.ENV.get('WEBGL_VERSION'));
  const det = await posedetection.createDetector(
    posedetection.SupportedModels.MoveNet,
    {
      modelType: posedetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
      modelUrl:
        window.location.hostname === 'localhost'
          ? `/models/movenet/model.json`
          : `${process.env.PUBLIC_URL}/models/movenet/model.json`,
    }
  );
  return {
    async estimatePoses(video) {
      const poses = await det.estimatePoses(video);
      // Already returns {keypoints:[{name,x,y,score}]} in your app’s format.
      return poses;
    },
    async dispose() { await det?.dispose?.(); }
  };
}

export async function createMediaPipePose() {
    // Load the WASM runtime from our own origin (public/mediapipe/wasm, copied from
    // the installed @mediapipe/tasks-vision package). Previously this came from a
    // jsdelivr CDN pinned to 0.10.0 while the package was 0.10.22 — a version skew
    // plus the only network dependency in an otherwise fully offline pipeline.
    // The CDN remains as a fallback for the case where the assets are missing.
    const localWasm = `${process.env.PUBLIC_URL || ''}/mediapipe/wasm`;
    let vision;
    try {
      vision = await FilesetResolver.forVisionTasks(localWasm);
    } catch (err) {
      console.warn('[MediaPipe] Local WASM unavailable, falling back to CDN:', err?.message || err);
      vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm'
      );
    }

    const model = `${process.env.PUBLIC_URL || ''}/mediapipe/pose_landmarker_full.task`;
    const landmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: model },
      runningMode: "VIDEO",
      numPoses: 1,
    });
  
    // MediaPipe indices ➜ names (33)
    const MP_NAMES = [
      'nose','left_eye_inner','left_eye','left_eye_outer','right_eye_inner','right_eye','right_eye_outer',
      'left_ear','right_ear','mouth_left','mouth_right',
      'left_shoulder','right_shoulder','left_elbow','right_elbow','left_wrist','right_wrist',
      'left_pinky','right_pinky','left_index','right_index','left_thumb','right_thumb',
      'left_hip','right_hip','left_knee','right_knee','left_ankle','right_ankle',
      'left_heel','right_heel','left_foot_index','right_foot_index'
    ];
  
    // MoveNet/COCO 17-order your app expects
    const MOVENET_17 = [
      'nose',
      'left_eye', 'right_eye',
      'left_ear', 'right_ear',
      'left_shoulder','right_shoulder',
      'left_elbow','right_elbow',
      'left_wrist','right_wrist',
      'left_hip','right_hip',
      'left_knee','right_knee',
      'left_ankle','right_ankle'
    ];
  
    // Map MP name -> MP index
    const MP_IDX = Object.fromEntries(MP_NAMES.map((n,i)=>[n,i]));
  
    // Helper to read/scale one MP landmark
    function kpFromName(lm, videoW, videoH, name) {
      const i = MP_IDX[name];
      const p = lm[i] || {};
      // MP gives normalized coords; scale to pixels for your pipeline
      return {
        name,
        x: (p.x ?? 0) * videoW,
        y: (p.y ?? 0) * videoH,
        // Use visibility if present, else 1.0 to keep present() happy
        score: (typeof p.visibility === 'number' ? p.visibility : 1.0)
      };
    }
  
    return {
      async estimatePoses(video) {
        const ts = performance.now();
        const out = landmarker.detectForVideo(video, ts);
        const lm = out?.landmarks?.[0];
        if (!lm) return [{ keypoints: [] }];
  
        const w = video.videoWidth || video.width || 1;
        const h = video.videoHeight || video.height || 1;
  
        // 1) First 17 keypoints in MoveNet order (fixes your renderer)
        const keypoints17 = MOVENET_17.map(n => kpFromName(lm, w, h, n));
  
        // 2) Append MediaPipe-only feet we need for calves
        const extras = ['left_heel','right_heel','left_foot_index','right_foot_index']
          .map(n => kpFromName(lm, w, h, n));
  
        const keypoints = [...keypoints17, ...extras];
  
        return [{ keypoints }];
      },
      async dispose() { try { landmarker?.close?.(); } catch {} }
    };
}

export async function createPoseDetector(kind = 'movenet') {
  return kind === 'mediapipe' ? createMediaPipePose() : createMoveNet();
}
