import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { processCruiseFiles } from "../cruise/benchmark.js";
import type { RawAircraft } from "../normalize/types.js";

interface SyntheticFlight {
  hex: string;
  registration: string;
  callsign: string;
  cruiseAltitudeFt: number;
  positions: Array<{ lat: number; lon: number }>;
}

const ROUTES = {
  "YBBN-YSSY": [
    { lat: -27.39, lon: 153.12 },
    { lat: -29, lon: 152.8 },
    { lat: -31.5, lon: 152 },
    { lat: -33.9, lon: 151.18 },
  ],
  "YMML-YPPH": [
    { lat: -37.67, lon: 144.84 },
    { lat: -35, lon: 135 },
    { lat: -33, lon: 125 },
    { lat: -31.94, lon: 115.97 },
  ],
} as const;

function flightsForRoute(
  route: keyof typeof ROUTES,
  operator: "QFA" | "VOZ",
  altitudeFt: number
): SyntheticFlight[] {
  return Array.from({ length: 5 }, (_, index) => ({
    hex: `${operator}${route[1]}${index}`.toLowerCase(),
    registration: `VH-${operator[0]}${route[1]}${index}`,
    callsign: `${operator}${route === "YBBN-YSSY" ? 100 : 200}${index}`,
    cruiseAltitudeFt: altitudeFt,
    positions: [...ROUTES[route]],
  }));
}

function syntheticFlights(): SyntheticFlight[] {
  return [
    ...flightsForRoute("YBBN-YSSY", "QFA", 35_000),
    ...flightsForRoute("YBBN-YSSY", "VOZ", 37_000),
    ...flightsForRoute("YMML-YPPH", "QFA", 39_000),
    ...flightsForRoute("YMML-YPPH", "VOZ", 38_000),
  ];
}

function observation(flight: SyntheticFlight, index: number): RawAircraft {
  const endpoint = index === 0 || index === 3;
  return {
    hex: flight.hex,
    r: flight.registration,
    t: "B738",
    flight: flight.callsign,
    lat: flight.positions[index]!.lat,
    lon: flight.positions[index]!.lon,
    alt_baro: endpoint ? 5_000 : flight.cruiseAltitudeFt,
    gs: endpoint ? 220 : 450,
    baro_rate: 0,
  };
}

async function writeSyntheticSnapshots(directory: string): Promise<string[]> {
  await mkdir(directory, { recursive: true });
  const flights = syntheticFlights();
  const timestamps = [
    "2025-01-01T00:00:00Z",
    "2025-01-01T00:05:00Z",
    "2025-01-01T00:10:00Z",
    "2025-01-01T00:15:00Z",
  ];
  const files: string[] = [];
  for (let index = 0; index < timestamps.length; index++) {
    const filePath = join(
      directory,
      `${String(index * 5).padStart(4, "0")}00Z.json.gz`
    );
    const payload = {
      now: new Date(timestamps[index]!).getTime() / 1_000,
      aircraft: flights.map((flight) => observation(flight, index)),
    };
    await writeFile(filePath, gzipSync(JSON.stringify(payload)));
    files.push(filePath);
  }
  return files;
}

describe("processCruiseFiles", () => {
  it("produces the known equal-route benchmark and all outputs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cruise-e2e-"));
    const outputDirectory = join(directory, "output");
    try {
      const files = await writeSyntheticSnapshots(join(directory, "raw"));
      const result = await processCruiseFiles({
        analysisRunId: "synthetic-run",
        selectedDays: [{ date: "2025-01-01", files }],
        outputDirectory,
        minimumFlights: 5,
        bootstrapReplicates: 100,
        bootstrapSeed: 737,
      });

      expect(result.analysis?.executive.adjustedDifferenceFt).toBe(500);
      expect(result.flights).toHaveLength(20);
      await expect(
        access(join(outputDirectory, "executive_summary.csv"))
      ).resolves.toBeUndefined();
      await expect(
        access(join(outputDirectory, "analysis_run_manifest.json"))
      ).resolves.toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
