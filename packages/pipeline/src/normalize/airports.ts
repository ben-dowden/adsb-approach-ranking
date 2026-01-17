/**
 * Airport registry loader
 */

import { readFile } from "node:fs/promises";
import type { Airport } from "./types.js";

/**
 * Load airport registry from JSON file
 */
export async function loadAirportRegistry(path: string): Promise<Airport[]> {
  const content = await readFile(path, "utf-8");
  const data = JSON.parse(content) as unknown[];

  // Validate structure
  if (!Array.isArray(data)) {
    throw new Error("Airport registry must be an array");
  }

  const airports: Airport[] = [];
  for (const item of data) {
    if (!isValidAirport(item)) {
      throw new Error(`Invalid airport entry: ${JSON.stringify(item)}`);
    }
    airports.push(item);
  }

  return airports;
}

/**
 * Get airport by ICAO code
 */
export function getAirport(registry: Airport[], icao: string): Airport | null {
  return registry.find((a) => a.icao === icao) ?? null;
}

/**
 * List all available airport ICAO codes
 */
export function listAirportCodes(registry: Airport[]): string[] {
  return registry.map((a) => a.icao);
}

function isValidAirport(obj: unknown): obj is Airport {
  if (typeof obj !== "object" || obj === null) return false;
  const a = obj as Record<string, unknown>;
  return (
    typeof a.icao === "string" &&
    typeof a.lat === "number" &&
    typeof a.lon === "number" &&
    typeof a.name === "string"
  );
}
