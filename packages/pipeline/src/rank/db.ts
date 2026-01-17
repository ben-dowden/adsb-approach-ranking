/**
 * DuckDB operations for arrival_ranks storage
 */

import { DuckDBInstance, timestampValue } from "@duckdb/node-api";
import type { DuckDBConnection, DuckDBTimestampValue } from "@duckdb/node-api";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ArrivalRank, CohortMember } from "./types.js";

export type RankDatabase = Awaited<ReturnType<typeof initRankDatabase>>;

/** Ring event row from database */
export interface RingEventRow {
  arrivalId: string;
  icaoHex: string;
  ringNm: number;
  crossTsUtc: Date;
  distanceNm: number;
  closingRate: number;
}

/**
 * Convert DuckDB timestamp to JavaScript Date
 */
function timestampToDate(value: DuckDBTimestampValue): Date {
  const micros = value.micros;
  // Handle both BigInt and number types
  if (typeof micros === "bigint") {
    return new Date(Number(micros / 1000n));
  }
  return new Date(Number(micros) / 1000);
}

/**
 * Initialize DuckDB database and create arrival_ranks schema
 */
export async function initRankDatabase(dbPath: string) {
  // Ensure directory exists
  await mkdir(dirname(dbPath), { recursive: true });

  const instance = await DuckDBInstance.create(dbPath);
  const connection = await instance.connect();

  // Create arrival_ranks table
  await connection.run(`
    CREATE TABLE IF NOT EXISTS arrival_ranks (
      arrival_id VARCHAR NOT NULL,
      airport_icao VARCHAR NOT NULL,
      icao_hex VARCHAR NOT NULL,
      ring_nm SMALLINT NOT NULL,
      cross_ts_utc TIMESTAMP NOT NULL,
      rank_distance SMALLINT NOT NULL,
      rank_ttg SMALLINT NOT NULL,
      delta_rank_distance SMALLINT,
      delta_rank_ttg SMALLINT,
      cohort_size SMALLINT NOT NULL,
      ring_order_index SMALLINT NOT NULL,
      PRIMARY KEY (arrival_id, ring_nm)
    )
  `);

  return { instance, connection };
}

/**
 * Load ring events for a given airport and date
 * Returns events sorted by ring_nm descending (outer to inner) for each arrival
 */
export async function loadRingEvents(
  connection: DuckDBConnection,
  airportIcao: string,
  date: string
): Promise<RingEventRow[]> {
  const events: RingEventRow[] = [];

  const result = await connection.run(`
    SELECT
      arrival_id,
      icao as icao_hex,
      ring_nm,
      cross_ts as cross_ts_utc,
      distance_nm,
      closing_rate
    FROM ring_events
    WHERE airport_icao = '${airportIcao}'
      AND DATE(cross_ts) = '${date}'
    ORDER BY cross_ts, icao, ring_nm DESC
  `);

  // Use chunk-based iteration for reliable reading
  while (true) {
    const chunk = await result.fetchChunk();
    if (chunk.rowCount === 0) break;
    const rows = chunk.getRows();
    for (const row of rows) {
      const tsValue = row[3] as DuckDBTimestampValue;
      events.push({
        arrivalId: row[0] as string,
        icaoHex: row[1] as string,
        ringNm: Number(row[2]),
        crossTsUtc: timestampToDate(tsValue),
        distanceNm: Number(row[4]),
        closingRate: Number(row[5]),
      });
    }
  }

  return events;
}

/**
 * Get distinct ring crossings (unique timestamps) for cohort grouping
 */
export async function getDistinctCrossings(
  connection: DuckDBConnection,
  airportIcao: string,
  date: string
): Promise<Array<{ ringNm: number; crossTs: Date }>> {
  const crossings: Array<{ ringNm: number; crossTs: Date }> = [];

  const reader = await connection.runAndReadAll(`
    SELECT DISTINCT ring_nm, cross_ts
    FROM ring_events
    WHERE airport_icao = '${airportIcao}'
      AND DATE(cross_ts) = '${date}'
    ORDER BY cross_ts, ring_nm DESC
  `);

  for (let i = 0; i < reader.currentRowCount; i++) {
    const tsValue = reader.value(i, 1) as DuckDBTimestampValue;
    crossings.push({
      ringNm: Number(reader.value(i, 0)),
      crossTs: timestampToDate(tsValue),
    });
  }

  return crossings;
}

/**
 * Insert arrival ranks in batch
 */
