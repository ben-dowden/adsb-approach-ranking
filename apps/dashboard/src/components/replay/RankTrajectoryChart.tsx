"use client";

/**
 * Line chart showing rank evolution as aircraft approach the airport
 */

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";

import type { AircraftTrajectory } from "@/lib/api";
import { getRankColor } from "@/lib/colors";

const styles = {
  container: {
    height: "100%",
    padding: "16px",
    backgroundColor: "#fff",
    display: "flex",
    flexDirection: "column" as const,
  },
  chartWrapper: {
    flex: 1,
    minHeight: "300px",
  },
  emptyState: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    color: "#6b7280",
    fontSize: "14px",
  },
  legend: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: "8px",
    marginTop: "8px",
    padding: "8px",
    borderTop: "1px solid #e5e7eb",
    maxHeight: "100px",
    overflowY: "auto" as const,
  },
  legendItem: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    padding: "2px 8px",
    borderRadius: "4px",
    fontSize: "12px",
    cursor: "pointer",
    backgroundColor: "#f3f4f6",
    border: "1px solid transparent",
  },
  legendItemSelected: {
    border: "1px solid #3b82f6",
    backgroundColor: "#eff6ff",
  },
  legendDot: {
    width: "8px",
    height: "8px",
    borderRadius: "50%",
  },
};

interface RankTrajectoryChartProps {
  trajectories: AircraftTrajectory[];
  selectedAircraft: string | null;
  currentDistanceNm: number | null;
  onSelectAircraft: (icao: string | null) => void;
}

interface ChartDataPoint {
  ringNm: number;
  [key: string]: number | null;
}

export function RankTrajectoryChart({
  trajectories,
  selectedAircraft,
  currentDistanceNm,
  onSelectAircraft,
}: RankTrajectoryChartProps) {
  if (trajectories.length === 0) {
    return (
      <div style={styles.container}>
        <div style={styles.emptyState}>No trajectory data available</div>
      </div>
    );
  }

  // Get all unique ring distances (sorted descending: far to near)
  const allRings = new Set<number>();
  for (const traj of trajectories) {
    for (const point of traj.points) {
      allRings.add(point.ringNm);
    }
  }
  const rings = [...allRings].sort((a, b) => b - a);

  // Build chart data: one entry per ring with aircraft ranks as properties
  const chartData: ChartDataPoint[] = rings.map((ringNm) => {
    const point: ChartDataPoint = { ringNm };
    for (const traj of trajectories) {
      const trajPoint = traj.points.find((p) => p.ringNm === ringNm);
      point[traj.icao] = trajPoint ? trajPoint.rankDistance : null;
    }
    return point;
  });

  // Get max cohort size for Y-axis
  const maxRank = Math.max(...trajectories.map((t) => t.cohortSize));

  // Custom tooltip
  const CustomTooltip = ({
    active,
    payload,
    label,
  }: {
    active?: boolean;
    payload?: Array<{ dataKey: string; value: number; color: string }>;
    label?: number;
  }) => {
    if (!active || !payload || payload.length === 0) return null;

    // Sort by rank
    const sorted = [...payload].sort((a, b) => a.value - b.value);

    return (
      <div
        style={{
          backgroundColor: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: "4px",
          padding: "8px",
          fontSize: "12px",
          boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: "4px" }}>
          {label} nm from airport
        </div>
        {sorted.slice(0, 5).map((entry) => {
          const traj = trajectories.find((t) => t.icao === entry.dataKey);
          return (
            <div
              key={entry.dataKey}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "4px",
                color: entry.color,
              }}
            >
              <span style={{ fontFamily: "monospace" }}>
                {traj?.callsign ?? entry.dataKey}
              </span>
              : #{entry.value}
            </div>
          );
        })}
        {sorted.length > 5 && (
          <div style={{ color: "#6b7280", marginTop: "4px" }}>
            +{sorted.length - 5} more
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={styles.container}>
      <div style={styles.chartWrapper}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
          data={chartData}
          margin={{ top: 20, right: 20, left: 20, bottom: 20 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="ringNm"
            reversed={false}
            domain={[0, Math.max(...rings)]}
            label={{
              value: "Distance from airport (nm)",
              position: "bottom",
              offset: 0,
              style: { fontSize: "12px", fill: "#6b7280" },
            }}
            tick={{ fontSize: 11 }}
          />
          <YAxis
            reversed
            domain={[1, maxRank]}
            label={{
              value: "Rank",
              angle: -90,
              position: "insideLeft",
              style: { fontSize: "12px", fill: "#6b7280" },
            }}
            tick={{ fontSize: 11 }}
            allowDecimals={false}
          />
          <Tooltip content={<CustomTooltip />} />

          {/* Vertical reference line for current playback position */}
          {currentDistanceNm !== null && (
            <ReferenceLine
              x={currentDistanceNm}
              stroke="#3b82f6"
              strokeWidth={2}
              strokeDasharray="5 5"
              label={{
                value: `${currentDistanceNm.toFixed(1)} nm`,
                position: "top",
                fill: "#3b82f6",
                fontSize: 11,
              }}
            />
          )}

          {/* One line per aircraft */}
          {trajectories.map((traj) => {
            const isSelected = selectedAircraft === traj.icao;
            const color = getRankColor(traj.finalRank, traj.cohortSize);
            return (
              <Line
                key={traj.icao}
                type="monotone"
                dataKey={traj.icao}
                stroke={color}
                strokeWidth={isSelected ? 3 : 1.5}
                opacity={isSelected || !selectedAircraft ? 1 : 0.3}
                dot={{
                  r: isSelected ? 4 : 2,
                  fill: color,
                  stroke: color,
                  cursor: "pointer",
                }}
                activeDot={{
                  r: 6,
                  onClick: () => onSelectAircraft(traj.icao),
                  cursor: "pointer",
                }}
                connectNulls
              />
            );
          })}
        </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Custom legend with clickable callsigns */}
      <div style={styles.legend}>
        {trajectories.map((traj) => {
          const isSelected = selectedAircraft === traj.icao;
          const color = getRankColor(traj.finalRank, traj.cohortSize);
          return (
            <div
              key={traj.icao}
              style={{
                ...styles.legendItem,
                ...(isSelected ? styles.legendItemSelected : {}),
              }}
              onClick={() =>
                onSelectAircraft(isSelected ? null : traj.icao)
              }
            >
              <div
                style={{
                  ...styles.legendDot,
                  backgroundColor: color,
                }}
              />
              <span style={{ fontFamily: "monospace", fontSize: "11px" }}>
                {traj.callsign ?? traj.icao}
              </span>
              <span style={{ color: "#6b7280" }}>#{traj.finalRank}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
