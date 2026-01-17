/**
 * Zod schemas for API request validation
 */

import { z } from "zod";

/** 4-letter ICAO airport code (e.g., YBBN) */
export const airportSchema = z
  .string()
  .regex(/^[A-Z]{4}$/, "Airport must be a 4-letter ICAO code")
  .transform((v) => v.toUpperCase());

/** Date in YYYY-MM-DD format */
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format");

/** Limit for list queries (1-100, default 20) */
export const limitSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(100)
  .default(20);

/** Sequence ID format: AIRPORT_EPOCH (e.g., YBBN_1733050800) */
export const sequenceIdSchema = z
  .string()
  .regex(/^[A-Z]{4}_\d+$/, "Invalid sequence ID format (expected AIRPORT_EPOCH)");

/** ISO8601 datetime (e.g., 2025-12-01T10:00:00Z) */
export const timestampSchema = z
  .string()
  .datetime({ message: "Timestamp must be in ISO8601 format" });

/** Query params for GET /api/sequences */
export const sequencesQuerySchema = z.object({
  airport: airportSchema,
  date: dateSchema,
  limit: limitSchema,
});

/** Params for GET /api/sequences/:id */
export const sequenceParamsSchema = z.object({
  id: sequenceIdSchema,
});

/** Query params for GET /api/sequences/:id/states */
export const statesQuerySchema = z.object({
  ts: timestampSchema,
});

export type SequencesQuery = z.infer<typeof sequencesQuerySchema>;
export type SequenceParams = z.infer<typeof sequenceParamsSchema>;
export type StatesQuery = z.infer<typeof statesQuerySchema>;
