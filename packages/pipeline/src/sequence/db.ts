/**
 * DuckDB operations for arrival_sequences storage
 */

import { DuckDBInstance, timestampValue } from "@duckdb/node-api";
import type { DuckDBConnection, DuckDBTimestampValue } from "@duckdb/node-api";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ArrivalSequence, ArrivalRankRow } from "./types.js";

export type SequenceDatabase = Awaited<ReturnType<typeof initSequenceDatabase>>;

/**
 * Convert DuckDB timestamp to JavaScript Date
 */
function timestampToDate(value: DuckDBTimestampValue): Date {
  const micros = value.micros;
  if (typeof micros === "bigint") {
    return new Date(Number(micros / 1000n));
  }
  return new Date(Number(micros) / 1000);
}

/**
 * Initialize DuckDB database and create arrival_sequences schema
 */
export async function initSequenceDatabase(dbPath: string) {
  await mkdir(dirname(dbPath), { recursive: true });

  const instance = await DuckDBInstance.create(dbPath);
  const connection = await instance.connect();

  // Create arrival_sequences table
  await connection.run(`
    CREATE TABLE IF NOT EXISTS arrival_sequences (
      sequence_id VARCHAR NOT NULL PRIMARY KEY,
      airport_icao VARCHAR NOT NULL,
      window_start_ts TIMESTAMP NOT NULL,
      window_end_ts TIMESTAMP NOT NULL,
      rank_volatility REAL NOT NULL,
      inversion_count INTEGER NOT NULL,
      avg_inner_density REAL NOT NULL,
      sequence_score REAL NOT NULL,
      aircraft_count SMALLINT NOT NULL,
      arrival_ids VARCHAR NOT NULL
    )
  `);

  return { instance, connection };
}

/**
 * Check if arrival_ranks has data for given airport and date
 */
export async function hasArrivalRanksData(
  connection: DuckDBConnection,
  airportIcao: string,
  date: string
): Promise<boolean> {
  const reader = await connection.runAndReadAll(`
    SELECT COUNT(*) as cnt FROM arrival_ranks
    WHERE airport_icao = '${airportIcao}'
      AND DATE(cross_ts_utc) = '${date}'
    LIMIT 1
  `);

  if (reader.currentRowCount === 0) return false;
  const count = Number(reader.value(0, 0) ?? 0);
  return count > 0;
}

/**
 * Load arrival ranks for a given airport and date
 * Returns ranks sorted by cross_ts_utc
 */
export async function loadArrivalRanks(
  connection: DuckDBConnection,
  airportIcao: string,
  date: string
): Promise<ArrivalRankRow[]> {
  const ranks: ArrivalRankRow[] = [];

  const result = await connection.run(`
    SELECT
      arrival_id,
      icao_hex,
      ring_nm,
      cross_ts_utc,
      rank_distance,
      delta_rank_distance,
      cohort_size
    FROM arrival_ranks
    WHERE airport_icao = '${airportIcao}'
      AND DATE(cross_ts_utc) = '${date}'
    ORDER BY cross_ts_utc
  `);

  // Use chunk-based iteration for reliable reading
  while (true) {
    const chunk = await result.fetchChunk();
    if (!chunk || chunk.rowCount === 0) break;
    const rows = chunk.getRows();
    for (const row of rows) {
      const tsValue = row[3] as DuckDBTimestampValue;
      const deltaRank = row[5];
      ranks.push({
        arrivalId: row[0] as string,
        icaoHex: row[1] as string,
        ringNm: Number(row[2]),
        crossTsUtc: timestampToDate(tsValue),
        rankDistance: Number(row[4]),
        deltaRankDistance: deltaRank !== null ? Number(deltaRank) : null,
        cohortSize: Number(row[6]),
      });
    }
  }

  return ranks;
}

/**
 * Insert arrival sequences in batch
 */
export async function insertArrivalSequences(
  db: SequenceDatabase,
  sequences: ArrivalSequence[],
  airportIcao: string
): Promise<number> {
  if (sequences.length === 0) return 0;

  const { connection } = db;

  const stmt = await connection.prepare(`
    INSERT OR REPLACE INTO arrival_sequences
    (sequence_id, airport_icao, window_start_ts, window_end_ts, rank_volatility,
     inversion_count, avg_inner_density, sequence_score, aircraft_count, arrival_ids)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let insertedCount = 0;
  for (const seq of sequences) {
    const startMicros = BigInt(seq.windowStartTs.getTime()) * 1000n;
    const endMicros = BigInt(seq.windowEndTs.getTime()) * 1000n;

    stmt.bindVarchar(1, seq.sequenceId);
    stmt.bindVarchar(2, airportIcao);
    stmt.bindTimestamp(3, timestampValue(startMicros));
    stmt.bindTimestamp(4, timestampValue(endMicros));
    stmt.bindFloat(5, seq.rankVolatility);
    stmt.bindInteger(6, seq.inversionCount);
    stmt.bindFloat(7, seq.avgInnerDensity);
    stmt.bindFloat(8, seq.sequenceScore);
    stmt.bindSmallInt(9, seq.aircraftCount);
    stmt.bindVarchar(10, JSON.stringify(seq.arrivalIds));

    await stmt.run();
    insertedCount++;
  }

  stmt.destroySync();
  return insertedCount;
}

/**
 * Export arrival_sequences to Parquet file with ZSTD compression
 */
export async function exportSequencesToParquet(
  db: SequenceDatabase,
  outputPath: string,
  airportIcao: string,
  date: string
): Promise<void> {
  const { connection } = db;

  await mkdir(dirname(outputPath), { recursive: true });

  await connection.run(`
    COPY (
      SELECT * FROM arrival_sequences
      WHERE airport_icao = '${airportIcao}'
        AND DATE(window_start_ts) = '${date}'
      ORDER BY sequence_score DESC
    ) TO '${outputPath}' (FORMAT PARQUET, COMPRESSION ZSTD)
  `);
}

/**
 * Get count of arrival_sequences in database for given airport/date
 */
export async function getArrivalSequenceCount(
  db: SequenceDatabase,
  airportIcao: string,
  date: string
): Promise<number> {
  const { connection } = db;
  const reader = await connection.runAndReadAll(`
    SELECT COUNT(*) as cnt FROM arrival_sequences
    WHERE airport_icao = '${airportIcao}'
      AND DATE(window_start_ts) = '${date}'
  `);
  if (reader.currentRowCount === 0) return 0;
  const value = reader.value(0, 0);
  return Number(value ?? 0);
}

/**
 * Close database connection
 */
export function closeSequenceDatabase(db: SequenceDatabase): void {
  db.connection.closeSync();
  db.instance.closeSync();
}
