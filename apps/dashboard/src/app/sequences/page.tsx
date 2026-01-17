/**
 * Sequences list page - Server Component
 * Browse sequences by date and airport
 */

import { DateFilter } from "@/components/sequences/DateFilter";
import { SequenceTable } from "@/components/sequences/SequenceTable";
import { getAirportList } from "@/lib/airports";
import { fetchSequences } from "@/lib/api";

const styles = {
  container: {
    maxWidth: "1200px",
    margin: "0 auto",
  },
  header: {
    padding: "24px",
    borderBottom: "1px solid #e5e7eb",
  },
  title: {
    margin: 0,
    fontSize: "24px",
    fontWeight: 600,
    color: "#111827",
  },
  subtitle: {
    margin: "8px 0 0",
    fontSize: "14px",
    color: "#6b7280",
  },
  content: {
    padding: "0",
  },
  error: {
    padding: "24px",
    color: "#dc2626",
    backgroundColor: "#fef2f2",
    borderRadius: "8px",
    margin: "24px",
  },
};

interface PageProps {
  searchParams: Promise<{ airport?: string; date?: string }>;
}

function getDefaultDate(): string {
  const today = new Date();
  return today.toISOString().slice(0, 10);
}

export default async function SequencesPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const airports = getAirportList();
  const airport = params.airport ?? airports[0]?.icao ?? "YBBN";
  const date = params.date ?? getDefaultDate();

  let sequences: Awaited<ReturnType<typeof fetchSequences>>["sequences"] = [];
  let error: string | null = null;

  try {
    const response = await fetchSequences(airport, date);
    sequences = response.sequences;
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to fetch sequences";
  }

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>Arrival Sequences</h1>
        <p style={styles.subtitle}>
          Browse and analyze arrival sequencing patterns by airport and date
        </p>
      </header>
      <DateFilter airport={airport} date={date} />
      <div style={styles.content}>
        {error ? (
          <div style={styles.error}>{error}</div>
        ) : (
          <SequenceTable sequences={sequences} />
        )}
      </div>
    </div>
  );
}
