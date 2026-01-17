/**
 * Rank computation for cohorts
 *
 * Computes dense ranks (1, 2, 3...) for distance and time-to-go (TTG)
 * within each cohort, using ICAO hex as a deterministic tie-breaker.
 */

import type { CohortMember, ComputedRank } from "./types.js";
import { TTG_EPSILON, MIN_COHORT_SIZE } from "./types.js";

/** Internal type for sorting with computed TTG */
interface RankableItem {
  member: CohortMember;
  ttg: number;
}

/**
 * Compute time-to-go estimate in minutes
 *
 * TTG = distance / |closing_rate|
 * where closing_rate is in NM/min (negative means approaching)
 *
 * @param distanceNm Distance in nautical miles
 * @param closingRate Rate of closure in NM/min (negative = approaching)
 * @returns Estimated time to arrival in minutes
 */
export function computeTtg(distanceNm: number, closingRate: number): number {
  // Use absolute value of closing rate (we want positive TTG)
  // Closing rate is typically negative for approaching aircraft
  const absRate = Math.max(Math.abs(closingRate), TTG_EPSILON);
  return distanceNm / absRate;
}

/**
 * Compute dense ranks for a cohort
 *
 * Dense ranking means no gaps: 1, 2, 3, 4... even with ties.
 * Ties are broken deterministically by ICAO hex (alphabetical order).
 *
 * Returns empty map if cohort size < MIN_COHORT_SIZE.
 *
 * @param cohort List of cohort members
 * @returns Map of arrivalId to computed ranks
 */
export function computeRanks(cohort: CohortMember[]): Map<string, ComputedRank> {
  const result = new Map<string, ComputedRank>();

  // Skip cohorts that are too small
  if (cohort.length < MIN_COHORT_SIZE) {
    return result;
  }

  // Prepare items with computed TTG
  const items: RankableItem[] = cohort.map((member) => ({
    member,
    ttg: computeTtg(member.distanceNm, member.closingRate),
  }));

  // Compute distance ranks
  const distanceRanks = computeDenseRanks(items, (a, b) => {
    // Sort by distance ascending (closer = better rank)
    const distDiff = a.member.distanceNm - b.member.distanceNm;
    if (distDiff !== 0) return distDiff;
    // Tie-break by ICAO (alphabetical)
    return a.member.icaoHex.localeCompare(b.member.icaoHex);
  });

  // Compute TTG ranks
  const ttgRanks = computeDenseRanks(items, (a, b) => {
    // Sort by TTG ascending (lower TTG = arrives sooner = better rank)
    const ttgDiff = a.ttg - b.ttg;
    if (ttgDiff !== 0) return ttgDiff;
    // Tie-break by ICAO (alphabetical)
    return a.member.icaoHex.localeCompare(b.member.icaoHex);
  });

  // Build result map
  for (const item of items) {
    result.set(item.member.arrivalId, {
      arrivalId: item.member.arrivalId,
      rankDistance: distanceRanks.get(item.member.arrivalId)!,
      rankTtg: ttgRanks.get(item.member.arrivalId)!,
    });
  }

  return result;
}

/**
 * Compute dense ranks for items using a comparison function
 *
 * Dense ranking: 1, 2, 3, 4... with no gaps
 * Items with same sort value get different ranks due to tie-breaker
 *
 * @param items Items to rank
 * @param compareFn Comparison function (negative = a before b)
 * @returns Map of arrivalId to rank (1-indexed)
 */
function computeDenseRanks(
  items: RankableItem[],
  compareFn: (a: RankableItem, b: RankableItem) => number
): Map<string, number> {
  const ranks = new Map<string, number>();

  // Sort items
  const sorted = [...items].sort(compareFn);

  // Assign dense ranks (1-indexed)
  sorted.forEach((item, index) => {
    ranks.set(item.member.arrivalId, index + 1);
  });

  return ranks;
}

/**
 * Batch compute ranks for all cohorts
 *
 * @param cohorts Map of cohort key to cohort members
 * @returns Map of arrivalId to computed rank (per ring)
 */
export function computeAllRanks(
  cohorts: Map<string, CohortMember[]>
): Map<string, ComputedRank> {
  const allRanks = new Map<string, ComputedRank>();

  for (const [_, cohort] of cohorts) {
    const cohortRanks = computeRanks(cohort);
    for (const [arrivalId, rank] of cohortRanks) {
      // Key includes ring info from the cohort member
      const member = cohort.find((m) => m.arrivalId === arrivalId)!;
      const key = `${arrivalId}:${member.ringNm}`;
      allRanks.set(key, rank);
    }
  }

  return allRanks;
}
