import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import {
  DuckDBInstance,
  timestampValue,
  type DuckDBConnection,
  type DuckDBPreparedStatement,
  type DuckDBTimestampValue,
} from "@duckdb/node-api";

import type { CruiseState } from "./types.js";

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS cruise_states (
    ts TIMESTAMP NOT NULL,
    icao_hex VARCHAR NOT NULL,
    registration VARCHAR NOT NULL,
    aircraft_type VARCHAR NOT NULL,
    callsign VARCHAR,
    operator_code VARCHAR,
    operator_name VARCHAR,
    lat DOUBLE NOT NULL,
    lon DOUBLE NOT NULL,
    altitude_ft INTEGER,
    ground_speed_kt REAL,
    vertical_rate_fpm REAL,
    on_ground TINYINT NOT NULL,
    PRIMARY KEY (ts, icao_hex)
  )
`;

function timestampToDate(value: DuckDBTimestampValue): Date {
  return typeof value.micros === "bigint"
    ? new Date(Number(value.micros / 1000n))
    : new Date(Number(value.micros) / 1000);
}

function bindNullableVarchar(
  statement: DuckDBPreparedStatement,
  index: number,
  value: string | null
): void {
  if (value === null) statement.bindNull(index);
  else statement.bindVarchar(index, value);
}

function bindNullableInteger(
  statement: DuckDBPreparedStatement,
  index: number,
  value: number | null
): void {
  if (value === null) statement.bindNull(index);
  else statement.bindInteger(index, value);
}

function bindNullableFloat(
  statement: DuckDBPreparedStatement,
  index: number,
  value: number | null
): void {
  if (value === null) statement.bindNull(index);
  else statement.bindFloat(index, value);
}

function sqlPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/'/g, "''");
}

async function insertStates(
  connection: DuckDBConnection,
  states: CruiseState[]
): Promise<void> {
  const statement = await connection.prepare(`
    INSERT OR IGNORE INTO cruise_states VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  try {
    for (const state of states) {
      statement.bindTimestamp(
        1,
        timestampValue(BigInt(state.ts.getTime()) * 1000n)
      );
      statement.bindVarchar(2, state.icaoHex);
      statement.bindVarchar(3, state.registration);
      statement.bindVarchar(4, state.aircraftType);
      bindNullableVarchar(statement, 5, state.callsign);
      bindNullableVarchar(statement, 6, state.operatorCode);
      bindNullableVarchar(statement, 7, state.operatorName);
      statement.bindDouble(8, state.lat);
      statement.bindDouble(9, state.lon);
      bindNullableInteger(statement, 10, state.altitudeFt);
      bindNullableFloat(statement, 11, state.groundSpeedKt);
      bindNullableFloat(statement, 12, state.verticalRateFpm);
      statement.bindInteger(13, state.onGround ? 1 : 0);
      await statement.run();
    }
  } finally {
    statement.destroySync();
  }
}

export async function writeCruiseStates(
  databasePath: string,
  parquetPath: string,
  states: CruiseState[]
): Promise<void> {
  await mkdir(dirname(databasePath), { recursive: true });
  await mkdir(dirname(parquetPath), { recursive: true });
  const instance = await DuckDBInstance.create(databasePath);
  const connection = await instance.connect();

  try {
    await connection.run(CREATE_TABLE_SQL);
    await connection.run("DELETE FROM cruise_states");
    await insertStates(connection, states);
    await connection.run(`
      COPY (SELECT * FROM cruise_states ORDER BY ts, icao_hex)
      TO '${sqlPath(parquetPath)}' (FORMAT PARQUET, COMPRESSION ZSTD)
    `);
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}

function cruiseStateFromRow(row: unknown[]): CruiseState {
  return {
    ts: timestampToDate(row[0] as DuckDBTimestampValue),
    icaoHex: row[1] as string,
    registration: row[2] as string,
    aircraftType: row[3] as string,
    callsign: row[4] as string | null,
    operatorCode: row[5] as string | null,
    operatorName: row[6] as string | null,
    lat: Number(row[7]),
    lon: Number(row[8]),
    altitudeFt: row[9] === null ? null : Number(row[9]),
    groundSpeedKt: row[10] === null ? null : Number(row[10]),
    verticalRateFpm: row[11] === null ? null : Number(row[11]),
    onGround: Number(row[12]) === 1,
  };
}

export async function readCruiseStates(
  databasePath: string
): Promise<CruiseState[]> {
  const instance = await DuckDBInstance.create(databasePath);
  const connection = await instance.connect();
  const states: CruiseState[] = [];

  try {
    const result = await connection.run(
      "SELECT * FROM cruise_states ORDER BY ts, icao_hex"
    );
    let chunk = await result.fetchChunk();
    while (chunk && chunk.rowCount > 0) {
      for (const row of chunk.getRows()) {
        states.push(cruiseStateFromRow(row));
      }
      chunk = await result.fetchChunk();
    }
  } finally {
    connection.closeSync();
    instance.closeSync();
  }

  return states;
}
