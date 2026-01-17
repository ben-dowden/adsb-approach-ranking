/**
 * Unit tests for derive pipeline step
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Track, TrackState } from "./types.js";
import { DEFAULT_GAP_THRESHOLD_SEC } from "./types.js";
import { interpolateCrossing } from "./interpolate.js";
import { detectCrossings, isInwardCrossing } from "./crossing.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "../../test/fixtures");

interface FixtureState {
  ts: string;
  lat: number;
  lon: number;
  altBaro: number | null;
  gs: number | null;
  track: number | null;
  vrt?: number | null;
  distanceNm: number;
}

interface FixtureTrack {
  description: string;
  icao: string;
  callsign: string | null;
  states: FixtureState[];
}

function loadFixture(filename: string): FixtureTrack {
  const path = join(fixturesDir, filename);
  const content = readFileSync(path, "utf-8");
  return JSON.parse(content);
}

function fixtureToTrack(fixture: FixtureTrack): Track {
  return {
    icao: fixture.icao,
    states: fixture.states.map((s) => ({
      ts: new Date(s.ts),
      icao: fixture.icao,
      callsign: fixture.callsign,
      lat: s.lat,
      lon: s.lon,
      altBaro: s.altBaro,
      gs: s.gs,
      track: s.track,
      vrt: s.vrt ?? -500, // Default to descending for test fixtures
      distanceNm: s.distanceNm,
    })),
  };
}

/** Helper to create a TrackState with defaults */
function makeState(partial: Partial<TrackState> & Pick<TrackState, "ts" | "icao" | "distanceNm">): TrackState {
  return {
    callsign: null,
    lat: -27.5,
    lon: 153.0,
    altBaro: 5000,
    gs: 250,
    track: 180,
    vrt: -500, // Default to descending
    ...partial,
  };
}

describe("isInwardCrossing", () => {
  it("returns true when crossing inward through ring", () => {
    expect(isInwardCrossing(25, 18, 20)).toBe(true);
  });

  it("returns false when not crossing ring", () => {
    expect(isInwardCrossing(25, 22, 20)).toBe(false);
    expect(isInwardCrossing(18, 15, 20)).toBe(false);
  });

  it("returns false for outward crossing", () => {
    expect(isInwardCrossing(18, 22, 20)).toBe(false);
  });

  it("returns true when exactly on ring", () => {
    expect(isInwardCrossing(25, 20, 20)).toBe(true);
  });
});

describe("interpolateCrossing", () => {
  it("interpolates timestamp correctly", () => {
    const prev: TrackState = {
      ts: new Date("2025-12-01T10:00:00.000Z"),
      icao: "7C1234",
      callsign: "QFA123",
      lat: -27.0,
      lon: 153.0,
      altBaro: 10000,
      gs: 280,
      track: 270,
      vrt: -500,
      distanceNm: 25,
    };

    const curr: TrackState = {
      ts: new Date("2025-12-01T10:01:00.000Z"),
      icao: "7C1234",
      callsign: "QFA123",
      lat: -27.1,
      lon: 152.9,
      altBaro: 9000,
      gs: 270,
      track: 270,
      vrt: -500,
      distanceNm: 15,
    };

    const crossing = interpolateCrossing(prev, curr, 20);

    // t = (25 - 20) / (25 - 15) = 0.5
    // So crossing should be at exactly 10:00:30
    expect(crossing.crossTs.getTime()).toBe(
      new Date("2025-12-01T10:00:30.000Z").getTime()
    );
    expect(crossing.ringNm).toBe(20);
    expect(crossing.distanceNm).toBe(20);
  });

  it("interpolates position correctly", () => {
    const prev: TrackState = {
      ts: new Date("2025-12-01T10:00:00.000Z"),
      icao: "7C1234",
      callsign: "QFA123",
      lat: -27.0,
      lon: 153.0,
      altBaro: 10000,
      gs: 280,
      track: 270,
      vrt: -500,
      distanceNm: 30,
    };

    const curr: TrackState = {
      ts: new Date("2025-12-01T10:01:00.000Z"),
      icao: "7C1234",
      callsign: "QFA123",
      lat: -27.2,
      lon: 152.8,
      altBaro: 9000,
      gs: 270,
      track: 270,
      vrt: -500,
      distanceNm: 10,
    };

    const crossing = interpolateCrossing(prev, curr, 20);

    // t = (30 - 20) / (30 - 10) = 0.5
    expect(crossing.lat).toBeCloseTo(-27.1, 5);
    expect(crossing.lon).toBeCloseTo(152.9, 5);
  });

  it("calculates closing rate correctly", () => {
    const prev: TrackState = {
      ts: new Date("2025-12-01T10:00:00.000Z"),
      icao: "7C1234",
      callsign: "QFA123",
      lat: -27.0,
      lon: 153.0,
      altBaro: 10000,
      gs: 280,
      track: 270,
      vrt: -500,
      distanceNm: 30,
    };

    const curr: TrackState = {
      ts: new Date("2025-12-01T10:01:00.000Z"),
      icao: "7C1234",
      callsign: "QFA123",
      lat: -27.1,
      lon: 152.9,
      altBaro: 9000,
      gs: 270,
      track: 270,
      vrt: -500,
      distanceNm: 25,
    };

    const crossing = interpolateCrossing(prev, curr, 27);

    // Distance change: 25 - 30 = -5 NM in 1 minute
    // Closing rate = -5 NM/min
    expect(crossing.closingRate).toBeCloseTo(-5, 2);
  });
});

