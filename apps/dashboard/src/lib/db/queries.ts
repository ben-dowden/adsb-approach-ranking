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

  const result = await connection.run(`
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

  let sequence: SequenceDetail | null = null;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const chunk = await result.fetchChunk();
    if (!chunk || chunk.rowCount === 0) break;

    const rows = chunk.getRows();
    if (rows.length > 0) {
      const row = rows[0];

      const arrivalIdsJson = row[9] as string;
      let arrivalIds: string[];
      try {
        arrivalIds = JSON.parse(arrivalIdsJson);
      } catch {
        arrivalIds = [];
      }

      sequence = {
        sequenceId: row[0] as string,
        airportIcao: row[1] as string,
        windowStartTs: timestampToIso(row[2] as DuckDBTimestampValue),
        windowEndTs: timestampToIso(row[3] as DuckDBTimestampValue),
        sequenceScore: Number(row[4]),
        rankVolatility: Number(row[5]),
        inversionCount: Number(row[6]),
        avgInnerDensity: Number(row[7]),
        aircraftCount: Number(row[8]),
        arrivalIds,
      };
      break; // Only process first row
    }
  }

  return sequence;
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
    console.log(`[getSequenceStatesAtTimestamp] Sequence not found: ${sequenceId}`);
    return null;
  }

  const arrivalIds = sequence.arrivalIds;
  if (arrivalIds.length === 0) {
    console.log(`[getSequenceStatesAtTimestamp] No arrival_ids for sequence: ${sequenceId}`);
    return [];
  }

  const arrivalIdList = arrivalIds.map((id) => `'${id}'`).join(",");

  // arrival_ids are hashed values, not ICAO_TIMESTAMP format
  // We need to get the actual icao_hex values from arrival_ranks
  const icaoResult = await connection.run(`
    SELECT DISTINCT icao_hex FROM arrival_ranks WHERE arrival_id IN (${arrivalIdList})
  `);
  const icaos: string[] = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const chunk = await icaoResult.fetchChunk();
    if (!chunk || chunk.rowCount === 0) break;
    const rows = chunk.getRows();
    for (const row of rows) {
      icaos.push(row[0] as string);
    }
  }

  if (icaos.length === 0) {
    console.log(`[getSequenceStatesAtTimestamp] No ICAOs found in arrival_ranks for arrival_ids`);
    return [];
  }

  const icaoList = icaos.map((i) => `'${i}'`).join(",");

  console.log(`[getSequenceStatesAtTimestamp] Looking for ${icaos.length} aircraft at ${timestamp}`);
  console.log(`[getSequenceStatesAtTimestamp] Window: ${sequence.windowStartTs} to ${sequence.windowEndTs}`);

  // Add a 1-second buffer to handle edge case where timestamp equals window start exactly
  // This helps when data timestamps are slightly after the window start
  // DuckDB uses INTERVAL syntax for timestamp arithmetic
  const tsWithBuffer = `TIMESTAMP '${timestamp}' + INTERVAL '1 second'`;

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
        AND ts <= ${tsWithBuffer}
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
        AND cross_ts_utc <= ${tsWithBuffer}
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

  console.log(`[getSequenceStatesAtTimestamp] Found ${states.length} aircraft states`);
  if (states.length === 0) {
    // Additional diagnostics when no states found
    const dbStatus = await getDatabaseStatus();
    console.log(`[getSequenceStatesAtTimestamp] aircraft_states table has ${dbStatus.counts["aircraft_states"] ?? 0} rows`);
    console.log(`[getSequenceStatesAtTimestamp] arrival_ranks table has ${dbStatus.counts["arrival_ranks"] ?? 0} rows`);

    // Check if the ICAOs exist in aircraft_states at all
    const icaoCheckResult = await connection.run(`
      SELECT DISTINCT icao FROM aircraft_states WHERE icao IN (${icaoList}) LIMIT 5
    `);
    const foundIcaos: string[] = [];
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const chunk = await icaoCheckResult.fetchChunk();
      if (!chunk || chunk.rowCount === 0) break;
      const rows = chunk.getRows();
      for (const row of rows) {
        foundIcaos.push(row[0] as string);
      }
    }
    console.log(`[getSequenceStatesAtTimestamp] Looking for ICAOs: ${icaos.slice(0, 5).join(", ")}...`);
    console.log(`[getSequenceStatesAtTimestamp] Found ${foundIcaos.length} matching ICAOs in aircraft_states: ${foundIcaos.join(", ")}`);

    // Check timestamp range in aircraft_states
    const tsRangeResult = await connection.run(`
      SELECT MIN(ts) as min_ts, MAX(ts) as max_ts FROM aircraft_states
    `);
    const tsChunk = await tsRangeResult.fetchChunk();
    if (tsChunk && tsChunk.rowCount > 0) {
      const tsRows = tsChunk.getRows();
      const tsRow = tsRows[0];
      if (tsRow) {
        const minTs = tsRow[0] ? timestampToIso(tsRow[0] as DuckDBTimestampValue) : "null";
        const maxTs = tsRow[1] ? timestampToIso(tsRow[1] as DuckDBTimestampValue) : "null";
        console.log(`[getSequenceStatesAtTimestamp] aircraft_states timestamp range: ${minTs} to ${maxTs}`);
      }
    }
  }

  return states;
}

/** Trajectory point at a specific ring */
export interface TrajectoryPoint {
  ringNm: number;
  rankDistance: number;
  cohortSize: number;
  crossTsUtc: string;
}

/** Aircraft trajectory across all rings */
export interface AircraftTrajectory {
  icao: string;
  callsign: string | null;
  finalRank: number;
  cohortSize: number;
  points: TrajectoryPoint[];
}

/**
 * Get trajectory data for all aircraft in a sequence
 * Returns rank progression across distance rings
 */
export async function getSequenceTrajectories(
  sequenceId: string
): Promise<AircraftTrajectory[] | null> {
  const connection = await getConnection();

  // First, get the sequence to extract arrival_ids
  const sequence = await getSequenceById(sequenceId);
  if (!sequence) {
    console.log(`[getSequenceTrajectories] Sequence not found: ${sequenceId}`);
    return null;
  }

  const arrivalIds = sequence.arrivalIds;
  if (arrivalIds.length === 0) {
    console.log(`[getSequenceTrajectories] No arrival_ids for sequence: ${sequenceId}`);
    return [];
  }

  console.log(`[getSequenceTrajectories] Looking for trajectories with ${arrivalIds.length} arrival_ids`);
  const arrivalIdList = arrivalIds.map((id) => `'${id}'`).join(",");

  // Query all rank data for the arrivals
  const result = await connection.run(`
    SELECT
      ar.icao_hex,
      ar.ring_nm,
      ar.cross_ts_utc,
      ar.rank_distance,
      ar.cohort_size
    FROM arrival_ranks ar
    WHERE ar.arrival_id IN (${arrivalIdList})
    ORDER BY ar.icao_hex, ar.ring_nm DESC
  `);

  // Group results by icao_hex
  const trajectoryMap = new Map<
    string,
    { points: TrajectoryPoint[]; callsign: string | null }
  >();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const chunk = await result.fetchChunk();
    if (!chunk || chunk.rowCount === 0) break;
    const rows = chunk.getRows();
    for (const row of rows) {
      const icao = row[0] as string;
      const point: TrajectoryPoint = {
        ringNm: Number(row[1]),
        crossTsUtc: timestampToIso(row[2] as DuckDBTimestampValue),
        rankDistance: Number(row[3]),
        cohortSize: Number(row[4]),
      };

      if (!trajectoryMap.has(icao)) {
        trajectoryMap.set(icao, { points: [], callsign: null });
      }
      trajectoryMap.get(icao)!.points.push(point);
    }
  }

  // Get callsigns from arrival_ids (format: ICAO_TIMESTAMP)
  // Query the most recent aircraft_states for callsigns
  const icaos = [...trajectoryMap.keys()];
  if (icaos.length > 0) {
    const icaoList = icaos.map((i) => `'${i}'`).join(",");
    const callsignResult = await connection.run(`
      SELECT DISTINCT icao, callsign
      FROM aircraft_states
      WHERE icao IN (${icaoList})
        AND callsign IS NOT NULL
      QUALIFY ROW_NUMBER() OVER (PARTITION BY icao ORDER BY ts DESC) = 1
    `);

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const chunk = await callsignResult.fetchChunk();
      if (!chunk || chunk.rowCount === 0) break;
      const rows = chunk.getRows();
      for (const row of rows) {
        const icao = row[0] as string;
        const callsign = row[1] as string | null;
        const entry = trajectoryMap.get(icao);
        if (entry) {
          entry.callsign = callsign;
        }
      }
    }
  }

  // Build trajectories array, computing finalRank from smallest ring
  const trajectories: AircraftTrajectory[] = [];
  for (const [icao, data] of trajectoryMap) {
    // Find the point with the smallest ring (closest to airport)
    const smallestRingPoint = data.points.reduce((min, p) =>
      p.ringNm < min.ringNm ? p : min
    );

    trajectories.push({
      icao,
      callsign: data.callsign,
      finalRank: smallestRingPoint.rankDistance,
      cohortSize: smallestRingPoint.cohortSize,
      points: data.points,
    });
  }

  // Sort by final rank
  trajectories.sort((a, b) => a.finalRank - b.finalRank);

  console.log(`[getSequenceTrajectories] Found ${trajectories.length} trajectories`);
  if (trajectories.length === 0) {
    // Additional diagnostics when no trajectories found
    const dbStatus = await getDatabaseStatus();
    console.log(`[getSequenceTrajectories] arrival_ranks table has ${dbStatus.counts["arrival_ranks"] ?? 0} rows`);
  }

  return trajectories;
}

/** Database status info for diagnostics */
export interface DatabaseStatus {
  tables: string[];
  counts: Record<string, number>;
}

/**
 * Get database status including table names and row counts
 * Used for diagnosing data availability issues
 */
export async function getDatabaseStatus(): Promise<DatabaseStatus> {
  const connection = await getConnection();
  const tables: string[] = [];
  const counts: Record<string, number> = {};

  // Get list of tables
  const tablesResult = await connection.run("SHOW TABLES");

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const chunk = await tablesResult.fetchChunk();
    if (!chunk || chunk.rowCount === 0) break;
    const rows = chunk.getRows();
    for (const row of rows) {
      tables.push(row[0] as string);
    }
  }

  // Get row counts for each table
  for (const table of tables) {
    try {
      const countResult = await connection.run(`SELECT COUNT(*) FROM "${table}"`);
      const chunk = await countResult.fetchChunk();
      if (chunk && chunk.rowCount > 0) {
        const rows = chunk.getRows();
        const firstRow = rows[0];
        if (firstRow) {
          counts[table] = Number(firstRow[0]);
        }
      }
    } catch {
      counts[table] = -1; // Error reading table
    }
  }

  console.log("[db] Database status:", { tables, counts });
  return { tables, counts };
}
