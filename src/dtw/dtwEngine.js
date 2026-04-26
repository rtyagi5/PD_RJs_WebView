// ---------------------------------------------
// dtw/dtwEngine.js
// Online Subsequence DTW for real-time exercise matching.
// Matches a live stream of feature vectors against a reference template.
// ---------------------------------------------

/**
 * Compute weighted Euclidean distance between two feature vectors.
 * Only compares features that are finite in BOTH vectors.
 * Angles are weighted higher than normalized positions (more reliable from pose detection).
 *
 * @param {Object} a - Feature vector { key: value }
 * @param {Object} b - Feature vector { key: value }
 * @param {Object} featureRanges - { key: { min, max, range } } for normalization
 * @param {Object} [weights] - Optional per-feature weights
 * @returns {number} distance (0 = identical, higher = more different)
 */
export function featureDistance(a, b, featureRanges, weights, side) {
  let sumSq = 0;
  let count = 0;
  const fin = Number.isFinite;

  for (const key of Object.keys(b)) {
    // Side-aware filtering
    if (side === 'alternating') {
      // Alternating exercises: skip per-side L/R features; compare only bilateral
      // aggregates (Min/Max/Avg) so whichever leg is active drives the match.
      if (key.endsWith('L') || key.endsWith('R')) continue;
    } else if (side) {
      // Single-side exercise: skip opposite side AND aggregates (polluted by inactive side)
      if (side === 'left' && key.endsWith('R')) continue;
      if (side === 'right' && key.endsWith('L')) continue;
      if (key.endsWith('Min') || key.endsWith('Max') || key.endsWith('Avg')) continue;
    }

    const va = a[key];
    const vb = b[key];
    if (!fin(va) || !fin(vb)) continue;

    // Normalize by feature range so all features contribute equally.
    // Floor of 10 prevents static features (range≈0) from dominating the distance.
    const range = featureRanges?.[key]?.range;
    const norm = Math.max(range || 0, 10);
    const w = weights?.[key] ?? 1;

    const diff = (va - vb) / norm;
    sumSq += w * diff * diff;
    count++;
  }

  return count > 0 ? Math.sqrt(sumSq / count) : Infinity;
}

/**
 * OnlineSubsequenceDTW — streaming DTW that finds repeating matches
 * of a template pattern within a continuous live stream.
 *
 * Based on the Spring/SDTW algorithm:
 * - Maintains a rolling cost matrix (1 row = current frame vs all template frames)
 * - When cost at the last template frame drops below threshold → match found (rep)
 * - Tracks the best-aligned position in the template → current phase
 *
 * Key properties:
 * - Handles variable movement speeds (DTW's core strength)
 * - O(T) per frame where T = template length (~60 frames = trivial)
 * - No window constraint needed for short templates
 */
export class OnlineSubsequenceDTW {
  /**
   * @param {Object} config
   * @param {Array} config.template - Array of { features: {...}, phase: string }
   * @param {Object} config.featureRanges - { key: { min, max, range } }
   * @param {number} [config.matchThreshold=0.5] - Max normalized distance for a rep match
   * @param {number} [config.refractoryFrames=15] - Min frames between rep detections
   * @param {Object} [config.weights] - Optional per-feature weights
   */
  constructor({ template, featureRanges, matchThreshold = 0.5, refractoryFrames = 15, weights, side }) {
    this.template = template;
    this.T = template.length;
    this.featureRanges = featureRanges;
    this.matchThreshold = matchThreshold;
    this.refractoryFrames = refractoryFrames;
    this.weights = weights || null;
    this.side = side || null; // 'left', 'right', or null (both)

    // DTW cost row: cost[j] = best alignment cost ending at template frame j
    // We only need the previous row and current row (space optimization)
    this.prevRow = new Float64Array(this.T).fill(Infinity);
    this.currRow = new Float64Array(this.T).fill(Infinity);

    // Track the best alignment position and its cost
    this.bestTemplateIdx = 0;    // which template frame we're best aligned to
    this.bestCost = Infinity;
    this.framesSinceMatch = this.refractoryFrames; // start ready

    // Per-feature deviation tracking (for feedback)
    this.lastDeviations = {};

    // Running state
    this.frameCount = 0;
  }

