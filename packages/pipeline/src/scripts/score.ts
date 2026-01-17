/**
 * Score script - identifies cohorts, computes ranks, and tracks trajectories
 *
 * Usage: pnpm pipeline:score --airport YBBN --date 2025-12-01
 *
 * Expected input: ring_events from derive stage
 * Output: arrival_ranks table + parquet export
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import minimist from "minimist";
import {
  type RankArgs,
  initRankDatabase,
  loadRingEvents,
  hasRingEventsData,
  insertArrivalRanks,
  updateRingEventRanks,
  exportArrivalRanksToParquet,
  getArrivalRankCount,
  closeRankDatabase,
  groupIntoCohorts,
  DEFAULT_COHORT_BUCKET_SEC,
  computeAllRanks,
  computeTrajectories,
  MIN_COHORT_SIZE,
} from "../rank/index.js";

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
Usage: pnpm pipeline:score --airport <ICAO> --date <YYYY-MM-DD>

Options:
  --airport   ICAO code of the target airport (e.g., YBBN)
  --date      Date to process in YYYY-MM-DD format

Examples:
  pnpm pipeline:score --airport YBBN --date 2025-12-01
`;

const BATCH_SIZE = 1000;

function parseArgs(): RankArgs | null {
  const argv = minimist(process.argv.slice(2), {
    string: ["airport", "date"],
    alias: {
      a: "airport",
      d: "date",
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

  return { airport: airport.toUpperCase(), date };
}

async function main() {
  const args = parseArgs();
  if (!args) {
    process.exit(1);
  }

  console.log(`[score] Processing ${args.airport} on ${args.date}`);
  console.log(`[score] Cohort bucket: ${DEFAULT_COHORT_BUCKET_SEC} seconds`);
  console.log(`[score] Min cohort size: ${MIN_COHORT_SIZE}`);

  // Initialize database
  const dbPath = join(process.cwd(), "data", "db", "adsb.duckdb");

  if (!existsSync(dirname(dbPath))) {
    console.error(`[score] Database directory not found: ${dirname(dbPath)}`);
    console.error(
      "[score] Run derive first: pnpm pipeline:derive --airport <ICAO> --date <DATE>"
    );
    process.exit(1);
  }

  console.log(`[score] Opening database: ${dbPath}`);
  const db = await initRankDatabase(dbPath);
  const { connection } = db;

  // Check if ring_events has data for this airport/date
  const hasData = await hasRingEventsData(connection, args.airport, args.date);
  if (!hasData) {
    console.error(
      `[score] No ring_events data found for ${args.airport} on ${args.date}`
    );
    console.error(
      "[score] Run derive first: pnpm pipeline:derive --airport <ICAO> --date <DATE>"
    );
    closeRankDatabase(db);
    process.exit(1);
  }

  // Load ring events
  console.log("[score] Loading ring events...");
  const events = await loadRingEvents(connection, args.airport, args.date);
  console.log(`[score] Loaded ${events.length} ring events`);

  if (events.length === 0) {
    console.warn("[score] No ring events found - nothing to process");
    closeRankDatabase(db);
    process.exit(0);
  }

  // Group into cohorts
  console.log("[score] Grouping into cohorts...");
  const cohorts = groupIntoCohorts(events, DEFAULT_COHORT_BUCKET_SEC);
  console.log(`[score] Found ${cohorts.size} cohorts`);

  // Count cohorts that meet minimum size
  let validCohorts = 0;
  let totalMembers = 0;
  for (const [_, members] of cohorts) {
    if (members.length >= MIN_COHORT_SIZE) {
      validCohorts++;
      totalMembers += members.length;
    }
  }
  console.log(`[score] Valid cohorts (size >= ${MIN_COHORT_SIZE}): ${validCohorts}`);
  console.log(`[score] Total rankable events: ${totalMembers}`);

  // Compute ranks
  console.log("[score] Computing ranks...");
  const ranks = computeAllRanks(cohorts);
  console.log(`[score] Computed ${ranks.size} rank entries`);

  // Compute trajectories with deltas
  console.log("[score] Computing trajectories...");
  const arrivalRanks = computeTrajectories(cohorts, ranks);
  console.log(`[score] Generated ${arrivalRanks.length} arrival rank records`);

  // Fill in airport ICAO
  for (const rank of arrivalRanks) {
    rank.airportIcao = args.airport;
  }

  if (arrivalRanks.length === 0) {
    console.warn("[score] No ranks computed (all cohorts may be too small)");
    closeRankDatabase(db);
    process.exit(0);
  }

  // Insert arrival ranks in batches
  console.log("[score] Inserting arrival ranks into database...");
  let totalInserted = 0;
  for (let i = 0; i < arrivalRanks.length; i += BATCH_SIZE) {
    const batch = arrivalRanks.slice(i, i + BATCH_SIZE);
    const inserted = await insertArrivalRanks(db, batch, args.airport);
    totalInserted += inserted;

    const pct = Math.round(((i + batch.length) / arrivalRanks.length) * 100);
    process.stdout.write(
      `\r[score] Progress: ${pct}% (${totalInserted}/${arrivalRanks.length} records)`
    );
  }
  process.stdout.write("\n");

  // Update ring_events with rank values
  console.log("[score] Updating ring_events with rank values...");
  const updated = await updateRingEventRanks(connection, arrivalRanks);
  console.log(`[score] Updated ${updated} ring_events records`);

  // Get final count
  const rankCount = await getArrivalRankCount(db, args.airport, args.date);
  console.log(`[score] Database contains ${rankCount} arrival ranks for this date`);

  // Export to Parquet
  const parquetDir = join(process.cwd(), "data", "processed", args.date);
  const parquetPath = join(parquetDir, "arrival_ranks.parquet");

  console.log(`[score] Exporting to: ${parquetPath}`);
  await exportArrivalRanksToParquet(db, parquetPath, args.airport, args.date);

  // Close database
  closeRankDatabase(db);

  // Summary
  const uniqueAircraft = new Set(arrivalRanks.map((r) => r.icaoHex)).size;
  const uniqueArrivals = new Set(arrivalRanks.map((r) => r.arrivalId)).size;
  const ringSummary = [...new Set(arrivalRanks.map((r) => r.ringNm))]
    .sort((a, b) => b - a)
    .map((r) => {
      const count = arrivalRanks.filter((e) => e.ringNm === r).length;
      return `${r}nm: ${count}`;
    })
    .join(", ");

  // Calculate average rank movement (for inner rings)
  const withDeltas = arrivalRanks.filter((r) => r.deltaRankDistance !== null);
  const avgDeltaDistance =
    withDeltas.length > 0
      ? withDeltas.reduce((sum, r) => sum + Math.abs(r.deltaRankDistance!), 0) /
        withDeltas.length
      : 0;

  console.log("[score] Complete!");
  console.log(`  Aircraft: ${uniqueAircraft}`);
  console.log(`  Arrivals: ${uniqueArrivals}`);
  console.log(`  Rank records: ${arrivalRanks.length}`);
  console.log(`  Cohorts: ${validCohorts}`);
  console.log(`  By ring: ${ringSummary}`);
  console.log(`  Avg rank movement: ${avgDeltaDistance.toFixed(2)}`);
  console.log(`  Database: ${dbPath}`);
  console.log(`  Parquet: ${parquetPath}`);
}

main().catch((err) => {
  console.error("[score] Error:", err);
  process.exit(1);
});
