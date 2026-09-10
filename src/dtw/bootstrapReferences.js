// ---------------------------------------------
// dtw/bootstrapReferences.js
// Auto-generates and registers all 16 exercise references on import.
// Then loads any .ref.json files from src/dtw/references/ (video-extracted).
// Video-extracted refs override synthetic ones with the same name.
// Import this module once at app startup to populate the registry.
// ---------------------------------------------
import { generateAllReferences } from './specToReference.js';
import { registerReference } from './referenceRegistry.js';
import { loadRefJsonFiles } from './references/index.js';
import { getCachedReference, cacheReference } from './referenceStorage.js';
import { getServiceUrl } from '../config.js';
import { checkPhaseSeparation } from './referenceHealth.js';

let _initialized = false;

/**
 * Generate synthetic references for all 16 exercises and register them,
 * then load any .ref.json files from the references/ folder (overrides synthetic).
 * Safe to call multiple times — only runs once.
 * @returns {number} Number of references registered
 */
// Fields a recording must NOT be able to redefine. A .ref.json replaces the
// synthetic reference wholesale, so without this any of these silently reverts
// to whatever the extractor happened to write — including safety limits.
//
// The split is: a recording supplies the SHAPE of the movement (template,
// featureRanges, phase labels, repCycle, coaching cues); EXERCISE_CONFIGS stays
// the authority on policy (which feature counts reps, what the clinical caps
// are, how the camera must be set up, which detector runs).
//
// `primaryFeatureBase` is the sharpest case. The auto-picker ranks features by
// raw range, comparing degrees against dimensionless ratios, so a recorded
// template carrying both an ankle angle and footPitchNorm would hand the foot
// exercises a new primary feature purely on magnitude.
export const CANONICAL_FIELDS = [
  'primaryFeature', 'primaryFeatureBase',
  'clinicalCaps', 'framing',
  // A recording carries no highlightKeypoints, and without it ref.highlightKeypoints
  // is undefined -> the highlight name list is empty -> the whole skeleton draws
  // "aqua". Dropping a recorded reference in therefore silently removed the green
  // limb-in-focus cue that the synthetic reference had.
  'highlightKeypoints',
  'minRomPct', 'timing',
  'detector', 'mode', 'side',
];

/** Overlay the canonical policy fields from `canonical` onto a loaded reference. */
export function applyCanonicalPolicy(ref, canonical) {
  if (!canonical) return ref;
  const merged = { ...ref };
  const overridden = [];
  for (const field of CANONICAL_FIELDS) {
    if (canonical[field] === undefined) continue;
    // Only report a real disagreement, not the absence of a field.
    if (ref[field] !== undefined && JSON.stringify(ref[field]) !== JSON.stringify(canonical[field])) {
      overridden.push(field);
    }
    merged[field] = canonical[field];
  }
  if (overridden.length) {
    console.warn(
      `[Bootstrap] "${ref.name}" — ignoring ${overridden.join(', ')} from the .ref.json; ` +
      `these come from EXERCISE_CONFIGS, not from a recording.`
    );
  }
  return merged;
}

export function bootstrapAllReferences() {
  if (_initialized) return 0;
  _initialized = true;

  // 1. Register synthetic references
  const refs = generateAllReferences();
  let syntheticCount = 0;

  for (const [name, ref] of Object.entries(refs)) {
    const result = registerReference(name, { ...ref, source: 'synthetic' });
    if (result.valid) {
      syntheticCount++;
    } else {
      console.warn(`[Bootstrap] Failed to register "${name}":`, result.errors);
    }
  }

  // 2. Load .ref.json files (video-extracted) — these override synthetic
  const fileRefs = loadRefJsonFiles();
  let fileCount = 0;

  for (const ref of fileRefs) {
    if (!ref?.name) {
      console.warn('[Bootstrap] Skipping .ref.json without "name" field');
      continue;
    }
    // A .ref.json only takes effect if its `name` is the exact key the app looks up
    // (an EXERCISE_CONFIGS key). Anything else registers under a key nothing requests,
    // so the synthetic template keeps running while the file appears to have loaded.
    if (!refs[ref.name]) {
      console.warn(
        `[Bootstrap] "${ref.name}" is not a known exercise id — this reference will ` +
        `NEVER be used. Re-export it from /reference-extractor with a canonical name ` +
        `(one of: ${Object.keys(refs).join(', ')}).`
      );
      continue;
    }
    // Shape validation cannot catch a MIS-SEGMENTED recording. The engine derives
    // refStartValue and templateDirection from the phase labels, so a reference
    // whose effort phase has swallowed the whole movement inverts the direction
    // gate: the patient moves correctly and the engine rejects it, counting
    // nothing while every log looks healthy. Keep the synthetic template instead.
    const health = checkPhaseSeparation(ref);
    if (!health.ok) {
      console.warn(
        `[Bootstrap] REJECTED video reference "${ref.name}" — ${health.reason} ` +
        `Keeping the synthetic template. Re-record and re-export from ` +
        `/reference-extractor with correct phase boundaries.`
      );
      continue;
    }

    const result = registerReference(
      ref.name,
      { ...applyCanonicalPolicy(ref, refs[ref.name]), source: 'video' }
    );
    if (result.valid) {
      fileCount++;
      console.log(`[Bootstrap] Loaded video reference: "${ref.name}" (overrides synthetic)`);
    } else {
      console.warn(`[Bootstrap] Failed to load "${ref.name}":`, result.errors);
    }
  }

  console.log(`[Bootstrap] Registered ${syntheticCount} synthetic + ${fileCount} video-extracted DTW references`);
  return syntheticCount + fileCount;
}

/**
 * Check if bootstrap has already run.
 */
export function isBootstrapped() {
  return _initialized;
}

/**
 * Fetch a video-extracted reference from the Rehab Ranger platform API.
 * Checks localStorage cache first (7-day TTL). On success, overrides the
 * synthetic reference in the registry with the real video-extracted one.
 * Falls back silently if the API is unreachable — synthetic ref remains active.
 *
 * Call this once per session from ExerciseTracker after JWT is decoded.
 *
 * @param {string} exerciseName - e.g. "StandingMarch"
 * @param {Object} activityData - decoded JWT payload (needs .tenant)
 */
export async function fetchAndCacheReference(exerciseName, activityData) {
  if (!exerciseName || !activityData?.tenant) return;

  // 1. Serve from localStorage cache if still valid (7-day TTL)
  const cached = getCachedReference(exerciseName);
  if (cached?.ref) {
    const result = registerReference(exerciseName, cached.ref);
    if (result.valid) {
      console.log(`[Bootstrap] Using cached video reference for "${exerciseName}" (v${cached.version})`);
      return;
    }
  }

  // 2. Fetch from platform API
  try {
    const { REFERENCE_SERVICE } = getServiceUrl(activityData);
    const res = await fetch(`${REFERENCE_SERVICE}/${encodeURIComponent(exerciseName)}`);
    if (!res.ok) return; // 404 → no video ref published yet; synthetic ref stays active
    const { ref, version } = await res.json();
    const result = registerReference(exerciseName, { ...ref, source: 'api' });
    if (result.valid) {
      cacheReference(exerciseName, ref, version);
      console.log(`[Bootstrap] Fetched + cached video reference for "${exerciseName}" (v${version})`);
    } else {
      console.warn(`[Bootstrap] API reference for "${exerciseName}" failed validation:`, result.errors);
    }
  } catch (e) {
    console.warn(`[Bootstrap] Could not fetch reference for "${exerciseName}":`, e.message);
  }
}