export async function insertArrivalRanks(
  db: RankDatabase,
  ranks: ArrivalRank[],
  airportIcao: string
): Promise<number> {
  if (ranks.length === 0) return 0;

  const { connection } = db;

  const stmt = await connection.prepare(`
    INSERT OR REPLACE INTO arrival_ranks
    (arrival_id, airport_icao, icao_hex, ring_nm, cross_ts_utc, rank_distance,
     rank_ttg, delta_rank_distance, delta_rank_ttg, cohort_size, ring_order_index)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let insertedCount = 0;
  for (const rank of ranks) {
    const tsMicros = BigInt(rank.crossTsUtc.getTime()) * 1000n;

    stmt.bindVarchar(1, rank.arrivalId);
    stmt.bindVarchar(2, airportIcao);
    stmt.bindVarchar(3, rank.icaoHex);
    stmt.bindSmallInt(4, rank.ringNm);
    stmt.bindTimestamp(5, timestampValue(tsMicros));
    stmt.bindSmallInt(6, rank.rankDistance);
    stmt.bindSmallInt(7, rank.rankTtg);

    if (rank.deltaRankDistance !== null) {
      stmt.bindSmallInt(8, rank.deltaRankDistance);
    } else {
      stmt.bindNull(8);
    }

    if (rank.deltaRankTtg !== null) {
      stmt.bindSmallInt(9, rank.deltaRankTtg);
    } else {
      stmt.bindNull(9);
    }

    stmt.bindSmallInt(10, rank.cohortSize);
    stmt.bindSmallInt(11, rank.ringOrderIndex);

    await stmt.run();
    insertedCount++;
  }

  stmt.destroySync();
  return insertedCount;
}

/**
 * Update rank_distance and rank_ttg in ring_events table
 */
export async function updateRingEventRanks(
  connection: DuckDBConnection,
  ranks: ArrivalRank[]
): Promise<number> {
  if (ranks.length === 0) return 0;

  let updatedCount = 0;
  const stmt = await connection.prepare(`
    UPDATE ring_events
    SET rank_distance = ?, rank_ttg = ?
    WHERE arrival_id = ? AND ring_nm = ?
  `);

  for (const rank of ranks) {
    stmt.bindSmallInt(1, rank.rankDistance);
    stmt.bindSmallInt(2, rank.rankTtg);
    stmt.bindVarchar(3, rank.arrivalId);
    stmt.bindSmallInt(4, rank.ringNm);

    await stmt.run();
    updatedCount++;
  }

  stmt.destroySync();
  return updatedCount;
}

/**
 * Export arrival_ranks to Parquet file with ZSTD compression
 */
export async function exportArrivalRanksToParquet(
  db: RankDatabase,
  outputPath: string,
  airportIcao: string,
  date: string
): Promise<void> {
  const { connection } = db;

  // Ensure output directory exists
  await mkdir(dirname(outputPath), { recursive: true });

  // Export with ZSTD compression
  await connection.run(`
    COPY (
      SELECT * FROM arrival_ranks
      WHERE airport_icao = '${airportIcao}'
        AND DATE(cross_ts_utc) = '${date}'
      ORDER BY cross_ts_utc, icao_hex, ring_nm DESC
    ) TO '${outputPath}' (FORMAT PARQUET, COMPRESSION ZSTD)
  `);
}

/**
 * Get count of arrival_ranks in database for given airport/date
 */
export async function getArrivalRankCount(
  db: RankDatabase,
  airportIcao: string,
  date: string
): Promise<number> {
  const { connection } = db;
  const reader = await connection.runAndReadAll(`
    SELECT COUNT(*) as cnt FROM arrival_ranks
    WHERE airport_icao = '${airportIcao}'
      AND DATE(cross_ts_utc) = '${date}'
  `);
  if (reader.currentRowCount === 0) return 0;
  const value = reader.value(0, 0);
  return Number(value ?? 0);
}

/**
 * Check if ring_events has data for given airport and date
 */
export async function hasRingEventsData(
  connection: DuckDBConnection,
  airportIcao: string,
  date: string
): Promise<boolean> {
  const reader = await connection.runAndReadAll(`
    SELECT COUNT(*) as cnt FROM ring_events
    WHERE airport_icao = '${airportIcao}'
      AND DATE(cross_ts) = '${date}'
    LIMIT 1
  `);

  if (reader.currentRowCount === 0) return false;
  const count = Number(reader.value(0, 0) ?? 0);
  return count > 0;
}

/**
 * Close database connection
 */
export function closeRankDatabase(db: RankDatabase): void {
  db.connection.closeSync();
  db.instance.closeSync();
}
