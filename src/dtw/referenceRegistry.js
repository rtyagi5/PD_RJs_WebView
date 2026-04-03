// ---------------------------------------------
// dtw/referenceRegistry.js
// Loads and caches reference JSON files for exercises.
// If a reference exists → DTWPhaseMachine is used.
// If not → falls back to hand-coded spec + PhaseMachine.
// ---------------------------------------------
import { validateReference, computeFeatureRanges } from './referenceSchema.js';

// Cache of loaded references: { exerciseName: referenceObject }
const _cache = {};

/**
 * Register a reference object for an exercise.
 * Validates and auto-computes featureRanges if missing.
 * @param {string} name - Exercise name (must match registry key, e.g. 'BicepCurls')
 * @param {Object} reference - Reference JSON object
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function registerReference(name, reference) {
  // Auto-compute feature ranges if not provided
  if (!reference.featureRanges && Array.isArray(reference.template)) {
    reference.featureRanges = computeFeatureRanges(reference.template);
  }

  const result = validateReference(reference);
  if (result.valid) {
    _cache[name] = reference;
  } else {
    console.warn(`[ReferenceRegistry] Invalid reference for "${name}":`, result.errors);
  }
  return result;
}

/**
 * Get a registered reference by exercise name.
 * @param {string} name - Exercise name
 * @returns {Object|null} reference object or null if not registered
 */
export function getReference(name) {
  return _cache[name] || null;
}

/**
 * Check if a DTW reference exists for an exercise.
 * @param {string} name - Exercise name
 * @returns {boolean}
 */
export function hasReference(name) {
  return name in _cache;
}

/**
 * Get all registered exercise names.
 * @returns {string[]}
 */
export function listReferences() {
  return Object.keys(_cache);
}

/**
 * Remove a reference (for testing/hot-reload).
 * @param {string} name
 */
export function unregisterReference(name) {
  delete _cache[name];
}

/**
 * Load a reference from a JSON object (e.g., fetched from server or imported).
 * Convenience wrapper around registerReference.
 * @param {Object} json - Reference JSON with at least a "name" field
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function loadReference(json) {
  if (!json?.name) return { valid: false, errors: ['Missing "name" in reference JSON'] };
  return registerReference(json.name, json);
}

/**
 * Bulk-load multiple references.
 * @param {Array<Object>} refs - Array of reference JSON objects
 * @returns {Array<{ name: string, valid: boolean, errors: string[] }>}
 */
export function loadReferences(refs) {
  return refs.map(r => ({ name: r?.name, ...loadReference(r) }));
}
