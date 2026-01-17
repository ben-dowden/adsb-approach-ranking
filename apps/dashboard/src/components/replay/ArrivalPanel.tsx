"use client";

/**
 * Side panel with arrival list sorted by distance
 */

import type { AircraftStateAtTimestamp } from "@/lib/api";
import { getRankColor, RANK_COLORS } from "@/lib/colors";

const styles = {
  container: {
    height: "100%",
    display: "flex",
    flexDirection: "column" as const,
    backgroundColor: "#fff",
  },
  header: {
    padding: "16px",
    borderBottom: "1px solid #e5e7eb",
    backgroundColor: "#f9fafb",
  },
  title: {
    margin: 0,
    fontSize: "16px",
    fontWeight: 600,
    color: "#111827",
  },
  subtitle: {
    margin: "4px 0 0",
    fontSize: "12px",
    color: "#6b7280",
  },
  list: {
    flex: 1,
    overflowY: "auto" as const,
    padding: "8px",
  },
  item: {
    padding: "12px",
    borderRadius: "8px",
    marginBottom: "8px",
    cursor: "pointer",
    transition: "background-color 0.15s",
    border: "1px solid transparent",
  },
  itemSelected: {
    backgroundColor: "#eff6ff",
    border: "1px solid #3b82f6",
  },
  itemHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "4px",
  },
  callsign: {
    fontWeight: 600,
    fontSize: "14px",
    color: "#111827",
    fontFamily: "monospace",
  },
  rankBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    padding: "2px 8px",
    borderRadius: "4px",
    fontSize: "12px",
    fontWeight: 600,
  },
  details: {
    display: "flex",
    gap: "16px",
    fontSize: "12px",
    color: "#6b7280",
  },
  changeArrow: {
    fontSize: "10px",
    fontWeight: 700,
  },
  emptyState: {
    padding: "24px",
    textAlign: "center" as const,
    color: "#6b7280",
    fontSize: "14px",
  },
};

interface ArrivalPanelProps {
  aircraft: AircraftStateAtTimestamp[];
  selectedAircraft: string | null;
  previousStates: Map<string, AircraftStateAtTimestamp>;
  onSelectAircraft: (icao: string | null) => void;
}

function getRankChange(
  current: AircraftStateAtTimestamp,
  previous: AircraftStateAtTimestamp | undefined
): { change: number; arrow: string; color: string } | null {
  if (!previous || current.rankDistance === null || previous.rankDistance === null) {
    return null;
  }
  const change = previous.rankDistance - current.rankDistance;
  if (change === 0) return null;
  return {
    change,
    arrow: change > 0 ? "▲" : "▼",
    color: change > 0 ? RANK_COLORS.green : RANK_COLORS.red,
  };
}

export function ArrivalPanel({
  aircraft,
  selectedAircraft,
  previousStates,
  onSelectAircraft,
}: ArrivalPanelProps) {
  // Sort by distance (closest first)
  const sorted = [...aircraft].sort((a, b) => a.distanceNm - b.distanceNm);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Arrivals</h2>
        <p style={styles.subtitle}>
          {aircraft.length} aircraft in approach sequence
        </p>
      </div>
      <div style={styles.list}>
        {sorted.length === 0 ? (
          <div style={styles.emptyState}>No aircraft in view</div>
        ) : (
          sorted.map((ac) => {
            const isSelected = selectedAircraft === ac.icao;
            const rankColor =
              ac.rankDistance !== null && ac.cohortSize !== null
                ? getRankColor(ac.rankDistance, ac.cohortSize)
                : "#e5e7eb";
            const rankChange = getRankChange(ac, previousStates.get(ac.icao));

            return (
              <div
                key={ac.icao}
                style={{
                  ...styles.item,
                  ...(isSelected ? styles.itemSelected : {}),
                  backgroundColor: isSelected ? "#eff6ff" : undefined,
                }}
                onClick={() =>
                  onSelectAircraft(isSelected ? null : ac.icao)
                }
                onMouseEnter={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.backgroundColor = "#f3f4f6";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.backgroundColor = "";
                  }
                }}
              >
                <div style={styles.itemHeader}>
                  <span style={styles.callsign}>
                    {ac.callsign ?? ac.icao}
                  </span>
                  <span
                    style={{
                      ...styles.rankBadge,
                      backgroundColor: rankColor,
                      color: "#1f2937",
                    }}
                  >
                    {ac.rankDistance !== null && ac.cohortSize !== null
                      ? `#${ac.rankDistance}`
                      : "-"}
                    {rankChange && (
                      <span
                        style={{
                          ...styles.changeArrow,
                          color: rankChange.color,
                        }}
                      >
                        {rankChange.arrow}
                      </span>
                    )}
                  </span>
                </div>
                <div style={styles.details}>
                  <span>{ac.distanceNm.toFixed(1)} nm</span>
                  {ac.altBaro !== null && (
                    <span>{Math.round(ac.altBaro).toLocaleString()} ft</span>
                  )}
                  {ac.gs !== null && <span>{Math.round(ac.gs)} kts</span>}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
