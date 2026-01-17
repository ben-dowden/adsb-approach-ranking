# Development Setup

## Prerequisites

- Node.js 20+
- pnpm 9+

## Quick Start

```bash
pnpm install
cp .env.example .env   # Edit with your target aerodrome
pnpm test
pnpm dashboard:dev     # http://localhost:3000
```

## Project Structure

```
apps/dashboard/     # Next.js dashboard
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
| `pnpm pipeline:ingest` | Load raw ADS-B data |
| `pnpm pipeline:derive` | Compute ring crossings |
| `pnpm pipeline:score` | Score sequences |

Or use `make dev`, `make test`, `make pipeline`.

## Environment Variables

See `.env.example`. Required: `AIRPORT_ICAO`, `AIRPORT_LAT`, `AIRPORT_LON`.

## Troubleshooting

**Cannot find module '@adsb/shared'**: Run `pnpm --filter @adsb/shared build`

**Tests fail with "Missing required env var"**: Create `.env` from `.env.example`
