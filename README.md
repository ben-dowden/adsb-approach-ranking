# ADS-B Arrival Sequencing POC

A historical, data-driven proof of concept exploring whether arrival sequencing behaviour can be inferred from ADS-B surveillance data alone.

## Problem Statement

Air traffic arrival sequencing is managed via speed control, vectoring, and holding—but these decisions are opaque outside ATC systems. This POC asks:

> Given only ADS-B trajectories, can we detect patterns where aircraft with different speed/closing-rate profiles experience systematic changes in their relative arrival order?

## What This Is

- **Historical analysis only** — retrospective batch processing of archived ADS-B data
- **Single-aerodrome focus** — analyses arrivals to one airport per run
- **Rank as proxy** — relative ordering within arrival cohorts, not ATC intent
- **Research-grade** — explainable, inspectable, not production-ready

## What This Is NOT

| Non-Goal | Reason |
|----------|--------|
| Real-time operations | Historical batch processing only |
| ATC intent inference | Rank is a proxy, not ground truth |
| Runway-specific sequencing | Distance-ring model, not threshold model |
| Causal claims | Associations and signals only |
| Pilot guidance | No operational recommendations |

## How It Works

The system reconstructs arrival cohorts within concentric distance rings (e.g., 20/15/10/5 NM) around a destination aerodrome and computes relative ordering ("rank") as aircraft approach.

**Rank** is computed per cohort using:
- Distance to aerodrome (rank_distance)
- Estimated time-to-go from closing rate (rank_ttg)

The POC then identifies sequences with high rank churn or anomalous behaviour for visual inspection and statistical analysis.

## Pipeline Stages

```
┌─────────┐    ┌───────────┐    ┌────────┐    ┌──────────┐    ┌─────┐    ┌───────────┐
│ Ingest  │───▶│ Normalize │───▶│ Derive │───▶│ Sequence │───▶│ API │───▶│ Dashboard │
└─────────┘    └───────────┘    └────────┘    │ Scoring  │    └─────┘    └───────────┘
                                              └──────────┘
```

1. **Ingest** — Load raw ADS-B data (initially ADS-B Exchange first-of-month samples)
2. **Normalize** — Clean, deduplicate, filter to arrival candidates
3. **Derive** — Compute distance to aerodrome, closing rate, ring crossings
4. **Sequence Scoring** — Identify cohorts, compute ranks, score churn/inversions
5. **API** — Serve processed data for replay and analysis
6. **Dashboard** — Visual replay of sequences, rank evolution, kinematics

## Success Criteria

If a human can replay a sequence and say "yes, that shows sequencing churn," the system works.

The goal is **clarity**, not performance.

## Data Sources

- ADS-B Exchange historical samples (free first-of-month archives)
- Future: expanded historical coverage if POC shows promise

## Tech Stack

- **Storage**: Parquet files, DuckDB
- **Processing**: Python batch jobs
- **API**: Lightweight REST/GraphQL
- **Dashboard**: Web-based replay UI

## Project Structure

```
├── README.md
├── docs/
│   ├── architecture.md    # Module descriptions
│   └── data-contracts.md  # Schema definitions
├── src/                   # (future) implementation
├── data/                  # (future) raw and processed data
└── notebooks/             # (future) exploratory analysis
```

## Documentation

- [Architecture](docs/architecture.md) — Module design and data flow
- [Data Contracts](docs/data-contracts.md) — Schema definitions

## License

Research use only. Not for operational aviation purposes.
