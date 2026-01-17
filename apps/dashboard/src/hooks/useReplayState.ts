"use client";

/**
 * Replay control state management hook
 */

import { useState, useCallback, useEffect, useRef } from "react";

import type { AircraftStateAtTimestamp } from "@/lib/api";

export type PlaybackSpeed = 1 | 2 | 5;

export interface ReplayState {
  currentTs: Date;
  isPlaying: boolean;
  selectedAircraft: string | null;
  playbackSpeed: PlaybackSpeed;
  previousStates: Map<string, AircraftStateAtTimestamp>;
}

interface UseReplayStateProps {
  windowStartTs: Date;
  windowEndTs: Date;
}

export function useReplayState({ windowStartTs, windowEndTs }: UseReplayStateProps) {
  const [currentTs, setCurrentTs] = useState<Date>(windowStartTs);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedAircraft, setSelectedAircraft] = useState<string | null>(null);
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>(1);
  const previousStatesRef = useRef<Map<string, AircraftStateAtTimestamp>>(new Map());

  // Reset to start when window changes
  useEffect(() => {
    setCurrentTs(windowStartTs);
    setIsPlaying(false);
  }, [windowStartTs]);

  // Playback interval
  useEffect(() => {
    if (!isPlaying) return;

    const stepMs = 5000; // 5 second steps
    const intervalMs = stepMs / playbackSpeed;

    const interval = setInterval(() => {
      setCurrentTs((prev) => {
        const next = new Date(prev.getTime() + stepMs);
        if (next >= windowEndTs) {
          setIsPlaying(false);
          return windowEndTs;
        }
        return next;
      });
    }, intervalMs);

    return () => clearInterval(interval);
  }, [isPlaying, playbackSpeed, windowEndTs]);

  const play = useCallback(() => setIsPlaying(true), []);
  const pause = useCallback(() => setIsPlaying(false), []);
  const togglePlay = useCallback(() => setIsPlaying((prev) => !prev), []);

  const seek = useCallback(
    (ts: Date) => {
      const clamped = new Date(
        Math.max(windowStartTs.getTime(), Math.min(ts.getTime(), windowEndTs.getTime()))
      );
      setCurrentTs(clamped);
    },
    [windowStartTs, windowEndTs]
  );

  const selectAircraft = useCallback((icao: string | null) => {
    setSelectedAircraft(icao);
  }, []);

  const updatePreviousStates = useCallback((states: AircraftStateAtTimestamp[]) => {
    const newMap = new Map<string, AircraftStateAtTimestamp>();
    for (const state of states) {
      newMap.set(state.icao, state);
    }
    const prev = previousStatesRef.current;
    previousStatesRef.current = newMap;
    return prev;
  }, []);

  return {
    currentTs,
    isPlaying,
    selectedAircraft,
    playbackSpeed,
    previousStates: previousStatesRef.current,
    play,
    pause,
    togglePlay,
    seek,
    selectAircraft,
    setPlaybackSpeed,
    updatePreviousStates,
    windowStartTs,
    windowEndTs,
  };
}
