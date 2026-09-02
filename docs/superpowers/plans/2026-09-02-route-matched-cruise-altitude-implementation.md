# Route-Matched B737 Cruise Altitude Benchmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and run a reproducible five-minute, 12-month ADS-B benchmark comparing Virgin Australia and Qantas B737 cruise altitudes on matched directional routes among Brisbane, Melbourne, Sydney, and Perth.

**Architecture:** Add a separate `cruise` analytical branch inside the existing pipeline package. It reuses the S3 client, gzip parser, DuckDB, Parquet, and manifest conventions while leaving the arrival-sequencing contracts unchanged. Small pure modules handle archive sampling, state normalization, flight reconstruction, cruise metrics, matched statistics, and CSV presentation; one CLI orchestrates discovery, download, processing, and reporting.

**Tech Stack:** TypeScript, Node.js, Vitest, AWS S3 SDK, DuckDB/Parquet, Papa Parse, pnpm

---

## File Structure

### Create

- `packages/pipeline/src/cruise/types.ts` — shared domain types and benchmark configuration.
- `packages/pipeline/src/cruise/test-helpers.ts` — typed synthetic states and flight metrics reused by focused tests.
- `packages/pipeline/src/cruise/constants.ts` — airports, B737 designators, operators, and thresholds.
- `packages/pipeline/src/cruise/sampling.ts` — five-minute object selection and monthly coverage discovery.
- `packages/pipeline/src/cruise/sampling.test.ts` — cadence, completeness, and date-discovery tests.
- `packages/pipeline/src/cruise/normalize.ts` — raw ADS-B to cruise-state normalization and exclusion counts.
- `packages/pipeline/src/cruise/normalize.test.ts` — field retention and filtering tests.
- `packages/pipeline/src/cruise/storage.ts` — dedicated DuckDB table and Parquet export/readback.
- `packages/pipeline/src/cruise/storage.test.ts` — persistence round-trip test.
- `packages/pipeline/src/cruise/flights.ts` — track segmentation and four-airport route inference.
- `packages/pipeline/src/cruise/flights.test.ts` — valid, ambiguous, gapped, and truncated route tests.
- `packages/pipeline/src/cruise/metrics.ts` — cruise observation and per-flight metric calculation.
- `packages/pipeline/src/cruise/metrics.test.ts` — cruise classifier and weighting tests.
- `packages/pipeline/src/cruise/statistics.ts` — matched route estimates, bootstrap, sensitivity OLS, and verdict.
- `packages/pipeline/src/cruise/statistics.test.ts` — hand-calculated matching and deterministic inference tests.
- `packages/pipeline/src/cruise/outputs.ts` — six business-readable CSVs and JSON run manifest.
- `packages/pipeline/src/cruise/outputs.test.ts` — schemas, units, roll-ups, and reconciliation tests.
- `packages/pipeline/src/cruise/index.ts` — public barrel exports.
- `packages/pipeline/src/scripts/cruise.ts` — end-to-end benchmark CLI.
- `packages/pipeline/src/scripts/cruise.test.ts` — synthetic local end-to-end benchmark test.
- `packages/pipeline/test/fixtures/cruise-synthetic-day.json` — compact multi-airport synthetic observations.

### Modify

- `packages/pipeline/src/normalize/types.ts` — expose raw registration/type/on-ground fields used by the cruise parser without changing arrival normalized types.
- `packages/pipeline/src/s3/types.ts` — add sampling and coverage types.
- `packages/pipeline/package.json` — add the `cruise` script.
- `package.json` — add the root `pipeline:cruise` command.
- `packages/pipeline/data/airports.json` — add Perth (`YPPH`).
- `docs/DEV.md` — document configuration, dry run, full run, outputs, and credential prerequisite.

## Task 1: Sampled Archive Selection and Coverage Discovery

**Files:**
- Create: `packages/pipeline/src/cruise/types.ts`
- Create: `packages/pipeline/src/cruise/constants.ts`
- Create: `packages/pipeline/src/cruise/sampling.ts`
- Test: `packages/pipeline/src/cruise/sampling.test.ts`
- Modify: `packages/pipeline/src/s3/types.ts`

- [ ] **Step 1: Write failing cadence and coverage tests**

