/**
 * Geographic utility functions
 */

const EARTH_RADIUS_NM = 3440.065;

/** Convert degrees to radians */
export function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Convert radians to degrees */
export function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

/**
 * Calculate distance between two points using haversine formula
 * @returns Distance in nautical miles
 */
export function haversineDistanceNm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_NM * c;
}

/**
 * Calculate closing rate between two distance measurements
 * @returns Rate in NM/min (negative = approaching)
 */
export function closingRate(
  distanceNm1: number,
  distanceNm2: number,
  timeDeltaSec: number
): number {
  if (timeDeltaSec <= 0) return 0;
  const timeDeltaMin = timeDeltaSec / 60;
  return (distanceNm2 - distanceNm1) / timeDeltaMin;
}

/**
 * Estimate time-to-go based on distance and closing rate
 * @returns Time in minutes (null if not closing)
 */
export function estimateTtgMin(
  distanceNm: number,
  closingRateNmPerMin: number
): number | null {
  if (closingRateNmPerMin >= 0) return null;
  return distanceNm / Math.abs(closingRateNmPerMin);
}
