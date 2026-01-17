/**
 * GET /api/sequences/:id/trajectories - Get rank trajectories for all aircraft
 */

import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { cache, CACHE_TTL } from "@/lib/cache";
import { getSequenceTrajectories } from "@/lib/db/queries";
import { sequenceParamsSchema } from "@/lib/validation";

interface ApiError {
  error: "VALIDATION_ERROR" | "NOT_FOUND" | "SERVER_ERROR";
  message: string;
  details?: unknown;
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(
  _request: Request,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id } = await params;

    // Validate params
    sequenceParamsSchema.parse({ id });

    const cacheKey = `trajectories:${id}`;

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
    console.log(`[trajectories] Querying for sequence ${id}`);
    const trajectories = await getSequenceTrajectories(id);
    console.log(`[trajectories] Returned ${trajectories?.length ?? 0} trajectories`);

    if (trajectories === null) {
      const apiError: ApiError = {
        error: "NOT_FOUND",
        message: `Sequence not found: ${id}`,
      };
      return NextResponse.json(apiError, { status: 404 });
    }

    const response = {
      sequenceId: id,
      trajectories,
    };

    // Store in cache
    cache.set(cacheKey, response, CACHE_TTL.TRAJECTORIES);

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

    console.error("Error fetching trajectories:", error);
    const apiError: ApiError = {
      error: "SERVER_ERROR",
      message: "Internal server error",
    };
    return NextResponse.json(apiError, { status: 500 });
  }
}
