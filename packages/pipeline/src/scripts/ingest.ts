/**
 * Ingest script - loads raw ADS-B data from source files
 *
 * Usage: pnpm pipeline:ingest
 *
 * Expected input: ADS-B Exchange sample files (JSON lines or CSV)
 * Output: Raw state vectors as structured data
 */

import { loadConfig } from "../config.js";

async function main() {
  const config = loadConfig();
  console.log(`[ingest] Starting ingest for ${config.airportIcao}`);
  console.log(`[ingest] Max distance: ${config.maxDistanceNm} NM`);
  console.log(`[ingest] Max altitude: ${config.maxAltitudeFt} ft`);

  // TODO: Implement data loading from ADS-B Exchange files
  // 1. Read input files from data/raw/
  // 2. Parse JSON lines or CSV format
  // 3. Write to data/processed/aircraft_states/

  console.log("[ingest] Not yet implemented - see docs/architecture.md");
}

main().catch((err) => {
  console.error("[ingest] Error:", err);
  process.exit(1);
});
