import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { parseGzipJson } from "../normalize/parser.js";

import { buildTrackSegments, inferDirectionalRoute } from "./flights.js";
import { buildFlightCruiseMetric } from "./metrics.js";
import { normalizeCruiseSnapshot } from "./normalize.js";
import { buildOutputTables, writeOutputTables } from "./outputs.js";
import { analyzeMatchedRoutes } from "./statistics.js";
import { writeCruiseStates } from "./storage.js";
import type {
  AnalysisBundle,
  BenchmarkAnalysis,
  CruiseState,
  FlightCruiseMetric,
  QualityCount,
  RouteExclusionReason,
} from "./types.js";

export interface SelectedDayFiles {
  date: string;
  files: string[];
}

export interface ProcessCruiseFilesOptions {
  analysisRunId: string;
  selectedDays: SelectedDayFiles[];
  outputDirectory: string;
  minimumFlights: number;
  bootstrapReplicates: number;
  bootstrapSeed: number;
}

function percentage(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : (numerator / denominator) * 100;
}

function increment(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

async function loadCruiseStates(selectedDays: SelectedDayFiles[]): Promise<{
  states: CruiseState[];
  rawObservationCount: number;
}> {
  const states: CruiseState[] = [];
  let rawObservationCount = 0;

  for (const day of selectedDays) {
    for (const filePath of [...day.files].sort()) {
      const snapshot = await parseGzipJson(filePath);
      rawObservationCount += snapshot.aircraft.length;
      states.push(
        ...normalizeCruiseSnapshot(
          snapshot.aircraft,
          new Date(snapshot.now * 1_000)
        )
      );
    }
  }
  return { states, rawObservationCount };
}

function buildFlights(states: CruiseState[]): {
  flights: FlightCruiseMetric[];
  segmentCount: number;
  exclusions: Map<string, number>;
} {
  const segments = buildTrackSegments(states);
  const flights: FlightCruiseMetric[] = [];
  const exclusions = new Map<string, number>();

  for (const segment of segments) {
    const inference = inferDirectionalRoute(segment);
    if (!inference.included) {
      increment(exclusions, inference.reason);
      continue;
    }
    const metric = buildFlightCruiseMetric(segment, inference.route);
    if (!metric) {
      const reason: RouteExclusionReason = "insufficient_cruise";
      increment(exclusions, reason);
      continue;
    }
    flights.push(metric);
  }
  return { flights, segmentCount: segments.length, exclusions };
}

function qualityRows(options: {
  rawObservationCount: number;
  retainedStateCount: number;
  segmentCount: number;
  qualifyingFlightCount: number;
  exclusions: Map<string, number>;
}): QualityCount[] {
  const rows: QualityCount[] = [
    {
      stage: "source",
      reason: "raw_aircraft_observation",
      count: options.rawObservationCount,
      percentage: 100,
    },
    {
      stage: "normalization",
      reason: "retained_b737_state",
      count: options.retainedStateCount,
      percentage: percentage(
        options.retainedStateCount,
        options.rawObservationCount
      ),
    },
    {
      stage: "normalization",
      reason: "not_retained",
      count: options.rawObservationCount - options.retainedStateCount,
      percentage: percentage(
        options.rawObservationCount - options.retainedStateCount,
        options.rawObservationCount
      ),
    },
    {
      stage: "flight_reconstruction",
      reason: "candidate_segment",
      count: options.segmentCount,
      percentage: 100,
    },
    {
      stage: "flight_reconstruction",
      reason: "qualifying_flight",
      count: options.qualifyingFlightCount,
      percentage: percentage(
        options.qualifyingFlightCount,
        options.segmentCount
      ),
    },
  ];
  for (const [reason, count] of [...options.exclusions.entries()].sort()) {
    rows.push({
      stage: "flight_reconstruction",
      reason,
      count,
      percentage: percentage(count, options.segmentCount),
    });
  }
  return rows;
}

function matchedAnalysis(
  flights: FlightCruiseMetric[],
  options: ProcessCruiseFilesOptions
): BenchmarkAnalysis | null {
  try {
    return analyzeMatchedRoutes(flights, {
      minimumFlights: options.minimumFlights,
      replicates: options.bootstrapReplicates,
      seed: options.bootstrapSeed,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message ===
        "No directional route meets the Qantas and Virgin flight threshold"
    ) {
      return null;
    }
    throw error;
  }
}

async function writeRunManifest(
  options: ProcessCruiseFilesOptions,
  bundle: AnalysisBundle,
  stateCount: number
): Promise<void> {
  const manifest = {
    analysis_run_id: options.analysisRunId,
    generated_at_utc: new Date().toISOString(),
    selected_dates: options.selectedDays.map((day) => day.date),
    selected_file_count: options.selectedDays.reduce(
      (sum, day) => sum + day.files.length,
      0
    ),
    files_by_date: Object.fromEntries(
      options.selectedDays.map((day) => [day.date, day.files.length])
    ),
    configuration: {
      minimum_matched_flights: options.minimumFlights,
      bootstrap_replicates: options.bootstrapReplicates,
      bootstrap_seed: options.bootstrapSeed,
    },
    reconciliation: {
      retained_state_count: stateCount,
      qualifying_flight_count: bundle.flights.length,
      matched_route_count: bundle.analysis?.routes.length ?? 0,
    },
    runtime: {
      node_version: process.version,
      platform: process.platform,
    },
  };
  await writeFile(
    join(options.outputDirectory, "analysis_run_manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
}

export async function processCruiseFiles(
  options: ProcessCruiseFilesOptions
): Promise<AnalysisBundle> {
  if (options.selectedDays.length === 0) {
    throw new Error("At least one selected archive day is required");
  }
  await mkdir(options.outputDirectory, { recursive: true });
  const loaded = await loadCruiseStates(options.selectedDays);
  await writeCruiseStates(
    join(options.outputDirectory, "cruise_states.duckdb"),
    join(options.outputDirectory, "cruise_states.parquet"),
    loaded.states
  );
  const reconstructed = buildFlights(loaded.states);
  const bundle: AnalysisBundle = {
    analysisRunId: options.analysisRunId,
    flights: reconstructed.flights,
    analysis: matchedAnalysis(reconstructed.flights, options),
    qualityRows: qualityRows({
      rawObservationCount: loaded.rawObservationCount,
      retainedStateCount: loaded.states.length,
      segmentCount: reconstructed.segmentCount,
      qualifyingFlightCount: reconstructed.flights.length,
      exclusions: reconstructed.exclusions,
    }),
  };
  await writeOutputTables(options.outputDirectory, buildOutputTables(bundle));
  await writeRunManifest(options, bundle, loaded.states.length);
  return bundle;
}
