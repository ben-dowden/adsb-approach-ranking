import type { S3ObjectInfo } from "../s3/types.js";

export interface CruiseState {
  ts: Date;
  icaoHex: string;
  registration: string;
  aircraftType: string;
  callsign: string | null;
  operatorCode: string | null;
  operatorName: string | null;
  lat: number;
  lon: number;
  altitudeFt: number | null;
  groundSpeedKt: number | null;
  verticalRateFpm: number | null;
  onGround: boolean;
}

export interface SampledDay {
  objects: S3ObjectInfo[];
  expectedCount: number;
  complete: boolean;
  missingTimestamps: string[];
}

export interface CoverageCandidate extends SampledDay {
  date: string;
  discoveredCount: number;
  reason: "complete" | "incomplete" | "unavailable";
}

export interface CoverageDiscovery {
  selected: CoverageCandidate[];
  candidates: CoverageCandidate[];
}

export interface RouteInference {
  originIcao: string;
  destinationIcao: string;
  route: string;
  originEvidenceTs: Date;
  destinationEvidenceTs: Date;
}

export type RouteExclusionReason =
  | "ambiguous_endpoint"
  | "same_endpoint"
  | "truncated_track"
  | "insufficient_cruise";

export type RouteInferenceResult =
  | { included: true; route: RouteInference }
  | { included: false; reason: RouteExclusionReason };

export interface CruiseSummary {
  meanCruiseAltitudeFt: number;
  medianCruiseAltitudeFt: number;
  minimumCruiseAltitudeFt: number;
  maximumCruiseAltitudeFt: number;
  standardDeviationFt: number;
  cruiseObservationCount: number;
  observedCruiseMinutes: number;
}

export interface FlightCruiseMetric extends CruiseSummary {
  flightId: string;
  sampleDate: string;
  registration: string;
  icaoHex: string;
  aircraftType: string;
  callsign: string;
  operatorCode: string;
  operatorName: string | null;
  originIcao: string;
  destinationIcao: string;
  route: string;
  originEvidenceTs: Date;
  destinationEvidenceTs: Date;
}

export interface QualityCount {
  stage: string;
  reason: string;
  count: number;
  percentage: number;
}

export interface MatchedRouteResult {
  route: string;
  qantasMeanAltitudeFt: number;
  virginMeanAltitudeFt: number;
  virginMinusQantasFt: number;
  confidenceIntervalLowFt: number;
  confidenceIntervalHighFt: number;
  qantasFlightCount: number;
  virginFlightCount: number;
  qantasAircraftCount: number;
  virginAircraftCount: number;
  representedDateCount: number;
}

export type BenchmarkVerdict = "supports" | "does_not_support" | "inconclusive";

export interface ExecutiveResult {
  verdict: BenchmarkVerdict;
  adjustedDifferenceFt: number;
  confidenceIntervalLowFt: number;
  confidenceIntervalHighFt: number;
  unadjustedDifferenceFt: number;
  sensitivityVirginCoefficientFt: number | null;
  matchedRouteCount: number;
  representedDateCount: number;
  qantasFlightCount: number;
  virginFlightCount: number;
  qantasAircraftCount: number;
  virginAircraftCount: number;
}

export interface BenchmarkAnalysis {
  executive: ExecutiveResult;
  routes: MatchedRouteResult[];
  matchedFlights: FlightCruiseMetric[];
}

export interface AnalysisBundle {
  analysisRunId: string;
  flights: FlightCruiseMetric[];
  analysis: BenchmarkAnalysis | null;
  qualityRows: QualityCount[];
}
