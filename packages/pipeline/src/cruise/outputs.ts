import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

import type * as PapaParse from "papaparse";

import type { AnalysisBundle, FlightCruiseMetric } from "./types.js";

type OutputValue = string | number | boolean | null;
type OutputRow = Record<string, OutputValue>;
export type OutputTables = Record<string, OutputRow[]>;

const { unparse } = createRequire(import.meta.url)(
  "papaparse"
) as typeof PapaParse;

const OUTPUT_FIELDS: Readonly<Record<string, string[]>> = {
  "flight_cruise_metrics.csv": [
    "analysis_run_id",
    "flight_id",
    "sample_date_utc",
    "registration",
    "icao_hex",
    "aircraft_type",
    "operator_code",
    "operator_name",
    "callsign",
    "directional_route",
    "origin_icao",
    "destination_icao",
    "origin_evidence_ts_utc",
    "destination_evidence_ts_utc",
    "mean_cruise_altitude_ft",
    "median_cruise_altitude_ft",
    "minimum_cruise_altitude_ft",
    "maximum_cruise_altitude_ft",
    "standard_deviation_ft",
    "cruise_observation_count",
    "observed_cruise_minutes",
  ],
  "aircraft_route_summary.csv": [
    "analysis_run_id",
    "registration",
    "icao_hex",
    "operator_code",
    "operator_name",
    "aircraft_types",
    "directional_route",
    "qualifying_flight_count",
    "matched_route_count",
    "mean_cruise_altitude_ft",
    "median_cruise_altitude_ft",
    "minimum_cruise_altitude_ft",
    "maximum_cruise_altitude_ft",
    "standard_deviation_ft",
    "thin_sample_flag",
  ],
  "route_operator_summary.csv": [
    "analysis_run_id",
    "directional_route",
    "operator_code",
    "operator_name",
    "qualifying_flight_count",
    "aircraft_count",
    "sample_date_count",
    "aircraft_types",
    "mean_cruise_altitude_ft",
    "median_cruise_altitude_ft",
    "minimum_cruise_altitude_ft",
    "maximum_cruise_altitude_ft",
    "matched_route_eligible",
  ],
  "route_matched_comparison.csv": [
    "analysis_run_id",
    "directional_route",
    "qantas_mean_cruise_altitude_ft",
    "virgin_mean_cruise_altitude_ft",
    "virgin_minus_qantas_ft",
    "confidence_interval_low_ft",
    "confidence_interval_high_ft",
    "qantas_flight_count",
    "virgin_flight_count",
    "qantas_aircraft_count",
    "virgin_aircraft_count",
    "represented_date_count",
  ],
  "executive_summary.csv": [
    "analysis_run_id",
    "verdict",
    "adjusted_difference_ft",
    "confidence_interval_low_ft",
    "confidence_interval_high_ft",
    "unadjusted_difference_ft",
    "sensitivity_virgin_coefficient_ft",
    "matched_route_count",
    "represented_date_count",
    "qantas_flight_count",
    "virgin_flight_count",
    "qantas_aircraft_count",
    "virgin_aircraft_count",
  ],
  "data_quality.csv": [
    "analysis_run_id",
    "stage",
    "reason",
    "count",
    "percentage",
  ],
};

function rounded(value: number | null, digits = 2): number | null {
  if (value === null) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1]! + ordered[middle]!) / 2
    : ordered[middle]!;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
      (values.length - 1)
  );
}

function groupFlights(
  flights: FlightCruiseMetric[],
  keyForFlight: (flight: FlightCruiseMetric) => string
): Map<string, FlightCruiseMetric[]> {
  const groups = new Map<string, FlightCruiseMetric[]>();
  for (const flight of flights) {
    const key = keyForFlight(flight);
    const group = groups.get(key) ?? [];
    group.push(flight);
    groups.set(key, group);
  }
  return groups;
}

