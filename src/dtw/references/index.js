// ---------------------------------------------
// dtw/references/index.js
// Auto-discovers all *.ref.json files in this folder using webpack's require.context.
// Drop a .ref.json file here and rebuild — it will be auto-loaded at startup.
//
// ─── FOR THE BACKEND DEVELOPER ────────────────────────────────────────────────
// The .ref.json files in this folder are the canonical schema examples.
// They should be stored in the database and served via REST API so the client
// can fetch them at runtime without bundling them into the webpack build.
//
// DB TABLE: exercise_references
// ─────────────────────────────
//   CREATE TABLE exercise_references (
//     id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
//     exercise_name VARCHAR(255) NOT NULL UNIQUE,  -- e.g. "Left Side Arm Raise"
//     side          VARCHAR(16),                   -- 'left' | 'right' | 'both' | 'alternating'
//     mode          VARCHAR(16),                   -- 'rep' | 'time'
//     detector      VARCHAR(32),                   -- 'movenet' | 'mediapipe'
//     version       INTEGER NOT NULL DEFAULT 1,    -- increment this to bust client localStorage cache
//     ref_json      JSONB NOT NULL,                -- full .ref.json object (see schema below)
//     created_at    TIMESTAMPTZ DEFAULT now(),
//     updated_at    TIMESTAMPTZ DEFAULT now()
//   );
//
// ref_json SCHEMA (see "Left Side Arm Raise.ref.json" for a full worked example):
//   {
//     "name": "Left Side Arm Raise",    // must match exercise_name column
//     "side": "left",
//     "mode": "rep",
//     "detector": "movenet",
//     "version": 1,                     // must match version column (used for cache busting)
//     "template": [ /* 60 frames */ ],  // each frame: { frame, features: {...}, phase }
//     "featureRanges": { ... },         // per-feature { min, max, range }
//     "repCycle": { "start": "lowered", "effort": "raised", "return": "lowered" },
//     "feedback": { "phase": {}, "form": [], "range": {}, "tempo": {} },
//     "timing": { "fps": 15, "repDurationMs": 11000, "dwellMs": 100, "refractoryMs": 300 }
//   }
//
// ENDPOINTS REQUIRED:
//   GET  /{tenant}.rehabranger.ai/exercise-service/references/:exerciseName
//        → 200 { version: number, ref: { ...ref_json } }
//        → 404 if no video-extracted ref has been published yet (client falls back to synthetic)
//
//   POST /{tenant}.rehabranger.ai/exercise-service/references
//        Body: { ...ref_json }
//        → 201 { version: number, name: string }
//        → 400 if schema validation fails
//        Note: if exercise_name already exists, increment version and update ref_json.
//
// CLIENT CACHING:
//   The client caches fetched refs in localStorage (key: dtw_ref_v1_<exerciseName>, TTL 7 days).
//   To force all clients to re-fetch after an update, increment the `version` field.
//   The client compares cached version vs API version and re-fetches if stale.
// ──────────────────────────────────────────────────────────────────────────────
// ---------------------------------------------

/**
 * Load all .ref.json files from this directory.
 * @returns {Array<Object>} Array of parsed reference JSON objects
 */
export function loadRefJsonFiles() {
  try {
    const ctx = require.context('./', false, /\.ref\.json$/);
    return ctx.keys().map(key => {
      try {
        return ctx(key);
      } catch (e) {
        console.warn(`[References] Failed to load ${key}:`, e.message);
        return null;
      }
    }).filter(Boolean);
  } catch (e) {
    // require.context not available (e.g. test environment)
    console.warn('[References] require.context not available:', e.message);
    return [];
  }
}
