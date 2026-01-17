/**
 * Normalize script - processes raw ADS-B data, filters by distance, stores in DuckDB
 *
 * Usage:
 *   pnpm pipeline:normalize --airport YBBN --date 2025-12-01 --radiusNm 30
 */

import { config } from "dotenv";
import { dirname, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { glob } from "glob";
import minimist from "minimist";

// Load .env from monorepo root
const __dirname = dirname(fileURLToPath(import.meta.url));
const monorepoRoot = resolve(__dirname, "../../../..");
const envPath = join(monorepoRoot, ".env");
if (existsSync(envPath)) {
  config({ path: envPath });
} else {
  config();
}

import {
  loadAirportRegistry,
  getAirport,
  listAirportCodes,
  parseGzipJson,
  processRawFile,
  initDatabase,
  insertStates,
  exportToParquet,
  closeDatabase,
  getRecordCount,
  type NormalizeArgs,
  type NormalizedState,
} from "../normalize/index.js";

const USAGE = `
Usage: pnpm pipeline:normalize --airport <ICAO> --date <YYYY-MM-DD> [--radiusNm <number>]

Options:
  --airport   ICAO code of the target airport (e.g., YBBN)
  --date      Date to process in YYYY-MM-DD format
  --radiusNm  Filter radius in nautical miles (default: 30)

Examples:
  pnpm pipeline:normalize --airport YBBN --date 2025-12-01
  pnpm pipeline:normalize --airport YBBN --date 2025-12-01 --radiusNm 50
`;

const DEFAULT_RADIUS_NM = 30;
const BATCH_SIZE = 10000;

function parseArgs(): NormalizeArgs | null {
  const argv = minimist(process.argv.slice(2), {
    string: ["airport", "date"],
    alias: {
      a: "airport",
      d: "date",
      r: "radiusNm",
      h: "help",
    },
  });

  if (argv.help) {
    console.log(USAGE);
    process.exit(0);
  }

  const airport = argv.airport;
  const date = argv.date;

  if (!airport || !date) {
    console.error("Error: --airport and --date are required");
    console.log(USAGE);
    return null;
  }

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error("Error: --date must be in YYYY-MM-DD format");
    return null;
  }

  // Parse radius
  let radiusNm = DEFAULT_RADIUS_NM;
  if (argv.radiusNm !== undefined) {
    radiusNm = parseFloat(String(argv.radiusNm));
    if (isNaN(radiusNm) || radiusNm <= 0) {
      console.error("Error: --radiusNm must be a positive number");
      return null;
    }
  }

  return { airport: airport.toUpperCase(), date, radiusNm };
}

async function main() {
  const args = parseArgs();
  if (!args) {
    process.exit(1);
  }

  console.log(
    `[normalize] Processing ${args.airport} on ${args.date} with ${args.radiusNm} NM radius`
  );

  // Load airport registry
  const pipelineRoot = resolve(__dirname, "../..");
  const registryPath = join(pipelineRoot, "data/airports.json");

  if (!existsSync(registryPath)) {
    console.error(`[normalize] Airport registry not found: ${registryPath}`);
    process.exit(1);
  }

  const registry = await loadAirportRegistry(registryPath);
  const airport = getAirport(registry, args.airport);

  if (!airport) {
    console.error(`[normalize] Unknown airport: ${args.airport}`);
    console.error(`[normalize] Available airports: ${listAirportCodes(registry).join(", ")}`);
    process.exit(1);
  }

  console.log(`[normalize] Airport: ${airport.name} (${airport.icao})`);

  // Find raw files
  const [year, month, day] = args.date.split("-");
  const rawDir = join(process.cwd(), "data", "raw", args.date);
  const rawPattern = join(rawDir, "readsb-hist", year!, month!, day!, "*.json.gz");

  if (!existsSync(rawDir)) {
    console.error(`[normalize] Raw data directory not found: ${rawDir}`);
    console.error("[normalize] Run ingest first: pnpm pipeline:ingest --airport <ICAO> --date <DATE>");
    process.exit(1);
  }

  const rawFiles = await glob(rawPattern);
  rawFiles.sort(); // Ensure chronological order

  if (rawFiles.length === 0) {
    console.error(`[normalize] No raw files found matching: ${rawPattern}`);
    console.error("[normalize] Run ingest first: pnpm pipeline:ingest --airport <ICAO> --date <DATE>");
    process.exit(1);
  }

  console.log(`[normalize] Found ${rawFiles.length} raw files`);

  // Initialize database
  const dbPath = join(process.cwd(), "data", "db", "adsb.duckdb");
  console.log(`[normalize] Initializing database: ${dbPath}`);
  const db = await initDatabase(dbPath);

  // Process files
  let totalStates = 0;
  let filesProcessed = 0;
  let filesWithErrors = 0;
  const stateBatch: NormalizedState[] = [];

  for (const filePath of rawFiles) {
    try {
      const rawFile = await parseGzipJson(filePath);
      const states = processRawFile(rawFile, airport, args.radiusNm);

      stateBatch.push(...states);
      totalStates += states.length;

      // Batch insert when threshold reached
      if (stateBatch.length >= BATCH_SIZE) {
        await insertStates(db, stateBatch);
        stateBatch.length = 0;
      }

      filesProcessed++;

      // Progress reporting
      const pct = Math.round((filesProcessed / rawFiles.length) * 100);
      process.stdout.write(
        `\r[normalize] Progress: ${pct}% (${filesProcessed}/${rawFiles.length} files, ${totalStates} states)`
      );
    } catch (error) {
      filesWithErrors++;
      console.error(
        `\n[normalize] Error processing ${filePath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Insert remaining states
  if (stateBatch.length > 0) {
    await insertStates(db, stateBatch);
  }

  process.stdout.write("\n");
  console.log(`[normalize] Processed ${filesProcessed} files with ${totalStates} states`);
  if (filesWithErrors > 0) {
    console.log(`[normalize] Skipped ${filesWithErrors} files with errors`);
  }

  // Get final record count
  const recordCount = await getRecordCount(db);
  console.log(`[normalize] Database contains ${recordCount} total records`);

  // Export to Parquet
  const parquetDir = join(process.cwd(), "data", "processed", args.date);
  const parquetPath = join(parquetDir, "aircraft_states.parquet");

  console.log(`[normalize] Exporting to: ${parquetPath}`);
  await exportToParquet(db, parquetPath, args.airport, args.date);

  // Close database
  closeDatabase(db);

  console.log("[normalize] Complete!");
  console.log(`  Database: ${dbPath}`);
  console.log(`  Parquet: ${parquetPath}`);
}

main().catch((err) => {
  console.error("[normalize] Error:", err);
  process.exit(1);
});
