# Graph Report - d:/Posedetection_ReactJS_WebView  (2026-04-26)

## Corpus Check
- Corpus is ~45,884 words - fits in a single context window. You may not need a graph.

## Summary
- 241 nodes · 261 edges · 33 communities detected
- Extraction: 89% EXTRACTED · 11% INFERRED · 0% AMBIGUOUS · INFERRED: 30 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Feature Computation|Feature Computation]]
- [[_COMMUNITY_Patient Baseline & Rep Classify|Patient Baseline & Rep Classify]]
- [[_COMMUNITY_Reference Bootstrap|Reference Bootstrap]]
- [[_COMMUNITY_Reference Cache & Service|Reference Cache & Service]]
- [[_COMMUNITY_Core Architecture Concepts|Core Architecture Concepts]]
- [[_COMMUNITY_Video Feature Extraction|Video Feature Extraction]]
- [[_COMMUNITY_Canvas Coaching UI|Canvas Coaching UI]]
- [[_COMMUNITY_Exercise Tracker Loop|Exercise Tracker Loop]]
- [[_COMMUNITY_DTW PhaseMachine|DTW PhaseMachine]]
- [[_COMMUNITY_DTW Engine (OnlineFull)|DTW Engine (Online/Full)]]
- [[_COMMUNITY_Hand-coded PhaseMachine|Hand-coded PhaseMachine]]
- [[_COMMUNITY_Session State Machine|Session State Machine]]
- [[_COMMUNITY_DTW Validation|DTW Validation]]
- [[_COMMUNITY_Service Worker|Service Worker]]
- [[_COMMUNITY_Pose Detectors|Pose Detectors]]
- [[_COMMUNITY_App Entry Point|App Entry Point]]
- [[_COMMUNITY_Confidence Threshold Design|Confidence Threshold Design]]
- [[_COMMUNITY_Performance Design Rationale|Performance Design Rationale]]
- [[_COMMUNITY_MoveNet Detector|MoveNet Detector]]
- [[_COMMUNITY_MediaPipe Detector|MediaPipe Detector]]
- [[_COMMUNITY_TensorFlow.js|TensorFlow.js]]
- [[_COMMUNITY_Jest Testing|Jest Testing]]
- [[_COMMUNITY_DTW Algorithm|DTW Algorithm]]
- [[_COMMUNITY_Stroke Rehab Domain|Stroke Rehab Domain]]
- [[_COMMUNITY_Synthetic References|Synthetic References]]
- [[_COMMUNITY_WebView JWT Auth|WebView JWT Auth]]
- [[_COMMUNITY_CRA Documentation|CRA Documentation]]
- [[_COMMUNITY_React Logo 192|React Logo 192]]
- [[_COMMUNITY_React Brand Color (192)|React Brand Color (192)]]
- [[_COMMUNITY_React Logo 512|React Logo 512]]
- [[_COMMUNITY_React Brand Color (512)|React Brand Color (512)]]
- [[_COMMUNITY_React SVG Logo|React SVG Logo]]
- [[_COMMUNITY_React SVG Brand Color|React SVG Brand Color]]

## God Nodes (most connected - your core abstractions)
1. `PatientBaseline` - 19 edges
2. `DTWPhaseMachine` - 12 edges
3. `React SPA (WebView)` - 7 edges
4. `runAllChecks()` - 6 edges
5. `SessionStateMachine` - 6 edges
6. `registerReference()` - 6 edges
7. `withUnmirroredText()` - 5 edges
8. `EMA` - 5 edges
9. `kp()` - 5 edges
10. `computeCommonFeatures()` - 5 edges

## Surprising Connections (you probably didn't know these)
- `computeFeaturesForExercise()` --calls--> `computeCommonFeatures()`  [INFERRED]
  D:\Posedetection_ReactJS_WebView\src\ExerciseTracker_refactored.js → D:\Posedetection_ReactJS_WebView\src\features.js
- `computeUniversalFeaturesFromPoses()` --calls--> `computeUniversalFeatures()`  [INFERRED]
  D:\Posedetection_ReactJS_WebView\src\ExerciseTracker_refactored.js → D:\Posedetection_ReactJS_WebView\src\dtw\universalFeatures.js
- `computeUniversalFeatures()` --calls--> `kp()`  [INFERRED]
  D:\Posedetection_ReactJS_WebView\src\dtw\universalFeatures.js → D:\Posedetection_ReactJS_WebView\src\features.js
- `fetchAndCacheReference()` --calls--> `getCachedReference()`  [INFERRED]
  D:\Posedetection_ReactJS_WebView\src\dtw\bootstrapReferences.js → D:\Posedetection_ReactJS_WebView\src\dtw\referenceStorage.js
- `fetchAndCacheReference()` --calls--> `registerReference()`  [INFERRED]
  D:\Posedetection_ReactJS_WebView\src\dtw\bootstrapReferences.js → D:\Posedetection_ReactJS_WebView\src\dtw\referenceRegistry.js

