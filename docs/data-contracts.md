# Data Contracts

This document defines the schemas for data artefacts produced by the pipeline.

All schemas are stored as Parquet files. Field types follow Parquet/Arrow conventions.

---

## aircraft_states

Normalized aircraft state vectors within the capture area around the target aerodrome.

**Path**: `processed/aircraft_states/{airport_icao}/{date}/`

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `ts` | timestamp[us, UTC] | No | Observation timestamp |
| `icao` | string | No | ICAO 24-bit transponder address (hex) |
| `callsign` | string | Yes | Flight callsign (may be null or change mid-flight) |
| `lat` | float64 | No | Latitude (WGS84 degrees) |
| `lon` | float64 | No | Longitude (WGS84 degrees) |
| `alt_baro` | int32 | Yes | Barometric altitude (feet) |
| `gs` | float32 | Yes | Ground speed (knots) |
| `track` | float32 | Yes | Track angle (degrees, 0=north, clockwise) |
| `vrt` | float32 | Yes | Vertical rate (feet/min, positive=climbing) |
| `distance_nm` | float32 | No | Distance to aerodrome reference point (NM) |
| `airport_icao` | string | No | Target aerodrome ICAO code |

**Primary Key**: (`icao`, `ts`)

**Partitioning**: By `airport_icao`, then by date

**Notes**:
- `distance_nm` computed using haversine formula from aerodrome reference point
- Records outside `max_distance_nm` are excluded
- Duplicate (icao, ts) pairs resolved by keeping last observed

---

## ring_events

Records of aircraft crossing distance ring boundaries inbound to the aerodrome.

**Path**: `processed/ring_events/{airport_icao}/{date}/`

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `arrival_id` | string | No | Unique identifier for this arrival segment |
| `icao` | string | No | ICAO 24-bit transponder address (hex) |
| `callsign` | string | Yes | Callsign at time of crossing |
| `ring_nm` | int16 | No | Ring distance crossed (e.g., 20, 15, 10, 5) |
| `cross_ts` | timestamp[us, UTC] | No | Timestamp of ring crossing |
| `gs` | float32 | Yes | Ground speed at crossing (knots) |
| `closing_rate` | float32 | No | Rate of distance change (NM/min, negative=inbound) |
| `alt_baro` | int32 | Yes | Barometric altitude at crossing (feet) |
| `rank_distance` | int16 | Yes | Rank within cohort by distance (1=closest) |
| `rank_ttg` | int16 | Yes | Rank within cohort by time-to-go (1=soonest) |
| `traffic_count` | int16 | No | Number of aircraft in cohort at this ring |

**Primary Key**: (`arrival_id`, `ring_nm`)

**Partitioning**: By `airport_icao`, then by date

**Notes**:
- `arrival_id` format: `{icao}_{first_ring_cross_ts}` (ISO8601 truncated)
- `closing_rate` derived from consecutive `distance_nm` observations
- `rank_distance` and `rank_ttg` are null until cohort scoring runs
- Cohort = aircraft crossing same ring within configurable time window

### Rank Interpretation

**Important**: Rank values are proxy measures, not ATC sequencing intent.

- `rank_distance`: Lower = closer to aerodrome at crossing time
- `rank_ttg`: Lower = estimated to arrive sooner (distance / |closing_rate|)
- Ranks are relative within cohort only; not comparable across cohorts

---

## arrival_ranks

Detailed rank trajectory for each aircraft at each ring crossing.

**Path**: `processed/{date}/arrival_ranks.parquet`

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `arrival_id` | string | No | Unique identifier for this arrival segment |
| `airport_icao` | string | No | Target aerodrome ICAO code |
| `icao_hex` | string | No | ICAO 24-bit transponder address (hex) |
| `ring_nm` | int16 | No | Ring distance crossed (e.g., 50, 40, 30, ...) |
| `cross_ts_utc` | timestamp[us, UTC] | No | Timestamp of ring crossing |
| `rank_distance` | int16 | No | Dense rank within cohort by distance (1=closest) |
| `rank_ttg` | int16 | No | Dense rank within cohort by time-to-go (1=soonest) |
| `delta_rank_distance` | int16 | Yes | Change from previous ring (null for outermost) |
| `delta_rank_ttg` | int16 | Yes | Change from previous ring (null for outermost) |
| `cohort_size` | int16 | No | Number of aircraft in cohort at this ring |
| `ring_order_index` | int16 | No | Order of ring crossings (0=outermost crossed) |