```ts
import { describe, expect, it } from "vitest";
import { sampledObjectsForDay, firstOfMonthDates } from "./sampling.js";
import type { S3ObjectInfo } from "../s3/types.js";

const object = (stamp: string): S3ObjectInfo => ({
  key: `readsb-hist/2025/12/01/${stamp}Z.json.gz`,
  size: 100,
  lastModified: new Date("2025-12-02T00:00:00Z"),
  etag: stamp,
});

describe("sampledObjectsForDay", () => {
  it("keeps only exact five-minute boundaries", () => {
    const result = sampledObjectsForDay(
      [object("000000"), object("000005"), object("000500"), object("001000")],
      5
    );
    expect(result.objects.map((item) => item.key)).toEqual([
      object("000000").key,
      object("000500").key,
      object("001000").key,
    ]);
    expect(result.expectedCount).toBe(288);
    expect(result.complete).toBe(false);
  });

  it("marks all 288 five-minute timestamps complete", () => {
    const objects = Array.from({ length: 288 }, (_, index) => {
      const totalMinutes = index * 5;
      const hh = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
      const mm = String(totalMinutes % 60).padStart(2, "0");
      return object(`${hh}${mm}00`);
    });
    expect(sampledObjectsForDay(objects, 5).complete).toBe(true);
  });
});

it("generates descending first-of-month dates", () => {
  expect(firstOfMonthDates("2026-09-02", 3)).toEqual([
    "2026-09-01",
    "2026-08-01",
    "2026-07-01",
  ]);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm --filter @adsb/pipeline test -- src/cruise/sampling.test.ts`

Expected: FAIL because `./sampling.js` does not exist.

- [ ] **Step 3: Add domain configuration and the minimal selector**

```ts
// constants.ts
export const ANALYSIS_AIRPORTS = {
  YBBN: { icao: "YBBN", name: "Brisbane", lat: -27.3842, lon: 153.1175 },
  YMML: { icao: "YMML", name: "Melbourne", lat: -37.669, lon: 144.841 },
  YSSY: { icao: "YSSY", name: "Sydney", lat: -33.9399, lon: 151.1753 },
  YPPH: { icao: "YPPH", name: "Perth", lat: -31.9403, lon: 115.9672 },
} as const;

export const B737_TYPES = new Set([
  "B731", "B732", "B733", "B734", "B735", "B736", "B737",
  "B738", "B739", "B37M", "B38M", "B39M", "B3XM",
]);

export const OPERATOR_NAMES: Record<string, string> = {
  QFA: "Qantas",
  VOZ: "Virgin Australia",
};

export const DEFAULT_CRUISE_CONFIG = {
  sampleIntervalMinutes: 5,
  requiredDays: 12,
  maximumLookbackMonths: 36,
  flightGapMinutes: 20,
  endpointRadiusNm: 40,
  endpointMaxAltitudeFt: 15_000,
  cruiseMinAltitudeFt: 20_000,
  cruiseMinGroundSpeedKt: 300,
  cruiseMaxVerticalRateFpm: 500,
  minimumCruiseObservations: 2,
  minimumMatchedFlights: 5,
  bootstrapReplicates: 10_000,
  bootstrapSeed: 737,
} as const;
```

```ts
// types.ts
export interface CruiseState {
  ts: Date;
  icaoHex: string;
  registration: string;
  aircraftType: string;
  callsign: string | null;
  operatorCode: string | null;
  operatorName: string | null;
  lat: number;
  lon: number;
  altitudeFt: number | null;
  groundSpeedKt: number | null;
  verticalRateFpm: number | null;
  onGround: boolean;
}

export interface FlightCruiseMetric {
  flightId: string;
  sampleDate: string;
  registration: string;
  icaoHex: string;
  aircraftType: string;
  callsign: string;
  operatorCode: string;
  operatorName: string | null;
  originIcao: string;
  destinationIcao: string;
  route: string;
  meanCruiseAltitudeFt: number;
  medianCruiseAltitudeFt: number;
  minimumCruiseAltitudeFt: number;
  maximumCruiseAltitudeFt: number;
  standardDeviationFt: number;
  cruiseObservationCount: number;
  observedCruiseMinutes: number;
}

export type ExclusionReason =
  | "missing_identity"
  | "non_b737"
  | "outside_envelope"
  | "ambiguous_endpoint"
  | "same_endpoint"
  | "truncated_track"
  | "insufficient_cruise"
  | "unknown_operator";
```

