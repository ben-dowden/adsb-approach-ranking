/**
 * DuckDB operations for ring_events storage
 */

import { DuckDBInstance, timestampValue } from "@duckdb/node-api";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { RingEvent } from "@adsb/shared";

export type DeriveDatabase = Awaited<ReturnType<typeof initDeriveDatabase>>;

/**
 * Initialize DuckDB database and create ring_events schema
 */
export async function initDeriveDatabase(dbPath: string) {
  // Ensure directory exists
  await mkdir(dirname(dbPath), { recursive: true });

  const instance = await DuckDBInstance.create(dbPath);
  const connection = await instance.connect();

  // Create ring_events table
  await connection.run(`
    CREATE TABLE IF NOT EXISTS ring_events (
      arrival_id VARCHAR NOT NULL,
      airport_icao VARCHAR NOT NULL,
      icao VARCHAR NOT NULL,
      callsign VARCHAR,
      ring_nm SMALLINT NOT NULL,
      cross_ts TIMESTAMP NOT NULL,
      lat DOUBLE NOT NULL,
      lon DOUBLE NOT NULL,
      alt_baro INTEGER,
      gs REAL,
      track REAL,
      closing_rate REAL NOT NULL,
      distance_nm REAL NOT NULL,
      rank_distance SMALLINT,
      rank_ttg SMALLINT,
      traffic_count SMALLINT NOT NULL,
      PRIMARY KEY (arrival_id, ring_nm)
    )
  `);

  return { instance, connection };
}

/**
 * Insert ring events in batch using prepared statement
 */
export async function insertRingEvents(
  db: DeriveDatabase,
  events: RingEvent[]
): Promise<number> {
  if (events.length === 0) return 0;

  const { connection } = db;

  // Use INSERT OR REPLACE to handle duplicates
  const stmt = await connection.prepare(`
    INSERT OR REPLACE INTO ring_events
    (arrival_id, airport_icao, icao, callsign, ring_nm, cross_ts, lat, lon,
     alt_baro, gs, track, closing_rate, distance_nm, rank_distance, rank_ttg, traffic_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let insertedCount = 0;
  for (const event of events) {
    // Convert timestamp to microseconds as bigint
    const tsMicros = BigInt(event.crossTs.getTime()) * 1000n;

    stmt.bindVarchar(1, event.arrivalId);
    stmt.bindVarchar(2, event.airportIcao);
    stmt.bindVarchar(3, event.icao);

    if (event.callsign !== null) {
      stmt.bindVarchar(4, event.callsign);
    } else {
      stmt.bindNull(4);
    }

    stmt.bindSmallInt(5, event.ringNm);
    stmt.bindTimestamp(6, timestampValue(tsMicros));
    stmt.bindDouble(7, event.lat);
    stmt.bindDouble(8, event.lon);

    if (event.altBaro !== null) {
      stmt.bindInteger(9, event.altBaro);
    } else {
      stmt.bindNull(9);
    }

    if (event.gs !== null) {
      stmt.bindFloat(10, event.gs);
    } else {
      stmt.bindNull(10);
    }

    if (event.track !== null) {
      stmt.bindFloat(11, event.track);
    } else {
      stmt.bindNull(11);
    }

    stmt.bindFloat(12, event.closingRate);
    stmt.bindFloat(13, event.distanceNm);

    if (event.rankDistance !== null) {
      stmt.bindSmallInt(14, event.rankDistance);
    } else {
      stmt.bindNull(14);
    }

    if (event.rankTtg !== null) {
      stmt.bindSmallInt(15, event.rankTtg);
    } else {
      stmt.bindNull(15);
    }

    stmt.bindSmallInt(16, event.trafficCount);

    await stmt.run();
    insertedCount++;
  }

  stmt.destroySync();
  return insertedCount;
}

/**
 * Export ring_events to Parquet file with ZSTD compression
 */
export async function exportRingEventsToParquet(
  db: DeriveDatabase,
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
      SELECT * FROM ring_events
      WHERE airport_icao = '${airportIcao}'
        AND DATE(cross_ts) = '${date}'
      ORDER BY cross_ts, icao, ring_nm
    ) TO '${outputPath}' (FORMAT PARQUET, COMPRESSION ZSTD)
  `);
}

/**
 * Get count of ring_events in database for given airport/date
 */
export async function getRingEventCount(
  db: DeriveDatabase,
  airportIcao: string,
  date: string
): Promise<number> {
  const { connection } = db;
  const reader = await connection.runAndReadAll(`
    SELECT COUNT(*) as cnt FROM ring_events
    WHERE airport_icao = '${airportIcao}'
      AND DATE(cross_ts) = '${date}'
  `);
  if (reader.currentRowCount === 0) return 0;
  const value = reader.value(0, 0);
  return Number(value ?? 0);
}

/**
 * Close database connection
 */
export function closeDeriveDatabase(db: DeriveDatabase): void {
  db.connection.closeSync();
  db.instance.closeSync();
}
