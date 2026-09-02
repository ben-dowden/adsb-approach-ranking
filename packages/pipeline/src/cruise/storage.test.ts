import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { CruiseState } from "./types.js";
import { readCruiseStates, writeCruiseStates } from "./storage.js";

const STATE: CruiseState = {
  ts: new Date("2025-12-01T01:00:00Z"),
  icaoHex: "7C6DE0",
  registration: "VH-VZM",
  aircraftType: "B738",
  callsign: "QFA1077",
  operatorCode: "QFA",
  operatorName: "Qantas",
  lat: -30,
  lon: 145,
  altitudeFt: 39_000,
  groundSpeedKt: 500,
  verticalRateFpm: 0,
  onGround: false,
};

describe("cruise state storage", () => {
  it("round-trips states through a dedicated DuckDB and Parquet artefact", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cruise-storage-"));
    const databasePath = join(directory, "cruise.duckdb");
    const parquetPath = join(directory, "cruise_states.parquet");

    try {
      await writeCruiseStates(databasePath, parquetPath, [STATE]);

      expect(await readCruiseStates(databasePath)).toEqual([STATE]);
      await expect(access(parquetPath)).resolves.toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("deduplicates the same aircraft observation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cruise-storage-"));
    const databasePath = join(directory, "cruise.duckdb");
    const parquetPath = join(directory, "cruise_states.parquet");

    try {
      await writeCruiseStates(databasePath, parquetPath, [STATE, STATE]);
      expect(await readCruiseStates(databasePath)).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
