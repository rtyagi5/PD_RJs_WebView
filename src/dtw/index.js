// ---------------------------------------------
// dtw/index.js — barrel export for DTW module
// ---------------------------------------------
export { computeUniversalFeatures, UNIVERSAL_FEATURE_KEYS, BODY_PART_FEATURE_MAP } from './universalFeatures.js';
export { OnlineSubsequenceDTW, featureDistance, fullDTW } from './dtwEngine.js';
export { DTWPhaseMachine } from './DTWPhaseMachine.js';
export { validateReference, computeFeatureRanges, extractPhaseOrder, SAMPLE_REFERENCE } from './referenceSchema.js';
export { registerReference, getReference, hasReference, loadReference, loadReferences, listReferences } from './referenceRegistry.js';
export { extractFeaturesFromVideo, detectRepBoundaries, buildTemplateFromReps, getTopFeatures } from './videoFeatureExtractor.js';
export { generateReference, generateAllReferences, EXERCISE_CONFIGS } from './specToReference.js';
export { bootstrapAllReferences } from './bootstrapReferences.js';
export { validateExercise, validateAllExercises, generateSyntheticSequence } from './validateDTW.js';
export { PatientBaseline } from './PatientBaseline.js';
