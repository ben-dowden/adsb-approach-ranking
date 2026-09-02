# Development Setup

## Prerequisites

- Node.js 20+
- pnpm 9+

## Quick Start

```bash
pnpm install
cp .env.example .env   # Edit with your target aerodrome
pnpm test
pnpm dashboard:dev     # http://localhost:3000/sequences
```

## Project Structure

```
apps/dashboard/     # Next.js replay dashboard
  src/
    app/            # Next.js App Router pages
      sequences/    # Sequence list page
      sequence/[id] # Replay view page
      api/          # API routes
    components/     # React components
      replay/       # Map, markers, timeline
      sequences/    # List, filters
      ui/           # Shared UI components
    hooks/          # Custom React hooks
    lib/            # Utilities, API client
packages/pipeline/  # Data processing scripts
packages/shared/    # Types and utilities
```

## Commands

| Command                  | Description                                 |
| ------------------------ | ------------------------------------------- |
| `pnpm lint`              | Run ESLint                                  |
| `pnpm typecheck`         | Type check all packages                     |
| `pnpm test`              | Run all tests                               |
| `pnpm dashboard:dev`     | Start dashboard dev server                  |
| `pnpm dashboard:build`   | Build dashboard for production              |
| `pnpm pipeline:ingest`   | Load raw ADS-B data                         |
| `pnpm pipeline:derive`   | Compute ring crossings                      |
| `pnpm pipeline:score`    | Compute ranks and trajectories              |
| `pnpm pipeline:sequence` | Identify high-churn arrival windows         |
| `pnpm pipeline:cruise`   | Compare route-matched B737 cruise altitudes |

Or use `make dev`, `make test`, `make pipeline`.

## Dashboard Development

See [Dashboard Quickstart](dashboard-quickstart.md) for usage guide.

### Key Libraries

- **Next.js 15** - React framework with App Router
- **Leaflet + react-leaflet** - Interactive maps
- **SWR** - Data fetching with caching
- **Recharts** - Charts (PR9)
- **DuckDB** - Query engine for API routes

## Environment Variables

See `.env.example`. Required: `AIRPORT_ICAO`, `AIRPORT_LAT`, `AIRPORT_LON`.

## Troubleshooting

**Cannot find module '@adsb/shared'**: Run `pnpm --filter @adsb/shared build`

**Tests fail with "Missing required env var"**: Create `.env` from `.env.example`

## B737 Cruise Benchmark

This diagnostic benchmark compares Virgin Australia and Qantas B737 cruise
altitudes on directional routes among Brisbane, Melbourne, Sydney, and Perth.
It produces business-readable CSVs for chat-based executive interpretation; it
does not estimate causal fuel savings.

### Source access

Configure the ADS-B sample-data source in the repository `.env` file. Never
commit these credentials:

```dotenv
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
S3_BUCKET=adsbx-sample-data
AWS_REGION=auto
S3_ENDPOINT=https://6ff2cd7dae70306649e2c1e1500e2e0a.r2.cloudflarestorage.com
```

### Run the approved benchmark

```bash
pnpm pipeline:cruise -- --asOf 2026-09-02 --months 12 --intervalMinutes 5
```

The command searches backward for 12 complete first-of-month archive days,
selects only 288 five-minute snapshots per day before download, resumes files
already present with the expected size, and writes an immutable analysis folder
under `packages/pipeline/data/analysis/cruise/`.

Each run contains:

- `analysis_run_manifest.json`
- `coverage_candidates.json`
- `selected_source_objects.json`
- `cruise_states.duckdb`
- `cruise_states.parquet`
- `flight_cruise_metrics.csv`
- `aircraft_route_summary.csv`
- `route_operator_summary.csv`
- `route_matched_comparison.csv`
- `executive_summary.csv`
- `data_quality.csv`

To reprocess complete local archives without source access:

```bash
pnpm pipeline:cruise -- --asOf 2026-09-02 --months 12 --intervalMinutes 5 --skipDownload
```

The benchmark stops with coverage-only outputs when it cannot find all 12
complete sampled days. It never silently lowers the evidence standard.
