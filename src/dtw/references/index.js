// ---------------------------------------------
// dtw/references/index.js
// Auto-discovers all *.ref.json files in this folder using webpack's require.context.
// Drop a .ref.json file here and rebuild — it will be auto-loaded at startup.
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
