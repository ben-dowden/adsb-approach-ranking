/**
 * Unit tests for rank pipeline step
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { CohortMember, ArrivalRank } from "./types.js";
import { TTG_EPSILON, MIN_COHORT_SIZE } from "./types.js";
import {
  groupIntoCohorts,
  parseCohortKey,
  DEFAULT_COHORT_BUCKET_SEC,
} from "./cohort.js";
import { computeRanks, computeTtg, computeAllRanks } from "./compute.js";
import { computeTrajectories } from "./trajectory.js";
import type { RingEventRow } from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "../../test/fixtures");

interface FixtureCohortMember {
  arrivalId: string;
  icaoHex: string;
  ringNm: number;
  crossTsUtc: string;
  distanceNm: number;
  closingRate: number;
}

interface FixtureCohort {
  description: string;
  members: FixtureCohortMember[];
}

function loadCohortFixture(filename: string): FixtureCohort {
  const path = join(fixturesDir, filename);
  const content = readFileSync(path, "utf-8");
  return JSON.parse(content);
}

function fixtureToMembers(fixture: FixtureCohort): CohortMember[] {
  return fixture.members.map((m) => ({
    arrivalId: m.arrivalId,
    icaoHex: m.icaoHex,
    ringNm: m.ringNm,
    crossTsUtc: new Date(m.crossTsUtc),
    distanceNm: m.distanceNm,
    closingRate: m.closingRate,
  }));
}

describe("computeTtg", () => {
  it("computes TTG correctly with negative closing rate", () => {
    // Aircraft 20nm away, closing at 4nm/min
    // TTG = 20 / 4 = 5 minutes
    const ttg = computeTtg(20, -4);
    expect(ttg).toBeCloseTo(5, 2);
  });

  it("computes TTG correctly with positive closing rate", () => {
    // Aircraft 20nm away, closing at 4nm/min (positive form)
    const ttg = computeTtg(20, 4);
    expect(ttg).toBeCloseTo(5, 2);
  });

  it("handles very slow closing rate with epsilon", () => {
    // Aircraft barely moving
    const ttg = computeTtg(20, 0.0001);
    // Should use TTG_EPSILON (0.001) as minimum rate
    expect(ttg).toBe(20 / TTG_EPSILON);
  });

  it("handles zero closing rate with epsilon", () => {
    const ttg = computeTtg(20, 0);
    expect(ttg).toBe(20 / TTG_EPSILON);
  });
});

describe("computeRanks", () => {
  it("ranks 3 aircraft at different distances correctly", () => {
    const cohort: CohortMember[] = [
      {
        arrivalId: "arr1",
        icaoHex: "7C1111",
        ringNm: 20,
        crossTsUtc: new Date("2025-12-01T10:00:00Z"),
        distanceNm: 20,
        closingRate: -4,
      },
      {
        arrivalId: "arr2",
        icaoHex: "7C2222",
        ringNm: 20,
        crossTsUtc: new Date("2025-12-01T10:00:10Z"),
        distanceNm: 22,
        closingRate: -4,
      },
      {
        arrivalId: "arr3",
        icaoHex: "7C3333",
        ringNm: 20,
        crossTsUtc: new Date("2025-12-01T10:00:20Z"),
        distanceNm: 18,
        closingRate: -4,
      },
    ];

    const ranks = computeRanks(cohort);

    // arr3 (18nm) is closest → rank 1
    // arr1 (20nm) is second → rank 2
    // arr2 (22nm) is third → rank 3
    expect(ranks.get("arr3")!.rankDistance).toBe(1);
    expect(ranks.get("arr1")!.rankDistance).toBe(2);
    expect(ranks.get("arr2")!.rankDistance).toBe(3);
  });

  it("ranks 3 aircraft with different speeds by TTG", () => {
    const cohort: CohortMember[] = [
      {
        arrivalId: "arr1",
        icaoHex: "7C1111",
        ringNm: 20,
        crossTsUtc: new Date("2025-12-01T10:00:00Z"),
        distanceNm: 20,
        closingRate: -2, // TTG = 10 min
      },
      {
        arrivalId: "arr2",
        icaoHex: "7C2222",
        ringNm: 20,
        crossTsUtc: new Date("2025-12-01T10:00:10Z"),
        distanceNm: 20,
        closingRate: -4, // TTG = 5 min
      },
      {
        arrivalId: "arr3",
        icaoHex: "7C3333",
        ringNm: 20,
        crossTsUtc: new Date("2025-12-01T10:00:20Z"),
        distanceNm: 20,
        closingRate: -8, // TTG = 2.5 min
      },
    ];

    const ranks = computeRanks(cohort);

    // arr3 (TTG=2.5) arrives first → rank 1
    // arr2 (TTG=5) second → rank 2
    // arr1 (TTG=10) third → rank 3
    expect(ranks.get("arr3")!.rankTtg).toBe(1);
    expect(ranks.get("arr2")!.rankTtg).toBe(2);
    expect(ranks.get("arr1")!.rankTtg).toBe(3);
  });

  it("breaks ties by ICAO (alphabetical)", () => {
    const cohort: CohortMember[] = [
      {
        arrivalId: "arr1",
        icaoHex: "7CBBBB",
        ringNm: 20,
        crossTsUtc: new Date("2025-12-01T10:00:00Z"),
        distanceNm: 20,
        closingRate: -4,
      },
      {
        arrivalId: "arr2",
        icaoHex: "7CAAAA",
        ringNm: 20,
        crossTsUtc: new Date("2025-12-01T10:00:00Z"),
        distanceNm: 20,
        closingRate: -4,
      },
    ];

    const ranks = computeRanks(cohort);

    // Same distance, arr2 (7CAAAA) comes before arr1 (7CBBBB) alphabetically
    expect(ranks.get("arr2")!.rankDistance).toBe(1);
    expect(ranks.get("arr1")!.rankDistance).toBe(2);
  });

  it("returns empty map for single aircraft (cohort too small)", () => {
    const cohort: CohortMember[] = [
      {
        arrivalId: "arr1",
        icaoHex: "7C1111",
        ringNm: 20,
        crossTsUtc: new Date("2025-12-01T10:00:00Z"),
        distanceNm: 20,
        closingRate: -4,
      },
    ];

    const ranks = computeRanks(cohort);

    expect(ranks.size).toBe(0);
  });

  it("returns empty map for empty cohort", () => {
    const ranks = computeRanks([]);
    expect(ranks.size).toBe(0);
  });
});

describe("groupIntoCohorts", () => {
  it("groups events by ring and time bucket", () => {
    const events: RingEventRow[] = [
      {
        arrivalId: "arr1",
        icaoHex: "7C1111",
        ringNm: 20,
        crossTsUtc: new Date("2025-12-01T10:00:00Z"),
        distanceNm: 20,
        closingRate: -4,
      },
      {
        arrivalId: "arr2",
        icaoHex: "7C2222",
        ringNm: 20,
        crossTsUtc: new Date("2025-12-01T10:00:30Z"),
        distanceNm: 20,
        closingRate: -4,
      },
      {
        arrivalId: "arr3",
        icaoHex: "7C3333",
        ringNm: 30,
        crossTsUtc: new Date("2025-12-01T10:00:30Z"),
        distanceNm: 30,
        closingRate: -4,
      },
    ];

    const cohorts = groupIntoCohorts(events, 300); // 5 minute buckets

    // arr1 and arr2 should be in same cohort (same ring, same bucket)
    // arr3 should be in different cohort (different ring)
    expect(cohorts.size).toBe(2);

    let foundCohortWithTwo = false;
    let foundCohortWithOne = false;
    for (const [_, members] of cohorts) {
      if (members.length === 2) {
        foundCohortWithTwo = true;
        const icaos = members.map((m) => m.icaoHex).sort();
        expect(icaos).toEqual(["7C1111", "7C2222"]);
      }
      if (members.length === 1) {
        foundCohortWithOne = true;
        expect(members[0]!.icaoHex).toBe("7C3333");
      }
    }
    expect(foundCohortWithTwo).toBe(true);
    expect(foundCohortWithOne).toBe(true);
  });

  it("separates events in different time buckets", () => {
    const events: RingEventRow[] = [
      {
        arrivalId: "arr1",
        icaoHex: "7C1111",
        ringNm: 20,
        crossTsUtc: new Date("2025-12-01T10:00:00Z"),
        distanceNm: 20,
        closingRate: -4,
      },
      {
        arrivalId: "arr2",
        icaoHex: "7C2222",
        ringNm: 20,
        crossTsUtc: new Date("2025-12-01T10:10:00Z"), // 10 minutes later
        distanceNm: 20,
        closingRate: -4,
      },
    ];

    const cohorts = groupIntoCohorts(events, 300); // 5 minute buckets

    // Should be in different buckets (600s apart > 300s bucket)
    expect(cohorts.size).toBe(2);
  });
});

describe("parseCohortKey", () => {
  it("parses cohort key correctly", () => {
    const { ringNm, bucketTs } = parseCohortKey("20:1733050800");
    expect(ringNm).toBe(20);
    expect(bucketTs).toBe(1733050800);
  });
});

describe("computeTrajectories", () => {
  it("computes deltas across rings", () => {
    // Simulate an aircraft crossing 50nm, 40nm, 30nm rings
    // All crossings at same ring must be in same time bucket (300s = 5 min)
    const events: RingEventRow[] = [
      {
        arrivalId: "arr1",
        icaoHex: "7C1111",
        ringNm: 50,
        crossTsUtc: new Date("2025-12-01T10:00:00Z"),
        distanceNm: 50,
        closingRate: -4,
      },
      {
        arrivalId: "arr1",
        icaoHex: "7C1111",
        ringNm: 40,
        crossTsUtc: new Date("2025-12-01T10:02:30Z"),
        distanceNm: 40,
        closingRate: -4,
      },
      {
        arrivalId: "arr1",
        icaoHex: "7C1111",
        ringNm: 30,
        crossTsUtc: new Date("2025-12-01T10:04:50Z"), // Same bucket as arr2
        distanceNm: 30,
        closingRate: -4,
      },
      // Another aircraft
      {
        arrivalId: "arr2",
        icaoHex: "7C2222",
        ringNm: 50,
        crossTsUtc: new Date("2025-12-01T10:00:10Z"),
        distanceNm: 50,
        closingRate: -5,
      },
      {
        arrivalId: "arr2",
        icaoHex: "7C2222",
        ringNm: 40,
        crossTsUtc: new Date("2025-12-01T10:02:10Z"),
        distanceNm: 40,
        closingRate: -5,
      },
      {
        arrivalId: "arr2",
        icaoHex: "7C2222",
        ringNm: 30,
        crossTsUtc: new Date("2025-12-01T10:04:10Z"), // Same bucket as arr1
        distanceNm: 30,
        closingRate: -5,
      },
    ];

    const cohorts = groupIntoCohorts(events, 300);
    const ranks = computeAllRanks(cohorts);
    const trajectories = computeTrajectories(cohorts, ranks);

    // Should have 6 trajectory entries (2 aircraft × 3 rings)
    expect(trajectories.length).toBe(6);

    // Find arr1's entries
    const arr1Entries = trajectories
      .filter((t) => t.arrivalId === "arr1")
      .sort((a, b) => b.ringNm - a.ringNm);

    // First ring (50nm) should have null deltas
    expect(arr1Entries[0]!.ringNm).toBe(50);
    expect(arr1Entries[0]!.ringOrderIndex).toBe(0);
    expect(arr1Entries[0]!.deltaRankDistance).toBeNull();
    expect(arr1Entries[0]!.deltaRankTtg).toBeNull();

    // Inner rings should have numeric deltas
    expect(arr1Entries[1]!.ringNm).toBe(40);
    expect(arr1Entries[1]!.ringOrderIndex).toBe(1);
    expect(arr1Entries[1]!.deltaRankDistance).not.toBeNull();

    expect(arr1Entries[2]!.ringNm).toBe(30);
    expect(arr1Entries[2]!.ringOrderIndex).toBe(2);
    expect(arr1Entries[2]!.deltaRankDistance).not.toBeNull();
  });

  it("handles missing intermediate ring", () => {
    // Aircraft crosses 50nm and 30nm but not 40nm
    // All crossings at same ring must be in same time bucket (300s = 5 min)
    const events: RingEventRow[] = [
      {
        arrivalId: "arr1",
        icaoHex: "7C1111",
        ringNm: 50,
        crossTsUtc: new Date("2025-12-01T10:00:00Z"),
        distanceNm: 50,
        closingRate: -4,
      },
      {
        arrivalId: "arr1",
        icaoHex: "7C1111",
        ringNm: 30,
        crossTsUtc: new Date("2025-12-01T10:04:50Z"), // Same bucket as arr2
        distanceNm: 30,
        closingRate: -4,
      },
      // Need another aircraft for cohort
      {
        arrivalId: "arr2",
        icaoHex: "7C2222",
        ringNm: 50,
        crossTsUtc: new Date("2025-12-01T10:00:10Z"),
        distanceNm: 50,
        closingRate: -5,
      },
      {
        arrivalId: "arr2",
        icaoHex: "7C2222",
        ringNm: 30,
        crossTsUtc: new Date("2025-12-01T10:04:30Z"), // Same bucket as arr1
        distanceNm: 30,
        closingRate: -5,
      },
    ];

    const cohorts = groupIntoCohorts(events, 300);
    const ranks = computeAllRanks(cohorts);
    const trajectories = computeTrajectories(cohorts, ranks);

    // Find arr1's entries
    const arr1Entries = trajectories
      .filter((t) => t.arrivalId === "arr1")
      .sort((a, b) => b.ringNm - a.ringNm);

    // Should have 2 entries only
    expect(arr1Entries.length).toBe(2);

    // 50nm should be index 0 with null delta
    expect(arr1Entries[0]!.ringOrderIndex).toBe(0);
    expect(arr1Entries[0]!.deltaRankDistance).toBeNull();

    // 30nm should be index 1 with delta from 50nm (skips 40nm)
    expect(arr1Entries[1]!.ringOrderIndex).toBe(1);
    expect(arr1Entries[1]!.deltaRankDistance).not.toBeNull();
  });
});

describe("with synthetic fixture", () => {
  it("ranks fixture cohort correctly", () => {
    const fixture = loadCohortFixture("synthetic-cohort-rank.json");
    const members = fixtureToMembers(fixture);

    const ranks = computeRanks(members);

    // Verify we got ranks for all members
    expect(ranks.size).toBe(members.length);

    // Verify rank values are valid (1 to N)
    for (const [_, rank] of ranks) {
      expect(rank.rankDistance).toBeGreaterThanOrEqual(1);
      expect(rank.rankDistance).toBeLessThanOrEqual(members.length);
      expect(rank.rankTtg).toBeGreaterThanOrEqual(1);
      expect(rank.rankTtg).toBeLessThanOrEqual(members.length);
    }

    // Verify dense ranking (all values 1..N present)
    const distanceRanks = [...ranks.values()].map((r) => r.rankDistance).sort((a, b) => a - b);
    const ttgRanks = [...ranks.values()].map((r) => r.rankTtg).sort((a, b) => a - b);

    for (let i = 0; i < members.length; i++) {
      expect(distanceRanks[i]).toBe(i + 1);
      expect(ttgRanks[i]).toBe(i + 1);
    }
  });
});

describe("edge cases", () => {
  it("handles exactly MIN_COHORT_SIZE members", () => {
    const cohort: CohortMember[] = [
      {
        arrivalId: "arr1",
        icaoHex: "7C1111",
        ringNm: 20,
        crossTsUtc: new Date("2025-12-01T10:00:00Z"),
        distanceNm: 20,
        closingRate: -4,
      },
      {
        arrivalId: "arr2",
        icaoHex: "7C2222",
        ringNm: 20,
        crossTsUtc: new Date("2025-12-01T10:00:10Z"),
        distanceNm: 22,
        closingRate: -4,
      },
    ];

    expect(cohort.length).toBe(MIN_COHORT_SIZE);
    const ranks = computeRanks(cohort);
    expect(ranks.size).toBe(2);
  });

  it("handles large cohort", () => {
    // Create cohort with 20 aircraft
    const cohort: CohortMember[] = [];
    for (let i = 0; i < 20; i++) {
      cohort.push({
        arrivalId: `arr${i}`,
        icaoHex: `7C${String(i).padStart(4, "0")}`,
        ringNm: 20,
        crossTsUtc: new Date(`2025-12-01T10:00:${String(i).padStart(2, "0")}Z`),
        distanceNm: 20 + i * 0.5, // Increasing distances
        closingRate: -4 - i * 0.1, // Varying speeds
      });
    }

    const ranks = computeRanks(cohort);

    expect(ranks.size).toBe(20);

    // Verify dense ranking
    const distanceRanks = [...ranks.values()].map((r) => r.rankDistance).sort((a, b) => a - b);
    for (let i = 0; i < 20; i++) {
      expect(distanceRanks[i]).toBe(i + 1);
    }
  });

  it("ranks TTG differently from distance when speeds vary", () => {
    const cohort: CohortMember[] = [
      {
        arrivalId: "slow-close",
        icaoHex: "7C1111",
        ringNm: 20,
        crossTsUtc: new Date("2025-12-01T10:00:00Z"),
        distanceNm: 10, // Close but slow
        closingRate: -1, // TTG = 10 min
      },
      {
        arrivalId: "fast-far",
        icaoHex: "7C2222",
        ringNm: 20,
        crossTsUtc: new Date("2025-12-01T10:00:00Z"),
        distanceNm: 20, // Far but fast
        closingRate: -10, // TTG = 2 min
      },
    ];

    const ranks = computeRanks(cohort);

    // slow-close is rank 1 by distance (10nm < 20nm)
    expect(ranks.get("slow-close")!.rankDistance).toBe(1);
    expect(ranks.get("fast-far")!.rankDistance).toBe(2);

    // fast-far is rank 1 by TTG (2min < 10min)
    expect(ranks.get("fast-far")!.rankTtg).toBe(1);
    expect(ranks.get("slow-close")!.rankTtg).toBe(2);
  });
});
