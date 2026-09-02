# Route-Matched B737 Cruise Altitude Benchmark

## Purpose

Test the diagnostic hypothesis that Virgin Australia operates at higher cruise altitudes than Qantas on comparable Australian domestic B737 flights.

The primary user is a strategy or transformation executive investigating airline fuel-efficiency and flight-planning differences. The analysis must make like-for-like airline differences visible without implying that cruise altitude alone proves fuel efficiency or causation.

## Executive Experience

The user receives business-readable CSV files and asks Codex to interpret them. There is no dashboard in this iteration.

The interpretation leads with:

1. Whether the data supports, contradicts, or cannot resolve the hypothesis.
2. The route-adjusted Virgin-minus-Qantas cruise-altitude difference in feet and its 95% confidence interval.
3. The directional routes that most influence the result.
4. Whether individual aircraft results are consistent with the operator-level result.
5. Coverage limitations and factors that ADS-B data cannot observe.

## Scope

### Airports and routes

Include only flights whose inferred origin and destination are both in this set:

| Airport | ICAO |
|---|---|
| Brisbane | YBBN |
| Melbourne | YMML |
| Sydney | YSSY |
| Perth | YPPH |

Routes are directional. For example, `YSSY-YMML` and `YMML-YSSY` are different routes. This produces at most 12 directional routes.

### Aircraft and operators

Include the ICAO B737-family type designators `B731`, `B732`, `B733`, `B734`, `B735`, `B736`, `B737`, `B738`, `B739`, `B37M`, `B38M`, `B39M`, and `B3XM`. Keep the exact type designator in every detailed output so variants can be inspected and controlled.

Identify the aircraft by registration, with ICAO hex as a secondary stable identifier. Identify operators from an explicit callsign-prefix mapping:

- `QFA`: Qantas
- `VOZ`: Virgin Australia
- Other observed prefixes: named through the same auditable mapping when known; otherwise retained as their prefix and marked `unknown_operator_name`

The headline hypothesis compares Virgin Australia with Qantas. Other B737 operators appear on a route only when they meet the same minimum of five qualifying flights on that route.

### Time coverage and cadence

Use the most recent 12 complete first-of-month archive days available from the configured ADS-B source at analysis time. Store the chosen dates in an immutable run manifest so the result is reproducible.

Download one snapshot every five minutes: files whose UTC timestamp has seconds `00` and a minute divisible by five. A complete sampled day therefore has 288 expected snapshots. Filter the source object listing before download; do not download five-second snapshots and discard them afterward.

If a candidate month is incomplete, record the reason and continue backward until 12 complete sampled days are selected. If 12 complete days cannot be found, stop before headline analysis and produce a coverage report rather than silently weakening the requested evidence standard.

## Existing Project Fit

The existing project is an arrival-sequencing proof of concept with reusable archive access, gzip parsing, DuckDB/Parquet storage, manifests, and tests. Its current normalization is airport-centred and discards raw registration and aircraft-type fields.

The cruise benchmark is a separate analytical branch. It reuses the existing infrastructure and conventions without changing the behaviour or data contracts of the arrival-sequencing pipeline.

The raw archive provides the required fields:

- `hex`: ICAO aircraft identifier
- `r`: registration
- `t`: ICAO aircraft type designator
- `flight`: callsign
- `lat`, `lon`: position
- `alt_baro`: barometric altitude
- `gs`: ground speed
- `baro_rate` or `geom_rate`: vertical-rate evidence

## Proposed Components

### 1. Sampled archive ingestion

Extend archive selection with a configurable interval, used here as five minutes. The selector operates before downloading and validates each selected day's expected timestamps. Existing manifest behaviour makes the process resumable and idempotent.

The run manifest records:

- Selected archive dates
- Expected, discovered, downloaded, and rejected object counts
- Sampling interval and timestamp rule
- Source bucket and prefix without credentials
- File sizes and checksums or source metadata sufficient for reconciliation

### 2. Cruise-state normalization

Parse only fields required by this analysis and retain registration and aircraft type. Normalize callsign whitespace and type casing. Convert `ground` altitude to null for airborne calculations while retaining an on-ground flag where available.

Filter early to:

- B737-family types
- Records with valid latitude and longitude
- The Australian analysis envelope: latitude -41 to -20 degrees and longitude 112 to 155 degrees