## Hyperedges (group relationships)
- **DTW Engine Core Components** — claudemd_online_subsequence_dtw, claudemd_dtw_phase_machine, claudemd_synthetic_reference, claudemd_rep_gate [EXTRACTED 1.00]
- **Session Lifecycle** — claudemd_session_state_machine, claudemd_canvas_renderer, claudemd_postmessage_bridge [EXTRACTED 1.00]

## Communities

### Community 0 - "Feature Computation"
Cohesion: 0.14
Nodes (12): computeFeaturesForExercise(), angle(), computeCommonFeatures(), EMA, kp(), present(), checkCameraAngle(), checkDistance() (+4 more)

### Community 1 - "Patient Baseline & Rep Classify"
Cohesion: 0.14
Nodes (1): PatientBaseline

### Community 2 - "Reference Bootstrap"
Cohesion: 0.12
Nodes (10): bootstrapAllReferences(), loadRefJsonFiles(), loadReference(), registerReference(), computeFeatureRanges(), extractPhaseOrder(), validateReference(), generateAllReferences() (+2 more)

### Community 3 - "Reference Cache & Service"
Cohesion: 0.15
Nodes (8): fetchAndCacheReference(), getServiceUrl(), cacheReference(), getCachedReference(), drawCanvas(), drawKeypoints(), drawSkeleton(), sendUpdates()

### Community 4 - "Core Architecture Concepts"
Cohesion: 0.15
Nodes (14): Canvas Renderer, DTW PhaseMachine (Level 3), EMA Feature Smoothing, Exercise Engine, Hand-coded PhaseMachine (Level 1), Host App (mobile/web), mirrorFeatures (alternating L/R expansion), Rationale: No Cloud Inference (+6 more)

### Community 5 - "Video Feature Extraction"
Cohesion: 0.24
Nodes (9): detectRepBoundaries(), _detectRepsForFeature(), emaSmooth(), extractFeaturesFromVideo(), findLocalMax(), findLocalMin(), findPeaksAndValleys(), getTopFeatures() (+1 more)

### Community 6 - "Canvas Coaching UI"
Cohesion: 0.29
Nodes (8): drawCoachingMessages(), drawCornerBrackets(), drawCountdown(), drawInactiveOverlay(), drawLoadingOverlay(), drawTargetBox(), hexToRGBA(), withUnmirroredText()

### Community 7 - "Exercise Tracker Loop"
Cohesion: 0.2
Nodes (3): computeUniversalFeaturesFromPoses(), avgFinite(), computeUniversalFeatures()

### Community 8 - "DTW PhaseMachine"
Cohesion: 0.33
Nodes (1): DTWPhaseMachine

### Community 9 - "DTW Engine (Online/Full)"
Cohesion: 0.32
Nodes (3): featureDistance(), fullDTW(), OnlineSubsequenceDTW

### Community 10 - "Hand-coded PhaseMachine"
Cohesion: 0.38
Nodes (3): evalBool(), normalizeSpec(), PhaseMachine

### Community 11 - "Session State Machine"
Cohesion: 0.38
Nodes (1): SessionStateMachine

### Community 12 - "DTW Validation"
Cohesion: 0.67
Nodes (5): getReference(), generateSyntheticSequence(), runDTWOnSequence(), validateAllExercises(), validateExercise()

### Community 13 - "Service Worker"
Cohesion: 0.5
Nodes (2): register(), registerValidSW()

### Community 16 - "Pose Detectors"
Cohesion: 0.83
Nodes (3): createMediaPipePose(), createMoveNet(), createPoseDetector()

### Community 17 - "App Entry Point"
Cohesion: 1.0
Nodes (2): App(), useQuery()

### Community 24 - "Confidence Threshold Design"
Cohesion: 1.0
Nodes (2): Rationale: Low confidence threshold for stroke patients, MIN_CONFIDENCE = 0.3

### Community 25 - "Performance Design Rationale"
Cohesion: 1.0
Nodes (2): Rationale: No Redux (30-60fps perf loop), React 18 (Create React App)

### Community 45 - "MoveNet Detector"
Cohesion: 1.0
Nodes (1): MoveNet SinglePose Lightning

### Community 46 - "MediaPipe Detector"
Cohesion: 1.0
Nodes (1): MediaPipe Pose Landmarker

### Community 47 - "TensorFlow.js"
Cohesion: 1.0
Nodes (1): TensorFlow.js

### Community 48 - "Jest Testing"
Cohesion: 1.0
Nodes (1): Jest + React Testing Library

### Community 49 - "DTW Algorithm"
Cohesion: 1.0
Nodes (1): Online Subsequence DTW Algorithm

### Community 50 - "Stroke Rehab Domain"
Cohesion: 1.0
Nodes (1): Stroke Rehabilitation Domain

### Community 51 - "Synthetic References"
Cohesion: 1.0
Nodes (1): Synthetic 60-frame Reference Template

### Community 52 - "WebView JWT Auth"
Cohesion: 1.0
Nodes (1): JWT Token (inbound WebView params)

### Community 53 - "CRA Documentation"
Cohesion: 1.0
Nodes (1): README.md (Create React App)

