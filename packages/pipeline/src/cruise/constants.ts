export const ANALYSIS_AIRPORTS = {
  YBBN: {
    icao: "YBBN",
    name: "Brisbane",
    lat: -27.3842,
    lon: 153.1175,
  },
  YMML: {
    icao: "YMML",
    name: "Melbourne",
    lat: -37.669,
    lon: 144.841,
  },
  YSSY: {
    icao: "YSSY",
    name: "Sydney",
    lat: -33.9399,
    lon: 151.1753,
  },
  YPPH: {
    icao: "YPPH",
    name: "Perth",
    lat: -31.9403,
    lon: 115.9672,
  },
} as const;

export const B737_TYPES = new Set([
  "B731",
  "B732",
  "B733",
  "B734",
  "B735",
  "B736",
  "B737",
  "B738",
  "B739",
  "B37M",
  "B38M",
  "B39M",
  "B3XM",
]);

export const OPERATOR_NAMES: Readonly<Record<string, string>> = {
  QFA: "Qantas",
  VOZ: "Virgin Australia",
};

export const DEFAULT_CRUISE_CONFIG = {
  sampleIntervalMinutes: 5,
  requiredDays: 12,
  maximumLookbackMonths: 36,
  flightGapMinutes: 20,
  endpointRadiusNm: 40,
  endpointMaxAltitudeFt: 15_000,
  cruiseMinAltitudeFt: 20_000,
  cruiseMinGroundSpeedKt: 300,
  cruiseMaxVerticalRateFpm: 500,
  minimumCruiseObservations: 2,
  minimumMatchedFlights: 5,
  bootstrapReplicates: 10_000,
  bootstrapSeed: 737,
} as const;

export const AUSTRALIAN_ANALYSIS_ENVELOPE = {
  minimumLatitude: -41,
  maximumLatitude: -20,
  minimumLongitude: 112,
  maximumLongitude: 155,
} as const;
