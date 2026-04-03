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

let _initialized = false;

/**
 * Generate synthetic references for all 16 exercises and register them,
 * then load any .ref.json files from the references/ folder (overrides synthetic).
 * Safe to call multiple times — only runs once.
 * @returns {number} Number of references registered
 */
export function bootstrapAllReferences() {
  if (_initialized) return 0;
  _initialized = true;

  // 1. Register synthetic references
  const refs = generateAllReferences();
  let syntheticCount = 0;

  for (const [name, ref] of Object.entries(refs)) {
    const result = registerReference(name, ref);
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
    const result = registerReference(ref.name, ref);
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
