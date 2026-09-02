import { haversineDistanceNm } from "@adsb/shared";

import { ANALYSIS_AIRPORTS, DEFAULT_CRUISE_CONFIG } from "./constants.js";
import type { CruiseState, RouteInferenceResult } from "./types.js";

interface AirportEvidence {
  icao: string;
  stateIndex: number;
  distanceNm: number;
  timestamp: Date;
}

function startsNewSegment(
  previous: CruiseState,
  current: CruiseState
): boolean {
  if (current.icaoHex !== previous.icaoHex) return true;
  if (current.callsign !== previous.callsign) return true;
  const elapsedMinutes =
    (current.ts.getTime() - previous.ts.getTime()) / 60_000;
  return elapsedMinutes > DEFAULT_CRUISE_CONFIG.flightGapMinutes;
}

export function buildTrackSegments(states: CruiseState[]): CruiseState[][] {
  const orderedStates = [...states].sort(
    (left, right) =>
      left.icaoHex.localeCompare(right.icaoHex) ||
      left.ts.getTime() - right.ts.getTime()
  );
  const segments: CruiseState[][] = [];

  for (const currentState of orderedStates) {
    const currentSegment = segments.at(-1);
    const previousState = currentSegment?.at(-1);
    if (
      !currentSegment ||
      !previousState ||
      startsNewSegment(previousState, currentState)
    ) {
      segments.push([currentState]);
    } else {
      currentSegment.push(currentState);
    }
  }
  return segments;
}

function airportEvidenceAtState(
  state: CruiseState,
  stateIndex: number
): AirportEvidence[] {
  if (
    state.altitudeFt === null ||
    state.altitudeFt > DEFAULT_CRUISE_CONFIG.endpointMaxAltitudeFt
  ) {
    return [];
  }

  return Object.values(ANALYSIS_AIRPORTS)
    .map((airport) => ({
      icao: airport.icao,
      stateIndex,
      distanceNm: haversineDistanceNm(
        state.lat,
        state.lon,
        airport.lat,
        airport.lon
      ),
      timestamp: state.ts,
    }))
    .filter(
      (evidence) =>
        evidence.distanceNm <= DEFAULT_CRUISE_CONFIG.endpointRadiusNm
    )
    .sort((left, right) => left.distanceNm - right.distanceNm);
}

function endpointEvidence(states: CruiseState[]): AirportEvidence[][] {
  return states.map(airportEvidenceAtState);
}

function hasCruiseEvidenceBetween(
  states: CruiseState[],
  originIndex: number,
  destinationIndex: number
): boolean {
  const cruiseStates = states
    .slice(originIndex + 1, destinationIndex)
    .filter(
      (state) =>
        state.altitudeFt !== null &&
        state.altitudeFt >= DEFAULT_CRUISE_CONFIG.cruiseMinAltitudeFt &&
        state.groundSpeedKt !== null &&
        state.groundSpeedKt >= DEFAULT_CRUISE_CONFIG.cruiseMinGroundSpeedKt
    );
  return cruiseStates.length >= DEFAULT_CRUISE_CONFIG.minimumCruiseObservations;
}

function movedAwayFromOrigin(
  states: CruiseState[],
  evidence: AirportEvidence,
  destinationIndex: number
): boolean {
  const airport =
    ANALYSIS_AIRPORTS[evidence.icao as keyof typeof ANALYSIS_AIRPORTS];
  return states
    .slice(evidence.stateIndex + 1, destinationIndex)
    .some(
      (state) =>
        haversineDistanceNm(state.lat, state.lon, airport.lat, airport.lon) >
        evidence.distanceNm + 5
    );
}

function movedTowardDestination(
  states: CruiseState[],
  originIndex: number,
  evidence: AirportEvidence
): boolean {
  const airport =
    ANALYSIS_AIRPORTS[evidence.icao as keyof typeof ANALYSIS_AIRPORTS];
  return states
    .slice(originIndex + 1, evidence.stateIndex)
    .some(
      (state) =>
        haversineDistanceNm(state.lat, state.lon, airport.lat, airport.lon) >
        evidence.distanceNm + 5
    );
}

export function inferDirectionalRoute(
  states: CruiseState[]
): RouteInferenceResult {
  const orderedStates = [...states].sort(
    (left, right) => left.ts.getTime() - right.ts.getTime()
  );
  const evidence = endpointEvidence(orderedStates);
  const originIndex = evidence.findIndex((candidates) => candidates.length > 0);
  let destinationIndex = -1;
  for (let index = evidence.length - 1; index > originIndex; index--) {
    if (evidence[index]!.length > 0) {
      destinationIndex = index;
      break;
    }
  }

  if (originIndex < 0 || destinationIndex < 0) {
    return { included: false, reason: "truncated_track" };
  }
  if (
    evidence[originIndex]!.length !== 1 ||
    evidence[destinationIndex]!.length !== 1
  ) {
    return { included: false, reason: "ambiguous_endpoint" };
  }

  const origin = evidence[originIndex]![0]!;
  const destination = evidence[destinationIndex]![0]!;
  if (origin.icao === destination.icao) {
    return { included: false, reason: "same_endpoint" };
  }
  if (!hasCruiseEvidenceBetween(orderedStates, originIndex, destinationIndex)) {
    return { included: false, reason: "insufficient_cruise" };
  }
  if (
    !movedAwayFromOrigin(orderedStates, origin, destinationIndex) ||
    !movedTowardDestination(orderedStates, originIndex, destination)
  ) {
    return { included: false, reason: "truncated_track" };
  }

  return {
    included: true,
    route: {
      originIcao: origin.icao,
      destinationIcao: destination.icao,
      route: `${origin.icao}-${destination.icao}`,
      originEvidenceTs: origin.timestamp,
      destinationEvidenceTs: destination.timestamp,
    },
  };
}