Persist normalized observations in a dedicated table or Parquet artefact keyed by observation timestamp and ICAO hex. Do not write them into the existing arrival-focused `aircraft_states` contract.

### 3. Flight reconstruction and route inference

Build ordered tracks by ICAO hex and normalized callsign within each archive day. Split a track when the callsign changes or when an observation gap exceeds 20 minutes.

An airport-proximity observation is within 40 nautical miles of one of the four airport reference points and has numeric barometric altitude no greater than 15,000 feet. Infer an origin only when the earliest proximity observation is followed by outward movement and later cruise evidence. Infer a destination only when the latest proximity observation is preceded by inward movement and cruise evidence. When more than one endpoint is plausible or the required movement cannot be established, mark the route ambiguous rather than choosing the nearest airport. Keep the distance and altitude thresholds configurable but use these values for the benchmark run.

A qualifying flight must:

- Have one unambiguous origin and one later unambiguous destination from the four-airport set
- Have different origin and destination airports
- Show enough departure and arrival context to rule out a day-boundary truncation
- Have a registration, B737-family type, and usable callsign
- Contain sufficient eligible cruise observations

Ambiguous endpoints, loops, airport transits, truncated tracks, and conflicting callsigns are excluded with explicit reason codes.

### 4. Cruise-phase classification

An observation is eligible for cruise when it has:

- Numeric barometric altitude of at least 20,000 feet
- Ground speed of at least 300 knots
- Absolute reported vertical rate no greater than 500 feet per minute, or an absolute altitude-change rate no greater than 500 feet per minute across an adjacent five-minute sample interval when vertical rate is unavailable
- At least one neighbouring five-minute observation that supports a sustained cruise segment

A flight requires at least two eligible cruise observations. Step-climb or step-descent observations may be excluded while stable observations on either level remain eligible.

Calculate one cruise-altitude value per flight as the arithmetic mean of its eligible observations. Also retain the median, minimum, maximum, standard deviation, eligible-observation count, and observed cruise duration for auditability.

Downstream aircraft and operator averages use flight-level cruise values. They do not average raw observations, so longer flights and better-covered tracks do not receive extra weight.

### 5. Matching and statistical analysis

A matched directional route has at least five qualifying Qantas flights and five qualifying Virgin Australia flights across the 12 selected dates.

For the primary estimate:

1. Calculate operator mean flight cruise altitude within each directional route and sample date where both Qantas and Virgin are represented.
2. Calculate the Virgin-minus-Qantas difference for each represented route-date cell.
3. Average route-date differences across dates to obtain one difference per directional route.
4. Average qualifying route differences with equal route weights. High-frequency routes therefore do not dominate the national benchmark.
5. Produce a deterministic 95% bootstrap confidence interval from 10,000 replicates with random seed `737`. Within each route, resample represented route-date cells with replacement, then resample flights with replacement inside each operator's selected cell. Recalculate route differences and the equal-route national estimate for every replicate.

Report unadjusted values alongside the route-adjusted estimate. Run an ordinary least-squares sensitivity model on flight-level cruise altitude with operator, directional-route, sample-date, and B737-type fixed effects. The Virgin operator coefficient is supporting evidence, not a replacement for the transparent route-standardized estimate.

Classify the headline result as:

- `supports`: the entire 95% confidence interval for Virgin-minus-Qantas is above zero
- `does_not_support`: the entire interval is below zero
- `inconclusive`: the interval includes zero

Do not convert statistical significance into a fuel-saving claim.

## Outputs

All CSV columns use explicit units such as `_ft`, `_kt`, `_minutes`, and `_count`. Timestamps are UTC ISO 8601 values. Each file includes an `analysis_run_id` that joins it to the run manifest.

### `flight_cruise_metrics.csv`

One row per qualifying flight, including date, registration, ICAO hex, aircraft type, operator, callsign, directional route, inferred endpoint evidence, cruise metrics, and quality flags.

### `aircraft_route_summary.csv`

Rows for each registration and directional route plus an `ALL_MATCHED_ROUTES` roll-up for each registration. Include qualifying flights, route count, mean and median flight cruise altitude, range, variability, aircraft variant, operator, and a thin-sample flag. Route-level rows are the authoritative like-for-like view; the roll-up is a convenient aircraft overview.

### `route_operator_summary.csv`