```ts
// sampling.ts
import type { S3ObjectInfo } from "../s3/types.js";

export interface SampledDay {
  objects: S3ObjectInfo[];
  expectedCount: number;
  complete: boolean;
  missingTimestamps: string[];
}

const timestampFromKey = (key: string): string | null =>
  key.match(/\/(\d{6})Z\.json\.gz$/)?.[1] ?? null;

export function sampledObjectsForDay(
  objects: S3ObjectInfo[],
  intervalMinutes: number
): SampledDay {
  const expected = new Set<string>();
  for (let minute = 0; minute < 24 * 60; minute += intervalMinutes) {
    expected.add(
      `${String(Math.floor(minute / 60)).padStart(2, "0")}${String(minute % 60).padStart(2, "0")}00`
    );
  }
  const selected = objects
    .filter((item) => {
      const stamp = timestampFromKey(item.key);
      return stamp !== null && expected.has(stamp);
    })
    .sort((a, b) => a.key.localeCompare(b.key));
  const present = new Set(selected.map((item) => timestampFromKey(item.key)!));
  const missingTimestamps = [...expected].filter((stamp) => !present.has(stamp));
  return {
    objects: selected,
    expectedCount: expected.size,
    complete: selected.length === expected.size && missingTimestamps.length === 0,
    missingTimestamps,
  };
}

export function firstOfMonthDates(asOf: string, count: number): string[] {
  const cursor = new Date(`${asOf}T00:00:00Z`);
  cursor.setUTCDate(1);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - index, 1));
    return date.toISOString().slice(0, 10);
  });
}
```

- [ ] **Step 4: Add an injectable coverage-discovery function**

```ts
export interface CoverageCandidate extends SampledDay {
  date: string;
  discoveredCount: number;
  reason: "complete" | "incomplete" | "unavailable";
}

export async function discoverCompleteDays(options: {
  asOf: string;
  requiredDays: number;
  maximumLookbackMonths: number;
  intervalMinutes: number;
  listForDate: (date: string) => Promise<S3ObjectInfo[]>;
}): Promise<{ selected: CoverageCandidate[]; candidates: CoverageCandidate[] }> {
  const dates = firstOfMonthDates(options.asOf, options.maximumLookbackMonths);
  const candidates: CoverageCandidate[] = [];
  for (const date of dates) {
    const discovered = await options.listForDate(date);
    const sampled = sampledObjectsForDay(discovered, options.intervalMinutes);
    const candidate: CoverageCandidate = {
      date,
      discoveredCount: discovered.length,
      ...sampled,
      reason: sampled.complete ? "complete" : discovered.length ? "incomplete" : "unavailable",
    };
    candidates.push(candidate);
    if (candidates.filter((item) => item.complete).length === options.requiredDays) break;
  }
  return {
    selected: candidates.filter((item) => item.complete).slice(0, options.requiredDays),
    candidates,
  };
}
```

- [ ] **Step 5: Run tests and commit**

Run: `pnpm --filter @adsb/pipeline test -- src/cruise/sampling.test.ts`

Expected: PASS.

Commit:

```bash
git add packages/pipeline/src/cruise packages/pipeline/src/s3/types.ts
git commit -m "feat: select complete five-minute archive days"
```

## Task 2: Cruise-State Normalization and Dedicated Storage

**Files:**
- Create: `packages/pipeline/src/cruise/normalize.ts`
- Create: `packages/pipeline/src/cruise/normalize.test.ts`
- Create: `packages/pipeline/src/cruise/storage.ts`
- Create: `packages/pipeline/src/cruise/storage.test.ts`
- Modify: `packages/pipeline/src/normalize/types.ts`

- [ ] **Step 1: Write failing normalization tests**

```ts
import { describe, expect, it } from "vitest";
import { normalizeCruiseAircraft } from "./normalize.js";

describe("normalizeCruiseAircraft", () => {
  it("retains B737 registration, type, callsign, and flight fields", () => {
    const result = normalizeCruiseAircraft(
      {
        hex: "7c6de0", r: "VH-VZM", t: "b738", flight: " QFA1077 ",
        lat: -24.53, lon: 146.8, alt_baro: 39000, gs: 536.4, baro_rate: 64,
      },
      new Date("2025-12-01T00:40:00Z")
    );
    expect(result).toMatchObject({
      icaoHex: "7C6DE0", registration: "VH-VZM", aircraftType: "B738",
      callsign: "QFA1077", operatorCode: "QFA", operatorName: "Qantas",
      altitudeFt: 39000, groundSpeedKt: 536.4, verticalRateFpm: 64,
    });
  });

  it("rejects non-B737 and out-of-envelope observations", () => {
    expect(normalizeCruiseAircraft({ hex: "a", t: "A320", r: "VH-A", lat: -30, lon: 140 }, new Date())).toBeNull();
    expect(normalizeCruiseAircraft({ hex: "b", t: "B738", r: "VH-B", lat: -10, lon: 140 }, new Date())).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm --filter @adsb/pipeline test -- src/cruise/normalize.test.ts`

