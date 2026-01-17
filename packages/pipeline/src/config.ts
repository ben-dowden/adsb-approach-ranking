import "dotenv/config";

import {
  DEFAULT_COHORT_WINDOW_SEC,
  DEFAULT_RING_DISTANCES,
  type PipelineConfig,
} from "@adsb/shared";

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export function loadConfig(): PipelineConfig {
  return {
    airportIcao: required("AIRPORT_ICAO"),
    airportLat: parseFloat(required("AIRPORT_LAT")),
    airportLon: parseFloat(required("AIRPORT_LON")),
    maxDistanceNm: parseFloat(optional("MAX_DISTANCE_NM", "50")),
    maxAltitudeFt: parseInt(optional("MAX_ALTITUDE_FT", "15000"), 10),
    ringDistances: JSON.parse(
      optional("RING_DISTANCES", JSON.stringify([...DEFAULT_RING_DISTANCES]))
    ) as number[],
    cohortWindowSec: parseInt(
      optional("COHORT_WINDOW_SEC", String(DEFAULT_COHORT_WINDOW_SEC)),
      10
    ),
  };
}
