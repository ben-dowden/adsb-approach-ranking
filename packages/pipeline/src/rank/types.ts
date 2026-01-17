/**
 * Type definitions for the ranking pipeline step
 */

/** CLI arguments for score script */
export interface RankArgs {
  airport: string;
  date: string;
}

/** Arrival rank at a specific ring crossing */
export interface ArrivalRank {
  arrivalId: string;
  airportIcao: string;
  icaoHex: string;
  ringNm: number;
  crossTsUtc: Date;
  rankDistance: number;      // Dense 1..N
  rankTtg: number;           // Dense 1..N
  deltaRankDistance: number | null;
  deltaRankTtg: number | null;
  cohortSize: number;
  ringOrderIndex: number;    // 0=outermost, increasing inward
}

/** Member of a cohort at a ring crossing */
export interface CohortMember {
  arrivalId: string;
  icaoHex: string;
  ringNm: number;
  crossTsUtc: Date;
  distanceNm: number;
  closingRate: number;
}

/** Computed rank for a single cohort member */
export interface ComputedRank {
  arrivalId: string;
  rankDistance: number;
  rankTtg: number;
}

/** Small constant to avoid division by zero when computing TTG */
export const TTG_EPSILON = 0.001;

/** Minimum cohort size to compute ranks */
export const MIN_COHORT_SIZE = 2;

/** Temporal window for cohort matching (seconds) */
export const COHORT_WINDOW_SEC = 30;