Expected: FAIL because `normalizeCruiseAircraft` does not exist.

- [ ] **Step 3: Extend raw types and implement normalization**

```ts
// additions to normalize/types.ts RawAircraft
r?: string;
t?: string;
baro_rate?: number;

// normalize.ts
import type { RawAircraft } from "../normalize/types.js";
import { B737_TYPES, OPERATOR_NAMES } from "./constants.js";
import type { CruiseState } from "./types.js";

export function normalizeCruiseAircraft(raw: RawAircraft, ts: Date): CruiseState | null {
  const aircraftType = raw.t?.trim().toUpperCase();
  const registration = raw.r?.trim().toUpperCase();
  if (!raw.hex || !aircraftType || !B737_TYPES.has(aircraftType)) return null;
  if (!registration || raw.lat === undefined || raw.lon === undefined) return null;
  if (raw.lat < -41 || raw.lat > -20 || raw.lon < 112 || raw.lon > 155) return null;
  const callsign = raw.flight?.trim().toUpperCase() || null;
  const operatorCode = callsign?.match(/^([A-Z]{3})/)?.[1] ?? null;
  return {
    ts, icaoHex: raw.hex.toUpperCase(), registration, aircraftType, callsign,
    operatorCode, operatorName: operatorCode ? OPERATOR_NAMES[operatorCode] ?? null : null,
    lat: raw.lat, lon: raw.lon,
    altitudeFt: typeof raw.alt_baro === "number" ? raw.alt_baro : null,
    groundSpeedKt: raw.gs ?? null,
    verticalRateFpm: raw.baro_rate ?? raw.geom_rate ?? null,
    onGround: raw.alt_baro === "ground",
  };
}
```

- [ ] **Step 4: Write a failing DuckDB/Parquet round-trip test**

```ts
import { expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeCruiseStates, readCruiseStates } from "./storage.js";

it("round-trips cruise states through dedicated storage", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cruise-storage-"));
  try {
    const state = {
      ts: new Date("2025-12-01T01:00:00Z"), icaoHex: "7C6DE0",
      registration: "VH-VZM", aircraftType: "B738", callsign: "QFA1077",
      operatorCode: "QFA", operatorName: "Qantas", lat: -30, lon: 145,
      altitudeFt: 39000, groundSpeedKt: 500, verticalRateFpm: 0, onGround: false,
    };
    await writeCruiseStates(join(dir, "cruise.duckdb"), join(dir, "cruise_states.parquet"), [state]);
    expect(await readCruiseStates(join(dir, "cruise.duckdb"))).toEqual([state]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 5: Implement a dedicated `cruise_states` table and Parquet export**

Implement `writeCruiseStates(dbPath, parquetPath, states)` with `DuckDBInstance`, a table keyed by `(ts, icao_hex)`, prepared inserts, and:

```sql
COPY (SELECT * FROM cruise_states ORDER BY ts, icao_hex)
TO 'cruise_states.parquet' (FORMAT PARQUET, COMPRESSION ZSTD)
```

Implement `readCruiseStates(dbPath)` to return typed records ordered by timestamp and ICAO hex. Use the same timestamp conversion pattern as `packages/pipeline/src/normalize/db.ts`.

- [ ] **Step 6: Run tests and commit**

Run: `pnpm --filter @adsb/pipeline test -- src/cruise/normalize.test.ts src/cruise/storage.test.ts`

Expected: PASS.

Commit:

```bash
git add packages/pipeline/src/cruise packages/pipeline/src/normalize/types.ts
git commit -m "feat: normalize and persist B737 cruise states"
```

## Task 3: Flight Reconstruction, Route Inference, and Cruise Metrics

**Files:**
- Create: `packages/pipeline/src/cruise/flights.ts`
- Create: `packages/pipeline/src/cruise/flights.test.ts`
- Create: `packages/pipeline/src/cruise/metrics.ts`
- Create: `packages/pipeline/src/cruise/metrics.test.ts`
- Create: `packages/pipeline/src/cruise/test-helpers.ts`

- [ ] **Step 1: Write failing segmentation and route tests**

First add the shared typed builder:

```ts
// test-helpers.ts
import type { CruiseState, FlightCruiseMetric } from "./types.js";

