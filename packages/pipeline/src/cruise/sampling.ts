import type { S3ObjectInfo } from "../s3/types.js";
import type {
  CoverageCandidate,
  CoverageDiscovery,
  SampledDay,
} from "./types.js";

const MINUTES_PER_DAY = 24 * 60;
const ARCHIVE_TIMESTAMP_PATTERN = /\/(\d{6})Z\.json\.gz$/;

function timestampFromKey(key: string): string | null {
  return key.match(ARCHIVE_TIMESTAMP_PATTERN)?.[1] ?? null;
}

function expectedTimestamps(intervalMinutes: number): string[] {
  if (
    !Number.isInteger(intervalMinutes) ||
    intervalMinutes <= 0 ||
    MINUTES_PER_DAY % intervalMinutes !== 0
  ) {
    throw new Error("Sampling interval must divide evenly into 1,440 minutes");
  }

  const timestamps: string[] = [];
  for (let minute = 0; minute < MINUTES_PER_DAY; minute += intervalMinutes) {
    const hours = String(Math.floor(minute / 60)).padStart(2, "0");
    const minutes = String(minute % 60).padStart(2, "0");
    timestamps.push(`${hours}${minutes}00`);
  }
  return timestamps;
}

export function sampledObjectsForDay(
  objects: S3ObjectInfo[],
  intervalMinutes: number
): SampledDay {
  const expected = expectedTimestamps(intervalMinutes);
  const expectedSet = new Set(expected);
  const selectedByTimestamp = new Map<string, S3ObjectInfo>();

  for (const object of objects) {
    const timestamp = timestampFromKey(object.key);
    if (timestamp && expectedSet.has(timestamp)) {
      selectedByTimestamp.set(timestamp, object);
    }
  }

  const missingTimestamps = expected.filter(
    (timestamp) => !selectedByTimestamp.has(timestamp)
  );
  const sampledObjects = [...selectedByTimestamp.values()].sort((left, right) =>
    left.key.localeCompare(right.key)
  );

  return {
    objects: sampledObjects,
    expectedCount: expected.length,
    complete:
      sampledObjects.length === expected.length && missingTimestamps.length === 0,
    missingTimestamps,
  };
}

export function firstOfMonthDates(asOf: string, count: number): string[] {
  const asOfDate = new Date(`${asOf}T00:00:00Z`);
  if (Number.isNaN(asOfDate.getTime())) {
    throw new Error(`Invalid as-of date: ${asOf}`);
  }
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error("Month count must be a positive integer");
  }

  return Array.from({ length: count }, (_, index) => {
    const date = new Date(
      Date.UTC(asOfDate.getUTCFullYear(), asOfDate.getUTCMonth() - index, 1)
    );
    return date.toISOString().slice(0, 10);
  });
}

function coverageCandidate(
  date: string,
  discoveredObjects: S3ObjectInfo[],
  intervalMinutes: number
): CoverageCandidate {
  const sampled = sampledObjectsForDay(discoveredObjects, intervalMinutes);
  return {
    date,
    discoveredCount: discoveredObjects.length,
    ...sampled,
    reason: sampled.complete
      ? "complete"
      : discoveredObjects.length > 0
        ? "incomplete"
        : "unavailable",
  };
}

export async function discoverCompleteDays(options: {
  asOf: string;
  requiredDays: number;
  maximumLookbackMonths: number;
  intervalMinutes: number;
  listForDate: (date: string) => Promise<S3ObjectInfo[]>;
}): Promise<CoverageDiscovery> {
  const dates = firstOfMonthDates(options.asOf, options.maximumLookbackMonths);
  const candidates: CoverageCandidate[] = [];

  for (const date of dates) {
    const discoveredObjects = await options.listForDate(date);
    candidates.push(
      coverageCandidate(date, discoveredObjects, options.intervalMinutes)
    );
    if (candidates.filter((candidate) => candidate.complete).length >= options.requiredDays) {
      break;
    }
  }

  return {
    selected: candidates
      .filter((candidate) => candidate.complete)
      .slice(0, options.requiredDays),
    candidates,
  };
}