function flightRows(bundle: AnalysisBundle): OutputRow[] {
  return [...bundle.flights]
    .sort(
      (left, right) =>
        left.sampleDate.localeCompare(right.sampleDate) ||
        left.route.localeCompare(right.route) ||
        left.callsign.localeCompare(right.callsign)
    )
    .map((flight) => ({
      analysis_run_id: bundle.analysisRunId,
      flight_id: flight.flightId,
      sample_date_utc: flight.sampleDate,
      registration: flight.registration,
      icao_hex: flight.icaoHex,
      aircraft_type: flight.aircraftType,
      operator_code: flight.operatorCode,
      operator_name: flight.operatorName,
      callsign: flight.callsign,
      directional_route: flight.route,
      origin_icao: flight.originIcao,
      destination_icao: flight.destinationIcao,
      origin_evidence_ts_utc: flight.originEvidenceTs.toISOString(),
      destination_evidence_ts_utc: flight.destinationEvidenceTs.toISOString(),
      mean_cruise_altitude_ft: rounded(flight.meanCruiseAltitudeFt),
      median_cruise_altitude_ft: rounded(flight.medianCruiseAltitudeFt),
      minimum_cruise_altitude_ft: rounded(flight.minimumCruiseAltitudeFt),
      maximum_cruise_altitude_ft: rounded(flight.maximumCruiseAltitudeFt),
      standard_deviation_ft: rounded(flight.standardDeviationFt),
      cruise_observation_count: flight.cruiseObservationCount,
      observed_cruise_minutes: rounded(flight.observedCruiseMinutes),
    }));
}

function aircraftSummaryRow(
  runId: string,
  directionalRoute: string,
  flights: FlightCruiseMetric[]
): OutputRow {
  const altitudes = flights.map((flight) => flight.meanCruiseAltitudeFt);
  const first = flights[0]!;
  return {
    analysis_run_id: runId,
    registration: first.registration,
    icao_hex: first.icaoHex,
    operator_code: first.operatorCode,
    operator_name: first.operatorName,
    aircraft_types: [...new Set(flights.map((flight) => flight.aircraftType))]
      .sort()
      .join("|"),
    directional_route: directionalRoute,
    qualifying_flight_count: flights.length,
    matched_route_count: new Set(flights.map((flight) => flight.route)).size,
    mean_cruise_altitude_ft: rounded(average(altitudes)),
    median_cruise_altitude_ft: rounded(median(altitudes)),
    minimum_cruise_altitude_ft: rounded(Math.min(...altitudes)),
    maximum_cruise_altitude_ft: rounded(Math.max(...altitudes)),
    standard_deviation_ft: rounded(standardDeviation(altitudes)),
    thin_sample_flag: flights.length < 2,
  };
}

function aircraftRows(bundle: AnalysisBundle): OutputRow[] {
  const routeGroups = groupFlights(
    bundle.flights,
    (flight) => `${flight.registration}|${flight.route}`
  );
  const routeRows = [...routeGroups.values()].map((flights) =>
    aircraftSummaryRow(bundle.analysisRunId, flights[0]!.route, flights)
  );
  const matchedGroups = groupFlights(
    bundle.analysis?.matchedFlights ?? [],
    (flight) => flight.registration
  );
  const rollupRows = [...matchedGroups.values()].map((flights) =>
    aircraftSummaryRow(bundle.analysisRunId, "ALL_MATCHED_ROUTES", flights)
  );
  return [...routeRows, ...rollupRows].sort(
    (left, right) =>
      String(left.registration).localeCompare(String(right.registration)) ||
      String(left.directional_route).localeCompare(
        String(right.directional_route)
      )
  );
}

function routeOperatorRows(bundle: AnalysisBundle): OutputRow[] {
  const matchedRouteSet = new Set(
    bundle.analysis?.routes.map((route) => route.route) ?? []
  );
  const groups = groupFlights(
    bundle.flights,
    (flight) => `${flight.route}|${flight.operatorCode}`
  );
  return [...groups.values()]
    .map((flights) => {
      const first = flights[0]!;
      const altitudes = flights.map((flight) => flight.meanCruiseAltitudeFt);
      return {
        analysis_run_id: bundle.analysisRunId,
        directional_route: first.route,
        operator_code: first.operatorCode,
        operator_name: first.operatorName,
        qualifying_flight_count: flights.length,
        aircraft_count: new Set(flights.map((flight) => flight.registration))
          .size,
        sample_date_count: new Set(flights.map((flight) => flight.sampleDate))
          .size,
        aircraft_types: [
          ...new Set(flights.map((flight) => flight.aircraftType)),
        ]
          .sort()
          .join("|"),
        mean_cruise_altitude_ft: rounded(average(altitudes)),
        median_cruise_altitude_ft: rounded(median(altitudes)),
        minimum_cruise_altitude_ft: rounded(Math.min(...altitudes)),
        maximum_cruise_altitude_ft: rounded(Math.max(...altitudes)),
        matched_route_eligible: matchedRouteSet.has(first.route),
      };
    })
    .sort(
      (left, right) =>
        String(left.directional_route).localeCompare(
          String(right.directional_route)
        ) ||
        String(left.operator_code).localeCompare(String(right.operator_code))
    );
}

