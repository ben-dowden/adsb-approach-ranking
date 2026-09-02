import { DEFAULT_CRUISE_CONFIG } from "./constants.js";
import type {
  CruiseState,
  CruiseSummary,
  FlightCruiseMetric,
  RouteInference,
} from "./types.js";

const MAX_NEIGHBOUR_GAP_MINUTES = 6;

function elapsedMinutes(left: CruiseState, right: CruiseState): number {
  return Math.abs(right.ts.getTime() - left.ts.getTime()) / 60_000;
}

function inferredVerticalRate(
  state: CruiseState,
  neighbour: CruiseState | null
): number | null {
  if (state.verticalRateFpm !== null) return Math.abs(state.verticalRateFpm);
  if (
    !neighbour ||
    state.altitudeFt === null ||
    neighbour.altitudeFt === null
  ) {
    return null;
  }
  const minutes = elapsedMinutes(state, neighbour);
  if (minutes <= 0 || minutes > MAX_NEIGHBOUR_GAP_MINUTES) return null;
  return Math.abs(state.altitudeFt - neighbour.altitudeFt) / minutes;
}

export function isCruiseObservation(
  state: CruiseState,
  neighbour: CruiseState | null
): boolean {
  if (
    state.altitudeFt === null ||
    state.altitudeFt < DEFAULT_CRUISE_CONFIG.cruiseMinAltitudeFt ||
    state.groundSpeedKt === null ||
    state.groundSpeedKt < DEFAULT_CRUISE_CONFIG.cruiseMinGroundSpeedKt
  ) {
    return false;
  }
  const verticalRate = inferredVerticalRate(state, neighbour);
  return (
    verticalRate !== null &&
    verticalRate <= DEFAULT_CRUISE_CONFIG.cruiseMaxVerticalRateFpm
  );
}

function adjacentState(
  states: CruiseState[],
  index: number
): CruiseState | null {
  return states[index - 1] ?? states[index + 1] ?? null;
}

function eligibleCruiseStates(states: CruiseState[]): CruiseState[] {
  const orderedStates = [...states].sort(
    (left, right) => left.ts.getTime() - right.ts.getTime()
  );
  const individuallyEligible = orderedStates.map((state, index) =>
    isCruiseObservation(state, adjacentState(orderedStates, index))
  );

  return orderedStates.filter((state, index) => {
    if (!individuallyEligible[index]) return false;
    const previousSupports =
      index > 0 &&
      individuallyEligible[index - 1] &&
      elapsedMinutes(state, orderedStates[index - 1]!) <=
        MAX_NEIGHBOUR_GAP_MINUTES;
    const nextSupports =
      index + 1 < orderedStates.length &&
      individuallyEligible[index + 1] &&
      elapsedMinutes(state, orderedStates[index + 1]!) <=
        MAX_NEIGHBOUR_GAP_MINUTES;
    return Boolean(previousSupports || nextSupports);
  });
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1]! + ordered[middle]!) / 2
    : ordered[middle]!;
}

function sampleStandardDeviation(values: number[], average: number): number {
  if (values.length < 2) return 0;
  const squaredDifferences = values.map((value) => (value - average) ** 2);
  return Math.sqrt(
    squaredDifferences.reduce((sum, value) => sum + value, 0) /
      (values.length - 1)
  );
}

export function calculateFlightCruiseMetrics(
  states: CruiseState[]
): CruiseSummary | null {
  const cruiseStates = eligibleCruiseStates(states);
  if (cruiseStates.length < DEFAULT_CRUISE_CONFIG.minimumCruiseObservations) {
    return null;
  }

  const altitudes = cruiseStates.map((state) => state.altitudeFt!);
  const average = mean(altitudes);
  return {
    meanCruiseAltitudeFt: average,
    medianCruiseAltitudeFt: median(altitudes),
    minimumCruiseAltitudeFt: Math.min(...altitudes),
    maximumCruiseAltitudeFt: Math.max(...altitudes),
    standardDeviationFt: sampleStandardDeviation(altitudes, average),
    cruiseObservationCount: cruiseStates.length,
    observedCruiseMinutes:
      (cruiseStates.at(-1)!.ts.getTime() - cruiseStates[0]!.ts.getTime()) /
      60_000,
  };
}

export function buildFlightCruiseMetric(
  states: CruiseState[],
  route: RouteInference
): FlightCruiseMetric | null {
  const firstState = [...states].sort(
    (left, right) => left.ts.getTime() - right.ts.getTime()
  )[0];
  if (
    !firstState ||
    !firstState.callsign ||
    !firstState.operatorCode
  ) {
    return null;
  }
  const summary = calculateFlightCruiseMetrics(states);
  if (!summary) return null;

  return {
    flightId: `${firstState.icaoHex}_${firstState.ts.toISOString()}`,
    sampleDate: firstState.ts.toISOString().slice(0, 10),
    registration: firstState.registration,
    icaoHex: firstState.icaoHex,
    aircraftType: firstState.aircraftType,
    callsign: firstState.callsign,
    operatorCode: firstState.operatorCode,
    operatorName: firstState.operatorName,
    originIcao: route.originIcao,
    destinationIcao: route.destinationIcao,
    route: route.route,
    originEvidenceTs: route.originEvidenceTs,
    destinationEvidenceTs: route.destinationEvidenceTs,
    ...summary,
  };
}