export function state(
  iso: string,
  overrides: Partial<CruiseState> = {}
): CruiseState {
  return {
    ts: new Date(iso), icaoHex: "7C0001", registration: "VH-TEST",
    aircraftType: "B738", callsign: "VOZ1", operatorCode: "VOZ",
    operatorName: "Virgin Australia", lat: -30, lon: 150,
    altitudeFt: 37000, groundSpeedKt: 450, verticalRateFpm: 0,
    onGround: false, ...overrides,
  };
}

export function fixtureFlights(
  route: string,
  sampleDate: string,
  operatorCode: "QFA" | "VOZ",
  altitudeFt: number,
  count: number
): FlightCruiseMetric[] {
  const [originIcao, destinationIcao] = route.split("-") as [string, string];
  return Array.from({ length: count }, (_, index) => ({
    flightId: `${sampleDate}-${route}-${operatorCode}-${index}`,
    sampleDate, registration: `VH-${operatorCode}${index}`, icaoHex: `${operatorCode}${index}`,
    aircraftType: "B738", callsign: `${operatorCode}${100 + index}`, operatorCode,
    operatorName: operatorCode === "QFA" ? "Qantas" : "Virgin Australia",
    originIcao, destinationIcao, route,
    meanCruiseAltitudeFt: altitudeFt, medianCruiseAltitudeFt: altitudeFt,
    minimumCruiseAltitudeFt: altitudeFt, maximumCruiseAltitudeFt: altitudeFt,
    standardDeviationFt: 0, cruiseObservationCount: 2, observedCruiseMinutes: 5,
  }));
}
```

```ts
import { expect, it } from "vitest";
import { buildTrackSegments, inferDirectionalRoute } from "./flights.js";
import { state } from "./test-helpers.js";

it("splits tracks after a gap over 20 minutes", () => {
  const segments = buildTrackSegments([
    state("2025-12-01T00:00:00Z", { callsign: "VOZ1" }),
    state("2025-12-01T00:05:00Z", { callsign: "VOZ1" }),
    state("2025-12-01T00:30:00Z", { callsign: "VOZ1" }),
  ]);
  expect(segments).toHaveLength(2);
});

