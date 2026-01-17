/**
 * Core data types for ADS-B Arrival Sequencing POC
 * See docs/data-contracts.md for full schema documentation
 */

/** Aircraft state vector within capture area */
export interface AircraftState {
  ts: Date;
  icao: string;
  callsign: string | null;
  lat: number;
  lon: number;
  altBaro: number | null;
  gs: number | null;
  track: number | null;
  vrt: number | null;
  distanceNm: number;
  airportIcao: string;
}

/** Ring crossing event */
export interface RingEvent {
  arrivalId: string;
  airportIcao: string;
  icao: string;
  callsign: string | null;
  ringNm: number;
  crossTs: Date;
  lat: number;
  lon: number;
  altBaro: number | null;
  gs: number | null;
  track: number | null;
  closingRate: number;
  distanceNm: number;
  rankDistance: number | null;
  rankTtg: number | null;
  trafficCount: number;
}

/** Scored arrival sequence */
export interface Sequence {
  sequenceId: string;
  airportIcao: string;
  startTs: Date;
  endTs: Date;
  durationSec: number;
  aircraftCount: number;
  scoreRankVol: number;
  scoreInversions: number;
  trafficCount: number;
}

/** Configuration for pipeline runs */
export interface PipelineConfig {
  airportIcao: string;
  airportLat: number;
  airportLon: number;
  maxDistanceNm: number;
  maxAltitudeFt: number;
  ringDistances: number[];
  cohortWindowSec: number;
}

/** Default ring distances in nautical miles */
export const DEFAULT_RING_DISTANCES = [50, 40, 30, 25, 20, 15, 10, 8, 6, 4] as const;

/** Default cohort time window in seconds */
export const DEFAULT_COHORT_WINDOW_SEC = 600;
