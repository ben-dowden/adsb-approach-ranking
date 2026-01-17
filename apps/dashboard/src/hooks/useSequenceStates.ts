"use client";

/**
 * SWR hook for fetching aircraft states at a specific timestamp
 */

import useSWR from "swr";

import { fetcher, type StatesResponse } from "@/lib/api";

export function useSequenceStates(sequenceId: string, timestamp: string) {
  const url = `/api/sequences/${sequenceId}/states?ts=${encodeURIComponent(timestamp)}`;

  return useSWR<StatesResponse>(
    sequenceId && timestamp ? url : null,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 2000,
    }
  );
}
