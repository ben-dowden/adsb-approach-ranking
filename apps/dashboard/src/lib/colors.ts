/**
 * Rank color scale utilities
 * Green (1st) → Yellow (middle) → Red (last)
 */

export const RANK_COLORS = {
  green: "#4ade80",
  yellow: "#fbbf24",
  red: "#f87171",
  border: "#e5e7eb",
} as const;

/**
 * Get color for rank position based on cohort size
 * @param rank - 1-based rank position
 * @param cohortSize - total number in cohort
 * @returns hex color string
 */
export function getRankColor(rank: number, cohortSize: number): string {
  if (cohortSize <= 1) return RANK_COLORS.green;

  // Normalize to 0-1 range (0 = first, 1 = last)
  const t = (rank - 1) / (cohortSize - 1);

  // Interpolate green → yellow → red
  if (t <= 0.5) {
    // Green to Yellow (0 to 0.5)
    const s = t * 2;
    return interpolateColor(RANK_COLORS.green, RANK_COLORS.yellow, s);
  } else {
    // Yellow to Red (0.5 to 1)
    const s = (t - 0.5) * 2;
    return interpolateColor(RANK_COLORS.yellow, RANK_COLORS.red, s);
  }
}

/**
 * Interpolate between two hex colors
 */
function interpolateColor(color1: string, color2: string, t: number): string {
  const r1 = parseInt(color1.slice(1, 3), 16);
  const g1 = parseInt(color1.slice(3, 5), 16);
  const b1 = parseInt(color1.slice(5, 7), 16);

  const r2 = parseInt(color2.slice(1, 3), 16);
  const g2 = parseInt(color2.slice(3, 5), 16);
  const b2 = parseInt(color2.slice(5, 7), 16);

  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);

  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

/**
 * Get score color based on sequence score
 * Higher scores = more churn = more red
 */
export function getScoreColor(score: number): string {
  // Score typically ranges from 0 to ~50+
  // Normalize to 0-1 range, clamping at reasonable max
  const maxScore = 50;
  const t = Math.min(score / maxScore, 1);
  return getRankColor(Math.round(t * 10) + 1, 11);
}
