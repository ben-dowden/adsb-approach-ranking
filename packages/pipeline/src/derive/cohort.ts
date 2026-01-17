/**
 * Traffic count approximation for cohort analysis
 */

import type { DuckDBConnection } from "@duckdb/node-api";
import { DEFAULT_BUCKET_SIZE_SEC } from "./types.js";

/** Cache key: timestamp bucket + ring */
type CacheKey = string;

/** Traffic count cache: Map<"tsBucket:ringNm", count> */
export type TrafficCache = Map<CacheKey, number>;

/**
 * Create a cache key from timestamp and ring
 */
function makeCacheKey(tsBucket: number, ringNm: number): CacheKey {
  return `${tsBucket}:${ringNm}`;
}

/**
 * Get the bucket for a timestamp
 * @param ts Timestamp
 * @param bucketSizeSec Bucket size in seconds
 * @returns Bucket timestamp (rounded down)
 */
function getBucket(ts: Date, bucketSizeSec: number): number {
  const sec = Math.floor(ts.getTime() / 1000);
  return Math.floor(sec / bucketSizeSec) * bucketSizeSec;
}

/**
 * Precompute traffic counts at each ring distance for time buckets
 * Uses efficient SQL aggregation rather than per-crossing queries
 *
 * @param connection DuckDB connection
 * @param airportIcao Airport ICAO code
 * @param date Date string (YYYY-MM-DD)
 * @param rings Ring distances to compute counts for
 * @param bucketSizeSec Time bucket size in seconds (default: 5)
 * @returns Cache mapping (tsBucket, ringNm) to traffic count
 */
export async function precomputeTrafficCounts(
  connection: DuckDBConnection,
  airportIcao: string,
  date: string,
  rings: number[],
  bucketSizeSec: number = DEFAULT_BUCKET_SIZE_SEC
): Promise<TrafficCache> {
  const cache: TrafficCache = new Map();

  // For each ring, count distinct aircraft within that distance at each time bucket
  // This query counts how many unique aircraft were inside each ring at each time bucket
  for (const ringNm of rings) {
    const result = await connection.run(`
      SELECT
        CAST(FLOOR(EPOCH(ts) / ${bucketSizeSec}) * ${bucketSizeSec} AS INTEGER) as ts_bucket,
        COUNT(DISTINCT icao) as aircraft_count
      FROM aircraft_states
      WHERE airport_icao = '${airportIcao}'
        AND DATE(ts) = '${date}'
        AND distance_nm <= ${ringNm}
      GROUP BY ts_bucket
      ORDER BY ts_bucket
    `);

    // Use chunk-based iteration for reliable reading
    while (true) {
      const chunk = await result.fetchChunk();
      if (chunk.rowCount === 0) break;
      const rows = chunk.getRows();
      for (const row of rows) {
        const tsBucket = Number(row[0]);
        const count = Number(row[1]);
        const key = makeCacheKey(tsBucket, ringNm);
        cache.set(key, count);
      }
    }
  }

  return cache;
}

/**
 * Look up traffic count from cache for a given crossing
 * @param cache Precomputed traffic cache
 * @param crossTs Crossing timestamp
 * @param ringNm Ring distance
 * @param bucketSizeSec Time bucket size (must match precomputation)
 * @returns Traffic count at nearest bucket, or 0 if not found
 */
export function lookupTrafficCount(
  cache: TrafficCache,
  crossTs: Date,
  ringNm: number,
  bucketSizeSec: number = DEFAULT_BUCKET_SIZE_SEC
): number {
  const tsBucket = getBucket(crossTs, bucketSizeSec);
  const key = makeCacheKey(tsBucket, ringNm);
  return cache.get(key) ?? 0;
}
