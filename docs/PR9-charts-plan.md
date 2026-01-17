# PR9 - Rank Trajectory Charts

## Overview

Add Recharts-based visualizations to the replay view for deeper analysis of rank evolution over time and distance.

## Dependencies

Already installed in PR8:
```json
"recharts": "^2.14.0"
```

## Planned Components

### 1. RankTrajectoryChart

**Purpose**: Show how each aircraft's rank evolves as they approach the airport.

**Location**: `src/components/replay/RankTrajectoryChart.tsx`

**Visualization**:
- X-axis: Distance from airport (nm) - reversed (50nm → 0nm)
- Y-axis: Rank position (1 at top)
- One line per aircraft, colored by final rank
- Hover tooltip shows callsign, rank, distance, time
- Highlight selected aircraft line

```typescript
interface RankTrajectoryChartProps {
  trajectories: Map<string, RankPoint[]>;
  selectedAircraft: string | null;
  onSelectAircraft: (icao: string | null) => void;
}

interface RankPoint {
  distanceNm: number;
  rank: number;
  timestamp: string;
}
```

**Implementation Notes**:
- Use `<LineChart>` with custom line colors
- Fetch trajectory data via new API endpoint
- Memoize trajectory computation

### 2. CohortDensityChart

**Purpose**: Show traffic density at each ring over time.

**Location**: `src/components/replay/CohortDensityChart.tsx`

**Visualization**:
- X-axis: Time within sequence window
- Y-axis: Ring distance (stacked or grouped)
- Bar height: Number of aircraft in cohort
- Color intensity by density

```typescript
interface CohortDensityChartProps {
  densityData: CohortDensity[];
  currentTs: Date;
}

interface CohortDensity {
  timestamp: string;
  ringNm: number;
  count: number;
}
```

### 3. InversionTimeline

**Purpose**: Visualize when and where rank inversions occur.

**Location**: `src/components/replay/InversionTimeline.tsx`

**Visualization**:
- X-axis: Time within sequence window
- Y-axis: Ring distance (50nm → 0nm)
- Scatter points for each inversion event
- Point size by number of inversions
- Click to jump to that timestamp

```typescript
interface InversionTimelineProps {
  inversions: InversionEvent[];
  currentTs: Date;
  onSeek: (ts: Date) => void;
}

interface InversionEvent {
  timestamp: string;
  ringNm: number;
  aircraft1: string;
  aircraft2: string;
}
```

## New API Endpoint

### `GET /api/sequences/:id/trajectories`

Returns rank trajectories for all aircraft in a sequence.

**Response**:
```typescript
interface TrajectoriesResponse {
  sequenceId: string;
  trajectories: {
    icao: string;
    callsign: string | null;
    points: {
      timestamp: string;
      ringNm: number;
      distanceNm: number;
      rankDistance: number;
      cohortSize: number;
    }[];
  }[];
}
```

**Query**: Join `arrival_ranks` with sequence's `arrival_ids`

## Layout Changes

### Option A: Tabbed Panel

Replace single arrival panel with tabs:
```
[List] [Trajectory] [Density]
```

Panel shows one view at a time, preserving the 70/30 split.

### Option B: Expandable Charts

Add collapsible chart section below the map:
```
┌────────────────────┬─────────────┐
│       Map          │   Panel     │
├────────────────────┴─────────────┤
│      Charts (collapsible)        │
├──────────────────────────────────┤
│         Time Scrubber            │
└──────────────────────────────────┘
```

**Recommendation**: Option A for simplicity, Option B for richer analysis.

## Implementation Steps

1. **Add trajectories API endpoint**
   - Create `src/app/api/sequences/[id]/trajectories/route.ts`
   - Query `arrival_ranks` table for all crossings
   - Group by arrival_id, order by ring descending

2. **Create RankTrajectoryChart component**
   - Use Recharts `<LineChart>` with `<Line>` per aircraft
   - Color lines using `getRankColor()` based on final rank
   - Add click handler to select aircraft
   - Sync with replay state

3. **Create useSequenceTrajectories hook**
   - SWR hook to fetch trajectory data
   - Cache for duration of session

4. **Add tabbed panel layout**
   - Create `TabPanel.tsx` wrapper component
   - Update `ArrivalPanel.tsx` to be first tab
   - Add trajectory chart as second tab

5. **Create CohortDensityChart (stretch)**
   - Aggregate cohort data by time bucket
   - Use `<BarChart>` with stacked bars per ring

6. **Create InversionTimeline (stretch)**
   - Compute inversions client-side from trajectories
   - Use `<ScatterChart>` with click-to-seek

## File Structure

```
src/
├── app/api/sequences/[id]/
│   └── trajectories/
│       └── route.ts              # New API endpoint
├── components/replay/
│   ├── RankTrajectoryChart.tsx   # Main trajectory chart
│   ├── CohortDensityChart.tsx    # Density visualization
│   ├── InversionTimeline.tsx     # Inversion events
│   └── ChartTabs.tsx             # Tab container
└── hooks/
    └── useSequenceTrajectories.ts # Data fetching hook
```

## Acceptance Criteria

- [ ] Trajectory chart shows rank evolution by distance
- [ ] Each aircraft line is colored by rank
- [ ] Clicking a line selects the aircraft
- [ ] Selected aircraft is highlighted in chart
- [ ] Chart syncs with current timestamp marker
- [ ] Tabbed panel switches between list and chart views
- [ ] (Stretch) Density chart shows cohort sizes over time
- [ ] (Stretch) Inversion timeline allows click-to-seek

## Design Notes

### Color Consistency

Use same rank colors across all visualizations:
- Map markers
- Panel rank badges
- Chart lines

### Performance

- Fetch trajectories once per sequence (not per timestamp)
- Memoize chart data transformations
- Use Recharts' built-in animations sparingly

### Interaction Model

- Selecting aircraft in any view highlights it everywhere
- Current timestamp shown as vertical line in charts
- Hovering chart elements shows detailed tooltips
