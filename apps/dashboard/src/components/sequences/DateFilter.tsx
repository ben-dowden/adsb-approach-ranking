"use client";

/**
 * Date and airport filter component
 */

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

import { getAirportList } from "@/lib/airports";

const styles = {
  container: {
    display: "flex",
    gap: "16px",
    padding: "16px",
    backgroundColor: "#f9fafb",
    borderBottom: "1px solid #e5e7eb",
    alignItems: "center",
  },
  field: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "4px",
  },
  label: {
    fontSize: "12px",
    fontWeight: 500,
    color: "#6b7280",
  },
  input: {
    padding: "8px 12px",
    border: "1px solid #d1d5db",
    borderRadius: "6px",
    fontSize: "14px",
    backgroundColor: "#fff",
  },
  select: {
    padding: "8px 12px",
    border: "1px solid #d1d5db",
    borderRadius: "6px",
    fontSize: "14px",
    backgroundColor: "#fff",
    minWidth: "160px",
  },
};

interface DateFilterProps {
  airport: string;
  date: string;
}

export function DateFilter({ airport, date }: DateFilterProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const airports = getAirportList();

  const updateParams = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set(key, value);
      router.push(`/sequences?${params.toString()}`);
    },
    [router, searchParams]
  );

  return (
    <div style={styles.container}>
      <div style={styles.field}>
        <label style={styles.label}>Airport</label>
        <select
          style={styles.select}
          value={airport}
          onChange={(e) => updateParams("airport", e.target.value)}
        >
          {airports.map((apt) => (
            <option key={apt.icao} value={apt.icao}>
              {apt.icao} - {apt.name}
            </option>
          ))}
        </select>
      </div>
      <div style={styles.field}>
        <label style={styles.label}>Date</label>
        <input
          type="date"
          style={styles.input}
          value={date}
          onChange={(e) => updateParams("date", e.target.value)}
        />
      </div>
    </div>
  );
}
