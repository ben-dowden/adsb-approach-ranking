import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { buildOutputTables, writeOutputTables } from "./outputs.js";
import { analyzeMatchedRoutes } from "./statistics.js";
import { fixtureFlights } from "./test-helpers.js";
import type { AnalysisBundle } from "./types.js";

function fixtureBundle(): AnalysisBundle {
  const flights = [
    ...fixtureFlights("YBBN-YSSY", "2025-01-01", "QFA", 35_000, 5),
    ...fixtureFlights("YBBN-YSSY", "2025-01-01", "VOZ", 37_000, 5),
  ];
  return {
    analysisRunId: "test-run",
    flights,
    analysis: analyzeMatchedRoutes(flights, {
      minimumFlights: 5,
      replicates: 100,
      seed: 737,
    }),
    qualityRows: [
      {
        stage: "flight_reconstruction",
        reason: "qualifying_flight",
        count: 10,
        percentage: 100,
      },
    ],
  };
}

describe("buildOutputTables", () => {
  it("emits six named tables with explicit units", () => {
    const tables = buildOutputTables(fixtureBundle());

    expect(Object.keys(tables)).toEqual([
      "flight_cruise_metrics.csv",
      "aircraft_route_summary.csv",
      "route_operator_summary.csv",
      "route_matched_comparison.csv",
      "executive_summary.csv",
      "data_quality.csv",
    ]);
    expect(Object.keys(tables["executive_summary.csv"]![0]!)).toContain(
      "adjusted_difference_ft"
    );
  });

  it("adds an ALL_MATCHED_ROUTES roll-up for each registration", () => {
    const rows = buildOutputTables(fixtureBundle())[
      "aircraft_route_summary.csv"
    ]!;

    expect(
      rows.some((row) => row.directional_route === "ALL_MATCHED_ROUTES")
    ).toBe(true);
  });
});

describe("writeOutputTables", () => {
  it("writes parseable CSV files with headers", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cruise-outputs-"));
    try {
      await writeOutputTables(directory, buildOutputTables(fixtureBundle()));
      const executivePath = join(directory, "executive_summary.csv");
      await expect(access(executivePath)).resolves.toBeUndefined();
      expect(await readFile(executivePath, "utf8")).toContain(
        "adjusted_difference_ft"
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