  /**
   * Process one new frame from the live stream.
   *
   * @param {Object} liveFeatures - Universal feature vector for current frame
   * @returns {{
   *   phase: string,          - Current phase (from template alignment)
   *   templatePosition: number, - 0..1 progress through template cycle
   *   matchCost: number,      - How well current frame matches aligned template frame
   *   cycleComplete: boolean, - True if a full cycle (rep) was just detected
   *   deviations: Object,     - Per-feature deviation from reference
   *   quality: number,        - 0..1 quality score (1 = perfect match)
   * }}
   */
  step(liveFeatures) {
    this.frameCount++;
    this.framesSinceMatch++;

    // Compute distance from live frame to every template frame
    const distances = new Float64Array(this.T);
    for (let j = 0; j < this.T; j++) {
      distances[j] = featureDistance(
        liveFeatures,
        this.template[j].features,
        this.featureRanges,
        this.weights,
        this.side
      );
    }

    // Update DTW cost matrix (one new row)
    // Subsequence DTW: cost[0] can start fresh from any live frame
    // cost[j] = distance[j] + min(prevRow[j], prevRow[j-1], currRow[j-1])
    for (let j = 0; j < this.T; j++) {
      if (j === 0) {
        // Can start a new alignment from any live frame
        this.currRow[j] = distances[j];
      } else {
        // Standard DTW recurrence:
        // - prevRow[j]   = insertion (live frame skipped in template)
        // - prevRow[j-1] = match (both advance)
        // - currRow[j-1] = deletion (template frame skipped)
        const insertion = this.prevRow[j];
        const match     = this.prevRow[j - 1];
        const deletion  = this.currRow[j - 1];
        this.currRow[j] = distances[j] + Math.min(insertion, match, deletion);
      }
    }

    // Phase detection: use RAW distances (nearest-neighbor) to find which
    // template frame the user most resembles RIGHT NOW.
    // This avoids the accumulated-cost bias that makes bestIdx stick to position 0.
    let nnIdx = 0;
    let nnDist = distances[0];
    for (let j = 1; j < this.T; j++) {
      if (distances[j] < nnDist) {
        nnDist = distances[j];
        nnIdx = j;
      }
    }

    this.bestTemplateIdx = nnIdx;
    this.bestCost = nnDist;

    // Cycle detection: still uses accumulated DTW cost at end of template
    // (correct for detecting when a full template traversal has occurred)
    const endCost = this.currRow[this.T - 1] / this.T; // normalize by template length
    const cycleComplete = (
      endCost < this.matchThreshold &&
      this.framesSinceMatch >= this.refractoryFrames
    );

    if (cycleComplete) {
      this.framesSinceMatch = 0;
      // Reset the DTW matrix to allow detecting the next rep cleanly
      this.prevRow.fill(Infinity);
      this.currRow.fill(Infinity);
    }

    // Compute per-feature deviations for feedback (against nearest-neighbor frame)
    const alignedFrame = this.template[nnIdx];
    const deviations = {};
    for (const [key, refVal] of Object.entries(alignedFrame.features)) {
      const liveVal = liveFeatures[key];
      if (Number.isFinite(refVal) && Number.isFinite(liveVal)) {
        // Use same floor as distance calculation so static features (range≈0) don't
        // produce inflated normalizedDelta values and trigger false form warnings.
        const range = Math.max(this.featureRanges?.[key]?.range || 0, 10);
        deviations[key] = {
          live: liveVal,
          reference: refVal,
          delta: liveVal - refVal,
          normalizedDelta: (liveVal - refVal) / range,
        };
      }
    }
    this.lastDeviations = deviations;

    // Quality: 1 = perfect, 0 = terrible. Based on distance to nearest frame.
    const alignedDist = nnDist;
    const quality = Math.max(0, Math.min(1, 1 - alignedDist));

    // Swap rows for next iteration
    const tmp = this.prevRow;
    this.prevRow = this.currRow;
    this.currRow = tmp;
    this.currRow.fill(Infinity);

    return {
      phase: alignedFrame.phase,
      templatePosition: nnIdx / (this.T - 1),  // 0..1
      matchCost: alignedDist,
      cycleComplete,
      deviations,
      quality,
    };
  }

  /**
   * Reset the DTW state (e.g., on exercise restart).
   */
  reset() {
    this.prevRow.fill(Infinity);
    this.currRow.fill(Infinity);
    this.bestTemplateIdx = 0;
    this.bestCost = Infinity;
    this.framesSinceMatch = this.refractoryFrames;
    this.lastDeviations = {};
    this.frameCount = 0;
  }
}

/**
 * Offline DTW: compute full DTW alignment between two sequences.
 * Used for quality scoring after a rep is complete, and for
 * reference extraction (aligning multiple reps to find the average).
 *
 * @param {Array} seq1 - Array of feature objects
 * @param {Array} seq2 - Array of feature objects
 * @param {Object} featureRanges - For normalization
 * @returns {{ cost: number, path: Array<[number, number]> }}
 */
export function fullDTW(seq1, seq2, featureRanges) {
  const N = seq1.length;
  const M = seq2.length;

  // Cost matrix
  const cost = Array.from({ length: N }, () => new Float64Array(M).fill(Infinity));

  // Fill first cell
  cost[0][0] = featureDistance(seq1[0], seq2[0], featureRanges);

  // Fill first row
  for (let j = 1; j < M; j++) {
    cost[0][j] = cost[0][j - 1] + featureDistance(seq1[0], seq2[j], featureRanges);
  }

  // Fill first column
  for (let i = 1; i < N; i++) {
    cost[i][0] = cost[i - 1][0] + featureDistance(seq1[i], seq2[0], featureRanges);
  }

  // Fill rest
  for (let i = 1; i < N; i++) {
    for (let j = 1; j < M; j++) {
      const d = featureDistance(seq1[i], seq2[j], featureRanges);
      cost[i][j] = d + Math.min(cost[i - 1][j], cost[i - 1][j - 1], cost[i][j - 1]);
    }
  }

  // Backtrack to find optimal path
  const path = [];
  let i = N - 1, j = M - 1;
  path.push([i, j]);
  while (i > 0 || j > 0) {
    if (i === 0) { j--; }
    else if (j === 0) { i--; }
    else {
      const candidates = [
        { cost: cost[i - 1][j - 1], i: i - 1, j: j - 1 },
        { cost: cost[i - 1][j],     i: i - 1, j: j },
        { cost: cost[i][j - 1],     i: i,     j: j - 1 },
      ];
      const best = candidates.reduce((a, b) => a.cost <= b.cost ? a : b);
      i = best.i;
      j = best.j;
    }
    path.push([i, j]);
  }
  path.reverse();

  return {
    cost: cost[N - 1][M - 1] / path.length, // normalized by path length
    path,
  };
}
