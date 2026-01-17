/**
 * API client functions for the dashboard
 */

import type {
  SequenceSummary,
  SequenceDetail,
  AircraftStateAtTimestamp,
} from "./db/queries";

export type { SequenceSummary, SequenceDetail, AircraftStateAtTimestamp };

export interface SequencesResponse {
  airport: string;
  date: string;
  count: number;
  sequences: SequenceSummary[];
}

export interface StatesResponse {
  sequenceId: string;
  timestamp: string;
  aircraftCount: number;
  aircraft: AircraftStateAtTimestamp[];
}

export interface ApiError {
  error: "VALIDATION_ERROR" | "NOT_FOUND" | "SERVER_ERROR";
  message: string;
  details?: unknown;
}

const API_BASE = "/api";

/**
 * Generic fetcher for SWR
 */
export async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const error = (await res.json()) as ApiError;
    throw new Error(error.message);
  }
  return res.json();
}

/**
 * Fetch sequences for an airport and date
 */
export async function fetchSequences(
  airport: string,
  date: string,
  limit = 20
): Promise<SequencesResponse> {
  const params = new URLSearchParams({ airport, date, limit: String(limit) });
  const res = await fetch(`${API_BASE}/sequences?${params}`);
  if (!res.ok) {
    const error = (await res.json()) as ApiError;
    throw new Error(error.message);
  }
  return res.json();
}

/**
 * Fetch sequence details by ID
 */
export async function fetchSequence(id: string): Promise<SequenceDetail> {
  const res = await fetch(`${API_BASE}/sequences/${id}`);
  if (!res.ok) {
    const error = (await res.json()) as ApiError;
    throw new Error(error.message);
  }
  return res.json();
}

/**
 * Fetch aircraft states at a specific timestamp
 */
export async function fetchStates(
  sequenceId: string,
  timestamp: string
): Promise<StatesResponse> {
  const params = new URLSearchParams({ ts: timestamp });
  const res = await fetch(`${API_BASE}/sequences/${sequenceId}/states?${params}`);
  if (!res.ok) {
    const error = (await res.json()) as ApiError;
    throw new Error(error.message);
  }
  return res.json();
}
