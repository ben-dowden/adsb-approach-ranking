/**
 * Distance filtering utilities
 */

import { haversineDistanceNm } from "@adsb/shared";

/**
 * Compute distance in nautical miles between a point and an airport
 */
export function computeDistanceNm(
  lat: number,
  lon: number,
  airportLat: number,
  airportLon: number
): number {
  return haversineDistanceNm(lat, lon, airportLat, airportLon);
}

/**
 * Check if a point is within a given radius of an airport
 */
export function isWithinRadius(
  lat: number,
  lon: number,
  airportLat: number,
  airportLon: number,
  radiusNm: number
): boolean {
  const distance = computeDistanceNm(lat, lon, airportLat, airportLon);
  return distance <= radiusNm;
}
