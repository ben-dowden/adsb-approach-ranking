/**
 * SQL query functions for the Replay API
 */

import type { DuckDBTimestampValue } from "@duckdb/node-api";

import { getConnection } from "./connection";

/** Sequence summary for list endpoint */
export interface SequenceSummary {
  sequenceId: string;
  windowStartTs: string;
  windowEndTs: string;
  sequenceScore: number;
  rankVolatility: number;
  inversionCount: number;
  avgInnerDensity: number;
  aircraftCount: number;
}

/** Sequence detail with arrival_ids */
export interface SequenceDetail extends SequenceSummary {
  airportIcao: string;
  arrivalIds: string[];
}

/** Aircraft state at a timestamp */
export interface AircraftStateAtTimestamp {
  icao: string;
  callsign: string | null;
  lat: number;
  lon: number;
  altBaro: number | null;
  gs: number | null;
  track: number | null;
  distanceNm: number;
  ringNm: number | null;
  rankDistance: number | null;
  cohortSize: number | null;
}

/**
 * Convert DuckDB timestamp to ISO string
 */
function timestampToIso(value: DuckDBTimestampValue): string {
  const micros = value.micros;
  const ms =
    typeof micros === "bigint" ? Number(micros / 1000n) : Number(micros) / 1000;
  return new Date(ms).toISOString();
}

/**
 * Get top sequences for an airport on a given date
 */
export async function getSequences(
  airport: string,
  date: string,
  limit: number
): Promise<SequenceSummary[]> {
  const connection = await getConnection();
  const sequences: SequenceSummary[] = [];

  const result = await connection.run(`
    SELECT
      sequence_id,
      window_start_ts,
      window_end_ts,
      sequence_score,
      rank_volatility,
      inversion_count,
      avg_inner_density,
      aircraft_count
    FROM arrival_sequences
    WHERE airport_icao = '${airport}'
      AND DATE(window_start_ts) = '${date}'
    ORDER BY sequence_score DESC
    LIMIT ${limit}
  `);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const chunk = await result.fetchChunk();
    if (!chunk || chunk.rowCount === 0) break;
    const rows = chunk.getRows();
    for (const row of rows) {
      sequences.push({
        sequenceId: row[0] as string,
        windowStartTs: timestampToIso(row[1] as DuckDBTimestampValue),
        windowEndTs: timestampToIso(row[2] as DuckDBTimestampValue),
        sequenceScore: Number(row[3]),
        rankVolatility: Number(row[4]),
        inversionCount: Number(row[5]),
        avgInnerDensity: Number(row[6]),
        aircraftCount: Number(row[7]),
      });
    }
  }

  return sequences;
}

/**
 * Get a single sequence by ID with its arrival_ids
 */
export async function getSequenceById(
  id: string
): Promise<SequenceDetail | null> {
  const connection = await getConnection();

  const reader = await connection.runAndReadAll(`
    SELECT
      sequence_id,
      airport_icao,
      window_start_ts,
      window_end_ts,
      sequence_score,
      rank_volatility,
      inversion_count,
      avg_inner_density,
      aircraft_count,
      arrival_ids
    FROM arrival_sequences
    WHERE sequence_id = '${id}'
    LIMIT 1
  `);

  if (reader.currentRowCount === 0) {
    return null;
  }

  const arrivalIdsJson = reader.value(0, 9) as string;
  let arrivalIds: string[];
  try {
    arrivalIds = JSON.parse(arrivalIdsJson);
  } catch {
    arrivalIds = [];
  }

  return {
    sequenceId: reader.value(0, 0) as string,
    airportIcao: reader.value(0, 1) as string,
    windowStartTs: timestampToIso(reader.value(0, 2) as DuckDBTimestampValue),
    windowEndTs: timestampToIso(reader.value(0, 3) as DuckDBTimestampValue),
    sequenceScore: Number(reader.value(0, 4)),
    rankVolatility: Number(reader.value(0, 5)),
    inversionCount: Number(reader.value(0, 6)),
    avgInnerDensity: Number(reader.value(0, 7)),
    aircraftCount: Number(reader.value(0, 8)),
    arrivalIds,
  };
}

/**
 * Get aircraft states at a specific timestamp for a sequence
 * Uses window functions to get the latest state per aircraft at/before the timestamp
 * Joins with arrival_ranks for ring/rank info
 */
export async function getSequenceStatesAtTimestamp(
  sequenceId: string,
  timestamp: string
): Promise<AircraftStateAtTimestamp[] | null> {
  const connection = await getConnection();

  // First, get the sequence to extract arrival_ids
  const sequence = await getSequenceById(sequenceId);
  if (!sequence) {
    return null;
  }

  const arrivalIds = sequence.arrivalIds;
  if (arrivalIds.length === 0) {
    return [];
  }

  // Extract unique ICAOs from arrival_ids (format: ICAO_TIMESTAMP)
  const icaos = [...new Set(arrivalIds.map((id) => id.split("_")[0]))];
  const icaoList = icaos.map((i) => `'${i}'`).join(",");
  const arrivalIdList = arrivalIds.map((id) => `'${id}'`).join(",");

  // Query to get latest states at/before timestamp and join with arrival_ranks
  const states: AircraftStateAtTimestamp[] = [];
  const result = await connection.run(`
    WITH latest_states AS (
      SELECT
        icao,
        callsign,
        lat,
        lon,
        alt_baro,
        gs,
        track,
        distance_nm,
        ROW_NUMBER() OVER (PARTITION BY icao ORDER BY ts DESC) as rn
      FROM aircraft_states
      WHERE icao IN (${icaoList})
        AND ts <= '${timestamp}'
    ),
    recent_rings AS (
      SELECT
        icao_hex,
        ring_nm,
        rank_distance,
        cohort_size,
        ROW_NUMBER() OVER (PARTITION BY icao_hex ORDER BY cross_ts_utc DESC) as rn
      FROM arrival_ranks
      WHERE arrival_id IN (${arrivalIdList})
        AND cross_ts_utc <= '${timestamp}'
    )
    SELECT
      ls.icao,
      ls.callsign,
      ls.lat,
      ls.lon,
      ls.alt_baro,
      ls.gs,
      ls.track,
      ls.distance_nm,
      rr.ring_nm,
      rr.rank_distance,
      rr.cohort_size
    FROM latest_states ls
    LEFT JOIN recent_rings rr ON ls.icao = rr.icao_hex AND rr.rn = 1
    WHERE ls.rn = 1
    ORDER BY ls.distance_nm ASC
  `);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const chunk = await result.fetchChunk();
    if (!chunk || chunk.rowCount === 0) break;
    const rows = chunk.getRows();
    for (const row of rows) {
      states.push({
        icao: row[0] as string,
        callsign: row[1] as string | null,
        lat: Number(row[2]),
        lon: Number(row[3]),
        altBaro: row[4] !== null ? Number(row[4]) : null,
        gs: row[5] !== null ? Number(row[5]) : null,
        track: row[6] !== null ? Number(row[6]) : null,
        distanceNm: Number(row[7]),
        ringNm: row[8] !== null ? Number(row[8]) : null,
        rankDistance: row[9] !== null ? Number(row[9]) : null,
        cohortSize: row[10] !== null ? Number(row[10]) : null,
      });
    }
  }

  return states;
}