function routeComparisonRows(bundle: AnalysisBundle): OutputRow[] {
  return (bundle.analysis?.routes ?? []).map((route) => ({
    analysis_run_id: bundle.analysisRunId,
    directional_route: route.route,
    qantas_mean_cruise_altitude_ft: rounded(route.qantasMeanAltitudeFt),
    virgin_mean_cruise_altitude_ft: rounded(route.virginMeanAltitudeFt),
    virgin_minus_qantas_ft: rounded(route.virginMinusQantasFt),
    confidence_interval_low_ft: rounded(route.confidenceIntervalLowFt),
    confidence_interval_high_ft: rounded(route.confidenceIntervalHighFt),
    qantas_flight_count: route.qantasFlightCount,
    virgin_flight_count: route.virginFlightCount,
    qantas_aircraft_count: route.qantasAircraftCount,
    virgin_aircraft_count: route.virginAircraftCount,
    represented_date_count: route.representedDateCount,
  }));
}

function executiveRows(bundle: AnalysisBundle): OutputRow[] {
  const result = bundle.analysis?.executive;
  if (!result) {
    return [
      {
        analysis_run_id: bundle.analysisRunId,
        verdict: "coverage_failure",
        adjusted_difference_ft: null,
        confidence_interval_low_ft: null,
        confidence_interval_high_ft: null,
        unadjusted_difference_ft: null,
        sensitivity_virgin_coefficient_ft: null,
        matched_route_count: 0,
        represented_date_count: 0,
        qantas_flight_count: 0,
        virgin_flight_count: 0,
        qantas_aircraft_count: 0,
        virgin_aircraft_count: 0,
      },
    ];
  }
  return [
    {
      analysis_run_id: bundle.analysisRunId,
      verdict: result.verdict,
      adjusted_difference_ft: rounded(result.adjustedDifferenceFt),
      confidence_interval_low_ft: rounded(result.confidenceIntervalLowFt),
      confidence_interval_high_ft: rounded(result.confidenceIntervalHighFt),
      unadjusted_difference_ft: rounded(result.unadjustedDifferenceFt),
      sensitivity_virgin_coefficient_ft: rounded(
        result.sensitivityVirginCoefficientFt
      ),
      matched_route_count: result.matchedRouteCount,
      represented_date_count: result.representedDateCount,
      qantas_flight_count: result.qantasFlightCount,
      virgin_flight_count: result.virginFlightCount,
      qantas_aircraft_count: result.qantasAircraftCount,
      virgin_aircraft_count: result.virginAircraftCount,
    },
  ];
}

function qualityRows(bundle: AnalysisBundle): OutputRow[] {
  return bundle.qualityRows.map((row) => ({
    analysis_run_id: bundle.analysisRunId,
    stage: row.stage,
    reason: row.reason,
    count: row.count,
    percentage: rounded(row.percentage),
  }));
}

export function buildOutputTables(bundle: AnalysisBundle): OutputTables {
  return {
    "flight_cruise_metrics.csv": flightRows(bundle),
    "aircraft_route_summary.csv": aircraftRows(bundle),
    "route_operator_summary.csv": routeOperatorRows(bundle),
    "route_matched_comparison.csv": routeComparisonRows(bundle),
    "executive_summary.csv": executiveRows(bundle),
    "data_quality.csv": qualityRows(bundle),
  };
}

export async function writeOutputTables(
  outputDirectory: string,
  tables: OutputTables
): Promise<void> {
  await mkdir(outputDirectory, { recursive: true });
  for (const [name, rows] of Object.entries(tables)) {
    const fields = OUTPUT_FIELDS[name];
    if (!fields) throw new Error(`Unknown output table: ${name}`);
    await writeFile(
      join(outputDirectory, name),
      `${unparse({ fields, data: rows })}\n`,
      "utf8"
    );
  }
}
