import { describe, expect, it } from "vitest";

import {
  analyzeMatchedRoutes,
  fixedEffectVirginCoefficient,
  verdictForInterval,
} from "./statistics.js";
import { fixtureFlights } from "./test-helpers.js";

function fixtureMatchedFlights() {
  return [
    ...fixtureFlights("YBBN-YSSY", "2025-01-01", "QFA", 35_000, 5),
    ...fixtureFlights("YBBN-YSSY", "2025-01-01", "VOZ", 37_000, 5),
    ...fixtureFlights("YBBN-YSSY", "2025-02-01", "QFA", 36_000, 5),
    ...fixtureFlights("YBBN-YSSY", "2025-02-01", "VOZ", 37_000, 5),
  ];
}

describe("analyzeMatchedRoutes", () => {
  it("weights routes equally instead of weighting flight volume", () => {
    const flights = [
      ...fixtureFlights("YBBN-YSSY", "2025-01-01", "QFA", 35_000, 5),
      ...fixtureFlights("YBBN-YSSY", "2025-01-01", "VOZ", 37_000, 5),
      ...fixtureFlights("YMML-YPPH", "2025-01-01", "QFA", 39_000, 50),
      ...fixtureFlights("YMML-YPPH", "2025-01-01", "VOZ", 38_000, 50),
    ];

    const result = analyzeMatchedRoutes(flights, {
      minimumFlights: 5,
      replicates: 100,
      seed: 737,
    });

    expect(result.executive.adjustedDifferenceFt).toBe(500);
    expect(result.executive.unadjustedDifferenceFt).toBeCloseTo(-727.2727, 3);
  });

  it("excludes a route below either airline threshold", () => {
    const flights = [
      ...fixtureFlights("YMML-YPPH", "2025-01-01", "QFA", 35_000, 5),
      ...fixtureFlights("YMML-YPPH", "2025-01-01", "VOZ", 37_000, 4),
      ...fixtureMatchedFlights(),
    ];

    const result = analyzeMatchedRoutes(flights, {
      minimumFlights: 5,
      replicates: 100,
      seed: 737,
    });

    expect(result.routes).toHaveLength(1);
    expect(result.routes[0]!.route).toBe("YBBN-YSSY");
  });

  it("returns the same bootstrap interval for seed 737", () => {
    const first = analyzeMatchedRoutes(fixtureMatchedFlights(), {
      minimumFlights: 5,
      replicates: 500,
      seed: 737,
    });
    const second = analyzeMatchedRoutes(fixtureMatchedFlights(), {
      minimumFlights: 5,
      replicates: 500,
      seed: 737,
    });

    expect([
      first.executive.confidenceIntervalLowFt,
      first.executive.confidenceIntervalHighFt,
    ]).toEqual([
      second.executive.confidenceIntervalLowFt,
      second.executive.confidenceIntervalHighFt,
    ]);
  });

  it("fails clearly when no route meets the evidence threshold", () => {
    expect(() =>
      analyzeMatchedRoutes(
        fixtureFlights("YBBN-YSSY", "2025-01-01", "QFA", 35_000, 5),
        { minimumFlights: 5, replicates: 100, seed: 737 }
      )
    ).toThrow(
      "No directional route meets the Qantas and Virgin flight threshold"
    );
  });
});

describe("fixedEffectVirginCoefficient", () => {
  it("recovers a stable Virgin effect after route control", () => {
    expect(fixedEffectVirginCoefficient(fixtureMatchedFlights())).toBeCloseTo(
      1_500,
      6
    );
  });
});

describe("verdictForInterval", () => {
  it("classifies the confidence interval", () => {
    expect(verdictForInterval([-100, 200])).toBe("inconclusive");
    expect(verdictForInterval([10, 200])).toBe("supports");
    expect(verdictForInterval([-200, -10])).toBe("does_not_support");
  });
});
