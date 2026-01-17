/**
 * Type definitions for the derive pipeline step
 */

/** CLI arguments for derive script */
export interface DeriveArgs {
  airport: string;
  date: string;
  rings: number[];
}

/** Aircraft state within a track */
export interface TrackState {
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
}

/** Aircraft track (ordered sequence of states) */
export interface Track {
  icao: string;
  states: TrackState[];
}

/** Interpolated ring crossing event (before traffic count lookup) */
export interface InterpolatedCrossing {
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
}

/** Default ring distances in nautical miles */
export const DEFAULT_RINGS = [50, 40, 30, 25, 20, 15, 10, 8, 6, 4] as const;

/** Default gap threshold in seconds (skip transitions with larger gaps) */
export const DEFAULT_GAP_THRESHOLD_SEC = 30;

/** Default traffic count bucket size in seconds */
export const DEFAULT_BUCKET_SIZE_SEC = 5;
