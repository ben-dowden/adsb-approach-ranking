# Dashboard Quickstart

This guide walks you through running the Replay Dashboard for visual inspection of arrival sequencing behaviour.

## Prerequisites

- Node.js 20+
- pnpm 9+
- Processed pipeline data (Parquet files in `data/processed/`)

## Quick Start

```bash
# Install dependencies
pnpm install

# Start the dashboard
pnpm dashboard:dev

# Open in browser
open http://localhost:3000
```

## Pages

### Sequences List (`/sequences`)

Browse arrival sequences by date and airport.

- **Date Filter**: Select a date to view sequences from that day
- **Airport Filter**: Choose the target airport (defaults to YBBN)
- **Table**: Click any row to view the replay

The table shows:
| Column | Description |
|--------|-------------|
| Time Window | Start and end time of the sequence |
| Score | Combined churn score (higher = more sequencing activity) |
| Volatility | Sum of rank changes across all aircraft |
| Inversions | Number of order swaps between consecutive rings |
| Aircraft | Number of unique aircraft in the sequence |

### Replay View (`/sequence/[id]`)

Interactive map replay of a specific sequence.

**Layout**: 70% map / 30% arrival panel

**Map Controls**:
- Pan and zoom with mouse/trackpad
- Click aircraft markers to select
- Distance rings show 4-50 NM boundaries
- Aircraft color indicates rank (green=1st, red=last)

**Time Scrubber**:
- Drag slider to seek through the sequence
- Play/Pause button for automatic playback
- Speed selector: 1x, 2x, 5x

**Arrival Panel**:
- Sorted by distance (closest first)
- Shows callsign, rank, distance, altitude, speed
- ↑/↓ arrows indicate rank changes
- Click to select and highlight on map

## Interpreting the Display

### Rank Colors

| Color | Meaning |
|-------|---------|
| Green (#4ade80) | Leading position (rank 1) |
| Yellow (#fbbf24) | Middle of pack |
| Red (#f87171) | Trailing position (last rank) |

### Rank Change Indicators

- **Pulse animation**: Aircraft marker pulses when rank changes
- **↑ Arrow (green)**: Aircraft moved up in rank (improved position)
- **↓ Arrow (red)**: Aircraft moved down in rank (lost position)

### Identifying Sequencing Churn

Look for:
1. Frequent rank changes as aircraft approach
2. Position swaps between aircraft at similar distances
3. Clusters of aircraft converging with different closing rates
4. High volatility scores in the sequence list

## API Endpoints

The dashboard uses these internal API routes:

| Endpoint | Description |
|----------|-------------|
| `GET /api/sequences?airport=YBBN&date=2025-12-01` | List sequences |
| `GET /api/sequences/:id` | Sequence detail with arrival IDs |
| `GET /api/sequences/:id/states?ts=ISO8601` | Aircraft positions at timestamp |

## Troubleshooting

**Map doesn't load**: Check that Leaflet CSS is imported in `layout.tsx`

**No sequences shown**: Verify pipeline has processed data for the selected date/airport

**Aircraft not appearing**: Check the timestamp is within the sequence window

**Slow performance**: Reduce playback speed or check network tab for API latency

## Tech Stack

- **Next.js 15**: React framework with App Router
- **Leaflet + react-leaflet**: Interactive maps
- **SWR**: Data fetching with caching
- **DuckDB**: Query engine (via API routes)