One row per directional route and operator with flight count, aircraft count, sample-date count, cruise-altitude statistics, aircraft variants, and matched-route eligibility.

### `route_matched_comparison.csv`

One row per matched directional route with Qantas and Virgin means, Virgin-minus-Qantas difference, confidence interval, flight and aircraft counts, represented dates, and sensitivity indicators.

### `executive_summary.csv`

A compact national result containing the verdict, adjusted difference, confidence interval, unadjusted difference, sensitivity-model estimate, matched routes, represented dates, qualifying flights, aircraft counts, and coverage warnings.

### `data_quality.csv`

Counts and percentages at each stage, including raw observations, retained B737 observations, candidate tracks, qualifying flights, and exclusions by reason. Coverage failures and incomplete candidate months appear here even when headline analysis cannot run.

## Error Handling and Quality Controls

- Resume partial downloads from the manifest and never duplicate completed files.
- Validate 288 expected timestamps before declaring a sampled day complete.
- Reject malformed source records individually and count them by reason.
- Preserve unknown operators in audit outputs but exclude them from named operator comparisons until mapped.
- Exclude incomplete or ambiguous flights rather than guessing endpoints.
- Prevent routes below the agreed five-flight-per-airline threshold from entering the headline estimate.
- Fail headline generation if there are no matched routes or fewer than 12 complete sample days.
- Emit reconciliation counts at every transformation boundary.
- Record configuration, software version, selected dates, thresholds, and random seed with every run.

## Validation Strategy

### Unit tests

- Five-minute timestamp selection occurs before download.
- Registration, aircraft type, callsign, position, altitude, speed, and vertical rate survive normalization.
- B737-family inclusion and non-B737 exclusion are correct.
- Track splitting handles callsign changes and gaps over 20 minutes.
- Directional origin and destination inference handles valid, ambiguous, and truncated tracks.
- Cruise classification accepts level observations and rejects climb, descent, low-altitude, slow, and isolated observations.
- Each flight contributes exactly one value to downstream averages.
- Route thresholds and equal-route weighting match hand-calculated fixtures.
- Bootstrap results are repeatable with the recorded seed.
- Verdict classification follows the confidence interval.

### Integration tests

- A synthetic multi-airport day runs from sampled source records to all six CSV outputs.
- A known synthetic Virgin altitude advantage produces the expected adjusted difference and `supports` verdict.
- A zero-difference fixture produces `inconclusive`.
- An incomplete archive day produces a coverage failure rather than a headline result.
- Output totals reconcile with the exclusion ledger.

### Post-run checks

- Manually inspect a sample of inferred routes against mapped trajectories.
- Compare operator and type mappings against observed callsigns and registrations.
- Review route-date coverage for systematic airline gaps.
- Compare the transparent adjusted estimate with the sensitivity model and explain material divergence.

## Interpretation Guardrails

The result is a retrospective diagnostic association. ADS-B does not provide payload, passenger load, fuel load, cost index, planned altitude, winds aloft, turbulence, ATC restrictions, dispatch decisions, or complete operational intent.

Higher observed cruise altitude may be consistent with different flight-planning or operating practices, but it does not on its own establish better fuel efficiency. The executive interpretation must distinguish measured altitude differences from hypotheses about their causes and business value.

## Out of Scope

- Real-time monitoring
- A web dashboard or interactive UI
- Airports other than Brisbane, Melbourne, Sydney, and Perth
- International or overflight comparisons
- Non-B737 aircraft
- Causal fuel-burn or emissions estimates
- Payload, weather, or ATC data integration
- Automated operational recommendations

## Acceptance Criteria

The design is successfully implemented when:

1. The pipeline selects 12 complete first-of-month archive days and downloads exactly the five-minute snapshot cadence.
2. Complete B737 flights between the four named airports are reconstructed with auditable route evidence.
3. Every qualifying flight contributes one cruise-altitude value.
4. Per-aircraft, per-route, per-operator, matched-comparison, executive, and data-quality CSVs are produced with reconciliation totals.
5. The headline Virgin-minus-Qantas estimate uses only qualifying directional matched routes, equal route weights, and a reproducible 95% confidence interval.
6. Synthetic fixtures demonstrate correct route control, weighting, and verdict classification.
7. The chat interpretation can explain the result, its route drivers, confidence, coverage, and limitations without making a causal fuel-efficiency claim.
