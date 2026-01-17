import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { haversineDistanceNm } from "@adsb/shared";
import {
  loadAirportRegistry,
  getAirport,
  listAirportCodes,
} from "./airports.js";
import { computeDistanceNm, isWithinRadius } from "./filter.js";
import { extractAircraftFields, processRawFile } from "./parser.js";
import type { Airport, RawAircraft, RawReadsbFile } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "../../test/fixtures");

// Test airports
const brisbane: Airport = {
  icao: "YBBN",
  lat: -27.3842,
  lon: 153.1175,
  name: "Brisbane Airport",
};

const sydney: Airport = {
  icao: "YSSY",
  lat: -33.9399,
  lon: 151.1753,
  name: "Sydney Airport",
};

describe("Distance Calculations", () => {
  it("calculates Brisbane to Sydney distance (~406 NM)", () => {
    const distance = haversineDistanceNm(
      brisbane.lat,
      brisbane.lon,
      sydney.lat,
      sydney.lon
    );
    expect(distance).toBeGreaterThan(400);
    expect(distance).toBeLessThan(410);
  });

  it("computeDistanceNm wraps haversine correctly", () => {
    const distance = computeDistanceNm(
      brisbane.lat,
      brisbane.lon,
      sydney.lat,
      sydney.lon
    );
    expect(distance).toBeGreaterThan(400);
    expect(distance).toBeLessThan(410);
  });

  it("returns 0 for same point", () => {
    const distance = computeDistanceNm(
      brisbane.lat,
      brisbane.lon,
      brisbane.lat,
      brisbane.lon
    );
    expect(distance).toBe(0);
  });
});

describe("isWithinRadius", () => {
  it("returns true for point within radius", () => {
    // Point 5 NM from Brisbane
    const result = isWithinRadius(-27.45, 153.1, brisbane.lat, brisbane.lon, 10);
    expect(result).toBe(true);
  });

  it("returns false for point outside radius", () => {
    // Sydney is ~396 NM from Brisbane
    const result = isWithinRadius(
      sydney.lat,
      sydney.lon,
      brisbane.lat,
      brisbane.lon,
      30
    );
    expect(result).toBe(false);
  });

  it("returns true for point exactly at airport", () => {
    const result = isWithinRadius(
      brisbane.lat,
      brisbane.lon,
      brisbane.lat,
      brisbane.lon,
      1
    );
    expect(result).toBe(true);
  });
});

describe("extractAircraftFields", () => {
  const testTs = new Date("2024-12-01T00:00:00Z");

  it("extracts complete aircraft record", () => {
    const raw: RawAircraft = {
      hex: "7c1234",
      lat: -27.4,
      lon: 153.1,
      alt_baro: 3000,
      gs: 150,
      track: 180,
      flight: "QFA123 ",
      baro_rate: -500,
    };

    const result = extractAircraftFields(raw, testTs, brisbane);

    expect(result).not.toBeNull();
    expect(result!.icao).toBe("7C1234");
    expect(result!.callsign).toBe("QFA123");
    expect(result!.lat).toBe(-27.4);
    expect(result!.lon).toBe(153.1);
    expect(result!.alt_baro).toBe(3000);
    expect(result!.gs).toBe(150);
    expect(result!.track).toBe(180);
    expect(result!.vrt).toBe(-500);
    expect(result!.airport_icao).toBe("YBBN");
    expect(result!.distance_nm).toBeGreaterThan(0);
  });

  it("handles alt_baro: ground as null", () => {
    const raw: RawAircraft = {
      hex: "7c5678",
      lat: -27.5,
      lon: 153.2,
      alt_baro: "ground",
      gs: 0,
    };

    const result = extractAircraftFields(raw, testTs, brisbane);

    expect(result).not.toBeNull();
    expect(result!.alt_baro).toBeNull();
  });

  it("prefers baro_rate over geom_rate", () => {
    const raw: RawAircraft = {
      hex: "7c0001",
      lat: -27.4,
      lon: 153.1,
      baro_rate: -500,
      geom_rate: -600,
    };

    const result = extractAircraftFields(raw, testTs, brisbane);

    expect(result).not.toBeNull();
    expect(result!.vrt).toBe(-500);
  });

  it("falls back to geom_rate when baro_rate missing", () => {
    const raw: RawAircraft = {
      hex: "7c0002",
      lat: -27.4,
      lon: 153.1,
      geom_rate: -400,
    };

    const result = extractAircraftFields(raw, testTs, brisbane);

    expect(result).not.toBeNull();
    expect(result!.vrt).toBe(-400);
  });

  it("returns null for missing hex", () => {
    const raw = {
      lat: -27.4,
      lon: 153.1,
    } as RawAircraft;

    const result = extractAircraftFields(raw, testTs, brisbane);
    expect(result).toBeNull();
  });

  it("returns null for missing lat/lon", () => {
    const raw: RawAircraft = {
      hex: "7c1234",
      alt_baro: 3000,
    };

    const result = extractAircraftFields(raw, testTs, brisbane);
    expect(result).toBeNull();
  });

  it("trims callsign whitespace", () => {
    const raw: RawAircraft = {
      hex: "7c1234",
      lat: -27.4,
      lon: 153.1,
      flight: "  ABC123  ",
    };

    const result = extractAircraftFields(raw, testTs, brisbane);

    expect(result).not.toBeNull();
    expect(result!.callsign).toBe("ABC123");
  });

  it("handles empty callsign as null", () => {
    const raw: RawAircraft = {
      hex: "7c1234",
      lat: -27.4,
      lon: 153.1,
      flight: "   ",
    };

    const result = extractAircraftFields(raw, testTs, brisbane);

    expect(result).not.toBeNull();
    expect(result!.callsign).toBeNull();
  });
});

