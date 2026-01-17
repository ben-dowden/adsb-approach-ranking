/**
 * GET /api/sequences/:id - Get sequence details with arrival_ids
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { cache, CACHE_TTL } from "@/lib/cache";
import { getSequenceById } from "@/lib/db/queries";
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
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id } = await params;

    // Validate params
    sequenceParamsSchema.parse({ id });

    const cacheKey = `sequence:${id}`;

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
    const sequence = await getSequenceById(id);

    if (!sequence) {
      const apiError: ApiError = {
        error: "NOT_FOUND",
        message: `Sequence not found: ${id}`,
      };
      return NextResponse.json(apiError, { status: 404 });
    }

    // Store in cache
    cache.set(cacheKey, sequence, CACHE_TTL.SEQUENCE);

    return NextResponse.json(sequence, {
      headers: {
        "Cache-Control": "public, max-age=300, immutable",
        "X-Cache": "MISS",
      },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      const apiError: ApiError = {
        error: "VALIDATION_ERROR",
        message: "Invalid sequence ID format",
        details: error.errors,
      };
      return NextResponse.json(apiError, { status: 400 });
    }

    console.error("Error fetching sequence:", error);
    const apiError: ApiError = {
      error: "SERVER_ERROR",
      message: "Internal server error",
    };
    return NextResponse.json(apiError, { status: 500 });
  }
}
