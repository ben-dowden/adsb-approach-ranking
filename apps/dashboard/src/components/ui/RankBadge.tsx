"use client";

/**
 * Color-coded rank indicator badge
 */

import { getRankColor, getScoreColor } from "@/lib/colors";

interface RankBadgeProps {
  rank?: number | null;
  cohortSize?: number | null;
  score?: number;
  showPosition?: boolean;
}

const styles = {
  badge: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "2px 8px",
    borderRadius: "4px",
    fontSize: "12px",
    fontWeight: 600,
    color: "#1f2937",
    minWidth: "32px",
  },
};

export function RankBadge({ rank, cohortSize, score, showPosition = true }: RankBadgeProps) {
  let backgroundColor: string;
  let text: string;

  if (score !== undefined) {
    backgroundColor = getScoreColor(score);
    text = score.toFixed(1);
  } else if (rank !== null && rank !== undefined && cohortSize !== null && cohortSize !== undefined) {
    backgroundColor = getRankColor(rank, cohortSize);
    text = showPosition ? `${rank}/${cohortSize}` : String(rank);
  } else {
    backgroundColor = "#e5e7eb";
    text = "-";
  }

  return (
    <span style={{ ...styles.badge, backgroundColor }}>
      {text}
    </span>
  );
}
