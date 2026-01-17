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

## sequences

Scored arrival sequences showing rank evolution across rings.

**Path**: `processed/sequences/{airport_icao}/{date}/`

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `sequence_id` | string | No | Unique sequence identifier |
| `airport_icao` | string | No | Target aerodrome |
| `start_ts` | timestamp[us, UTC] | No | First ring crossing in sequence |
| `end_ts` | timestamp[us, UTC] | No | Last ring crossing in sequence |
| `duration_sec` | int32 | No | Sequence duration (seconds) |
| `aircraft_count` | int16 | No | Number of aircraft in sequence |
| `score_rank_vol` | float32 | No | Rank volatility score |
| `score_inversions` | int32 | No | Count of pairwise order inversions |
| `traffic_count` | int16 | No | Peak cohort size during sequence |

**Primary Key**: `sequence_id`

**Partitioning**: By `airport_icao`, then by date

### Score Definitions

**`score_rank_vol`**: Sum of absolute rank changes for all aircraft across rings.

```
score_rank_vol = Σ |rank[ring_n] - rank[ring_n-1]| for all aircraft, all ring transitions
```

Higher values indicate more reordering during the approach.

**`score_inversions`**: Count of pairwise order swaps between consecutive rings.

```
For aircraft A and B in same cohort:
  inversion if rank_A < rank_B at ring N, but rank_A > rank_B at ring N-1
```

Higher values indicate more "overtaking" behaviour.

### Sequence Identification

A sequence is formed when:
1. Two or more aircraft cross the outermost ring within a time window
2. Those aircraft continue inbound and cross subsequent rings
3. The sequence ends when all aircraft exit the innermost ring or data ends

---

## Relationships

```
aircraft_states ──[1:N]──▶ ring_events (via icao)
ring_events ──[N:1]──▶ sequences (via sequence membership)
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
