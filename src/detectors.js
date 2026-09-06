// detectors.js
import * as posedetection from '@tensorflow-models/pose-detection';
import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import * as tf from '@tensorflow/tfjs';
// Registers the WebGPU backend so selectBackend() can try it. WebGPU dispatches
// work without the long synchronous stall WebGL's estimatePoses() incurs on
// mobile - measured at ~58ms per call on an Adreno 710, which capped the whole
// detection loop at ~17fps. Falls through to WebGL where WebGPU is unavailable.
import '@tensorflow/tfjs-backend-webgpu';

// Chrome/WebView removed GPUAdapter.requestAdapterInfo() in favour of the
// synchronous `adapter.info` property, but tfjs-backend-webgpu 4.20 still calls
// the removed method. That throws during backend init, so WebGPU silently falls
// back to WebGL even on devices that fully support it - confirmed on WebView 150
// with an Adreno 710, where requestAdapter() succeeds but init still failed.
// Shim the old method onto the prototype so the backend can construct.
const GPUAdapterCtor =
  typeof window !== 'undefined' ? window.GPUAdapter : undefined;
if (GPUAdapterCtor && !GPUAdapterCtor.prototype.requestAdapterInfo) {
  GPUAdapterCtor.prototype.requestAdapterInfo = function requestAdapterInfo() {
    return Promise.resolve(this.info || {});
  };
}

/**
 * Select the fastest TF.js backend the device actually supports.
 * WebGL is required for usable frame rates, but some in-app WebViews and older
 * devices don't expose it — previously that threw and left the patient staring at
 * a frozen "Initializing…" screen. Falling back to CPU is slow but functional.
 */
async function selectBackend() {
  // Why WebGPU was rejected. navigator.gpu can exist while requestAdapter()
  // still returns null (blocklisted driver, or WebView not granting an
  // adapter), which surfaces only as "Initialization of backend webgpu failed".
  try {
    if (typeof navigator !== 'undefined' && navigator.gpu) {
      const adapter = await navigator.gpu.requestAdapter();
      console.log(`[TF-env] requestAdapter -> ${adapter ? 'OK' : 'null'}`);
      if (adapter) {
        const info = adapter.info || (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : null);
        console.log(`[TF-env] adapter vendor=${info?.vendor} arch=${info?.architecture} desc=${info?.description}`);
      }
    } else {
      console.log('[TF-env] navigator.gpu absent');
    }
  } catch (e) {
    console.warn('[TF-env] requestAdapter threw:', e && e.message);
  }

  // TF.js defaults this to 1 on mobile, forcing a gl.flush() after ~1ms of
  // estimated GPU work. That can stall the pipeline on tiled mobile GPUs.
  // -1 disables the auto-flush and lets the driver batch.
  try {
    tf.env().set('WEBGL_FLUSH_THRESHOLD', -1);
    console.log('[TF-env] WEBGL_FLUSH_THRESHOLD -> -1 (auto-flush disabled)');
  } catch (e) {
    console.warn('[TF-env] could not set flush threshold', e && e.message);
  }

  // tf.setBackend() swallows the real exception and only logs
  // "Initialization of backend webgpu failed". Invoke the registered factory
  // directly so the actual failure reason is visible.
  try {
    const factory = tf.findBackendFactory ? tf.findBackendFactory('webgpu') : null;
    if (factory) {
      const made = await factory();
      console.log(`[TF-env] webgpu factory -> ${made ? 'constructed OK' : 'returned falsy'}`);
      if (made && made.dispose) { try { made.dispose(); } catch (e) {} }
    } else {
      console.log('[TF-env] no webgpu factory registered');
    }
  } catch (e) {
    console.error(`[TF-env] webgpu factory threw: ${e && e.message} | ${String(e && e.stack).slice(0, 300)}`);
  }

  for (const backend of ['webgpu', 'webgl', 'cpu']) {
    try {
      if (await tf.setBackend(backend)) {
        await tf.ready();
        // One-off environment dump. The ~58ms synchronous cost of
        // estimatePoses() on mobile is most likely the GPU->CPU keypoint
        // readback; whether that blocks depends on these flags, so read the
        // real values off the device rather than assuming defaults.
        try {
          const flags = [
            'WEBGL_VERSION', 'WEBGL_FENCE_API_ENABLED', 'WEBGL_FLUSH_THRESHOLD',
            'WEBGL_PACK', 'WEBGL_CPU_FORWARD', 'WEBGL_RENDER_FLOAT32_ENABLED',
            'WEBGL_DOWNLOAD_FLOAT_ENABLED', 'WEBGL_BUFFER_SUPPORTED',
            'WEBGL_USE_SHAPES_UNIFORMS', 'CHECK_COMPUTATION_FOR_ERRORS',
          ];
          const dump = flags.map((f) => {
            try { return `${f}=${tf.env().get(f)}`; } catch (e) { return `${f}=?`; }
          }).join(' ');
          console.log(`[TF-env] ${dump}`);
          console.log(`[TF-env] navigator.gpu=${!!(typeof navigator !== 'undefined' && navigator.gpu)} cores=${typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : '?'}`);
        } catch (e) {
          console.warn('[TF-env] dump failed', e && e.message);
        }
        if (backend === 'cpu') {
          console.warn(`[TF] No GPU backend — running on "${backend}". Expect reduced frame rate.`);
        }
        return backend;
      }
    } catch (err) {
      console.warn(`[TF] backend "${backend}" failed to initialise:`, err?.message || err);
    }
  }
  throw new Error('No usable TensorFlow.js backend (tried webgpu, webgl, cpu)');
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