it("infers YBBN to YSSY from ordered endpoint and cruise evidence", () => {
  const route = inferDirectionalRoute([
    state("2025-12-01T00:00:00Z", { lat: -27.39, lon: 153.12, altitudeFt: 3000 }),
    state("2025-12-01T00:10:00Z", { lat: -29, lon: 152.8, altitudeFt: 25000 }),
    state("2025-12-01T00:20:00Z", { lat: -31, lon: 152.2, altitudeFt: 37000 }),
    state("2025-12-01T00:40:00Z", { lat: -33.8, lon: 151.3, altitudeFt: 8000 }),
  ]);
  expect(route).toMatchObject({ originIcao: "YBBN", destinationIcao: "YSSY", route: "YBBN-YSSY" });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `pnpm --filter @adsb/pipeline test -- src/cruise/flights.test.ts`

Expected: FAIL because the flight functions do not exist.

- [ ] **Step 3: Implement deterministic track segmentation and endpoint inference**

`buildTrackSegments` must sort by timestamp, group by ICAO hex and callsign, and split when callsign changes or elapsed time exceeds 20 minutes. `inferDirectionalRoute` must:

```ts
const proximity = states.map((state) =>
  Object.values(ANALYSIS_AIRPORTS)
    .map((airport) => ({ airport, distanceNm: haversineDistanceNm(state.lat, state.lon, airport.lat, airport.lon) }))
    .filter(({ distanceNm }) => distanceNm <= 40 && state.altitudeFt !== null && state.altitudeFt <= 15_000)
    .sort((a, b) => a.distanceNm - b.distanceNm)
);
```

Choose the earliest unique airport candidate as origin and the latest later unique candidate as destination. Require different airports, at least two cruise-eligible observations between them, increasing distance after origin, and decreasing distance before destination. Return a reason code instead of a route when any condition is ambiguous or truncated.

- [ ] **Step 4: Write failing cruise metric tests**

```ts
import { expect, it } from "vitest";
import { calculateFlightCruiseMetrics, isCruiseObservation } from "./metrics.js";
import { state } from "./test-helpers.js";

it("accepts stable high-speed level flight and rejects climb", () => {
  expect(isCruiseObservation(state("2025-12-01T00:00:00Z", {
    altitudeFt: 37000, groundSpeedKt: 450, verticalRateFpm: 0,
  }), null)).toBe(true);
  expect(isCruiseObservation(state("2025-12-01T00:00:00Z", {
    altitudeFt: 25000, groundSpeedKt: 450, verticalRateFpm: 1500,
  }), null)).toBe(false);
});

it("gives every flight one mean regardless of observation count", () => {
  const result = calculateFlightCruiseMetrics([
    state("2025-12-01T00:00:00Z", { altitudeFt: 35000, groundSpeedKt: 450, verticalRateFpm: 0 }),
    state("2025-12-01T00:05:00Z", { altitudeFt: 37000, groundSpeedKt: 450, verticalRateFpm: 0 }),
  ]);
  expect(result?.meanCruiseAltitudeFt).toBe(36000);
  expect(result?.cruiseObservationCount).toBe(2);
});
```

- [ ] **Step 5: Implement the classifier and descriptive metrics**

Implement the agreed 20,000-foot, 300-knot, and 500-feet-per-minute thresholds. When vertical rate is missing, calculate the absolute altitude-change rate from an adjacent five-minute observation. Require two eligible observations. Return mean, median, minimum, maximum, sample standard deviation, observation count, and elapsed cruise minutes.

- [ ] **Step 6: Run tests and commit**

Run: `pnpm --filter @adsb/pipeline test -- src/cruise/flights.test.ts src/cruise/metrics.test.ts`

Expected: PASS.

Commit:

```bash
git add packages/pipeline/src/cruise
git commit -m "feat: infer routes and calculate flight cruise metrics"
```

## Task 4: Matched Statistics, Bootstrap, and Sensitivity Model

**Files:**
- Create: `packages/pipeline/src/cruise/statistics.ts`
- Test: `packages/pipeline/src/cruise/statistics.test.ts`

- [ ] **Step 1: Write failing matched-estimate tests**

```ts
import { expect, it } from "vitest";
import { analyzeMatchedRoutes, verdictForInterval } from "./statistics.js";
import { fixtureFlights } from "./test-helpers.js";

const fixtureMatchedFlights = () => [
  ...fixtureFlights("YBBN-YSSY", "2025-01-01", "QFA", 35000, 5),
  ...fixtureFlights("YBBN-YSSY", "2025-01-01", "VOZ", 37000, 5),
  ...fixtureFlights("YBBN-YSSY", "2025-02-01", "QFA", 36000, 5),
  ...fixtureFlights("YBBN-YSSY", "2025-02-01", "VOZ", 37000, 5),
];

it("weights routes equally instead of weighting flight volume", () => {
  const flights = [
    ...fixtureFlights("YBBN-YSSY", "2025-01-01", "QFA", 35000, 5),
    ...fixtureFlights("YBBN-YSSY", "2025-01-01", "VOZ", 37000, 5),
    ...fixtureFlights("YMML-YPPH", "2025-01-01", "QFA", 39000, 50),
    ...fixtureFlights("YMML-YPPH", "2025-01-01", "VOZ", 38000, 50),
  ];
  const result = analyzeMatchedRoutes(flights, { minimumFlights: 5, replicates: 100, seed: 737 });
  expect(result.executive.adjustedDifferenceFt).toBe(500);
});

it("returns the same bootstrap interval for seed 737", () => {
  const first = analyzeMatchedRoutes(fixtureMatchedFlights(), { minimumFlights: 5, replicates: 500, seed: 737 });
  const second = analyzeMatchedRoutes(fixtureMatchedFlights(), { minimumFlights: 5, replicates: 500, seed: 737 });
  expect(first.executive.confidenceIntervalFt).toEqual(second.executive.confidenceIntervalFt);
});

it("classifies intervals around zero as inconclusive", () => {
  expect(verdictForInterval([-100, 200])).toBe("inconclusive");
  expect(verdictForInterval([10, 200])).toBe("supports");
  expect(verdictForInterval([-200, -10])).toBe("does_not_support");
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm --filter @adsb/pipeline test -- src/cruise/statistics.test.ts`

Expected: FAIL because the analysis functions do not exist.

- [ ] **Step 3: Implement route/date matching and equal-route weighting**

Group flight metrics by route, UTC sample date, and operator code. Keep routes with at least five total `QFA` and five total `VOZ` flights, then keep route-date cells containing both. Compute cell differences, route means, and the unweighted mean of route means.

- [ ] **Step 4: Implement deterministic hierarchical bootstrap**

Use a small seeded generator rather than `Math.random`:

```ts
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
```

For each replicate, resample route-date cells within every route and flights within each selected operator cell, calculate route differences, then equally average routes. Use the 2.5th and 97.5th percentiles.

- [ ] **Step 5: Implement the fixed-effect sensitivity coefficient**

Build an OLS design matrix containing intercept, Virgin indicator, and reference-coded dummy columns for directional route, date, and B737 type. Solve `(X'X)b = X'y` with pivoted Gaussian elimination and return the Virgin coefficient. Return a quality warning when the matrix is singular instead of emitting an estimate.

- [ ] **Step 6: Run tests and commit**

Run: `pnpm --filter @adsb/pipeline test -- src/cruise/statistics.test.ts`

Expected: PASS.

Commit:

```bash
git add packages/pipeline/src/cruise/statistics.ts packages/pipeline/src/cruise/statistics.test.ts
git commit -m "feat: add route-matched cruise statistics"
```

## Task 5: Business-Readable Outputs and Reconciliation

**Files:**
- Create: `packages/pipeline/src/cruise/outputs.ts`
- Test: `packages/pipeline/src/cruise/outputs.test.ts`
- Create: `packages/pipeline/src/cruise/index.ts`

- [ ] **Step 1: Write failing output tests**

```ts
import { expect, it } from "vitest";
import { buildOutputTables } from "./outputs.js";
import { analyzeMatchedRoutes } from "./statistics.js";
import { fixtureFlights } from "./test-helpers.js";

const fixtureAnalysis = () => {
  const flights = [
    ...fixtureFlights("YBBN-YSSY", "2025-01-01", "QFA", 35000, 5),
    ...fixtureFlights("YBBN-YSSY", "2025-01-01", "VOZ", 37000, 5),
  ];
  return {
    analysisRunId: "test-run",
    flights,
    analysis: analyzeMatchedRoutes(flights, { minimumFlights: 5, replicates: 100, seed: 737 }),
    qualityRows: [{ stage: "qualifying_flights", reason: "included", count: 10, percentage: 100 }],
  };
};

it("emits six named tables with explicit units", () => {
  const tables = buildOutputTables(fixtureAnalysis());
  expect(Object.keys(tables)).toEqual([
    "flight_cruise_metrics.csv",
    "aircraft_route_summary.csv",
    "route_operator_summary.csv",
    "route_matched_comparison.csv",
    "executive_summary.csv",
    "data_quality.csv",
  ]);
  expect(Object.keys(tables["executive_summary.csv"][0]!)).toContain("adjusted_difference_ft");
});

it("adds an ALL_MATCHED_ROUTES roll-up for each registration", () => {
  const rows = buildOutputTables(fixtureAnalysis())["aircraft_route_summary.csv"];
  expect(rows.some((row) => row.directional_route === "ALL_MATCHED_ROUTES")).toBe(true);
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm --filter @adsb/pipeline test -- src/cruise/outputs.test.ts`

Expected: FAIL because output functions do not exist.

- [ ] **Step 3: Implement tables and CSV writing**

Use `Papa.unparse` with headers and newline termination. Preserve numeric values as numbers until serialization, sort rows deterministically, and prefix each row with `analysis_run_id`. Implement:

```ts
export async function writeOutputTables(
  outputDirectory: string,
  tables: Record<string, Array<Record<string, string | number | boolean | null>>>
): Promise<void> {
  await mkdir(outputDirectory, { recursive: true });
  for (const [name, rows] of Object.entries(tables)) {
    await writeFile(join(outputDirectory, name), `${Papa.unparse(rows)}\n`, "utf8");
  }
}
```

The data-quality table must reconcile source observations, retained states, candidate segments, inferred routes, qualifying flights, and every exclusion reason. Unknown operator names remain visible in audit outputs.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm --filter @adsb/pipeline test -- src/cruise/outputs.test.ts`

Expected: PASS.

Commit:

```bash
git add packages/pipeline/src/cruise
git commit -m "feat: produce cruise benchmark CSV outputs"
```

## Task 6: Benchmark CLI and Synthetic End-to-End Verification

**Files:**
- Create: `packages/pipeline/src/scripts/cruise.ts`
- Test: `packages/pipeline/src/scripts/cruise.test.ts`
- Create: `packages/pipeline/test/fixtures/cruise-synthetic-day.json`
- Modify: `packages/pipeline/package.json`
- Modify: `package.json`
- Modify: `packages/pipeline/data/airports.json`

- [ ] **Step 1: Write a failing synthetic end-to-end test**

Construct five Qantas and five Virgin flights on each of two directional routes in a temporary local raw-data directory. Give Virgin a known +2,000-foot advantage on one route and -1,000 feet on the other. Invoke an exported `runCruiseBenchmark` with download disabled and 100 bootstrap replicates. Assert:

```ts
expect(result.executive.adjustedDifferenceFt).toBe(500);
await expect(access(join(outputDir, "executive_summary.csv"))).resolves.toBeUndefined();
expect(result.quality.qualifyingFlightCount).toBe(20);
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm --filter @adsb/pipeline test -- src/scripts/cruise.test.ts`

Expected: FAIL because the benchmark orchestrator does not exist.

- [ ] **Step 3: Implement an injectable orchestrator and CLI**

Export `runCruiseBenchmark(options, dependencies)` for tests. The production path must:

1. Load `.env` from the monorepo root.
2. Discover complete sampled days from the first of the current month backward.
3. Write coverage candidates immediately.
4. Stop with a coverage-only result when fewer than 12 complete days exist.
5. Download all selected objects through `downloadAll`; allow its size check to resume local files.
6. Parse gzip snapshots and normalize B737 observations.
7. Persist `cruise_states.duckdb` and `cruise_states.parquet`.
8. Build tracks, infer routes, calculate flight metrics, and record exclusions.
9. Analyze matched routes and write the six CSV files plus `analysis_run_manifest.json`.

CLI options:

```text
pnpm pipeline:cruise -- --asOf 2026-09-02 --months 12 --intervalMinutes 5
  [--maxLookbackMonths 36] [--outputDir <path>] [--localRawDir <path>]
  [--skipDownload] [--bootstrapReplicates 10000]
```

Add scripts:

```json
// packages/pipeline/package.json
"cruise": "node --import tsx src/scripts/cruise.ts"

// root package.json
"pipeline:cruise": "pnpm --filter @adsb/pipeline cruise"
```

- [ ] **Step 4: Run focused and complete verification**

Run:

```bash
pnpm --filter @adsb/pipeline test -- src/scripts/cruise.test.ts
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
```

Expected: all commands PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/pipeline/src/scripts packages/pipeline/test/fixtures packages/pipeline/package.json package.json packages/pipeline/data/airports.json
git commit -m "feat: add cruise benchmark command"
```

## Task 7: Documentation, Full Run, and Executive Interpretation

**Files:**
- Modify: `docs/DEV.md`
- Generate: `packages/pipeline/data/analysis/cruise/<analysis-run-id>/analysis_run_manifest.json`
- Generate: `packages/pipeline/data/analysis/cruise/<analysis-run-id>/*.csv`

- [ ] **Step 1: Document the business workflow and prerequisites**

Add a `B737 cruise benchmark` section to `docs/DEV.md` containing:

```markdown
### B737 cruise benchmark

Prerequisite: configure `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` for the ADS-B sample-data source in the repository `.env` file. Do not commit credentials.

Run the approved benchmark:

`pnpm pipeline:cruise -- --asOf 2026-09-02 --months 12 --intervalMinutes 5`

The command writes an immutable run manifest, normalized Parquet data, six CSV outputs, and reconciliation totals under `packages/pipeline/data/analysis/cruise/<analysis-run-id>/`.
```

- [ ] **Step 2: Run the full benchmark**

Run: `pnpm pipeline:cruise -- --asOf 2026-09-02 --months 12 --intervalMinutes 5 --bootstrapReplicates 10000`

Expected: 12 complete sampled days selected, 3,456 snapshot files validated, and six CSV files generated. If source credentials are not configured, stop without fabricating results and report that explicit prerequisite.

- [ ] **Step 3: Reconcile and inspect outputs**

Check that the run manifest has 12 dates and 288 files per date, the data-quality counts reconcile, matched routes meet both five-flight thresholds, and the executive result equals the equal-weight average of route differences. Manually inspect representative inferred tracks for each included directional route.

- [ ] **Step 4: Run final repository verification**

Run:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
git status --short
```

Expected: all checks PASS; only intentionally generated, gitignored analysis data may remain untracked.

- [ ] **Step 5: Commit documentation**

```bash
git add docs/DEV.md
git commit -m "docs: explain cruise benchmark workflow"
```

- [ ] **Step 6: Interpret the result for the strategy user**

Report the verdict, adjusted difference in feet, 95% interval, matched route count, flight and aircraft counts, strongest route drivers, sensitivity result, exclusion rates, and interpretation guardrails. Link the six CSVs and run manifest. If the run was blocked by missing source access, distinguish completed software verification from unavailable empirical results and state the single credential prerequisite.
