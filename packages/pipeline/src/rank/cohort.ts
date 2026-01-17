/**
 * Cohort identification from ring_events
 *
 * Groups aircraft that cross the same ring at approximately the same time
 * into cohorts for ranking purposes.
 */

import type { CohortMember } from "./types.js";
import type { RingEventRow } from "./db.js";

/** Cohort grouping key: "ring_nm:bucket_ts" */
type CohortKey = string;

/** Default bucket size for cohort grouping (seconds) */
export const DEFAULT_COHORT_BUCKET_SEC = 300; // 5 minutes

/**
 * Create a cohort key from ring and timestamp bucket
 */
function makeCohortKey(ringNm: number, bucketTs: number): CohortKey {
  return `${ringNm}:${bucketTs}`;
}

/**
 * Get the bucket timestamp for a given crossing time
 * @param ts Timestamp
 * @param bucketSizeSec Bucket size in seconds
 * @returns Bucket timestamp (rounded down to nearest bucket)
 */
function getBucket(ts: Date, bucketSizeSec: number): number {
  const sec = Math.floor(ts.getTime() / 1000);
  return Math.floor(sec / bucketSizeSec) * bucketSizeSec;
}

/**
 * Group ring events into cohorts based on ring and time bucket
 *
 * Aircraft crossing the same ring within the same time bucket form a cohort.
 * Returns a map of cohort key to list of cohort members.
 *
 * @param events Ring events from database
 * @param bucketSizeSec Time bucket size in seconds (default: 300 = 5 minutes)
 * @returns Map of cohort key to cohort members
 */
export function groupIntoCohorts(
  events: RingEventRow[],
  bucketSizeSec: number = DEFAULT_COHORT_BUCKET_SEC
): Map<CohortKey, CohortMember[]> {
  const cohorts = new Map<CohortKey, CohortMember[]>();

  for (const event of events) {
    const bucketTs = getBucket(event.crossTsUtc, bucketSizeSec);
    const key = makeCohortKey(event.ringNm, bucketTs);

    const member: CohortMember = {
      arrivalId: event.arrivalId,
      icaoHex: event.icaoHex,
      ringNm: event.ringNm,
      crossTsUtc: event.crossTsUtc,
      distanceNm: event.distanceNm,
      closingRate: event.closingRate,
    };

    const existing = cohorts.get(key);
    if (existing) {
      existing.push(member);
    } else {
      cohorts.set(key, [member]);
    }
  }

  return cohorts;
}

/**
 * Parse cohort key back into ring and bucket timestamp
 */
export function parseCohortKey(key: CohortKey): { ringNm: number; bucketTs: number } {
  const [ringStr, tsStr] = key.split(":");
  return {
    ringNm: parseInt(ringStr!, 10),
    bucketTs: parseInt(tsStr!, 10),
  };
}
