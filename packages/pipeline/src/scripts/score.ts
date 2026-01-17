/**
 * Score script - identifies cohorts, computes ranks, and scores sequences
 *
 * Usage: pnpm pipeline:score
 *
 * Expected input: ring_events from derive stage
 * Output: Enriched ring_events with ranks + sequences with scores
 */

import { loadConfig } from "../config.js";

async function main() {
  const config = loadConfig();
  console.log(`[score] Starting scoring for ${config.airportIcao}`);
  console.log(`[score] Cohort window: ${config.cohortWindowSec} seconds`);

  // TODO: Implement cohort identification and scoring
  // 1. Load ring_events from data/processed/
  // 2. Group aircraft crossing same ring within time window
  // 3. Compute rank_distance and rank_ttg within each cohort
  // 4. Track rank changes across rings
  // 5. Calculate score_rank_vol and score_inversions
  // 6. Write enriched ring_events and sequences

  console.log("[score] Not yet implemented - see docs/architecture.md");
}

main().catch((err) => {
  console.error("[score] Error:", err);
  process.exit(1);
});
