"use client";

/**
 * Main replay view orchestrator component
 * Manages state and coordinates child components
 */

import dynamic from "next/dynamic";
import { useEffect, useMemo } from "react";

import { useReplayState } from "@/hooks/useReplayState";
import { useSequenceStates } from "@/hooks/useSequenceStates";
import { getAirportCoordinates } from "@/lib/airports";
import type { SequenceDetail } from "@/lib/api";

import { ArrivalPanel } from "./ArrivalPanel";
import { TimeScrubber } from "./TimeScrubber";

// Dynamic import for ApproachMap to avoid SSR issues with Leaflet
const ApproachMap = dynamic(() => import("./ApproachMap").then((m) => m.ApproachMap), {
  ssr: false,
  loading: () => (
    <div style={styles.mapLoading}>
      <span>Loading map...</span>
    </div>
  ),
});

const styles = {
  container: {
    display: "flex",
    height: "100vh",
    flexDirection: "column" as const,
  },
  header: {
    padding: "12px 16px",
    borderBottom: "1px solid #e5e7eb",
    backgroundColor: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    margin: 0,
    fontSize: "16px",
    fontWeight: 600,
    color: "#111827",
  },
  meta: {
    display: "flex",
    gap: "16px",
    fontSize: "13px",
    color: "#6b7280",
  },
  main: {
    display: "flex",
    flex: 1,
    overflow: "hidden",
  },
  mapContainer: {
    flex: "0 0 70%",
    display: "flex",
    flexDirection: "column" as const,
  },
  map: {
    flex: 1,
  },
  panel: {
    flex: "0 0 30%",
    borderLeft: "1px solid #e5e7eb",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column" as const,
  },
  mapLoading: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    backgroundColor: "#f3f4f6",
    color: "#6b7280",
  },
  error: {
    padding: "24px",
    margin: "24px",
    backgroundColor: "#fef2f2",
    color: "#dc2626",
    borderRadius: "8px",
    textAlign: "center" as const,
  },
  loading: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100vh",
    color: "#6b7280",
  },
  backLink: {
    color: "#3b82f6",
    textDecoration: "none",
    fontSize: "14px",
  },
};

interface ReplayViewProps {
  sequence: SequenceDetail;
}

function formatDateTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function ReplayView({ sequence }: ReplayViewProps) {
  const windowStartTs = useMemo(
    () => new Date(sequence.windowStartTs),
    [sequence.windowStartTs]
  );
  const windowEndTs = useMemo(
    () => new Date(sequence.windowEndTs),
    [sequence.windowEndTs]
  );

  const replayState = useReplayState({ windowStartTs, windowEndTs });
  const {
    currentTs,
    isPlaying,
    selectedAircraft,
    playbackSpeed,
    previousStates,
    togglePlay,
    seek,
    selectAircraft,
    setPlaybackSpeed,
    updatePreviousStates,
  } = replayState;

  const { data } = useSequenceStates(
    sequence.sequenceId,
    currentTs.toISOString()
  );

  const aircraft = data?.aircraft ?? [];

  // Update previous states when we get new data
  useEffect(() => {
    if (data?.aircraft) {
      updatePreviousStates(data.aircraft);
    }
  }, [data?.aircraft, updatePreviousStates]);

  // Auto-select first aircraft if none selected
  useEffect(() => {
    const firstAircraft = aircraft[0];
    if (firstAircraft && selectedAircraft === null) {
      selectAircraft(firstAircraft.icao);
    }
  }, [aircraft, selectedAircraft, selectAircraft]);

  const airport = getAirportCoordinates(sequence.airportIcao);
  if (!airport) {
    return (
      <div style={styles.error}>
        Unknown airport: {sequence.airportIcao}
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div>
          <a href="/sequences" style={styles.backLink}>
            ← Back to sequences
          </a>
          <h1 style={styles.title}>
            {sequence.airportIcao} Sequence Replay
          </h1>
        </div>
        <div style={styles.meta}>
          <span>{formatDateTime(sequence.windowStartTs)}</span>
          <span>Score: {sequence.sequenceScore.toFixed(1)}</span>
          <span>{sequence.aircraftCount} aircraft</span>
        </div>
      </header>

      <div style={styles.main}>
        <div style={styles.mapContainer}>
          <div style={styles.map}>
            <ApproachMap
              centerLat={airport.lat}
              centerLon={airport.lon}
              aircraft={aircraft}
              selectedAircraft={selectedAircraft}
              previousStates={previousStates}
              onSelectAircraft={selectAircraft}
            />
          </div>
          <TimeScrubber
            currentTs={currentTs}
            windowStartTs={windowStartTs}
            windowEndTs={windowEndTs}
            isPlaying={isPlaying}
            playbackSpeed={playbackSpeed}
            onTogglePlay={togglePlay}
            onSeek={seek}
            onSpeedChange={setPlaybackSpeed}
          />
        </div>

        <div style={styles.panel}>
          <ArrivalPanel
            aircraft={aircraft}
            selectedAircraft={selectedAircraft}
            previousStates={previousStates}
            onSelectAircraft={selectAircraft}
          />
        </div>
      </div>
    </div>
  );
}
