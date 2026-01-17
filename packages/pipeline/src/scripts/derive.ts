/**
 * Derive script - computes ring crossings and kinematic features
 *
 * Usage: pnpm pipeline:derive --airport YBBN --date 2025-12-01 --rings "50,40,30,25,20,15,10,8,6,4"
 *
 * Expected input: aircraft_states from normalize stage
 * Output: ring_events with crossing timestamps and kinematics
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import minimist from "minimist";
import type { RingEvent } from "@adsb/shared";
import {
  type DeriveArgs,
  DEFAULT_RINGS,
  DEFAULT_BUCKET_SIZE_SEC,
  loadTracks,
  listAvailableAirports,
  hasStatesData,
  detectAllCrossings,
  precomputeTrafficCounts,
  lookupTrafficCount,
  initDeriveDatabase,
  insertRingEvents,
  exportRingEventsToParquet,
  getRingEventCount,
  closeDeriveDatabase,
} from "../derive/index.js";

// Load .env from monorepo root
const __dirname = dirname(fileURLToPath(import.meta.url));
const monorepoRoot = resolve(__dirname, "../../../..");
const envPath = join(monorepoRoot, ".env");
if (existsSync(envPath)) {
  config({ path: envPath });
} else {
  config();
}

const USAGE = `
Usage: pnpm pipeline:derive --airport <ICAO> --date <YYYY-MM-DD> [--rings <comma-separated>]

Options:
  --airport   ICAO code of the target airport (e.g., YBBN)
  --date      Date to process in YYYY-MM-DD format
  --rings     Comma-separated ring distances in NM (default: 50,40,30,25,20,15,10,8,6,4)

Examples:
  pnpm pipeline:derive --airport YBBN --date 2025-12-01
  pnpm pipeline:derive --airport YBBN --date 2025-12-01 --rings "50,40,30,25,20,15,10,8,6,4"
`;

const BATCH_SIZE = 1000;

function parseArgs(): DeriveArgs | null {
  const argv = minimist(process.argv.slice(2), {
    string: ["airport", "date", "rings"],
    alias: {
      a: "airport",
      d: "date",
      r: "rings",
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

  // Parse rings
  let rings: number[] = [...DEFAULT_RINGS];
  if (argv.rings) {
    const parsed = String(argv.rings)
      .split(",")
      .map((s) => parseFloat(s.trim()))
      .filter((n) => !isNaN(n) && n > 0);

    if (parsed.length === 0) {
      console.error("Error: --rings must contain at least one positive number");
      return null;
    }
    rings = parsed;
  }

  return { airport: airport.toUpperCase(), date, rings };
}

/**
 * Generate deterministic arrival ID from airport, ICAO, and date
 */
function generateArrivalId(
  airportIcao: string,
  icao: string,
  date: string
): string {
  const input = `${airportIcao}|${icao}|${date}`;
  const hash = createHash("sha256").update(input).digest("hex");
  return hash.substring(0, 16);
}

