/**
 * Type definitions for the normalize pipeline step
 */

/** Raw aircraft data from readsb JSON files */
export interface RawAircraft {
  hex: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | "ground";
  gs?: number;
  track?: number;
  flight?: string;
  baro_rate?: number;
  geom_rate?: number;
}

/** Raw readsb JSON file structure */
export interface RawReadsbFile {
  now: number;
  aircraft: RawAircraft[];
}

/** Normalized aircraft state for DuckDB storage */
export interface NormalizedState {
  ts: Date;
  icao: string;
  callsign: string | null;
  lat: number;
  lon: number;
  alt_baro: number | null;
  gs: number | null;
  track: number | null;
  vrt: number | null;
  distance_nm: number;
  airport_icao: string;
}

/** Airport registry entry */
export interface Airport {
  icao: string;
  lat: number;
  lon: number;
  name: string;
}

/** CLI arguments for normalize script */
export interface NormalizeArgs {
  airport: string;
  date: string;
  radiusNm: number;
}
