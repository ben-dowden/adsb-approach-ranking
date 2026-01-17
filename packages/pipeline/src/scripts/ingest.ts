/**
 * Ingest script - downloads raw ADS-B data from S3
 *
 * Usage:
 *   pnpm pipeline:ingest --airport YBBN --date 2025-01-01
 *   pnpm pipeline:ingest --airport YBBN --date 2025-01-01 --startHH 6 --endHH 12
 */

import { config } from "dotenv";
import { dirname, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Load .env from monorepo root (four levels up from this script's directory)
const __dirname = dirname(fileURLToPath(import.meta.url));
const monorepoRoot = resolve(__dirname, "../../../..");
const envPath = join(monorepoRoot, ".env");
if (existsSync(envPath)) {
  config({ path: envPath });
} else {
  // Fallback to cwd for local development
  config();
}
import minimist from "minimist";
import {
  loadS3Config,
  createS3Client,
  listObjects,
  downloadAll,
  readManifest,
  appendManifest,
  createManifestEntry,
  type IngestArgs,
  type S3ObjectInfo,
} from "../s3/index.js";

const USAGE = `
Usage: pnpm pipeline:ingest --airport <ICAO> --date <YYYY-MM-DD> [--startHH <0-23>] [--endHH <0-23>]

Options:
  --airport   ICAO code of the target airport (e.g., YBBN)
  --date      Date to download in YYYY-MM-DD format
  --startHH   Start hour (inclusive, 0-23) - optional
  --endHH     End hour (exclusive, 0-23) - optional

Examples:
  pnpm pipeline:ingest --airport YBBN --date 2025-01-01
  pnpm pipeline:ingest --airport YBBN --date 2025-01-01 --startHH 6 --endHH 12
`;

function parseArgs(): IngestArgs | null {
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

  const args: IngestArgs = { airport, date };

  // Parse optional hour range
  if (argv.startHH !== undefined) {
    const startHH = parseInt(String(argv.startHH), 10);
    if (isNaN(startHH) || startHH < 0 || startHH > 23) {
      console.error("Error: --startHH must be between 0 and 23");
      return null;
    }
    args.startHH = startHH;
  }

  if (argv.endHH !== undefined) {
    const endHH = parseInt(String(argv.endHH), 10);
    if (isNaN(endHH) || endHH < 0 || endHH > 24) {
      console.error("Error: --endHH must be between 0 and 24");
      return null;
    }
    args.endHH = endHH;
  }

  return args;
}

async function main() {
  const args = parseArgs();
  if (!args) {
    process.exit(1);
  }

  console.log(`[ingest] Starting download for ${args.airport} on ${args.date}`);
  if (args.startHH !== undefined || args.endHH !== undefined) {
    console.log(
      `[ingest] Hour filter: ${args.startHH ?? 0}:00 - ${args.endHH ?? 24}:00`
    );
  }

  // Load S3 configuration
  let s3Config;
  try {
    s3Config = loadS3Config();
  } catch (error) {
    console.error(
      `[ingest] ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }

  console.log(`[ingest] Using bucket: ${s3Config.bucket}`);

  // Create S3 client
  const client = createS3Client(s3Config);

  // Set up output directory
  const outputDir = join(process.cwd(), "data", "raw", args.date);
  const manifestPath = join(outputDir, "manifest.jsonl");

  // Read existing manifest to skip already-downloaded files
  console.log("[ingest] Reading existing manifest...");
  const existingManifest = await readManifest(manifestPath);
  console.log(`[ingest] Found ${existingManifest.size} existing entries`);

  // List objects from S3
  console.log("[ingest] Listing objects from S3...");
  let allObjects: S3ObjectInfo[];
  try {
    allObjects = await listObjects(
      client,
      s3Config.bucket,
      args.date,
      args.startHH,
      args.endHH
    );
  } catch (error) {
    console.error(
      `[ingest] Failed to list objects: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }

  console.log(`[ingest] Found ${allObjects.length} objects matching criteria`);

  // Filter out already-downloaded objects
  const objectsToDownload = allObjects.filter(
    (obj) => !existingManifest.has(obj.key)
  );

  if (objectsToDownload.length === 0) {
    console.log("[ingest] All files already downloaded, nothing to do");
    return;
  }

  console.log(`[ingest] Downloading ${objectsToDownload.length} new files...`);

  // Download with progress
  const results = await downloadAll(
    client,
    s3Config.bucket,
    objectsToDownload,
    outputDir,
    (completed, total, current) => {
      if (current !== "complete") {
        const pct = Math.round((completed / total) * 100);
        process.stdout.write(`\r[ingest] Progress: ${pct}% (${completed}/${total})`);
      } else {
        process.stdout.write("\n");
      }
    }
  );

  // Update manifest with successful downloads
  let downloaded = 0;
  let skipped = 0;
  let errors = 0;

  for (const result of results) {
    if (result.error) {
      errors++;
      console.error(`[ingest] Error downloading ${result.key}: ${result.error}`);
    } else if (result.skipped) {
      skipped++;
    } else {
      downloaded++;
      // Find the original object info
      const obj = objectsToDownload.find((o) => o.key === result.key);
      if (obj) {
        const entry = createManifestEntry(obj, result.localPath);
        await appendManifest(manifestPath, entry);
      }
    }
  }

  // Summary
  console.log("[ingest] Download complete:");
  console.log(`  Downloaded: ${downloaded}`);
  console.log(`  Skipped (existing): ${skipped}`);
  if (errors > 0) {
    console.log(`  Errors: ${errors}`);
  }
  console.log(`[ingest] Output directory: ${outputDir}`);
  console.log(`[ingest] Manifest: ${manifestPath}`);
}

main().catch((err) => {
  console.error("[ingest] Error:", err);
  process.exit(1);
});
