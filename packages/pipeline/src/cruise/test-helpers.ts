import type { CruiseState, FlightCruiseMetric } from "./types.js";

export function state(
  isoTimestamp: string,
  overrides: Partial<CruiseState> = {}
): CruiseState {
  return {
    ts: new Date(isoTimestamp),
    icaoHex: "7C0001",
    registration: "VH-TEST",
    aircraftType: "B738",
    callsign: "VOZ1",
    operatorCode: "VOZ",
    operatorName: "Virgin Australia",
    lat: -30,
    lon: 150,
    altitudeFt: 37_000,
    groundSpeedKt: 450,
    verticalRateFpm: 0,
    onGround: false,
    ...overrides,
  };
}

export function fixtureFlights(
  route: string,
  sampleDate: string,
  operatorCode: "QFA" | "VOZ",
  altitudeFt: number,
  count: number,
  type = "B738"
): FlightCruiseMetric[] {
  const [originIcao, destinationIcao] = route.split("-") as [string, string];
  return Array.from({ length: count }, (_, index) => ({
    flightId: `${sampleDate}-${route}-${operatorCode}-${index}`,
    sampleDate,
    registration: `VH-${operatorCode}${String(index).padStart(2, "0")}`,
    icaoHex: `${operatorCode}${String(index).padStart(3, "0")}`,
    aircraftType: type,
    callsign: `${operatorCode}${100 + index}`,
    operatorCode,
    operatorName: operatorCode === "QFA" ? "Qantas" : "Virgin Australia",
    originIcao,
    destinationIcao,
    route,
    originEvidenceTs: new Date(`${sampleDate}T00:00:00Z`),
    destinationEvidenceTs: new Date(`${sampleDate}T01:00:00Z`),
    meanCruiseAltitudeFt: altitudeFt,
    medianCruiseAltitudeFt: altitudeFt,
    minimumCruiseAltitudeFt: altitudeFt,
    maximumCruiseAltitudeFt: altitudeFt,
    standardDeviationFt: 0,
    cruiseObservationCount: 2,
    observedCruiseMinutes: 5,
  }));
}