async function main() {
  const args = parseArgs();
  if (!args) {
    process.exit(1);
  }

  console.log(
    `[derive] Processing ${args.airport} on ${args.date} with rings: ${args.rings.join(", ")} NM`
  );

  // Initialize database
  const dbPath = join(process.cwd(), "data", "db", "adsb.duckdb");

  if (!existsSync(dirname(dbPath))) {
    console.error(`[derive] Database directory not found: ${dirname(dbPath)}`);
    console.error(
      "[derive] Run normalize first: pnpm pipeline:normalize --airport <ICAO> --date <DATE>"
    );
    process.exit(1);
  }

  console.log(`[derive] Opening database: ${dbPath}`);
  const db = await initDeriveDatabase(dbPath);
  const { connection } = db;

  // Check if aircraft_states has data for this airport/date
  const hasData = await hasStatesData(connection, args.airport, args.date);
  if (!hasData) {
    const available = await listAvailableAirports(connection);
    console.error(
      `[derive] No aircraft_states data found for ${args.airport} on ${args.date}`
    );
    if (available.length > 0) {
      console.error(`[derive] Available airports: ${available.join(", ")}`);
    }
    console.error(
      "[derive] Run normalize first: pnpm pipeline:normalize --airport <ICAO> --date <DATE>"
    );
    closeDeriveDatabase(db);
    process.exit(1);
  }

  // Load tracks
  console.log("[derive] Loading tracks from aircraft_states...");
  const tracks = await loadTracks(connection, args.airport, args.date);
  console.log(`[derive] Loaded ${tracks.size} aircraft tracks`);

  if (tracks.size === 0) {
    console.warn("[derive] No tracks found - nothing to process");
    closeDeriveDatabase(db);
    process.exit(0);
  }

  // Precompute traffic counts
  console.log("[derive] Precomputing traffic counts...");
  const trafficCache = await precomputeTrafficCounts(
    connection,
    args.airport,
    args.date,
    args.rings,
    DEFAULT_BUCKET_SIZE_SEC
  );
  console.log(`[derive] Traffic cache contains ${trafficCache.size} entries`);

  // Detect crossings
  console.log("[derive] Detecting ring crossings...");
  const crossings = detectAllCrossings(tracks, args.rings);
  console.log(`[derive] Detected ${crossings.length} ring crossings`);

  if (crossings.length === 0) {
    console.warn(
      "[derive] No inward ring crossings detected (possibly departures only)"
    );
    closeDeriveDatabase(db);
    process.exit(0);
  }

  // Convert crossings to RingEvents with traffic counts and arrival IDs
  console.log("[derive] Building ring events...");
  const ringEvents: RingEvent[] = crossings.map((crossing) => ({
    arrivalId: generateArrivalId(args.airport, crossing.icao, args.date),
    airportIcao: args.airport,
    icao: crossing.icao,
    callsign: crossing.callsign,
    ringNm: crossing.ringNm,
    crossTs: crossing.crossTs,
    lat: crossing.lat,
    lon: crossing.lon,
    altBaro: crossing.altBaro,
    gs: crossing.gs,
    track: crossing.track,
    closingRate: crossing.closingRate,
    distanceNm: crossing.distanceNm,
    rankDistance: null, // Computed in score step
    rankTtg: null, // Computed in score step
    trafficCount: lookupTrafficCount(
      trafficCache,
      crossing.crossTs,
      crossing.ringNm,
      DEFAULT_BUCKET_SIZE_SEC
    ),
  }));

  // Insert in batches
  console.log("[derive] Inserting ring events into database...");
  let totalInserted = 0;
  for (let i = 0; i < ringEvents.length; i += BATCH_SIZE) {
    const batch = ringEvents.slice(i, i + BATCH_SIZE);
    const inserted = await insertRingEvents(db, batch);
    totalInserted += inserted;

    const pct = Math.round(((i + batch.length) / ringEvents.length) * 100);
    process.stdout.write(
      `\r[derive] Progress: ${pct}% (${totalInserted}/${ringEvents.length} events)`
    );
  }
  process.stdout.write("\n");

  // Get final count
  const eventCount = await getRingEventCount(db, args.airport, args.date);
  console.log(`[derive] Database contains ${eventCount} ring events for this date`);

  // Export to Parquet
  const parquetDir = join(process.cwd(), "data", "processed", args.date);
  const parquetPath = join(parquetDir, "ring_events.parquet");

  console.log(`[derive] Exporting to: ${parquetPath}`);
  await exportRingEventsToParquet(db, parquetPath, args.airport, args.date);

  // Close database
  closeDeriveDatabase(db);

  // Summary
  const uniqueAircraft = new Set(ringEvents.map((e) => e.icao)).size;
  const ringSummary = args.rings
    .map((r) => {
      const count = ringEvents.filter((e) => e.ringNm === r).length;
      return `${r}nm: ${count}`;
    })
    .join(", ");

  console.log("[derive] Complete!");
  console.log(`  Aircraft: ${uniqueAircraft}`);
  console.log(`  Events: ${ringEvents.length}`);
  console.log(`  By ring: ${ringSummary}`);
  console.log(`  Database: ${dbPath}`);
  console.log(`  Parquet: ${parquetPath}`);
}

main().catch((err) => {
  console.error("[derive] Error:", err);
  process.exit(1);
});
