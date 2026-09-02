import type { RawAircraft } from "../normalize/types.js";

import {
  AUSTRALIAN_ANALYSIS_ENVELOPE,
  B737_TYPES,
  OPERATOR_NAMES,
} from "./constants.js";
import type { CruiseState } from "./types.js";

function normalizedText(value: string | undefined): string | null {
  const normalized = value?.trim().toUpperCase();
  return normalized || null;
}

function isInsideAnalysisEnvelope(
  latitude: number,
  longitude: number
): boolean {
  return (
    latitude >= AUSTRALIAN_ANALYSIS_ENVELOPE.minimumLatitude &&
    latitude <= AUSTRALIAN_ANALYSIS_ENVELOPE.maximumLatitude &&
    longitude >= AUSTRALIAN_ANALYSIS_ENVELOPE.minimumLongitude &&
    longitude <= AUSTRALIAN_ANALYSIS_ENVELOPE.maximumLongitude
  );
}

function operatorCodeFromCallsign(callsign: string | null): string | null {
  return callsign?.match(/^([A-Z]{3})/)?.[1] ?? null;
}

export function normalizeCruiseAircraft(
  raw: RawAircraft,
  timestamp: Date
): CruiseState | null {
  const aircraftType = normalizedText(raw.t);
  const registration = normalizedText(raw.r);
  if (!aircraftType || !B737_TYPES.has(aircraftType) || !registration) {
    return null;
  }
  if (!raw.hex || raw.lat === undefined || raw.lon === undefined) {
    return null;
  }
  if (!isInsideAnalysisEnvelope(raw.lat, raw.lon)) {
    return null;
  }

  const callsign = normalizedText(raw.flight);
  const operatorCode = operatorCodeFromCallsign(callsign);
  return {
    ts: timestamp,
    icaoHex: raw.hex.toUpperCase(),
    registration,
    aircraftType,
    callsign,
    operatorCode,
    operatorName: operatorCode ? (OPERATOR_NAMES[operatorCode] ?? null) : null,
    lat: raw.lat,
    lon: raw.lon,
    altitudeFt: typeof raw.alt_baro === "number" ? raw.alt_baro : null,
    groundSpeedKt: raw.gs ?? null,
    verticalRateFpm: raw.baro_rate ?? raw.geom_rate ?? null,
    onGround: raw.alt_baro === "ground",
  };
}

export function normalizeCruiseSnapshot(
  aircraft: RawAircraft[],
  timestamp: Date
): CruiseState[] {
  const states: CruiseState[] = [];
  for (const rawAircraft of aircraft) {
    const state = normalizeCruiseAircraft(rawAircraft, timestamp);
    if (state) states.push(state);
  }
  return states;
}
