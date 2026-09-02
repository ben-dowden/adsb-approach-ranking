import { describe, expect, it } from "vitest";

import { buildTrackSegments, inferDirectionalRoute } from "./flights.js";
import { state } from "./test-helpers.js";

describe("buildTrackSegments", () => {
  it("splits tracks after a gap over 20 minutes", () => {
    const segments = buildTrackSegments([
      state("2025-12-01T00:00:00Z"),
      state("2025-12-01T00:05:00Z"),
      state("2025-12-01T00:30:00Z"),
    ]);

    expect(segments).toHaveLength(2);
  });

  it("splits tracks when the callsign changes", () => {
    const segments = buildTrackSegments([
      state("2025-12-01T00:00:00Z", { callsign: "VOZ1" }),
      state("2025-12-01T00:05:00Z", { callsign: "VOZ2" }),
    ]);

    expect(segments).toHaveLength(2);
  });

  it("keeps different aircraft in different segments", () => {
    const segments = buildTrackSegments([
      state("2025-12-01T00:00:00Z", { icaoHex: "ONE" }),
      state("2025-12-01T00:00:00Z", { icaoHex: "TWO" }),
    ]);

    expect(segments).toHaveLength(2);
  });
});

describe("inferDirectionalRoute", () => {
  it("infers Brisbane to Sydney from ordered endpoint and cruise evidence", () => {
    const result = inferDirectionalRoute([
      state("2025-12-01T00:00:00Z", {
        lat: -27.39,
        lon: 153.12,
        altitudeFt: 3_000,
      }),
      state("2025-12-01T00:05:00Z", {
        lat: -28.5,
        lon: 152.9,
        altitudeFt: 25_000,
      }),
      state("2025-12-01T00:10:00Z", {
        lat: -30.5,
        lon: 152.3,
        altitudeFt: 37_000,
      }),
      state("2025-12-01T00:15:00Z", {
        lat: -32,
        lon: 151.8,
        altitudeFt: 37_000,
      }),
      state("2025-12-01T00:25:00Z", {
        lat: -33.8,
        lon: 151.3,
        altitudeFt: 8_000,
      }),
    ]);

    expect(result).toMatchObject({
      included: true,
      route: {
        originIcao: "YBBN",
        destinationIcao: "YSSY",
        route: "YBBN-YSSY",
      },
    });
  });

  it("rejects a track without both endpoint contexts", () => {
    const result = inferDirectionalRoute([
      state("2025-12-01T00:00:00Z", { altitudeFt: 37_000 }),
      state("2025-12-01T00:05:00Z", { altitudeFt: 37_000 }),
    ]);

    expect(result).toEqual({ included: false, reason: "truncated_track" });
  });

  it("rejects a return to the same airport", () => {
    const result = inferDirectionalRoute([
      state("2025-12-01T00:00:00Z", {
        lat: -27.39,
        lon: 153.12,
        altitudeFt: 4_000,
      }),
      state("2025-12-01T00:05:00Z", {
        lat: -29,
        lon: 151,
        altitudeFt: 35_000,
      }),
      state("2025-12-01T00:10:00Z", {
        lat: -29.5,
        lon: 150,
        altitudeFt: 35_000,
      }),
      state("2025-12-01T00:20:00Z", {
        lat: -27.4,
        lon: 153.1,
        altitudeFt: 5_000,
      }),
    ]);

    expect(result).toEqual({ included: false, reason: "same_endpoint" });
  });
});
