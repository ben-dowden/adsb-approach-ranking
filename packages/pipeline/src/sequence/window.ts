/**
 * Rolling window generation for sequence analysis
 */

import type { ArrivalRankRow } from "./types.js";
import {
  DEFAULT_WINDOW_SIZE_MIN,
  DEFAULT_WINDOW_STEP_MIN,
  MIN_WINDOW_COHORT_SIZE,
} from "./types.js";

/** A rolling time window with arrival rank data */
export interface RollingWindow {
  windowId: string;
  startTs: Date;
  endTs: Date;
  arrivals: ArrivalRankRow[];
  arrivalIds: string[];
}

/**
 * Generate overlapping rolling windows from arrival rank data
 *
 * @param ranks - Arrival ranks sorted by cross_ts_utc
 * @param windowSizeMin - Window size in minutes (default 30)
 * @param windowStepMin - Step between windows in minutes (default 5)
 * @returns Array of rolling windows, each containing >= MIN_WINDOW_COHORT_SIZE unique aircraft
 */
export function generateRollingWindows(
  ranks: ArrivalRankRow[],
  windowSizeMin: number = DEFAULT_WINDOW_SIZE_MIN,
  windowStepMin: number = DEFAULT_WINDOW_STEP_MIN
): RollingWindow[] {
  if (ranks.length === 0) return [];

  const windows: RollingWindow[] = [];
  const windowSizeMs = windowSizeMin * 60 * 1000;
  const windowStepMs = windowStepMin * 60 * 1000;

  // Find the time range
  const minTs = ranks[0]!.crossTsUtc.getTime();
  const maxTs = ranks[ranks.length - 1]!.crossTsUtc.getTime();

  // Generate windows starting from the first event
  let windowStart = minTs;

  while (windowStart <= maxTs) {
    const windowEnd = windowStart + windowSizeMs;

    // Filter arrivals where cross_ts_utc falls within [start, end)
    const windowArrivals = ranks.filter((r) => {
      const ts = r.crossTsUtc.getTime();
      return ts >= windowStart && ts < windowEnd;
    });

    // Get unique aircraft in this window
    const uniqueArrivalIds = [...new Set(windowArrivals.map((r) => r.arrivalId))];

    // Only include windows with >= MIN_WINDOW_COHORT_SIZE unique aircraft
    if (uniqueArrivalIds.length >= MIN_WINDOW_COHORT_SIZE) {
      // Window ID: epoch seconds of start time
      const windowId = String(Math.floor(windowStart / 1000));

      windows.push({
        windowId,
        startTs: new Date(windowStart),
        endTs: new Date(windowEnd),
        arrivals: windowArrivals,
        arrivalIds: uniqueArrivalIds,
      });
    }

    windowStart += windowStepMs;
  }

  return windows;
}
