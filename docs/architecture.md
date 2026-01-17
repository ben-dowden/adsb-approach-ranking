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

### 4. Sequence Scoring

**Purpose**: Identify cohorts, compute ranks, and score sequences.

**Input**: `ring_events` Parquet

**Output**:
- Enriched `ring_events` with rank columns
- `sequences` Parquet (see [data-contracts.md](data-contracts.md))

**Responsibilities**:

**Cohort Identification**:
- Group aircraft crossing the same ring within a time window
- Window size configurable (e.g., 10 minutes)

**Rank Computation**:
- `rank_distance`: order by distance to aerodrome (ascending)
- `rank_ttg`: order by estimated time-to-go (distance / |closing_rate|)

**Sequence Scoring**:
- Track rank changes across rings for each aircraft
- `score_rank_vol`: sum of absolute rank changes
- `score_inversions`: count of pairwise order swaps between rings

**Sequence Definition**:
- A sequence = set of aircraft that appear together in cohorts across multiple rings
- Identified by overlapping cohort membership

---

### 5. API

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

### 6. Dashboard

**Purpose**: Visual replay and inspection of sequences.

**Features**:
- Map view with aircraft positions
- Timeline scrubber for replay
- Rank visualization (bar chart or table showing relative positions)
- Sequence list sorted by churn score
- Filter by date, traffic density, score threshold

**Interactions**:
- Click sequence → load replay
- Play/pause/step through time
- Highlight specific aircraft
- Show kinematic data (speed, closing rate, altitude)

---

## Data Flow Summary

| Stage | Input | Output | Storage |
|-------|-------|--------|---------|
| Ingest | Source archives | Raw states | `raw/` |
| Normalize | Raw states | `aircraft_states` | `processed/aircraft_states/` |
| Derive | `aircraft_states` | `ring_events` | `processed/ring_events/` |
| Sequence Scoring | `ring_events` | `ring_events` (enriched), `sequences` | `processed/sequences/` |
| API | All processed | JSON responses | (runtime) |
| Dashboard | API | Visual | (browser) |

---

## Non-Goals (Architectural)

- **Streaming/real-time**: All processing is batch
- **Distributed compute**: Single-machine processing sufficient for POC
- **Complex orchestration**: Simple scripts, no Airflow/Dagster
- **ML inference pipeline**: Statistical analysis only, no model serving
