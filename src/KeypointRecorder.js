// ---------------------------------------------
// KeypointRecorder.js
// Records the raw keypoint stream alongside the existing video recorders.
//
// VideoRecorder and SkeletonRecorder both captureStream() a canvas into
// MediaRecorder and emit webm. They record PIXELS. The keypoint array is
// computed every frame, drawn, and thrown away — so there is no dataset
// anywhere that can re-run segmentation offline. Without one you cannot replay
// a session, A/B a threshold change, or diagnose a patient complaint; every
// tuning decision has to be made by standing in front of a camera.
//
// This produces a .jsonl sidecar: line 1 is a header, every subsequent line is
// one frame. It is deliberately a plain class, not a React component — it must
// be callable from inside the detection loop with no render involvement.
// ---------------------------------------------

const SCHEMA = 1;

/** Round to n decimals, mapping anything non-finite to null.
 *  NaN must not reach JSON.stringify as a bare literal: `NaN` is invalid JSON
 *  and would make the whole line unparseable for every downstream consumer. */
function num(v, decimals) {
  if (!Number.isFinite(v)) return null;
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

function makeSessionId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* fall through */ }
  return `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export class KeypointRecorder {
  /**
   * @param {Object}   opts
   * @param {string}   opts.exercise
   * @param {string}   [opts.side]
   * @param {string}   [opts.patientId]
   * @param {string}   [opts.detector]      'mediapipe' | 'movenet'
   * @param {string[]} [opts.featureKeys]   which feature keys to record per frame
   * @param {string}   [opts.primaryFeature]
   * @param {number}   [opts.videoW]
   * @param {number}   [opts.videoH]
   */
  constructor(opts = {}) {
    this.opts = opts;
    this.sessionId = opts.sessionId || makeSessionId();
    this.lines = [];
    this.startedAtIso = null;
    this.t0 = null;
    this.frameCount = 0;
    this.failed = false;

    // Only these keys are written per frame. Dumping all 31 universal features
    // triples the file for no benefit — the ones that matter are the exercise's
    // own metrics plus whatever the engine actually gates on.
    const keys = new Set(opts.featureKeys || []);
    if (opts.primaryFeature) keys.add(opts.primaryFeature);
    this.featureKeys = [...keys];
  }

  /** Begin a recording. Safe to call more than once; later calls are ignored. */
  start() {
    if (this.startedAtIso) return;
    try {
      this.startedAtIso = new Date().toISOString();
      this.t0 = performance.now();
      const o = this.opts;
      const header = {
        type: 'header',
        schema: SCHEMA,
        sessionId: this.sessionId,
        exercise: o.exercise ?? null,
        side: o.side ?? null,
        patientId: o.patientId ?? null,
        detector: o.detector ?? null,
        modelVariant: o.modelVariant ?? (o.detector === 'mediapipe' ? 'pose_landmarker_full' : 'singlepose_lightning'),
        modelAsset: o.modelAsset ?? (o.detector === 'mediapipe' ? 'pose_landmarker_full.task' : 'model.json'),
        tfjsBackend: o.tfjsBackend ?? null,
        videoW: o.videoW ?? null,
        videoH: o.videoH ?? null,
        startedAtIso: this.startedAtIso,
        appVersion: process.env.REACT_APP_VERSION || 'dev',
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        featureKeys: this.featureKeys,
        primaryFeature: o.primaryFeature ?? null,
      };
      // MediaPipe returns visibility only sometimes; detectors.js substitutes 1.0
      // when it is absent, so a "fully confident" foot keypoint may never have
      // been measured at all. Downstream consumers must not treat these as
      // calibrated confidence, so say so in the file itself.
      if (o.detector === 'mediapipe') header.confidenceIsSynthetic = true;
      this.lines.push(JSON.stringify(header));
    } catch (e) {
      this._fail(e);
    }
  }

  /**
   * Record one frame. Call this at the same point DTWPhaseMachine.step() is
   * called, with the POST-smoothing features, so a replay is bit-identical to
   * what the engine actually saw.
   *
   * @param {Array}  keypoints - [{name,x,y,score}]
   * @param {Object} features  - the smoothed feature vector
   */
  recordFrame(keypoints, features) {
    if (this.failed || !this.startedAtIso) return;
    try {
      // Integer ms since start, from performance.now() deltas — NOT a frame
      // index. Inter-frame gaps are the diagnostic signal for dropped frames and
      // the only real fps measurement we get off a device; an index destroys it.
      const t = Math.round(performance.now() - this.t0);

      const kp = [];
      for (const k of keypoints || []) {
        if (!k || !k.name) continue;
        kp.push([k.name, num(k.x, 1), num(k.y, 1), num(k.score, 3)]);
      }

      const feat = {};
      for (const key of this.featureKeys) {
        feat[key] = num(features?.[key], 4);
      }

      this.lines.push(JSON.stringify({ t, kp, feat }));
      this.frameCount++;
    } catch (e) {
      this._fail(e);
    }
  }

  /**
   * Close the recording and return the assembled document.
   * @param {Object} [meta]
   * @param {number} [meta.liveRepCount] - what the LIVE session counted. The
   *        replay harness asserts its own count against this; without it stored
   *        in the file there is nothing to compare a replay to.
   * @returns {{filename:string, jsonl:string, frames:number}|null}
   */
  finish(meta = {}) {
    if (this.failed || !this.startedAtIso) return null;
    try {
      if (meta.liveRepCount != null && this.lines.length > 0) {
        const header = JSON.parse(this.lines[0]);
        header.liveRepCount = meta.liveRepCount;
        header.endedAtIso = new Date().toISOString();
        header.frames = this.frameCount;
        this.lines[0] = JSON.stringify(header);
      }
      return {
        filename: this.filename(),
        jsonl: this.lines.join('\n') + '\n',
        frames: this.frameCount,
      };
    } catch (e) {
      this._fail(e);
      return null;
    }
  }

  /** Same stem as the webm recorders so a session's artefacts stay matched. */
  filename() {
    const ex = this.opts.exercise || 'exercise';
    return `session_${this.sessionId}_${ex}.jsonl`;
  }

  /**
   * Hand the file to the dev server so it lands on the LAPTOP.
   *
   * A browser download would land on whatever device is running the WebView —
   * i.e. the phone, over adb reverse — which is exactly where it is useless.
   * setupProxy.js hosts this route and CRA never includes it in a production
   * build. The production upload path waits on the backend contract in
   * docs/BASELINE_SYNC_CONTRACT.md.
   *
   * @returns {Promise<boolean>} true if the server accepted it
   */
  async saveToDevServer(meta = {}) {
    if (process.env.NODE_ENV !== 'development') return false;
    const out = this.finish(meta);
    if (!out) return false;
    try {
      const res = await fetch('/__dev/keypoints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: out.filename, jsonl: out.jsonl }),
      });
      if (!res.ok) throw new Error(`dev server responded ${res.status}`);
      console.log(`[KeypointRecorder] saved ${out.filename} (${out.frames} frames)`);
      return true;
    } catch (e) {
      // Never surface this to the patient and never fail the session over it.
      console.warn('[KeypointRecorder] dev save failed:', e);
      return false;
    }
  }

  _fail(e) {
    // One failure disables the recorder for the rest of the session rather than
    // logging on every frame. A recorder fault must never break an exercise.
    if (!this.failed) console.warn('[KeypointRecorder] disabled after error:', e);
    this.failed = true;
  }
}

export default KeypointRecorder;