**Primary Key**: (`arrival_id`, `ring_nm`)

**Notes**:
- Dense ranking: 1, 2, 3... with no gaps (ties broken by ICAO hex alphabetically)
- `delta_rank_distance > 0` means aircraft fell back in the queue
- `delta_rank_distance < 0` means aircraft moved forward in the queue
- Cohorts require minimum 2 aircraft; single-aircraft crossings not ranked
- `ring_order_index` tracks progression (0=first ring crossed, 1=second, etc.)

---

## arrival_sequences

Rolling time windows scored for sequencing "interestingness" based on rank volatility, order inversions, and traffic density.

**Path**: `processed/{date}/arrival_sequences.parquet`

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `sequence_id` | string | No | Unique sequence identifier (airport_epoch) |
| `airport_icao` | string | No | Target aerodrome ICAO code |
| `window_start_ts` | timestamp[us, UTC] | No | Window start time |
| `window_end_ts` | timestamp[us, UTC] | No | Window end time |
| `rank_volatility` | float32 | No | Sum of |delta_rank_distance| in window |
| `inversion_count` | int32 | No | Count of pairwise rank inversions |
| `avg_inner_density` | float32 | No | Avg cohort size for rings ≤15nm |
| `sequence_score` | float32 | No | Combined z-score of all metrics |
| `aircraft_count` | int16 | No | Number of unique aircraft in window |
| `arrival_ids` | string | No | JSON array of arrival IDs in window |

**Primary Key**: `sequence_id`

### Metric Definitions

**`rank_volatility`**: Sum of absolute rank changes within the window.

```
rank_volatility = Σ |delta_rank_distance| for all arrivals in window
```

Higher values indicate more position changes during approach.

**`inversion_count`**: Pairwise order swaps between consecutive rings.

```
For aircraft A and B sharing rings:
  inversion if (rank_A < rank_B at outer) && (rank_A > rank_B at inner)
```

Higher values indicate more "overtaking" behaviour.

**`avg_inner_density`**: Traffic density at close-in rings.

```
avg_inner_density = AVG(cohort_size) for rings ≤ 15nm
```

Higher values indicate more congested final approach.

**`sequence_score`**: Z-score normalized combination.

```
sequence_score = z(rank_volatility) + z(inversion_count) + z(avg_inner_density)
```

Windows with higher scores show unusual sequencing activity.

### Window Parameters

- Window size: 30 minutes (default)
- Window step: 5 minutes (default)
- Minimum aircraft: 3 unique arrivals per window

---

## Relationships

```
aircraft_states ──[1:N]──▶ ring_events (via icao)
ring_events ──[1:1]──▶ arrival_ranks (via arrival_id, ring_nm)
arrival_ranks ──[N:1]──▶ arrival_sequences (via time window membership)
```

---

## Explicit Non-Goals

These schemas explicitly do **not** support:

| Non-Goal | Reason |
|----------|--------|
| **Real-time streaming** | All timestamps are historical; no "now" concept |
| **Runway assignment** | No runway field; distance-ring model only |
| **ATC clearance inference** | Rank is observational proxy, not intent |
| **Landing order prediction** | Innermost ring ≠ threshold; no touchdown data |
| **Multi-airport analysis** | Single `airport_icao` per dataset partition |

---

## Versioning

Schema changes follow semver in filename: `v1/`, `v2/`, etc.

Breaking changes require new version directory. Additive changes (new nullable columns) do not.

Current version: **v1**
