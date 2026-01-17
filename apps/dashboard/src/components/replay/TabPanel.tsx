"use client";

/**
 * Tabbed container for Arrivals list and Trajectory chart
 */

import { useState } from "react";

import type { AircraftStateAtTimestamp, AircraftTrajectory } from "@/lib/api";

import { ArrivalPanel } from "./ArrivalPanel";
import { RankTrajectoryChart } from "./RankTrajectoryChart";

const styles = {
  container: {
    height: "100%",
    display: "flex",
    flexDirection: "column" as const,
    backgroundColor: "#fff",
  },
  tabs: {
    display: "flex",
    borderBottom: "1px solid #e5e7eb",
    backgroundColor: "#f9fafb",
  },
  tab: {
    flex: 1,
    padding: "12px 16px",
    border: "none",
    backgroundColor: "transparent",
    fontSize: "14px",
    fontWeight: 500,
    color: "#6b7280",
    cursor: "pointer",
    borderBottomWidth: "2px",
    borderBottomStyle: "solid",
    borderBottomColor: "transparent",
    transition: "all 0.15s",
  },
  tabActive: {
    color: "#3b82f6",
    borderBottomColor: "#3b82f6",
    backgroundColor: "#fff",
  },
  content: {
    flex: 1,
    overflow: "hidden",
  },
};

interface TabPanelProps {
  aircraft: AircraftStateAtTimestamp[];
  trajectories: AircraftTrajectory[];
  selectedAircraft: string | null;
  previousStates: Map<string, AircraftStateAtTimestamp>;
  currentDistanceNm: number | null;
  onSelectAircraft: (icao: string | null) => void;
}

type TabId = "arrivals" | "trajectory";

export function TabPanel({
  aircraft,
  trajectories,
  selectedAircraft,
  previousStates,
  currentDistanceNm,
  onSelectAircraft,
}: TabPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>("arrivals");

  return (
    <div style={styles.container}>
      <div style={styles.tabs}>
        <button
          style={{
            ...styles.tab,
            ...(activeTab === "arrivals" ? styles.tabActive : {}),
          }}
          onClick={() => setActiveTab("arrivals")}
        >
          Arrivals
        </button>
        <button
          style={{
            ...styles.tab,
            ...(activeTab === "trajectory" ? styles.tabActive : {}),
          }}
          onClick={() => setActiveTab("trajectory")}
        >
          Trajectory
        </button>
      </div>

      <div style={styles.content}>
        {activeTab === "arrivals" ? (
          <ArrivalPanel
            aircraft={aircraft}
            selectedAircraft={selectedAircraft}
            previousStates={previousStates}
            onSelectAircraft={onSelectAircraft}
          />
        ) : (
          <RankTrajectoryChart
            trajectories={trajectories}
            selectedAircraft={selectedAircraft}
            currentDistanceNm={currentDistanceNm}
            onSelectAircraft={onSelectAircraft}
          />
        )}
      </div>
    </div>
  );
}
