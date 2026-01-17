/**
 * Track construction from aircraft_states table
 */

import type { DuckDBConnection, DuckDBTimestampValue } from "@duckdb/node-api";
import type { Track, TrackState } from "./types.js";

/**
 * Convert DuckDB timestamp to JavaScript Date
 */
function timestampToDate(value: DuckDBTimestampValue): Date {
  // DuckDB timestamps are in microseconds
  const micros = value.micros;
  // Handle both BigInt and number types
  if (typeof micros === "bigint") {
    return new Date(Number(micros / 1000n));
  }
  return new Date(Number(micros) / 1000);
}

/**
 * Load all tracks for a given airport and date from aircraft_states
 * @returns Map of ICAO to Track (states ordered by timestamp)
 */
export async function loadTracks(
  connection: DuckDBConnection,
  airportIcao: string,
  date: string
): Promise<Map<string, Track>> {
  const tracks = new Map<string, Track>();

  const result = await connection.run(`
    SELECT
      ts,
      icao,
      callsign,
      lat,
      lon,
      alt_baro,
      gs,
      track,
      distance_nm
    FROM aircraft_states
    WHERE airport_icao = '${airportIcao}'
      AND DATE(ts) = '${date}'
    ORDER BY icao, ts
  `);

  // Use chunk-based iteration for reliable reading
  while (true) {
    const chunk = await result.fetchChunk();
    if (chunk.rowCount === 0) break;

    const rows = chunk.getRows();
    for (const row of rows) {
      const tsValue = row[0] as DuckDBTimestampValue;
      const ts = timestampToDate(tsValue);
      const icao = row[1] as string;
      const callsign = row[2] as string | null;
      const lat = Number(row[3]);
      const lon = Number(row[4]);
      const altBaro = row[5] as number | null;
      const gs = row[6] as number | null;
      const track = row[7] as number | null;
      const distanceNm = Number(row[8]);

      const state: TrackState = {
        ts,
        icao,
        callsign,
        lat,
        lon,
        altBaro: altBaro !== null ? Number(altBaro) : null,
        gs: gs !== null ? Number(gs) : null,
        track: track !== null ? Number(track) : null,
        distanceNm,
      };

      let existingTrack = tracks.get(icao);
      if (!existingTrack) {
        existingTrack = { icao, states: [] };
        tracks.set(icao, existingTrack);
      }
      existingTrack.states.push(state);
    }
  }

  return tracks;
}

/**
 * Get list of available airports in aircraft_states
 */
export async function listAvailableAirports(
  connection: DuckDBConnection
): Promise<string[]> {
  const result = await connection.run(`
    SELECT DISTINCT airport_icao FROM aircraft_states ORDER BY airport_icao
  `);

  const airports: string[] = [];
  while (true) {
    const chunk = await result.fetchChunk();
    if (chunk.rowCount === 0) break;
    const rows = chunk.getRows();
    for (const row of rows) {
      airports.push(row[0] as string);
    }
  }
  return airports;
}

/**
 * Check if aircraft_states has data for given airport and date
 */
export async function hasStatesData(
  connection: DuckDBConnection,
  airportIcao: string,
  date: string
): Promise<boolean> {
  const reader = await connection.runAndReadAll(`
    SELECT COUNT(*) as cnt FROM aircraft_states
    WHERE airport_icao = '${airportIcao}'
      AND DATE(ts) = '${date}'
    LIMIT 1
  `);

  if (reader.currentRowCount === 0) return false;
  const count = Number(reader.value(0, 0) ?? 0);
  return count > 0;
}
