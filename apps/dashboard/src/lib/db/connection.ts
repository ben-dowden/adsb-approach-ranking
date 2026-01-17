/**
 * DuckDB singleton connection for read-only access
 */

import { resolve } from "node:path";

import { DuckDBInstance } from "@duckdb/node-api";
import type { DuckDBConnection } from "@duckdb/node-api";

const DB_PATH = resolve(
  process.cwd(),
  "../../packages/pipeline/data/db/adsb.duckdb"
);

let instance: DuckDBInstance | null = null;
let connection: DuckDBConnection | null = null;
let initPromise: Promise<DuckDBConnection> | null = null;

/**
 * Get the singleton DuckDB connection (read-only mode)
 */
export async function getConnection(): Promise<DuckDBConnection> {
  if (connection) {
    return connection;
  }

  // Prevent multiple simultaneous initializations
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    instance = await DuckDBInstance.create(DB_PATH, {
      access_mode: "READ_ONLY",
    });
    connection = await instance.connect();
    return connection;
  })();

  return initPromise;
}

/**
 * Close the database connection (for cleanup)
 */
export function closeConnection(): void {
  if (connection) {
    connection.closeSync();
    connection = null;
  }
  if (instance) {
    instance.closeSync();
    instance = null;
  }
  initPromise = null;
}
