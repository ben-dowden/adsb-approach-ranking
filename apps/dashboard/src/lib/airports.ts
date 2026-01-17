/**
 * Airport coordinate definitions
 */

export interface AirportCoordinates {
  lat: number;
  lon: number;
  name: string;
}

export const AIRPORTS: Record<string, AirportCoordinates> = {
  YBBN: {
    lat: -27.3942,
    lon: 153.1218,
    name: "Brisbane Airport",
  },
};

export function getAirportCoordinates(icao: string): AirportCoordinates | null {
  return AIRPORTS[icao] ?? null;
}

export function getAirportList(): Array<{ icao: string } & AirportCoordinates> {
  return Object.entries(AIRPORTS).map(([icao, coords]) => ({
    icao,
    ...coords,
  }));
}
