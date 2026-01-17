/**
 * Ring crossing detection logic
 */

import type { Track, TrackState, InterpolatedCrossing } from "./types.js";
import { DEFAULT_GAP_THRESHOLD_SEC } from "./types.js";
import { interpolateCrossing } from "./interpolate.js";

/**
 * Check if a transition represents an inward ring crossing
 * @param prevDistance Distance at previous state
 * @param currDistance Distance at current state
 * @param ringNm Ring distance threshold
 * @returns true if aircraft crossed inward through the ring
 */
export function isInwardCrossing(
  prevDistance: number,
  currDistance: number,
  ringNm: number
): boolean {
  return prevDistance > ringNm && currDistance <= ringNm;
}

/**
 * Check if aircraft is descending during a transition
 * Uses vrt (vertical rate) if available, otherwise computes from altitude change
 * @param prev Previous state
 * @param curr Current state
 * @returns true if aircraft is descending (or descent cannot be determined)
 */
export function isDescending(prev: TrackState, curr: TrackState): boolean {
  // Check vrt (vertical rate) - negative means descending
  if (curr.vrt !== null && curr.vrt < 0) {
    return true;
  }
  if (prev.vrt !== null && prev.vrt < 0) {
    return true;
  }

  // Fallback: compute from altitude change
  if (prev.altBaro !== null && curr.altBaro !== null) {
    return curr.altBaro < prev.altBaro;
  }

  // Cannot determine - allow the crossing (be permissive)
  return true;
}

/**
 * Detect all ring crossings for a track
 * Includes jitter protection (each ring crossed at most once)
 * Processes rings from outermost to innermost
 *
 * @param track Aircraft track with ordered states
 * @param rings Ring distances to detect (will be sorted descending)
 * @param gapThresholdSec Maximum gap between states to consider a valid transition
 * @returns Array of interpolated crossing events
 */
export function detectCrossings(
  track: Track,
  rings: number[],
  gapThresholdSec: number = DEFAULT_GAP_THRESHOLD_SEC
): InterpolatedCrossing[] {
  const results: InterpolatedCrossing[] = [];
  const { states } = track;

  if (states.length < 2) {
    return results;
  }

  // Sort rings descending (outermost first)
  const sortedRings = [...rings].sort((a, b) => b - a);

  // Track which rings have been crossed (jitter protection)
  const crossedRings = new Set<number>();

  for (let i = 1; i < states.length; i++) {
    const prev = states[i - 1]!;
    const curr = states[i]!;

    // Calculate time gap
    const gapSec = (curr.ts.getTime() - prev.ts.getTime()) / 1000;

    // Skip if gap is too large
    if (gapSec > gapThresholdSec) {
      continue;
    }

    // Check each ring (outermost to innermost)
    for (const ring of sortedRings) {
      // Jitter protection: skip if already crossed
      if (crossedRings.has(ring)) {
        continue;
      }

      // Check for inward crossing with descent
      if (isInwardCrossing(prev.distanceNm, curr.distanceNm, ring) && isDescending(prev, curr)) {
        const crossing = interpolateCrossing(prev, curr, ring);
        results.push(crossing);
        crossedRings.add(ring);
      }
    }
  }

  return results;
}

/**
 * Detect crossings for multiple tracks
 * @param tracks Map of ICAO to Track
 * @param rings Ring distances to detect
 * @param gapThresholdSec Maximum gap between states
 * @returns Array of all interpolated crossing events
 */
export function detectAllCrossings(
  tracks: Map<string, Track>,
  rings: number[],
  gapThresholdSec: number = DEFAULT_GAP_THRESHOLD_SEC
): InterpolatedCrossing[] {
  const allCrossings: InterpolatedCrossing[] = [];

  for (const track of tracks.values()) {
    const crossings = detectCrossings(track, rings, gapThresholdSec);
    allCrossings.push(...crossings);
  }

  return allCrossings;
}