### Community 54 - "React Logo 192"
Cohesion: 1.0
Nodes (1): React Logo (192px)

### Community 55 - "React Brand Color (192)"
Cohesion: 1.0
Nodes (1): Cyan/Aqua Brand Color (#61DAFB)

### Community 56 - "React Logo 512"
Cohesion: 1.0
Nodes (1): React Logo (512px)

### Community 57 - "React Brand Color (512)"
Cohesion: 1.0
Nodes (1): Cyan/Sky Blue Brand Color (#61DAFB)

### Community 58 - "React SVG Logo"
Cohesion: 1.0
Nodes (1): React Logo (SVG)

### Community 59 - "React SVG Brand Color"
Cohesion: 1.0
Nodes (1): React Brand Color (#61DAFB)

## Knowledge Gaps
- **27 isolated node(s):** `MoveNet SinglePose Lightning`, `MediaPipe Pose Landmarker`, `Hand-coded PhaseMachine (Level 1)`, `Patient Baseline`, `Session State Machine` (+22 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Patient Baseline & Rep Classify`** (22 nodes): `._classifyRep()`, `.saveBaseline()`, `PatientBaseline`, `._analyzeRep()`, `.checkSafety()`, `.constructor()`, `.getAdaptedRanges()`, `.getProgress()`, `.getSessionSummary()`, `._loadFromStorage()`, `._lockBaseline()`, `.normalize()`, `.normalizeAll()`, `.onRepDetected()`, `.resetBaseline()`, `._resetRepBuffer()`, `.saveToStorage()`, `._storageKey()`, `._updateCalibration()`, `.updateFrame()`, `._updateRepBuffer()`, `PatientBaseline.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `DTW PhaseMachine`** (9 nodes): `DTWPhaseMachine`, `._alternatingSideOk()`, `._detectOvershoot()`, `.getProgress()`, `.getSessionSummary()`, `._pickFeedback()`, `._primaryFeatureNearStart()`, `.step()`, `DTWPhaseMachine.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Session State Machine`** (7 nodes): `SessionStateMachine`, `.constructor()`, `._primaryCoachingMessage()`, `.reset()`, `._result()`, `.step()`, `SessionStateMachine.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Service Worker`** (5 nodes): `checkValidServiceWorker()`, `register()`, `registerValidSW()`, `unregister()`, `serviceWorker.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `App Entry Point`** (3 nodes): `App()`, `useQuery()`, `App.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Confidence Threshold Design`** (2 nodes): `Rationale: Low confidence threshold for stroke patients`, `MIN_CONFIDENCE = 0.3`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Performance Design Rationale`** (2 nodes): `Rationale: No Redux (30-60fps perf loop)`, `React 18 (Create React App)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `MoveNet Detector`** (1 nodes): `MoveNet SinglePose Lightning`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `MediaPipe Detector`** (1 nodes): `MediaPipe Pose Landmarker`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `TensorFlow.js`** (1 nodes): `TensorFlow.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Jest Testing`** (1 nodes): `Jest + React Testing Library`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `DTW Algorithm`** (1 nodes): `Online Subsequence DTW Algorithm`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Stroke Rehab Domain`** (1 nodes): `Stroke Rehabilitation Domain`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Synthetic References`** (1 nodes): `Synthetic 60-frame Reference Template`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `WebView JWT Auth`** (1 nodes): `JWT Token (inbound WebView params)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `CRA Documentation`** (1 nodes): `README.md (Create React App)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `React Logo 192`** (1 nodes): `React Logo (192px)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `React Brand Color (192)`** (1 nodes): `Cyan/Aqua Brand Color (#61DAFB)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `React Logo 512`** (1 nodes): `React Logo (512px)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `React Brand Color (512)`** (1 nodes): `Cyan/Sky Blue Brand Color (#61DAFB)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `React SVG Logo`** (1 nodes): `React Logo (SVG)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `React SVG Brand Color`** (1 nodes): `React Brand Color (#61DAFB)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `DTWPhaseMachine` connect `DTW PhaseMachine` to `DTW Engine (Online/Full)`, `Reference Bootstrap`, `Patient Baseline & Rep Classify`?**
  _High betweenness centrality (0.057) - this node is a cross-community bridge._
- **Why does `registerReference()` connect `Reference Bootstrap` to `Reference Cache & Service`?**
  _High betweenness centrality (0.049) - this node is a cross-community bridge._
- **What connects `MoveNet SinglePose Lightning`, `MediaPipe Pose Landmarker`, `Hand-coded PhaseMachine (Level 1)` to the rest of the system?**
  _27 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Feature Computation` be split into smaller, more focused modules?**
  _Cohesion score 0.14 - nodes in this community are weakly interconnected._
- **Should `Patient Baseline & Rep Classify` be split into smaller, more focused modules?**
  _Cohesion score 0.14 - nodes in this community are weakly interconnected._
- **Should `Reference Bootstrap` be split into smaller, more focused modules?**
  _Cohesion score 0.12 - nodes in this community are weakly interconnected._