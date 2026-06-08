// ---------------------------------------------
// dtw/referenceStorage.js
// localStorage cache for API-fetched DTW references.
// Mirrors the PatientBaseline persistence pattern.
//
// Cache key format: dtw_ref_v1_<exerciseName>
// TTL: 7 days — stale entries are evicted on read.
// Use clearCachedReference() to force a re-fetch after publishing a new version.
// ---------------------------------------------

const PREFIX = 'dtw_ref_v1_';
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Retrieve a cached reference from localStorage.
 * Returns null if not found, expired, or corrupted.
 *
 * @param {string} exerciseName - e.g. "StandingMarch"
 * @returns {{ ref: Object, version: number } | null}
 */
export function getCachedReference(exerciseName) {
  try {
    const raw = localStorage.getItem(`${PREFIX}${exerciseName}`);
    if (!raw) return null;
    const { ref, version, cachedAt } = JSON.parse(raw);
    if (Date.now() - cachedAt > TTL_MS) {
      localStorage.removeItem(`${PREFIX}${exerciseName}`);
      return null;
    }
    return { ref, version };
  } catch {
    return null;
  }
}

/**
 * Persist a reference to localStorage.
 * Silently fails if localStorage is unavailable (private browsing, quota exceeded).
 *
 * @param {string} exerciseName - e.g. "StandingMarch"
 * @param {Object} ref - Full reference JSON object
 * @param {number} version - Version number from API (used for cache busting)
 */
export function cacheReference(exerciseName, ref, version) {
  try {
    localStorage.setItem(`${PREFIX}${exerciseName}`, JSON.stringify({
      ref,
      version,
      cachedAt: Date.now(),
    }));
  } catch (e) {
    console.warn('[ReferenceStorage] localStorage save failed:', e);
  }
}

/**
 * Remove a cached reference, forcing a re-fetch on next session.
 * Call this after publishing a new version to the platform.
 *
 * @param {string} exerciseName - e.g. "StandingMarch"
 */
export function clearCachedReference(exerciseName) {
  localStorage.removeItem(`${PREFIX}${exerciseName}`);
}
