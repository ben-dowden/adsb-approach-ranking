/**
 * JSON parsing and aircraft field extraction
 */

import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import type {
  RawReadsbFile,
  RawAircraft,
  NormalizedState,
  Airport,
} from "./types.js";
import { computeDistanceNm, isWithinRadius } from "./filter.js";

/**
 * Parse a gzipped JSON file
 */
export async function parseGzipJson(filePath: string): Promise<RawReadsbFile> {
  const chunks: Buffer[] = [];

  await pipeline(createReadStream(filePath), createGunzip(), async function* (
    source
  ) {
    for await (const chunk of source) {
      chunks.push(chunk as Buffer);
    }
  });

  const content = Buffer.concat(chunks).toString("utf-8");
  return JSON.parse(content) as RawReadsbFile;
}

/**
 * Extract and normalize aircraft fields from raw data
 * Returns null if required fields are missing
 */
export function extractAircraftFields(
  raw: RawAircraft,
  ts: Date,
  airport: Airport
): NormalizedState | null {
  // Skip if missing required fields
  if (!raw.hex || raw.lat === undefined || raw.lon === undefined) {
    return null;
  }

  // Compute distance from airport
  const distance_nm = computeDistanceNm(
    raw.lat,
    raw.lon,
    airport.lat,
    airport.lon
  );

  // Handle alt_baro: "ground" -> null
  const alt_baro =
    raw.alt_baro === "ground" || raw.alt_baro === undefined
      ? null
      : raw.alt_baro;

  // Prefer baro_rate over geom_rate for vertical rate
  const vrt = raw.baro_rate ?? raw.geom_rate ?? null;

  // Trim callsign whitespace
  const callsign = raw.flight?.trim() || null;

  return {
    ts,
    icao: raw.hex.toUpperCase(),
    callsign,
    lat: raw.lat,
    lon: raw.lon,
    alt_baro,
    gs: raw.gs ?? null,
    track: raw.track ?? null,
    vrt,
    distance_nm,
    airport_icao: airport.icao,
  };
}

/**
 * Process a raw readsb file, filter by radius, return normalized states
 */
export function processRawFile(
  rawFile: RawReadsbFile,
  airport: Airport,
  radiusNm: number
): NormalizedState[] {
  const ts = new Date(rawFile.now * 1000);
  const states: NormalizedState[] = [];

  for (const aircraft of rawFile.aircraft) {
    // Skip if missing position
    if (aircraft.lat === undefined || aircraft.lon === undefined) {
      continue;
    }

    // Check radius filter
    if (
      !isWithinRadius(
        aircraft.lat,
        aircraft.lon,
        airport.lat,
        airport.lon,
        radiusNm
      )
    ) {
      continue;
    }

    const state = extractAircraftFields(aircraft, ts, airport);
    if (state) {
      states.push(state);
    }
  }

  return states;
}
