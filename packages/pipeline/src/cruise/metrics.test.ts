import { describe, expect, it } from "vitest";

import {
  calculateFlightCruiseMetrics,
  isCruiseObservation,
} from "./metrics.js";
import { state } from "./test-helpers.js";

describe("isCruiseObservation", () => {
  it("accepts high-speed level flight and rejects climb", () => {
    expect(
      isCruiseObservation(
        state("2025-12-01T00:00:00Z", {
          altitudeFt: 37_000,
          groundSpeedKt: 450,
          verticalRateFpm: 0,
        }),
        null
      )
    ).toBe(true);
    expect(
      isCruiseObservation(
        state("2025-12-01T00:00:00Z", {
          altitudeFt: 25_000,
          groundSpeedKt: 450,
          verticalRateFpm: 1_500,
        }),
        null
      )
    ).toBe(false);
  });

  it("uses an adjacent altitude rate when vertical rate is missing", () => {
    const previous = state("2025-12-01T00:00:00Z", {
      altitudeFt: 36_000,
      verticalRateFpm: null,
    });
    const stable = state("2025-12-01T00:05:00Z", {
      altitudeFt: 37_000,
      verticalRateFpm: null,
    });
    const climbing = state("2025-12-01T00:05:00Z", {
      altitudeFt: 40_000,
      verticalRateFpm: null,
    });

    expect(isCruiseObservation(stable, previous)).toBe(true);
    expect(isCruiseObservation(climbing, previous)).toBe(false);
  });
});

describe("calculateFlightCruiseMetrics", () => {
  it("calculates one descriptive cruise value for a flight", () => {
    const result = calculateFlightCruiseMetrics([
      state("2025-12-01T00:00:00Z", { altitudeFt: 35_000 }),
      state("2025-12-01T00:05:00Z", { altitudeFt: 37_000 }),
    ]);

    expect(result).toEqual({
      meanCruiseAltitudeFt: 36_000,
      medianCruiseAltitudeFt: 36_000,
      minimumCruiseAltitudeFt: 35_000,
      maximumCruiseAltitudeFt: 37_000,
      standardDeviationFt: expect.closeTo(Math.sqrt(2_000_000), 6),
      cruiseObservationCount: 2,
      observedCruiseMinutes: 5,
    });
  });

  it("rejects an isolated otherwise-valid cruise observation", () => {
    const result = calculateFlightCruiseMetrics([
      state("2025-12-01T00:00:00Z", { altitudeFt: 10_000 }),
      state("2025-12-01T00:05:00Z", { altitudeFt: 37_000 }),
      state("2025-12-01T00:10:00Z", { altitudeFt: 10_000 }),
    ]);

    expect(result).toBeNull();
  });

  it("requires at least two cruise observations", () => {
    expect(
      calculateFlightCruiseMetrics([
        state("2025-12-01T00:00:00Z", { altitudeFt: 37_000 }),
      ])
    ).toBeNull();
  });
});
