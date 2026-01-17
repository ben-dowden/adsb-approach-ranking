/**
 * Linear interpolation for ring crossing estimation
 */

import { closingRate } from "@adsb/shared";
import type { TrackState, InterpolatedCrossing } from "./types.js";

/**
 * Linear interpolation helper
 */
function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

/**
 * Interpolate the exact crossing point between two states
 * @param prev State before crossing the ring
 * @param curr State after crossing the ring
 * @param ringNm Ring distance being crossed
 * @returns Interpolated crossing with estimated values
 */
export function interpolateCrossing(
  prev: TrackState,
  curr: TrackState,
  ringNm: number
): InterpolatedCrossing {
  // Calculate interpolation factor
  // t = how far along from prev to curr did we cross the ring
  const t = (prev.distanceNm - ringNm) / (prev.distanceNm - curr.distanceNm);

  // Interpolate timestamp
  const prevMs = prev.ts.getTime();
  const currMs = curr.ts.getTime();
  const crossMs = lerp(prevMs, currMs, t);
  const crossTs = new Date(crossMs);

  // Interpolate position
  const lat = lerp(prev.lat, curr.lat, t);
  const lon = lerp(prev.lon, curr.lon, t);

  // Interpolate altitude (if both have values)
  let altBaro: number | null = null;
  if (prev.altBaro !== null && curr.altBaro !== null) {
    altBaro = Math.round(lerp(prev.altBaro, curr.altBaro, t));
  } else if (curr.altBaro !== null) {
    altBaro = curr.altBaro;
  } else if (prev.altBaro !== null) {
    altBaro = prev.altBaro;
  }

  // Interpolate ground speed (if both have values)
  let gs: number | null = null;
  if (prev.gs !== null && curr.gs !== null) {
    gs = lerp(prev.gs, curr.gs, t);
  } else if (curr.gs !== null) {
    gs = curr.gs;
  } else if (prev.gs !== null) {
    gs = prev.gs;
  }

  // Interpolate track (if both have values)
  let track: number | null = null;
  if (prev.track !== null && curr.track !== null) {
    // Handle track angle wraparound (e.g., 350° to 10°)
    let diff = curr.track - prev.track;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    track = (prev.track + t * diff + 360) % 360;
  } else if (curr.track !== null) {
    track = curr.track;
  } else if (prev.track !== null) {
    track = prev.track;
  }

  // Calculate closing rate
  const timeDeltaSec = (currMs - prevMs) / 1000;
  const rate = closingRate(prev.distanceNm, curr.distanceNm, timeDeltaSec);

  return {
    icao: curr.icao,
    callsign: curr.callsign ?? prev.callsign,
    ringNm,
    crossTs,
    lat,
    lon,
    altBaro,
    gs,
    track,
    closingRate: rate,
    distanceNm: ringNm, // At crossing, distance ≈ ring distance
  };
}