describe("detectCrossings with monotonic track", () => {
  it("detects one crossing per ring", () => {
    const fixture = loadFixture("synthetic-monotonic-track.json");
    const track = fixtureToTrack(fixture);
    const rings = [50, 40, 30, 25, 20, 15, 10, 8, 6, 4];

    const crossings = detectCrossings(track, rings);

    // Should cross all rings since track goes from 55 to 3 NM
    expect(crossings.length).toBe(10);

    // Check rings are crossed in descending order (outermost first)
    const crossedRings = crossings.map((c) => c.ringNm);
    expect(crossedRings).toEqual([50, 40, 30, 25, 20, 15, 10, 8, 6, 4]);
  });

  it("orders crossings chronologically", () => {
    const fixture = loadFixture("synthetic-monotonic-track.json");
    const track = fixtureToTrack(fixture);
    const rings = [50, 40, 30, 25, 20, 15, 10, 8, 6, 4];

    const crossings = detectCrossings(track, rings);

    // Crossings should be in chronological order
    for (let i = 1; i < crossings.length; i++) {
      expect(crossings[i]!.crossTs.getTime()).toBeGreaterThanOrEqual(
        crossings[i - 1]!.crossTs.getTime()
      );
    }
  });
});

describe("detectCrossings with jitter track", () => {
  it("detects exactly one crossing despite oscillation", () => {
    const fixture = loadFixture("synthetic-jitter-track.json");
    const track = fixtureToTrack(fixture);
    const rings = [20];

    const crossings = detectCrossings(track, rings);

    // Should only detect ONE crossing of 20 NM ring despite oscillation
    expect(crossings.length).toBe(1);
    expect(crossings[0]!.ringNm).toBe(20);
  });

  it("detects first crossing only", () => {
    const fixture = loadFixture("synthetic-jitter-track.json");
    const track = fixtureToTrack(fixture);
    const rings = [20];

    const crossings = detectCrossings(track, rings);

    // First inward crossing is between states at 22 NM and 19 NM
    // That's between 11:00:10 and 11:00:20
    const crossTs = crossings[0]!.crossTs;
    const expectedMin = new Date("2025-12-01T11:00:10.000Z");
    const expectedMax = new Date("2025-12-01T11:00:20.000Z");

    expect(crossTs.getTime()).toBeGreaterThanOrEqual(expectedMin.getTime());
    expect(crossTs.getTime()).toBeLessThanOrEqual(expectedMax.getTime());
  });
});

describe("detectCrossings gap handling", () => {
  it("skips transitions with gap > threshold", () => {
    const track: Track = {
      icao: "7CTEST",
      states: [
        {
          ts: new Date("2025-12-01T10:00:00.000Z"),
          icao: "7CTEST",
          callsign: "TEST",
          lat: -27.0,
          lon: 153.0,
          altBaro: 10000,
          gs: 280,
          track: 270,
          vrt: -500,
          distanceNm: 25,
        },
        // 60 second gap (> 30s threshold)
        {
          ts: new Date("2025-12-01T10:01:00.000Z"),
          icao: "7CTEST",
          callsign: "TEST",
          lat: -27.1,
          lon: 152.9,
          altBaro: 9000,
          gs: 270,
          track: 270,
          vrt: -500,
          distanceNm: 15,
        },
      ],
    };

    const crossings = detectCrossings(track, [20], DEFAULT_GAP_THRESHOLD_SEC);

    // Gap is 60s > 30s threshold, so no crossing should be detected
    expect(crossings.length).toBe(0);
  });

  it("detects transitions with gap <= threshold", () => {
    const track: Track = {
      icao: "7CTEST",
      states: [
        {
          ts: new Date("2025-12-01T10:00:00.000Z"),
          icao: "7CTEST",
          callsign: "TEST",
          lat: -27.0,
          lon: 153.0,
          altBaro: 10000,
          gs: 280,
          track: 270,
          vrt: -500,
          distanceNm: 25,
        },
        // 30 second gap (= threshold)
        {
          ts: new Date("2025-12-01T10:00:30.000Z"),
          icao: "7CTEST",
          callsign: "TEST",
          lat: -27.1,
          lon: 152.9,
          altBaro: 9000,
          gs: 270,
          track: 270,
          vrt: -500,
          distanceNm: 15,
        },
      ],
    };

    const crossings = detectCrossings(track, [20], DEFAULT_GAP_THRESHOLD_SEC);

    // Gap is exactly 30s = threshold, so crossing should be detected
    expect(crossings.length).toBe(1);
  });
});

