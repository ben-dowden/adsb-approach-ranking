/**
 * GET /api/sequences/:id/states - Get aircraft positions at timestamp
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { cache, CACHE_TTL } from "@/lib/cache";
import { getSequenceStatesAtTimestamp } from "@/lib/db/queries";
import { sequenceParamsSchema, statesQuerySchema } from "@/lib/validation";

interface ApiError {
  error: "VALIDATION_ERROR" | "NOT_FOUND" | "SERVER_ERROR";
  message: string;
  details?: unknown;
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const searchParams = request.nextUrl.searchParams;

    // Validate params and query
    sequenceParamsSchema.parse({ id });
    const { ts } = statesQuerySchema.parse({
      ts: searchParams.get("ts"),
    });

    // Use timestamp truncated to seconds for cache key
    const tsDate = new Date(ts);
    const tsSec = Math.floor(tsDate.getTime() / 1000);
    const cacheKey = `states:${id}:${tsSec}`;

    // Check cache
    const cached = cache.get(cacheKey);
    if (cached) {
      return NextResponse.json(cached, {
        headers: {
          "Cache-Control": "public, max-age=60, immutable",
          "X-Cache": "HIT",
        },
      });
    }

    // Query database
    const states = await getSequenceStatesAtTimestamp(id, ts);

    if (states === null) {
      const apiError: ApiError = {
        error: "NOT_FOUND",
        message: `Sequence not found: ${id}`,
      };
      return NextResponse.json(apiError, { status: 404 });
    }

    const response = {
      sequenceId: id,
      timestamp: ts,
      aircraftCount: states.length,
      aircraft: states,
    };

    // Store in cache
    cache.set(cacheKey, response, CACHE_TTL.STATES);

    return NextResponse.json(response, {
      headers: {
        "Cache-Control": "public, max-age=60, immutable",
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

    console.error("Error fetching states:", error);
    const apiError: ApiError = {
      error: "SERVER_ERROR",
      message: "Internal server error",
    };
    return NextResponse.json(apiError, { status: 500 });
  }
}
