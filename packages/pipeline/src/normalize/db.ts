/**
 * DuckDB operations for aircraft state storage
 */

import { DuckDBInstance, timestampValue } from "@duckdb/node-api";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { NormalizedState } from "./types.js";

export type Database = Awaited<ReturnType<typeof initDatabase>>;

/**
 * Initialize DuckDB database and create schema
 */
export async function initDatabase(dbPath: string) {
  // Ensure directory exists
  await mkdir(dirname(dbPath), { recursive: true });

  const instance = await DuckDBInstance.create(dbPath);
  const connection = await instance.connect();

  // Create table with schema
  await connection.run(`
    CREATE TABLE IF NOT EXISTS aircraft_states (
      ts TIMESTAMP NOT NULL,
      icao VARCHAR NOT NULL,
      callsign VARCHAR,
      lat DOUBLE NOT NULL,
      lon DOUBLE NOT NULL,
      alt_baro INTEGER,
      gs REAL,
      track REAL,
      vrt REAL,
      distance_nm REAL NOT NULL,
      airport_icao VARCHAR NOT NULL,
      PRIMARY KEY (icao, ts)
    )
  `);

  return { instance, connection };
}

/**
 * Insert states in batch using prepared statement
 */
export async function insertStates(
  db: Database,
  states: NormalizedState[]
): Promise<number> {
  if (states.length === 0) return 0;

  const { connection } = db;

  // Use INSERT OR IGNORE to handle duplicate primary keys
  const stmt = await connection.prepare(`
    INSERT OR IGNORE INTO aircraft_states
    (ts, icao, callsign, lat, lon, alt_baro, gs, track, vrt, distance_nm, airport_icao)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let insertedCount = 0;
  for (const state of states) {
    // Convert timestamp to microseconds as bigint
    const tsMicros = BigInt(state.ts.getTime()) * 1000n;
    stmt.bindTimestamp(1, timestampValue(tsMicros));
    stmt.bindVarchar(2, state.icao);
    if (state.callsign !== null) {
      stmt.bindVarchar(3, state.callsign);
    } else {
      stmt.bindNull(3);
    }
    stmt.bindDouble(4, state.lat);
    stmt.bindDouble(5, state.lon);
    if (state.alt_baro !== null) {
      stmt.bindInteger(6, state.alt_baro);
    } else {
      stmt.bindNull(6);
    }
    if (state.gs !== null) {
      stmt.bindFloat(7, state.gs);
    } else {
      stmt.bindNull(7);
    }
    if (state.track !== null) {
      stmt.bindFloat(8, state.track);
    } else {
      stmt.bindNull(8);
    }
    if (state.vrt !== null) {
      stmt.bindFloat(9, state.vrt);
    } else {
      stmt.bindNull(9);
    }
    stmt.bindFloat(10, state.distance_nm);
    stmt.bindVarchar(11, state.airport_icao);

    await stmt.run();
    insertedCount++;
  }

  stmt.destroySync();
  return insertedCount;
}

/**
 * Export data to Parquet file with ZSTD compression
 */
export async function exportToParquet(
  db: Database,
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
      SELECT * FROM aircraft_states
      WHERE airport_icao = '${airportIcao}'
      AND DATE(ts) = '${date}'
      ORDER BY ts, icao
    ) TO '${outputPath}' (FORMAT PARQUET, COMPRESSION ZSTD)
  `);
}

/**
 * Get count of records in database
 */
export async function getRecordCount(db: Database): Promise<number> {
  const { connection } = db;
  const reader = await connection.runAndReadAll(
    "SELECT COUNT(*) as cnt FROM aircraft_states"
  );
  if (reader.currentRowCount === 0) return 0;
  const value = reader.value(0, 0);
  return Number(value ?? 0);
}

/**
 * Close database connection
 */
export function closeDatabase(db: Database): void {
  db.connection.closeSync();
  db.instance.closeSync();
}
