# Architecture

This document describes the module structure and data flow for the ADS-B Arrival Sequencing POC.

## Design Principles

- **Determinism over cleverness** — reproducible outputs from identical inputs
- **Pre-computation over live logic** — derive once, query many times
- **Inspectability over black-box models** — every intermediate step observable
- **Simple artefacts** — Parquet and DuckDB, no heavy infrastructure

## Module Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              Pipeline                                    │
│  ┌────────┐  ┌───────────┐  ┌────────┐  ┌──────────────────┐            │
│  │ Ingest │─▶│ Normalize │─▶│ Derive │─▶│ Sequence Scoring │            │
│  └────────┘  └───────────┘  └────────┘  └──────────────────┘            │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                            ┌──────────────┐
                            │   Storage    │
                            │  (Parquet/   │
                            │   DuckDB)    │
                            └──────────────┘
                                    │
                                    ▼
                              ┌─────────┐
                              │   API   │
                              └─────────┘
                                    │
                                    ▼
                            ┌───────────────┐
                            │   Dashboard   │
                            └───────────────┘
```

---

## Modules

### 1. Ingest

**Purpose**: Load raw ADS-B data from source archives.

**Input**: ADS-B Exchange first-of-month sample files (compressed JSON/CSV)

**Output**: Raw state vectors as Parquet

**Responsibilities**:
- Download or read archived data files
- Parse source format (JSON lines, CSV)
- Write raw records with minimal transformation
- Log ingestion statistics (record count, time range, source file)

**Assumptions**:
- Source data may have gaps, duplicates, or invalid records
- No filtering at this stage — preserve everything

---

### 2. Normalize

**Purpose**: Clean, deduplicate, and filter to arrival candidates.

**Input**: Raw Parquet from Ingest

**Output**: `aircraft_states` Parquet (see [data-contracts.md](data-contracts.md))

**Responsibilities**:
- Deduplicate by (icao, timestamp)
- Filter to configurable geographic bounding box around target aerodrome
- Filter to plausible arrival altitudes (e.g., below FL150)
- Compute `distance_nm` from aircraft position to aerodrome reference point
- Tag with `airport_icao` for target aerodrome
- Drop records with missing critical fields (lat, lon, altitude)

**Configuration**:
- `airport_icao`: Target aerodrome
- `max_distance_nm`: Outer radius for capture (e.g., 50 NM)
- `max_altitude_ft`: Altitude ceiling for arrivals

---

### 3. Derive

**Purpose**: Compute kinematic features and detect ring crossings.

**Input**: `aircraft_states` Parquet

**Output**: `ring_events` Parquet (see [data-contracts.md](data-contracts.md))

**Responsibilities**:
- Sort states by (icao, timestamp)
- Compute `closing_rate` = rate of change of distance_nm
- Detect ring boundary crossings (e.g., 20/15/10/5 NM inbound)
- Assign `arrival_id` to contiguous inbound segments
- Record state at each ring crossing

**Ring Definition**:
- Configurable ring distances (default: [20, 15, 10, 5] NM)
- Crossing = transition from outside to inside ring boundary
- Only inbound crossings counted (closing_rate < 0)

**Edge Cases**:
- Aircraft that orbit or hold: multiple crossings of same ring
- Missing data gaps: may miss crossings or create spurious arrivals

---

### 4. Sequence Scoring (Ranking Engine)

**Purpose**: Identify cohorts, compute ranks, and track rank trajectories.

**CLI**: `pnpm pipeline:score --airport YBBN --date 2025-12-01`

**Input**: `ring_events` from derive stage

**Output**:
- `arrival_ranks` table/Parquet with detailed rank trajectories
- Enriched `ring_events` with rank columns updated

**Module Structure** (`packages/pipeline/src/rank/`):
```
rank/
├── types.ts       # ArrivalRank, CohortMember, constants
├── db.ts          # Database operations (DuckDB)
├── cohort.ts      # Cohort grouping by ring + time bucket
├── compute.ts     # Dense rank computation (distance, TTG)
├── trajectory.ts  # Delta computation across rings
└── index.ts       # Barrel export
```

**Responsibilities**:

**Cohort Identification**:
- Group ring_events by (ring_nm, time_bucket)
- Default bucket size: 5 minutes (300 seconds)
- Minimum cohort size: 2 aircraft

**Rank Computation**:
- `rank_distance`: dense rank by distance_nm ascending
- `rank_ttg`: dense rank by estimated time-to-go (distance / |closing_rate|)
- Deterministic tie-breaker: ICAO hex alphabetically
- TTG uses epsilon (0.001) to avoid division by zero

**Trajectory Tracking**:
- Order crossings by ring descending (outer→inner)
- Compute deltas: `delta_rank = current_rank - previous_rank`
- First ring (outermost) has null deltas
- Assign `ring_order_index`: 0, 1, 2... (progression through rings)

---

### 5. Sequence Windowing

**Purpose**: Identify arrival windows where sequencing churn is unusually high.

**CLI**: `pnpm pipeline:sequence --airport YBBN --date 2025-12-01`

**Input**: `arrival_ranks` from score stage

**Output**: `arrival_sequences` table/Parquet with window metrics and scores

**Module Structure** (`packages/pipeline/src/sequence/`):
```
sequence/
├── types.ts       # ArrivalSequence, WindowMetrics, constants
├── db.ts          # Database operations (DuckDB)
├── window.ts      # Rolling window generation
├── metrics.ts     # Volatility, inversions, density computation
├── score.ts       # Z-score normalization
└── index.ts       # Barrel export
```

**Responsibilities**:

**Rolling Window Generation**:
- Window size: 30 minutes (default)
- Window step: 5 minutes (default)
- Minimum aircraft: 3 unique arrivals per window

**Metric Computation**:
- `rank_volatility`: Σ |delta_rank_distance| for all arrivals in window
- `inversion_count`: pairwise order swaps between consecutive rings
- `avg_inner_density`: average cohort size for rings ≤ 15nm

**Sequence Scoring**:
- Z-score normalize each metric across all windows for the day
- Combined score: z(volatility) + z(inversions) + z(density)
- Higher scores indicate more sequencing activity/churn

**Inversion Algorithm**:
1. Build trajectory map: arrivalId → Map<ringNm, rankDistance>
2. For each pair of arrivals sharing 2+ rings
3. Check consecutive rings (outer vs inner)
4. Count flips: (rankA < rankB at outer) && (rankA > rankB at inner)

---

### 7. API

**Purpose**: Serve processed data for downstream consumers.

**Input**: All Parquet/DuckDB artefacts

**Output**: REST or GraphQL endpoints

**Endpoints**:
- `GET /sequences` — list sequences with scores, pagination
- `GET /sequences/{id}` — full sequence detail with all ring events
- `GET /sequences/{id}/replay` — time-ordered states for replay
- `GET /aircraft/{icao}/arrivals` — arrivals for a specific aircraft

**Design Notes**:
- Read-only interface
- DuckDB for query execution
- No authentication (local/research use)

---

### 8. Dashboard

**Purpose**: Visual replay and inspection of sequences.

**Tech Stack**: Next.js 15, Leaflet, react-leaflet, SWR, Recharts

**Pages**:

| Route | Component | Description |
|-------|-----------|-------------|
| `/sequences` | SequencesPage | List sequences by date/airport |
| `/sequence/[id]` | ReplayView | Interactive map replay |

**Replay View Layout**:
```
┌────────────────────────────────┬─────────────────┐
│                                │                 │
│           Map (70%)            │  Arrival Panel  │
│    - Aircraft markers          │    (30%)        │
│    - Distance rings            │  - Sorted list  │
│    - Airport marker            │  - Rank badges  │
│                                │  - Selection    │
├────────────────────────────────┴─────────────────┤
│              Time Scrubber                       │
│  [▶] ──────────────────────── [1x][2x][5x]       │
└──────────────────────────────────────────────────┘
```

**Features**:
- Map view with aircraft positions and rotation
- Concentric distance rings (50/40/30/25/20/15/10/8/6/4 nm)
- Timeline scrubber with 5-second steps
- Playback speed control (1x, 2x, 5x)
- Rank visualization via color (green→yellow→red)
- Rank change indicators (pulse animation, ↑/↓ arrows)
- Sequence list sorted by churn score
- Filter by date and airport

**Interactions**:
- Click sequence row → load replay
- Click aircraft marker or panel row → select/highlight
- Drag timeline → seek to timestamp
- Play/pause button → auto-advance

**Key Components**:
- `ReplayView.tsx` - Main orchestrator
- `ApproachMap.tsx` - Leaflet map container
- `AircraftMarker.tsx` - Rotated marker with rank color
- `RingOverlay.tsx` - Concentric distance circles
- `TimeScrubber.tsx` - Playback controls
- `ArrivalPanel.tsx` - Side panel with arrival list
- `SequenceTable.tsx` - Sortable sequence list
- `DateFilter.tsx` - Date/airport selector

---

## Data Flow Summary

| Stage | Input | Output | Storage |
|-------|-------|--------|---------|
| Ingest | Source archives | Raw states | `raw/` |
| Normalize | Raw states | `aircraft_states` | `processed/aircraft_states/` |
| Derive | `aircraft_states` | `ring_events` | `processed/{date}/ring_events.parquet` |
| Score (Ranking) | `ring_events` | `arrival_ranks`, enriched `ring_events` | `processed/{date}/arrival_ranks.parquet` |
| Sequence | `arrival_ranks` | `arrival_sequences` | `processed/{date}/arrival_sequences.parquet` |
| API | All processed | JSON responses | (runtime) |
| Dashboard | API | Visual | (browser) |

---

## Non-Goals (Architectural)

- **Streaming/real-time**: All processing is batch
- **Distributed compute**: Single-machine processing sufficient for POC
- **Complex orchestration**: Simple scripts, no Airflow/Dagster
- **ML inference pipeline**: Statistical analysis only, no model serving
