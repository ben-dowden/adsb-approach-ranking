/**
 * Type definitions for the sequence windowing and scoring pipeline step
 */

/** CLI arguments for sequence script */
export interface SequenceArgs {
  airport: string;
  date: string;
}

/** Arrival sequence metrics for a time window */
export interface ArrivalSequence {
  sequenceId: string;
  airportIcao: string;
  windowStartTs: Date;
  windowEndTs: Date;
  rankVolatility: number;
  inversionCount: number;
  avgInnerDensity: number;
  sequenceScore: number;
  aircraftCount: number;
  arrivalIds: string[];
}

/** Metrics computed for a single window (before z-score normalization) */
export interface WindowMetrics {
  windowId: string;
  windowStartTs: Date;
  windowEndTs: Date;
  rankVolatility: number;
  inversionCount: number;
  avgInnerDensity: number;
  aircraftCount: number;
  arrivalIds: string[];
}

/** Arrival rank row from database */
export interface ArrivalRankRow {
  arrivalId: string;
  icaoHex: string;
  ringNm: number;
  crossTsUtc: Date;
  rankDistance: number;
  deltaRankDistance: number | null;
  cohortSize: number;
}

/** Default rolling window size in minutes */
export const DEFAULT_WINDOW_SIZE_MIN = 30;

/** Default rolling window step in minutes */
export const DEFAULT_WINDOW_STEP_MIN = 5;

/** Inner ring threshold for density calculation (nm) */
export const INNER_RING_THRESHOLD_NM = 15;

/** Minimum number of unique aircraft required for a valid window */
export const MIN_WINDOW_COHORT_SIZE = 3;
