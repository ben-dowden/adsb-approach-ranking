/**
 * Sequence script - identifies arrival windows with unusual sequencing churn
 *
 * Usage: pnpm pipeline:sequence --airport YBBN --date 2025-12-01
 *
 * Expected input: arrival_ranks from score stage
 * Output: arrival_sequences table + parquet export
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import minimist from "minimist";
import {
  type SequenceArgs,
  DEFAULT_WINDOW_SIZE_MIN,
  DEFAULT_WINDOW_STEP_MIN,
  MIN_WINDOW_COHORT_SIZE,
  MIN_RINGS_PER_ARRIVAL,
  initSequenceDatabase,
  hasArrivalRanksData,
  loadArrivalRanks,
  filterByMinRings,
  insertArrivalSequences,
  exportSequencesToParquet,
  getArrivalSequenceCount,
  closeSequenceDatabase,
  generateRollingWindows,
  computeWindowMetrics,
  computeSequenceScores,
} from "../sequence/index.js";

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
Usage: pnpm pipeline:sequence --airport <ICAO> --date <YYYY-MM-DD>

Options:
  --airport   ICAO code of the target airport (e.g., YBBN)
  --date      Date to process in YYYY-MM-DD format

Examples:
  pnpm pipeline:sequence --airport YBBN --date 2025-12-01
`;

const BATCH_SIZE = 1000;

function parseArgs(): SequenceArgs | null {
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

  console.log(`[sequence] Processing ${args.airport} on ${args.date}`);
  console.log(`[sequence] Window size: ${DEFAULT_WINDOW_SIZE_MIN} minutes`);
  console.log(`[sequence] Window step: ${DEFAULT_WINDOW_STEP_MIN} minutes`);
  console.log(`[sequence] Min aircraft per window: ${MIN_WINDOW_COHORT_SIZE}`);
  console.log(`[sequence] Min rings per arrival: ${MIN_RINGS_PER_ARRIVAL}`);

  // Initialize database
  const dbPath = join(process.cwd(), "data", "db", "adsb.duckdb");

  if (!existsSync(dirname(dbPath))) {
    console.error(`[sequence] Database directory not found: ${dirname(dbPath)}`);
    console.error(
      "[sequence] Run score first: pnpm pipeline:score --airport <ICAO> --date <DATE>"
    );
    process.exit(1);
  }

  console.log(`[sequence] Opening database: ${dbPath}`);
  const db = await initSequenceDatabase(dbPath);
  const { connection } = db;

  // Check if arrival_ranks has data for this airport/date
  const hasData = await hasArrivalRanksData(connection, args.airport, args.date);
  if (!hasData) {
    console.error(
      `[sequence] No arrival_ranks data found for ${args.airport} on ${args.date}`
    );
    console.error(
      "[sequence] Run score first: pnpm pipeline:score --airport <ICAO> --date <DATE>"
    );
    closeSequenceDatabase(db);
    process.exit(1);
  }

  // Load arrival ranks
  console.log("[sequence] Loading arrival ranks...");
  const allRanks = await loadArrivalRanks(connection, args.airport, args.date);
  console.log(`[sequence] Loaded ${allRanks.length} arrival rank records`);

  if (allRanks.length === 0) {
    console.warn("[sequence] No arrival ranks found - nothing to process");
    closeSequenceDatabase(db);
    process.exit(0);
  }

  // Filter to only include arrivals with sufficient ring crossings
  console.log("[sequence] Filtering arrivals by minimum ring crossings...");
  const ranks = filterByMinRings(allRanks);
  console.log(`[sequence] Retained ${ranks.length} rank records after filtering`);

  if (ranks.length === 0) {
    console.warn("[sequence] No arrivals with sufficient ring crossings - nothing to process");
    closeSequenceDatabase(db);
    process.exit(0);
  }

  // Generate rolling windows
  console.log("[sequence] Generating rolling windows...");
  const windows = generateRollingWindows(
    ranks,
    DEFAULT_WINDOW_SIZE_MIN,
    DEFAULT_WINDOW_STEP_MIN
  );
  console.log(`[sequence] Generated ${windows.length} valid windows`);

  if (windows.length === 0) {
    console.warn(
      `[sequence] No windows with >= ${MIN_WINDOW_COHORT_SIZE} aircraft - nothing to process`
    );
    closeSequenceDatabase(db);
    process.exit(0);
  }

  // Compute metrics for each window
  console.log("[sequence] Computing window metrics...");
  const metrics = windows.map(computeWindowMetrics);

  // Compute sequence scores (z-score normalization)
  console.log("[sequence] Computing sequence scores...");
  const sequences = computeSequenceScores(metrics, args.airport);

  // Insert sequences in batches
  console.log("[sequence] Inserting arrival sequences into database...");
  let totalInserted = 0;
  for (let i = 0; i < sequences.length; i += BATCH_SIZE) {
    const batch = sequences.slice(i, i + BATCH_SIZE);
    const inserted = await insertArrivalSequences(db, batch, args.airport);
    totalInserted += inserted;

    const pct = Math.round(((i + batch.length) / sequences.length) * 100);
    process.stdout.write(
      `\r[sequence] Progress: ${pct}% (${totalInserted}/${sequences.length} records)`
    );
  }
  process.stdout.write("\n");

  // Get final count
  const seqCount = await getArrivalSequenceCount(db, args.airport, args.date);
  console.log(
    `[sequence] Database contains ${seqCount} arrival sequences for this date`
  );

  // Export to Parquet
  const parquetDir = join(process.cwd(), "data", "processed", args.date);
  const parquetPath = join(parquetDir, "arrival_sequences.parquet");

  console.log(`[sequence] Exporting to: ${parquetPath}`);
  await exportSequencesToParquet(db, parquetPath, args.airport, args.date);

  // Close database
  closeSequenceDatabase(db);

  // Summary statistics
  const sortedByScore = [...sequences].sort(
    (a, b) => b.sequenceScore - a.sequenceScore
  );
  const top5 = sortedByScore.slice(0, 5);

  const totalVolatility = sequences.reduce((sum, s) => sum + s.rankVolatility, 0);
  const totalInversions = sequences.reduce((sum, s) => sum + s.inversionCount, 0);
  const avgDensity =
    sequences.reduce((sum, s) => sum + s.avgInnerDensity, 0) / sequences.length;
  const avgAircraft =
    sequences.reduce((sum, s) => sum + s.aircraftCount, 0) / sequences.length;

  console.log("[sequence] Complete!");
  console.log(`  Windows: ${sequences.length}`);
  console.log(`  Total rank volatility: ${totalVolatility}`);
  console.log(`  Total inversions: ${totalInversions}`);
  console.log(`  Avg inner density: ${avgDensity.toFixed(2)}`);
  console.log(`  Avg aircraft per window: ${avgAircraft.toFixed(1)}`);
  console.log(`  Database: ${dbPath}`);
  console.log(`  Parquet: ${parquetPath}`);

  if (top5.length > 0) {
    console.log("\n  Top 5 sequences by score:");
    for (const seq of top5) {
      const startTime = seq.windowStartTs.toISOString().slice(11, 19);
      console.log(
        `    ${seq.sequenceId}: score=${seq.sequenceScore.toFixed(2)}, ` +
          `volatility=${seq.rankVolatility}, inversions=${seq.inversionCount}, ` +
          `aircraft=${seq.aircraftCount}, start=${startTime}`
      );
    }
  }
}

main().catch((err) => {
  console.error("[sequence] Error:", err);
  process.exit(1);
});