describe("arrival ID determinism", () => {
  function generateArrivalId(
    airportIcao: string,
    icao: string,
    date: string
  ): string {
    const input = `${airportIcao}|${icao}|${date}`;
    const hash = createHash("sha256").update(input).digest("hex");
    return hash.substring(0, 16);
  }

  it("generates same ID for same inputs", () => {
    const id1 = generateArrivalId("YBBN", "7C1234", "2025-12-01");
    const id2 = generateArrivalId("YBBN", "7C1234", "2025-12-01");

    expect(id1).toBe(id2);
  });

  it("generates different IDs for different inputs", () => {
    const id1 = generateArrivalId("YBBN", "7C1234", "2025-12-01");
    const id2 = generateArrivalId("YBBN", "7C5678", "2025-12-01");
    const id3 = generateArrivalId("YSSY", "7C1234", "2025-12-01");
    const id4 = generateArrivalId("YBBN", "7C1234", "2025-12-02");

    expect(id1).not.toBe(id2);
    expect(id1).not.toBe(id3);
    expect(id1).not.toBe(id4);
  });

  it("generates 16 character hex string", () => {
    const id = generateArrivalId("YBBN", "7C1234", "2025-12-01");

    expect(id.length).toBe(16);
    expect(/^[0-9a-f]+$/.test(id)).toBe(true);
  });
});

describe("edge cases", () => {
  it("handles empty track", () => {
    const track: Track = {
      icao: "7CTEST",
      states: [],
    };

    const crossings = detectCrossings(track, [20, 10]);
    expect(crossings.length).toBe(0);
  });

  it("handles single state track", () => {
    const track: Track = {
      icao: "7CTEST",
      states: [
        {
          ts: new Date("2025-12-01T10:00:00.000Z"),
          icao: "7CTEST",
          callsign: "TEST",
          lat: -27.0,
          lon: 153.0,
          altBaro: 10000,
          gs: 280,
          track: 270,
          vrt: -500,
          distanceNm: 25,
        },
      ],
    };

    const crossings = detectCrossings(track, [20, 10]);
    expect(crossings.length).toBe(0);
  });

  it("handles track that never crosses any ring", () => {
    const track: Track = {
      icao: "7CTEST",
      states: [
        {
          ts: new Date("2025-12-01T10:00:00.000Z"),
          icao: "7CTEST",
          callsign: "TEST",
          lat: -27.0,
          lon: 153.0,
          altBaro: 10000,
          gs: 280,
          track: 270,
          vrt: -500,
          distanceNm: 55,
        },
        {
          ts: new Date("2025-12-01T10:00:10.000Z"),
          icao: "7CTEST",
          callsign: "TEST",
          lat: -27.01,
          lon: 152.99,
          altBaro: 9900,
          gs: 278,
          track: 270,
          vrt: -500,
          distanceNm: 52,
        },
      ],
    };

    const crossings = detectCrossings(track, [20, 10]);
    expect(crossings.length).toBe(0);
  });

  it("handles departure (outbound track)", () => {
    const track: Track = {
      icao: "7CTEST",
      states: [
        {
          ts: new Date("2025-12-01T10:00:00.000Z"),
          icao: "7CTEST",
          callsign: "TEST",
          lat: -27.0,
          lon: 153.0,
          altBaro: 5000,
          gs: 280,
          track: 90,
          vrt: -500,
          distanceNm: 5,
        },
        {
          ts: new Date("2025-12-01T10:00:10.000Z"),
          icao: "7CTEST",
          callsign: "TEST",
          lat: -27.0,
          lon: 153.1,
          altBaro: 6000,
          gs: 300,
          track: 90,
          vrt: -500,
          distanceNm: 15,
        },
        {
          ts: new Date("2025-12-01T10:00:20.000Z"),
          icao: "7CTEST",
          callsign: "TEST",
          lat: -27.0,
          lon: 153.2,
          altBaro: 7000,
          gs: 320,
          track: 90,
          vrt: -500,
          distanceNm: 25,
        },
      ],
    };

    // Departures cross rings outbound (increasing distance)
    const crossings = detectCrossings(track, [20, 10]);
    expect(crossings.length).toBe(0);
  });
});
