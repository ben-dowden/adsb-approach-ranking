/**
 * Z-score normalization and sequence scoring
 */

import type { ArrivalSequence, WindowMetrics } from "./types.js";

/**
 * Compute mean of an array of numbers
 */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Compute standard deviation of an array of numbers
 */
function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const squaredDiffs = values.map((v) => (v - m) ** 2);
  return Math.sqrt(squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length);
}

/**
 * Z-score normalize an array of values
 *
 * z = (value - mean) / stddev
 * If stddev = 0, all z-scores = 0
 *
 * @param values - Array of values to normalize
 * @returns Array of z-scores in same order as input
 */
export function zScoreNormalize(values: number[]): number[] {
  const m = mean(values);
  const sd = stddev(values);

  if (sd === 0) {
    return values.map(() => 0);
  }

  return values.map((v) => (v - m) / sd);
}

/**
 * Compute sequence scores from window metrics
 *
 * sequence_score = z(rank_volatility) + z(inversions) + z(avg_inner_density)
 *
 * @param metrics - Array of window metrics
 * @param airportIcao - Airport ICAO code
 * @returns Array of arrival sequences with computed scores
 */
export function computeSequenceScores(
  metrics: WindowMetrics[],
  airportIcao: string
): ArrivalSequence[] {
  if (metrics.length === 0) return [];

  // Extract metric arrays
  const volatilities = metrics.map((m) => m.rankVolatility);
  const inversions = metrics.map((m) => m.inversionCount);
  const densities = metrics.map((m) => m.avgInnerDensity);

  // Z-score normalize each metric
  const zVolatilities = zScoreNormalize(volatilities);
  const zInversions = zScoreNormalize(inversions);
  const zDensities = zScoreNormalize(densities);

  // Combine into sequence scores
  return metrics.map((m, i) => {
    const sequenceScore = zVolatilities[i]! + zInversions[i]! + zDensities[i]!;

    return {
      sequenceId: `${airportIcao}_${m.windowId}`,
      airportIcao,
      windowStartTs: m.windowStartTs,
      windowEndTs: m.windowEndTs,
      rankVolatility: m.rankVolatility,
      inversionCount: m.inversionCount,
      avgInnerDensity: m.avgInnerDensity,
      sequenceScore,
      aircraftCount: m.aircraftCount,
      arrivalIds: m.arrivalIds,
    };
  });
}
