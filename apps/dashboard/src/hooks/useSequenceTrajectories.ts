"use client";

/**
 * SWR hook for fetching aircraft trajectories for a sequence
 */

import useSWR from "swr";

import { fetcher, type TrajectoriesResponse } from "@/lib/api";

export function useSequenceTrajectories(sequenceId: string) {
  return useSWR<TrajectoriesResponse>(
    sequenceId ? `/api/sequences/${sequenceId}/trajectories` : null,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000,
    }
  );
}
