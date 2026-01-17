/**
 * Unit tests for sequence pipeline step
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ArrivalRankRow, WindowMetrics } from "./types.js";
import {
  DEFAULT_WINDOW_SIZE_MIN,
  DEFAULT_WINDOW_STEP_MIN,
  MIN_WINDOW_COHORT_SIZE,
  INNER_RING_THRESHOLD_NM,
} from "./types.js";
import { generateRollingWindows } from "./window.js";
import {
  computeRankVolatility,
  computeInversionCount,
  computeAvgInnerDensity,
  computeWindowMetrics,
} from "./metrics.js";
import { zScoreNormalize, computeSequenceScores } from "./score.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "../../test/fixtures");

interface FixtureRing {
  ringNm: number;
  crossTsUtc: string;
  rankDistance: number;
  deltaRankDistance: number | null;
  cohortSize: number;
}

interface FixtureArrival {
  arrivalId: string;
  icaoHex: string;
  rings: FixtureRing[];
}

interface SequenceFixture {
  description: string;
  arrivals: FixtureArrival[];
}

function loadSequenceFixture(filename: string): SequenceFixture {
  const path = join(fixturesDir, filename);
  const content = readFileSync(path, "utf-8");
  return JSON.parse(content);
}

function fixtureToRanks(fixture: SequenceFixture): ArrivalRankRow[] {
  const ranks: ArrivalRankRow[] = [];
  for (const arrival of fixture.arrivals) {
    for (const ring of arrival.rings) {
      ranks.push({
        arrivalId: arrival.arrivalId,
        icaoHex: arrival.icaoHex,
        ringNm: ring.ringNm,
        crossTsUtc: new Date(ring.crossTsUtc),
        rankDistance: ring.rankDistance,
        deltaRankDistance: ring.deltaRankDistance,
        cohortSize: ring.cohortSize,
      });
    }
  }
  // Sort by cross_ts_utc like the real data
  return ranks.sort((a, b) => a.crossTsUtc.getTime() - b.crossTsUtc.getTime());
}

describe("generateRollingWindows", () => {
  it("generates windows with correct size and step", () => {
    const ranks: ArrivalRankRow[] = [
      {
        arrivalId: "arr1",
        icaoHex: "7C1111",
        ringNm: 20,
        crossTsUtc: new Date("2025-12-01T10:00:00Z"),
        rankDistance: 1,
        deltaRankDistance: null,
        cohortSize: 3,
      },
      {
        arrivalId: "arr2",
        icaoHex: "7C2222",
        ringNm: 20,
        crossTsUtc: new Date("2025-12-01T10:05:00Z"),
        rankDistance: 2,
        deltaRankDistance: null,
        cohortSize: 3,
      },
      {
        arrivalId: "arr3",
        icaoHex: "7C3333",
        ringNm: 20,
        crossTsUtc: new Date("2025-12-01T10:10:00Z"),
        rankDistance: 3,
        deltaRankDistance: null,
        cohortSize: 3,
      },
    ];

    const windows = generateRollingWindows(ranks, 30, 5);

    // Should have windows starting at 10:00, 10:05, 10:10
    // Each window is 30 min, so 10:00 includes all 3, 10:05 includes arr2+arr3, etc.
    expect(windows.length).toBeGreaterThan(0);

    // First window should start at first event time
    expect(windows[0]!.startTs.getTime()).toBe(
      new Date("2025-12-01T10:00:00Z").getTime()
    );
  });

  it("excludes windows with fewer than MIN_WINDOW_COHORT_SIZE aircraft", () => {
    const ranks: ArrivalRankRow[] = [
      {
        arrivalId: "arr1",
        icaoHex: "7C1111",
        ringNm: 20,
        crossTsUtc: new Date("2025-12-01T10:00:00Z"),
        rankDistance: 1,
        deltaRankDistance: null,
        cohortSize: 2,
      },
      {
        arrivalId: "arr2",
        icaoHex: "7C2222",
        ringNm: 20,
        crossTsUtc: new Date("2025-12-01T11:00:00Z"), // 1 hour later, different window
        rankDistance: 1,
        deltaRankDistance: null,
        cohortSize: 2,
      },
    ];

    const windows = generateRollingWindows(ranks, 30, 5);

    // Each window has only 1 aircraft, so should be excluded
    // (MIN_WINDOW_COHORT_SIZE = 3)
    expect(windows.length).toBe(0);
  });

  it("returns empty array for empty input", () => {
    const windows = generateRollingWindows([]);
    expect(windows).toEqual([]);
  });

  it("creates window ID from epoch seconds", () => {
    const ranks: ArrivalRankRow[] = [
      {
        arrivalId: "arr1",
        icaoHex: "7C1111",
        ringNm: 20,
        crossTsUtc: new Date("2025-12-01T10:00:00Z"),
        rankDistance: 1,
        deltaRankDistance: null,
        cohortSize: 3,
      },
      {
        arrivalId: "arr2",
        icaoHex: "7C2222",
        ringNm: 20,
        crossTsUtc: new Date("2025-12-01T10:01:00Z"),
        rankDistance: 2,
        deltaRankDistance: null,
        cohortSize: 3,
      },
      {
        arrivalId: "arr3",
        icaoHex: "7C3333",
        ringNm: 20,
        crossTsUtc: new Date("2025-12-01T10:02:00Z"),
        rankDistance: 3,
        deltaRankDistance: null,
        cohortSize: 3,
      },
    ];

    const windows = generateRollingWindows(ranks, 30, 5);

    const expectedEpoch = Math.floor(
      new Date("2025-12-01T10:00:00Z").getTime() / 1000
    );
    expect(windows[0]!.windowId).toBe(String(expectedEpoch));
  });
});

describe("computeRankVolatility", () => {
  it("sums absolute delta values", () => {
    const arrivals: ArrivalRankRow[] = [
      {
        arrivalId: "arr1",
        icaoHex: "7C1111",
        ringNm: 20,
        crossTsUtc: new Date("2025-12-01T10:00:00Z"),
        rankDistance: 1,
        deltaRankDistance: 2,
        cohortSize: 3,
      },
      {
        arrivalId: "arr2",
        icaoHex: "7C2222",
        ringNm: 20,
        crossTsUtc: new Date("2025-12-01T10:00:10Z"),
        rankDistance: 2,
        deltaRankDistance: -1,
        cohortSize: 3,
      },
      {
        arrivalId: "arr3",
        icaoHex: "7C3333",
        ringNm: 20,
        crossTsUtc: new Date("2025-12-01T10:00:20Z"),
        rankDistance: 3,
        deltaRankDistance: -1,
        cohortSize: 3,
      },
    ];

    const volatility = computeRankVolatility(arrivals);

    // |2| + |-1| + |-1| = 4
    expect(volatility).toBe(4);
  });

  it("ignores null deltas", () => {
    const arrivals: ArrivalRankRow[] = [
      {
        arrivalId: "arr1",
        icaoHex: "7C1111",
        ringNm: 30,
        crossTsUtc: new Date("2025-12-01T10:00:00Z"),
        rankDistance: 1,
        deltaRankDistance: null, // First ring, no delta
        cohortSize: 3,
      },
      {
        arrivalId: "arr1",
        icaoHex: "7C1111",
        ringNm: 20,
        crossTsUtc: new Date("2025-12-01T10:05:00Z"),
        rankDistance: 2,
        deltaRankDistance: 1,
        cohortSize: 3,
      },
    ];

    const volatility = computeRankVolatility(arrivals);

    expect(volatility).toBe(1);
  });

  it("returns 0 for empty input", () => {
    expect(computeRankVolatility([])).toBe(0);
  });
});

describe("computeInversionCount", () => {
  it("detects inversion when A ahead at outer becomes behind at inner", () => {
    const arrivals: ArrivalRankRow[] = [
      // Aircraft A at 30nm: rank 1
      {
        arrivalId: "arr-A",
        icaoHex: "7CAAAA",
        ringNm: 30,
        crossTsUtc: new Date("2025-12-01T10:00:00Z"),
        rankDistance: 1,
        deltaRankDistance: null,
        cohortSize: 2,
      },
      // Aircraft B at 30nm: rank 2
      {
        arrivalId: "arr-B",
        icaoHex: "7CBBBB",
        ringNm: 30,
        crossTsUtc: new Date("2025-12-01T10:00:30Z"),
        rankDistance: 2,
        deltaRankDistance: null,
        cohortSize: 2,
      },
      // Aircraft A at 20nm: rank 2 (fell back)
      {
        arrivalId: "arr-A",
        icaoHex: "7CAAAA",
        ringNm: 20,
        crossTsUtc: new Date("2025-12-01T10:05:00Z"),
        rankDistance: 2,
        deltaRankDistance: 1,
        cohortSize: 2,
      },
      // Aircraft B at 20nm: rank 1 (moved ahead)
      {
        arrivalId: "arr-B",
        icaoHex: "7CBBBB",
        ringNm: 20,
        crossTsUtc: new Date("2025-12-01T10:05:30Z"),
        rankDistance: 1,
        deltaRankDistance: -1,
        cohortSize: 2,
      },
    ];

    const inversions = computeInversionCount(arrivals);

    // A was ahead at 30nm (rank 1 < rank 2), B is ahead at 20nm (rank 1 < rank 2)
    // This is one inversion
    expect(inversions).toBe(1);
  });

  it("returns 0 when ranks stay stable", () => {
    const arrivals: ArrivalRankRow[] = [
      {
        arrivalId: "arr-A",
        icaoHex: "7CAAAA",
        ringNm: 30,
        crossTsUtc: new Date("2025-12-01T10:00:00Z"),
        rankDistance: 1,
        deltaRankDistance: null,
        cohortSize: 2,
      },
      {
        arrivalId: "arr-B",
        icaoHex: "7CBBBB",
        ringNm: 30,
        crossTsUtc: new Date("2025-12-01T10:00:30Z"),
        rankDistance: 2,
        deltaRankDistance: null,
        cohortSize: 2,
      },
      {
        arrivalId: "arr-A",
        icaoHex: "7CAAAA",
        ringNm: 20,
        crossTsUtc: new Date("2025-12-01T10:05:00Z"),
        rankDistance: 1, // Still rank 1
        deltaRankDistance: 0,
        cohortSize: 2,
      },
      {
        arrivalId: "arr-B",
        icaoHex: "7CBBBB",
        ringNm: 20,
        crossTsUtc: new Date("2025-12-01T10:05:30Z"),
        rankDistance: 2, // Still rank 2
        deltaRankDistance: 0,
        cohortSize: 2,
      },
    ];

    const inversions = computeInversionCount(arrivals);

    expect(inversions).toBe(0);
  });

  it("requires 2+ shared rings to count inversions", () => {
    const arrivals: ArrivalRankRow[] = [
      // A only crosses 30nm
      {
        arrivalId: "arr-A",
        icaoHex: "7CAAAA",
        ringNm: 30,
        crossTsUtc: new Date("2025-12-01T10:00:00Z"),
        rankDistance: 1,
        deltaRankDistance: null,
        cohortSize: 2,
      },
      // B only crosses 20nm
      {
        arrivalId: "arr-B",
        icaoHex: "7CBBBB",
        ringNm: 20,
        crossTsUtc: new Date("2025-12-01T10:05:00Z"),
        rankDistance: 1,
        deltaRankDistance: null,
        cohortSize: 2,
      },
    ];

    const inversions = computeInversionCount(arrivals);

    // No shared rings, so no inversions possible
    expect(inversions).toBe(0);
  });

  it("returns 0 for empty input", () => {
    expect(computeInversionCount([])).toBe(0);
  });
});

describe("computeAvgInnerDensity", () => {
  it("computes average cohort size for inner rings", () => {
    const arrivals: ArrivalRankRow[] = [
      {
        arrivalId: "arr1",
        icaoHex: "7C1111",
        ringNm: 30, // Not inner (> 15nm)
        crossTsUtc: new Date("2025-12-01T10:00:00Z"),
        rankDistance: 1,
        deltaRankDistance: null,
        cohortSize: 5,
      },
      {
        arrivalId: "arr1",
        icaoHex: "7C1111",
        ringNm: 15, // Inner (= 15nm)
        crossTsUtc: new Date("2025-12-01T10:05:00Z"),
        rankDistance: 1,
        deltaRankDistance: 0,
        cohortSize: 4,
      },
      {
        arrivalId: "arr1",
        icaoHex: "7C1111",
        ringNm: 10, // Inner (< 15nm)
        crossTsUtc: new Date("2025-12-01T10:10:00Z"),
        rankDistance: 1,
        deltaRankDistance: 0,
        cohortSize: 3,
      },
    ];

    const density = computeAvgInnerDensity(arrivals);

    // Inner rings: 15nm (4) and 10nm (3) -> avg = 3.5
    expect(density).toBe(3.5);
  });

  it("returns 0 when no inner ring crossings", () => {
    const arrivals: ArrivalRankRow[] = [
      {
        arrivalId: "arr1",
        icaoHex: "7C1111",
        ringNm: 30,
        crossTsUtc: new Date("2025-12-01T10:00:00Z"),
        rankDistance: 1,
        deltaRankDistance: null,
        cohortSize: 5,
      },
      {
        arrivalId: "arr1",
        icaoHex: "7C1111",
        ringNm: 20,
        crossTsUtc: new Date("2025-12-01T10:05:00Z"),
        rankDistance: 1,
        deltaRankDistance: 0,
        cohortSize: 4,
      },
    ];

    const density = computeAvgInnerDensity(arrivals);

    expect(density).toBe(0);
  });

  it("returns 0 for empty input", () => {
    expect(computeAvgInnerDensity([])).toBe(0);
  });
});

describe("zScoreNormalize", () => {
  it("normalizes values to z-scores", () => {
    const values = [2, 4, 6, 8, 10];

    const zScores = zScoreNormalize(values);

    // Mean = 6, stddev = sqrt(8) ≈ 2.83
    // z(2) = (2-6)/2.83 ≈ -1.41
    // z(6) = 0
    // z(10) = (10-6)/2.83 ≈ 1.41
    expect(zScores[2]).toBeCloseTo(0, 5);
    expect(zScores[0]).toBeCloseTo(-zScores[4]!, 5);
  });

  it("returns all zeros when stddev is 0", () => {
    const values = [5, 5, 5, 5];

    const zScores = zScoreNormalize(values);

    expect(zScores).toEqual([0, 0, 0, 0]);
  });

  it("returns empty array for empty input", () => {
    expect(zScoreNormalize([])).toEqual([]);
  });
});

describe("computeSequenceScores", () => {
  it("combines z-scores from all metrics", () => {
    const metrics: WindowMetrics[] = [
      {
        windowId: "1000",
        windowStartTs: new Date("2025-12-01T10:00:00Z"),
        windowEndTs: new Date("2025-12-01T10:30:00Z"),
        rankVolatility: 10,
        inversionCount: 2,
        avgInnerDensity: 5,
        aircraftCount: 3,
        arrivalIds: ["arr1", "arr2", "arr3"],
      },
      {
        windowId: "1300",
        windowStartTs: new Date("2025-12-01T10:05:00Z"),
        windowEndTs: new Date("2025-12-01T10:35:00Z"),
        rankVolatility: 20,
        inversionCount: 4,
        avgInnerDensity: 6,
        aircraftCount: 4,
        arrivalIds: ["arr2", "arr3", "arr4", "arr5"],
      },
    ];

    const sequences = computeSequenceScores(metrics, "YBBN");

    expect(sequences.length).toBe(2);
    expect(sequences[0]!.sequenceId).toBe("YBBN_1000");
    expect(sequences[0]!.airportIcao).toBe("YBBN");

    // Second window has higher values, so should have positive z-scores
    expect(sequences[1]!.sequenceScore).toBeGreaterThan(
      sequences[0]!.sequenceScore
    );
  });

  it("returns empty array for empty input", () => {
    expect(computeSequenceScores([], "YBBN")).toEqual([]);
  });

  it("returns score of 0 for single window (no variance)", () => {
    const metrics: WindowMetrics[] = [
      {
        windowId: "1000",
        windowStartTs: new Date("2025-12-01T10:00:00Z"),
        windowEndTs: new Date("2025-12-01T10:30:00Z"),
        rankVolatility: 10,
        inversionCount: 2,
        avgInnerDensity: 5,
        aircraftCount: 3,
        arrivalIds: ["arr1", "arr2", "arr3"],
      },
    ];

    const sequences = computeSequenceScores(metrics, "YBBN");

    // Single window means stddev=0, so all z-scores=0
    expect(sequences[0]!.sequenceScore).toBe(0);
  });
});

describe("with synthetic high-churn fixture", () => {
  it("detects inversions from rank swaps", () => {
    const fixture = loadSequenceFixture("synthetic-sequence-high-churn.json");
    const ranks = fixtureToRanks(fixture);

    const inversions = computeInversionCount(ranks);

    // Fixture has clear inversions:
    // arr-alpha: 1 -> 2 -> 3
    // arr-bravo: 2 -> 1 -> 2
    // arr-charlie: 3 -> 3 -> 1
    // Between 30nm and 20nm: alpha vs bravo inversion
    // Between 20nm and 10nm: bravo vs charlie inversion, alpha vs charlie inversion
    expect(inversions).toBeGreaterThan(0);
  });

  it("computes non-zero volatility from rank changes", () => {
    const fixture = loadSequenceFixture("synthetic-sequence-high-churn.json");
    const ranks = fixtureToRanks(fixture);

    const volatility = computeRankVolatility(ranks);

    // Fixture has delta values: 1, 1, -1, 1, 0, -2 = 6 total volatility
    expect(volatility).toBe(6);
  });
});

describe("determinism", () => {
  it("produces identical scores for same input", () => {
    const fixture = loadSequenceFixture("synthetic-sequence-high-churn.json");
    const ranks = fixtureToRanks(fixture);

    const windows1 = generateRollingWindows(ranks, 30, 5);
    const metrics1 = windows1.map(computeWindowMetrics);
    const scores1 = computeSequenceScores(metrics1, "TEST");

    const windows2 = generateRollingWindows(ranks, 30, 5);
    const metrics2 = windows2.map(computeWindowMetrics);
    const scores2 = computeSequenceScores(metrics2, "TEST");

    expect(scores1.length).toBe(scores2.length);
    for (let i = 0; i < scores1.length; i++) {
      expect(scores1[i]!.sequenceScore).toBe(scores2[i]!.sequenceScore);
      expect(scores1[i]!.rankVolatility).toBe(scores2[i]!.rankVolatility);
      expect(scores1[i]!.inversionCount).toBe(scores2[i]!.inversionCount);
    }
  });
});

describe("edge cases", () => {
  it("handles window with exactly MIN_WINDOW_COHORT_SIZE aircraft", () => {
    const ranks: ArrivalRankRow[] = [
      {
        arrivalId: "arr1",
        icaoHex: "7C1111",
        ringNm: 20,
        crossTsUtc: new Date("2025-12-01T10:00:00Z"),
        rankDistance: 1,
        deltaRankDistance: null,
        cohortSize: 3,
      },
      {
        arrivalId: "arr2",
        icaoHex: "7C2222",
        ringNm: 20,
        crossTsUtc: new Date("2025-12-01T10:01:00Z"),
        rankDistance: 2,
        deltaRankDistance: null,
        cohortSize: 3,
      },
      {
        arrivalId: "arr3",
        icaoHex: "7C3333",
        ringNm: 20,
        crossTsUtc: new Date("2025-12-01T10:02:00Z"),
        rankDistance: 3,
        deltaRankDistance: null,
        cohortSize: 3,
      },
    ];

    const windows = generateRollingWindows(ranks, 30, 5);

    expect(windows.length).toBeGreaterThan(0);
    expect(windows[0]!.arrivalIds.length).toBe(3);
  });

  it("handles multiple rings for same aircraft in window", () => {
    const ranks: ArrivalRankRow[] = [
      {
        arrivalId: "arr1",
        icaoHex: "7C1111",
        ringNm: 30,
        crossTsUtc: new Date("2025-12-01T10:00:00Z"),
        rankDistance: 1,
        deltaRankDistance: null,
        cohortSize: 3,
      },
      {
        arrivalId: "arr1",
        icaoHex: "7C1111",
        ringNm: 20,
        crossTsUtc: new Date("2025-12-01T10:05:00Z"),
        rankDistance: 1,
        deltaRankDistance: 0,
        cohortSize: 3,
      },
      {
        arrivalId: "arr1",
        icaoHex: "7C1111",
        ringNm: 10,
        crossTsUtc: new Date("2025-12-01T10:10:00Z"),
        rankDistance: 1,
        deltaRankDistance: 0,
        cohortSize: 3,
      },
      {
        arrivalId: "arr2",
        icaoHex: "7C2222",
        ringNm: 30,
        crossTsUtc: new Date("2025-12-01T10:00:30Z"),
        rankDistance: 2,
        deltaRankDistance: null,
        cohortSize: 3,
      },
      {
        arrivalId: "arr2",
        icaoHex: "7C2222",
        ringNm: 20,
        crossTsUtc: new Date("2025-12-01T10:05:30Z"),
        rankDistance: 2,
        deltaRankDistance: 0,
        cohortSize: 3,
      },
      {
        arrivalId: "arr3",
        icaoHex: "7C3333",
        ringNm: 30,
        crossTsUtc: new Date("2025-12-01T10:01:00Z"),
        rankDistance: 3,
        deltaRankDistance: null,
        cohortSize: 3,
      },
    ];

    const windows = generateRollingWindows(ranks, 30, 5);

    // Window should count unique aircraft, not events
    expect(windows[0]!.arrivalIds.length).toBe(3);
    expect(windows[0]!.arrivals.length).toBeGreaterThan(3);
  });
});
