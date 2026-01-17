"use client";

/**
 * Sortable table of sequences
 */

import { useRouter } from "next/navigation";

import { RankBadge } from "@/components/ui/RankBadge";
import type { SequenceSummary } from "@/lib/api";

const styles = {
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontSize: "14px",
  },
  th: {
    padding: "12px 16px",
    textAlign: "left" as const,
    borderBottom: "2px solid #e5e7eb",
    fontWeight: 600,
    color: "#374151",
    backgroundColor: "#f9fafb",
  },
  td: {
    padding: "12px 16px",
    borderBottom: "1px solid #e5e7eb",
    color: "#1f2937",
  },
  tr: {
    cursor: "pointer",
    transition: "background-color 0.15s",
  },
  trHover: {
    backgroundColor: "#f3f4f6",
  },
  emptyState: {
    padding: "48px",
    textAlign: "center" as const,
    color: "#6b7280",
  },
  time: {
    fontFamily: "monospace",
    fontSize: "13px",
  },
};

interface SequenceTableProps {
  sequences: SequenceSummary[];
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString("en-AU", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function SequenceTable({ sequences }: SequenceTableProps) {
  const router = useRouter();

  if (sequences.length === 0) {
    return (
      <div style={styles.emptyState}>
        <p>No sequences found for this date.</p>
        <p style={{ fontSize: "13px", marginTop: "8px" }}>
          Try selecting a different date or airport.
        </p>
      </div>
    );
  }

  return (
    <table style={styles.table}>
      <thead>
        <tr>
          <th style={styles.th}>Time Window</th>
          <th style={styles.th}>Score</th>
          <th style={styles.th}>Volatility</th>
          <th style={styles.th}>Inversions</th>
          <th style={styles.th}>Aircraft</th>
        </tr>
      </thead>
      <tbody>
        {sequences.map((seq) => (
          <tr
            key={seq.sequenceId}
            style={styles.tr}
            onClick={() => router.push(`/sequence/${seq.sequenceId}`)}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "#f3f4f6";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "";
            }}
          >
            <td style={styles.td}>
              <span style={styles.time}>
                {formatTime(seq.windowStartTs)} – {formatTime(seq.windowEndTs)}
              </span>
            </td>
            <td style={styles.td}>
              <RankBadge score={seq.sequenceScore} />
            </td>
            <td style={styles.td}>{seq.rankVolatility.toFixed(2)}</td>
            <td style={styles.td}>{seq.inversionCount}</td>
            <td style={styles.td}>{seq.aircraftCount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
