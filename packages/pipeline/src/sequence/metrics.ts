/**
 * Metrics computation for sequence analysis
 *
 * Computes rank volatility, inversion count, and average inner density
 */

import type { ArrivalRankRow, WindowMetrics } from "./types.js";
import { INNER_RING_THRESHOLD_NM } from "./types.js";
import type { RollingWindow } from "./window.js";

/**
 * Compute rank volatility for a window
 *
 * rank_volatility = Σ |delta_rank_distance| for all arrivals in window
 *
 * @param arrivals - Arrival rank rows for the window
 * @returns Sum of absolute delta_rank_distance values
 */
export function computeRankVolatility(arrivals: ArrivalRankRow[]): number {
  let volatility = 0;

  for (const arrival of arrivals) {
    if (arrival.deltaRankDistance !== null) {
      volatility += Math.abs(arrival.deltaRankDistance);
    }
  }

  return volatility;
}

/**
 * Compute inversion count for a window
 *
 * An inversion occurs when aircraft A is ranked ahead of B at an outer ring,
 * but B is ranked ahead of A at an inner ring.
 *
 * Algorithm:
 * 1. Group arrivals by arrival_id, build trajectory: Map<arrivalId, Map<ringNm, rankDistance>>
 * 2. For each pair of arrivals sharing 2+ rings
 * 3. Compare order at consecutive rings (outer vs inner)
 * 4. Count flips: if (rankA < rankB at outer) && (rankA > rankB at inner) → inversion
 *
 * @param arrivals - Arrival rank rows for the window
 * @returns Count of pairwise inversions
 */
export function computeInversionCount(arrivals: ArrivalRankRow[]): number {
  // Build trajectory map: arrivalId -> Map<ringNm, rankDistance>
  const trajectories = new Map<string, Map<number, number>>();

  for (const arrival of arrivals) {
    if (!trajectories.has(arrival.arrivalId)) {
      trajectories.set(arrival.arrivalId, new Map());
    }
    trajectories.get(arrival.arrivalId)!.set(arrival.ringNm, arrival.rankDistance);
  }

  // Get unique arrival IDs
  const arrivalIds = [...trajectories.keys()];

  let inversionCount = 0;

  // Check all pairs of arrivals
  for (let i = 0; i < arrivalIds.length; i++) {
    for (let j = i + 1; j < arrivalIds.length; j++) {
      const idA = arrivalIds[i]!;
      const idB = arrivalIds[j]!;

      const trajA = trajectories.get(idA)!;
      const trajB = trajectories.get(idB)!;

      // Find shared rings (both aircraft crossed)
      const sharedRings = [...trajA.keys()]
        .filter((ring) => trajB.has(ring))
        .sort((a, b) => b - a); // Sort descending (outer to inner)

      // Need at least 2 shared rings to detect inversions
      if (sharedRings.length < 2) continue;

      // Check consecutive ring pairs for inversions
      for (let k = 0; k < sharedRings.length - 1; k++) {
        const outerRing = sharedRings[k]!;
        const innerRing = sharedRings[k + 1]!;

        const rankAOuter = trajA.get(outerRing)!;
        const rankBOuter = trajB.get(outerRing)!;
        const rankAInner = trajA.get(innerRing)!;
        const rankBInner = trajB.get(innerRing)!;

        // Inversion: A ahead at outer, but B ahead at inner
        if (rankAOuter < rankBOuter && rankAInner > rankBInner) {
          inversionCount++;
        }
        // Inversion: B ahead at outer, but A ahead at inner
        else if (rankBOuter < rankAOuter && rankBInner > rankAInner) {
          inversionCount++;
        }
      }
    }
  }

  return inversionCount;
}

/**
 * Compute average inner density for a window
 *
 * avg_inner_density = AVG(cohort_size) for rings ≤ INNER_RING_THRESHOLD_NM (15nm)
 *
 * @param arrivals - Arrival rank rows for the window
 * @returns Average cohort size for inner rings, or 0 if no inner ring crossings
 */
export function computeAvgInnerDensity(arrivals: ArrivalRankRow[]): number {
  const innerRingArrivals = arrivals.filter(
    (a) => a.ringNm <= INNER_RING_THRESHOLD_NM
  );

  if (innerRingArrivals.length === 0) return 0;

  const totalCohortSize = innerRingArrivals.reduce(
    (sum, a) => sum + a.cohortSize,
    0
  );

  return totalCohortSize / innerRingArrivals.length;
}

/**
 * Compute all metrics for a rolling window
 *
 * @param window - The rolling window to process
 * @returns WindowMetrics with all computed values
 */
export function computeWindowMetrics(window: RollingWindow): WindowMetrics {
  return {
    windowId: window.windowId,
    windowStartTs: window.startTs,
    windowEndTs: window.endTs,
    rankVolatility: computeRankVolatility(window.arrivals),
    inversionCount: computeInversionCount(window.arrivals),
    avgInnerDensity: computeAvgInnerDensity(window.arrivals),
    aircraftCount: window.arrivalIds.length,
    arrivalIds: window.arrivalIds,
  };
}
