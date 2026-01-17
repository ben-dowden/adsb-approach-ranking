/**
 * Trajectory delta computation across rings
 *
 * Computes rank changes as aircraft progress through rings
 * from outer (50nm) to inner (4nm).
 */

import type { ArrivalRank, CohortMember, ComputedRank } from "./types.js";

/** Intermediate rank data grouped by arrival */
interface RankEntry {
  arrivalId: string;
  icaoHex: string;
  ringNm: number;
  crossTsUtc: Date;
  rankDistance: number;
  rankTtg: number;
  cohortSize: number;
}

/**
 * Compute trajectories with deltas for all arrivals
 *
 * Groups ranks by arrivalId, orders by ring descending (outer→inner),
 * assigns ring_order_index, and computes deltas from previous ring.
 *
 * @param cohorts Map of cohort key to cohort members
 * @param ranks Map of "arrivalId:ringNm" to computed ranks
 * @returns Array of ArrivalRank with deltas and ring order indices
 */
export function computeTrajectories(
  cohorts: Map<string, CohortMember[]>,
  ranks: Map<string, ComputedRank>
): ArrivalRank[] {
  // Build a flat list of rank entries with cohort info
  const entries: RankEntry[] = [];

  for (const [_, members] of cohorts) {
    const cohortSize = members.length;

    for (const member of members) {
      const key = `${member.arrivalId}:${member.ringNm}`;
      const computedRank = ranks.get(key);

      // Skip if no rank was computed (cohort too small)
      if (!computedRank) continue;

      entries.push({
        arrivalId: member.arrivalId,
        icaoHex: member.icaoHex,
        ringNm: member.ringNm,
        crossTsUtc: member.crossTsUtc,
        rankDistance: computedRank.rankDistance,
        rankTtg: computedRank.rankTtg,
        cohortSize,
      });
    }
  }

  // Group by arrivalId
  const byArrival = new Map<string, RankEntry[]>();
  for (const entry of entries) {
    const existing = byArrival.get(entry.arrivalId);
    if (existing) {
      existing.push(entry);
    } else {
      byArrival.set(entry.arrivalId, [entry]);
    }
  }

  // Process each arrival to compute deltas
  const results: ArrivalRank[] = [];

  for (const [arrivalId, arrivalEntries] of byArrival) {
    // Sort by ring descending (outer to inner: 50, 40, 30...)
    arrivalEntries.sort((a, b) => b.ringNm - a.ringNm);

    let previousEntry: RankEntry | null = null;

    for (let i = 0; i < arrivalEntries.length; i++) {
      const entry = arrivalEntries[i]!;

      // Compute deltas (null for first ring)
      let deltaRankDistance: number | null = null;
      let deltaRankTtg: number | null = null;

      if (previousEntry !== null) {
        // Delta = current - previous (positive = moved back in queue)
        deltaRankDistance = entry.rankDistance - previousEntry.rankDistance;
        deltaRankTtg = entry.rankTtg - previousEntry.rankTtg;
      }

      results.push({
        arrivalId: entry.arrivalId,
        airportIcao: "", // Will be filled by caller
        icaoHex: entry.icaoHex,
        ringNm: entry.ringNm,
        crossTsUtc: entry.crossTsUtc,
        rankDistance: entry.rankDistance,
        rankTtg: entry.rankTtg,
        deltaRankDistance,
        deltaRankTtg,
        cohortSize: entry.cohortSize,
        ringOrderIndex: i, // 0 = outermost ring crossed
      });

      previousEntry = entry;
    }
  }

  // Sort final results by timestamp for consistent ordering
  results.sort((a, b) => {
    const tsDiff = a.crossTsUtc.getTime() - b.crossTsUtc.getTime();
    if (tsDiff !== 0) return tsDiff;
    const icaoDiff = a.icaoHex.localeCompare(b.icaoHex);
    if (icaoDiff !== 0) return icaoDiff;
    return b.ringNm - a.ringNm;
  });

  return results;
}
