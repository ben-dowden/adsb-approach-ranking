/**
 * Derive script - computes ring crossings and kinematic features
 *
 * Usage: pnpm pipeline:derive
 *
 * Expected input: aircraft_states from ingest stage
 * Output: ring_events with crossing timestamps and kinematics
 */

import { loadConfig } from "../config.js";

async function main() {
  const config = loadConfig();
  console.log(`[derive] Starting derivation for ${config.airportIcao}`);
  console.log(`[derive] Ring distances: ${config.ringDistances.join(", ")} NM`);

  // TODO: Implement ring crossing detection
  // 1. Load aircraft_states from data/processed/
  // 2. Sort by (icao, timestamp)
  // 3. Compute closing_rate between consecutive states
  // 4. Detect ring boundary crossings
  // 5. Write ring_events to data/processed/ring_events/

  console.log("[derive] Not yet implemented - see docs/architecture.md");
}

main().catch((err) => {
  console.error("[derive] Error:", err);
  process.exit(1);
});
