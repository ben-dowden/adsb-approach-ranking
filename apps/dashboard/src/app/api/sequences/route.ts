/**
 * GET /api/sequences - List top N sequences by score
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { cache, CACHE_TTL } from "@/lib/cache";
import { getSequences } from "@/lib/db/queries";
import { sequencesQuerySchema } from "@/lib/validation";

interface ApiError {
  error: "VALIDATION_ERROR" | "NOT_FOUND" | "SERVER_ERROR";
  message: string;
  details?: unknown;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    // Parse and validate query params
    const searchParams = request.nextUrl.searchParams;
    const params = sequencesQuerySchema.parse({
      airport: searchParams.get("airport"),
      date: searchParams.get("date"),
      limit: searchParams.get("limit") ?? undefined,
    });

    const { airport, date, limit } = params;
    const cacheKey = `sequences:${airport}:${date}:${limit}`;

    // Check cache
    const cached = cache.get(cacheKey);
    if (cached) {
      return NextResponse.json(cached, {
        headers: {
          "Cache-Control": "public, max-age=300, immutable",
          "X-Cache": "HIT",
        },
      });
    }

    // Query database
    const sequences = await getSequences(airport, date, limit);

    const response = {
      airport,
      date,
      count: sequences.length,
      sequences,
    };

    // Store in cache
    cache.set(cacheKey, response, CACHE_TTL.SEQUENCES);

    return NextResponse.json(response, {
      headers: {
        "Cache-Control": "public, max-age=300, immutable",
        "X-Cache": "MISS",
      },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      const apiError: ApiError = {
        error: "VALIDATION_ERROR",
        message: "Invalid request parameters",
        details: error.errors,
      };
      return NextResponse.json(apiError, { status: 400 });
    }

    console.error("Error fetching sequences:", error);
    const apiError: ApiError = {
      error: "SERVER_ERROR",
      message: "Internal server error",
    };
    return NextResponse.json(apiError, { status: 500 });
  }
}