describe("processRawFile", () => {
  it("filters aircraft by radius", () => {
    const rawFile: RawReadsbFile = {
      now: 1733011200,
      aircraft: [
        // Within 30 NM
        { hex: "7c1234", lat: -27.4, lon: 153.1, alt_baro: 3000 },
        { hex: "7c5678", lat: -27.5, lon: 153.2, alt_baro: 2000 },
        // Outside 30 NM (further away)
        { hex: "7c9999", lat: -28.5, lon: 154.0, alt_baro: 35000 },
        // Missing position
        { hex: "7cabcd" },
      ],
    };

    const states = processRawFile(rawFile, brisbane, 30);

    // Should only include the two within radius
    expect(states).toHaveLength(2);
    expect(states.map((s) => s.icao).sort()).toEqual(["7C1234", "7C5678"]);
  });

  it("sets timestamp from now field", () => {
    const rawFile: RawReadsbFile = {
      now: 1733011200,
      aircraft: [{ hex: "7c1234", lat: -27.4, lon: 153.1 }],
    };

    const states = processRawFile(rawFile, brisbane, 30);

    expect(states[0]!.ts.toISOString()).toBe("2024-12-01T00:00:00.000Z");
  });

  it("returns empty array when no aircraft within radius", () => {
    const rawFile: RawReadsbFile = {
      now: 1733011200,
      aircraft: [
        { hex: "7c9999", lat: -35.0, lon: 150.0, alt_baro: 35000 },
      ],
    };

    const states = processRawFile(rawFile, brisbane, 30);

    expect(states).toHaveLength(0);
  });
});

describe("Airport Registry", () => {
  it("loads airport registry from file", async () => {
    const registry = await loadAirportRegistry(
      join(fixturesDir, "airports.json")
    );

    expect(registry).toHaveLength(2);
    expect(registry[0]!.icao).toBe("YBBN");
    expect(registry[1]!.icao).toBe("YSSY");
  });

  it("getAirport returns airport by ICAO", async () => {
    const registry = await loadAirportRegistry(
      join(fixturesDir, "airports.json")
    );

    const airport = getAirport(registry, "YBBN");

    expect(airport).not.toBeNull();
    expect(airport!.name).toBe("Brisbane Airport");
  });

  it("getAirport returns null for unknown ICAO", async () => {
    const registry = await loadAirportRegistry(
      join(fixturesDir, "airports.json")
    );

    const airport = getAirport(registry, "XXXX");

    expect(airport).toBeNull();
  });

  it("listAirportCodes returns all ICAO codes", async () => {
    const registry = await loadAirportRegistry(
      join(fixturesDir, "airports.json")
    );

    const codes = listAirportCodes(registry);

    expect(codes).toEqual(["YBBN", "YSSY"]);
  });
});
