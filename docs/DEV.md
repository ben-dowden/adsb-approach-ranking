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

| Command | Description |
|---------|-------------|
| `pnpm lint` | Run ESLint |
| `pnpm typecheck` | Type check all packages |
| `pnpm test` | Run all tests |
| `pnpm dashboard:dev` | Start dashboard dev server |
| `pnpm dashboard:build` | Build dashboard for production |
| `pnpm pipeline:ingest` | Load raw ADS-B data |
| `pnpm pipeline:derive` | Compute ring crossings |
| `pnpm pipeline:score` | Compute ranks and trajectories |
| `pnpm pipeline:sequence` | Identify high-churn arrival windows |

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
