import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("throws when required vars are missing", () => {
    delete process.env.AIRPORT_ICAO;
    expect(() => loadConfig()).toThrow("Missing required env var: AIRPORT_ICAO");
  });

  it("loads config from env vars", () => {
    process.env.AIRPORT_ICAO = "EGLL";
    process.env.AIRPORT_LAT = "51.4700";
    process.env.AIRPORT_LON = "-0.4543";

    const config = loadConfig();
    expect(config.airportIcao).toBe("EGLL");
    expect(config.airportLat).toBeCloseTo(51.47);
    expect(config.airportLon).toBeCloseTo(-0.4543);
    expect(config.maxDistanceNm).toBe(50);
    expect(config.maxAltitudeFt).toBe(15000);
  });

  it("uses custom values when provided", () => {
    process.env.AIRPORT_ICAO = "EGLL";
    process.env.AIRPORT_LAT = "51.4700";
    process.env.AIRPORT_LON = "-0.4543";
    process.env.MAX_DISTANCE_NM = "30";
    process.env.RING_DISTANCES = "[25,20,15,10,5]";

    const config = loadConfig();
    expect(config.maxDistanceNm).toBe(30);
    expect(config.ringDistances).toEqual([25, 20, 15, 10, 5]);
  });
});
