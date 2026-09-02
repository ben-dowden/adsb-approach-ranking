import { describe, expect, it } from "vitest";

import type { S3ObjectInfo } from "../s3/types.js";
import {
  discoverCompleteDays,
  firstOfMonthDates,
  sampledObjectsForDay,
} from "./sampling.js";

function object(stamp: string): S3ObjectInfo {
  return {
    key: `readsb-hist/2025/12/01/${stamp}Z.json.gz`,
    size: 100,
    lastModified: new Date("2025-12-02T00:00:00Z"),
    etag: stamp,
  };
}

function completeDay(): S3ObjectInfo[] {
  return Array.from({ length: 288 }, (_, index) => {
    const totalMinutes = index * 5;
    const hours = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
    const minutes = String(totalMinutes % 60).padStart(2, "0");
    return object(`${hours}${minutes}00`);
  });
}

describe("sampledObjectsForDay", () => {
  it("keeps only exact five-minute boundaries", () => {
    const result = sampledObjectsForDay(
      [object("000000"), object("000005"), object("000500"), object("001000")],
      5
    );

    expect(result.objects.map((item) => item.key)).toEqual([
      object("000000").key,
      object("000500").key,
      object("001000").key,
    ]);
    expect(result.expectedCount).toBe(288);
    expect(result.complete).toBe(false);
  });

  it("marks all 288 five-minute timestamps complete", () => {
    const result = sampledObjectsForDay(completeDay(), 5);

    expect(result.complete).toBe(true);
    expect(result.missingTimestamps).toEqual([]);
  });

  it("rejects invalid sampling intervals", () => {
    expect(() => sampledObjectsForDay([], 7)).toThrow(
      "Sampling interval must divide evenly into 1,440 minutes"
    );
  });
});

describe("firstOfMonthDates", () => {
  it("generates descending UTC first-of-month dates", () => {
    expect(firstOfMonthDates("2026-09-02", 3)).toEqual([
      "2026-09-01",
      "2026-08-01",
      "2026-07-01",
    ]);
  });
});

describe("discoverCompleteDays", () => {
  it("skips incomplete months and stops after the requested complete days", async () => {
    const discovered = await discoverCompleteDays({
      asOf: "2026-09-02",
      requiredDays: 2,
      maximumLookbackMonths: 4,
      intervalMinutes: 5,
      listForDate: async (date) =>
        date === "2026-09-01"
          ? completeDay().slice(0, 287)
          : date === "2026-08-01" || date === "2026-07-01"
            ? completeDay()
            : [],
    });

    expect(discovered.selected.map((day) => day.date)).toEqual([
      "2026-08-01",
      "2026-07-01",
    ]);
    expect(discovered.candidates.map((day) => day.reason)).toEqual([
      "incomplete",
      "complete",
      "complete",
    ]);
  });
});
