import type {
  BenchmarkAnalysis,
  BenchmarkVerdict,
  FlightCruiseMetric,
  MatchedRouteResult,
} from "./types.js";

interface RouteDateCell {
  date: string;
  qantas: FlightCruiseMetric[];
  virgin: FlightCruiseMetric[];
}

interface MatchedRoute {
  route: string;
  cells: RouteDateCell[];
}

interface AnalysisOptions {
  minimumFlights: number;
  replicates: number;
  seed: number;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function altitudeMean(flights: FlightCruiseMetric[]): number {
  return mean(flights.map((flight) => flight.meanCruiseAltitudeFt));
}

function routeDateCells(
  route: string,
  flights: FlightCruiseMetric[]
): RouteDateCell[] {
  const dates = [...new Set(flights.map((flight) => flight.sampleDate))].sort();
  return dates
    .map((date) => ({
      date,
      qantas: flights.filter(
        (flight) => flight.sampleDate === date && flight.operatorCode === "QFA"
      ),
      virgin: flights.filter(
        (flight) => flight.sampleDate === date && flight.operatorCode === "VOZ"
      ),
    }))
    .filter((cell) => cell.qantas.length > 0 && cell.virgin.length > 0)
    .map((cell) => ({ ...cell, route }));
}

function matchedRoutes(
  flights: FlightCruiseMetric[],
  minimumFlights: number
): MatchedRoute[] {
  const routes = [...new Set(flights.map((flight) => flight.route))].sort();
  return routes.flatMap((route) => {
    const routeFlights = flights.filter((flight) => flight.route === route);
    const qantasCount = routeFlights.filter(
      (flight) => flight.operatorCode === "QFA"
    ).length;
    const virginCount = routeFlights.filter(
      (flight) => flight.operatorCode === "VOZ"
    ).length;
    if (qantasCount < minimumFlights || virginCount < minimumFlights) return [];
    const cells = routeDateCells(route, routeFlights);
    return cells.length > 0 ? [{ route, cells }] : [];
  });
}

function routeDifference(route: MatchedRoute): number {
  return mean(
    route.cells.map(
      (cell) => altitudeMean(cell.virgin) - altitudeMean(cell.qantas)
    )
  );
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1_664_525 * state + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function sampleWithReplacement<T>(values: T[], random: () => number): T[] {
  return Array.from(
    { length: values.length },
    () => values[Math.floor(random() * values.length)]!
  );
}

function resampledAltitudeMean(
  flights: FlightCruiseMetric[],
  random: () => number
): number {
  return altitudeMean(sampleWithReplacement(flights, random));
}

function bootstrap(
  routes: MatchedRoute[],
  replicates: number,
  seed: number
): { national: number[]; byRoute: Map<string, number[]> } {
  const random = seededRandom(seed);
  const national: number[] = [];
  const byRoute = new Map(routes.map((route) => [route.route, [] as number[]]));

  for (let replicate = 0; replicate < replicates; replicate++) {
    const routeDifferences: number[] = [];
    for (const route of routes) {
      const sampledCells = sampleWithReplacement(route.cells, random);
      const difference = mean(
        sampledCells.map(
          (cell) =>
            resampledAltitudeMean(cell.virgin, random) -
            resampledAltitudeMean(cell.qantas, random)
        )
      );
      routeDifferences.push(difference);
      byRoute.get(route.route)!.push(difference);
    }
    national.push(mean(routeDifferences));
  }
  return { national, byRoute };
}

function percentile(values: number[], probability: number): number {
  const ordered = [...values].sort((left, right) => left - right);
  const position = (ordered.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  if (lowerIndex === upperIndex) return ordered[lowerIndex]!;
  const fraction = position - lowerIndex;
  return (
    ordered[lowerIndex]! * (1 - fraction) + ordered[upperIndex]! * fraction
  );
}

function confidenceInterval(values: number[]): [number, number] {
  return [percentile(values, 0.025), percentile(values, 0.975)];
}

export function verdictForInterval(
  interval: readonly [number, number]
): BenchmarkVerdict {
  if (interval[0] > 0) return "supports";
  if (interval[1] < 0) return "does_not_support";
  return "inconclusive";
}

function allMatchedFlights(routes: MatchedRoute[]): FlightCruiseMetric[] {
  return routes.flatMap((route) =>
    route.cells.flatMap((cell) => [...cell.qantas, ...cell.virgin])
  );
}

function uniqueCount(
  flights: FlightCruiseMetric[],
  field: "registration" | "sampleDate"
): number {
  return new Set(flights.map((flight) => flight[field])).size;
}

function routeResult(
  route: MatchedRoute,
  bootstrapValues: number[]
): MatchedRouteResult {
  const qantas = route.cells.flatMap((cell) => cell.qantas);
  const virgin = route.cells.flatMap((cell) => cell.virgin);
  const routeInterval = confidenceInterval(bootstrapValues);
  const qantasStandardizedMean = mean(
    route.cells.map((cell) => altitudeMean(cell.qantas))
  );
  const virginStandardizedMean = mean(
    route.cells.map((cell) => altitudeMean(cell.virgin))
  );
  return {
    route: route.route,
    qantasMeanAltitudeFt: qantasStandardizedMean,
    virginMeanAltitudeFt: virginStandardizedMean,
    virginMinusQantasFt: routeDifference(route),
    confidenceIntervalLowFt: routeInterval[0],
    confidenceIntervalHighFt: routeInterval[1],
    qantasFlightCount: qantas.length,
    virginFlightCount: virgin.length,
    qantasAircraftCount: uniqueCount(qantas, "registration"),
    virginAircraftCount: uniqueCount(virgin, "registration"),
    representedDateCount: route.cells.length,
  };
}

function dummyColumns(
  flights: FlightCruiseMetric[],
  value: (flight: FlightCruiseMetric) => string
): string[] {
  return [...new Set(flights.map(value))].sort().slice(1);
}

function solveLinearSystem(
  matrix: number[][],
  vector: number[]
): number[] | null {
  const augmented = matrix.map((row, index) => [...row, vector[index]!]);
  for (let column = 0; column < augmented.length; column++) {
    let pivotRow = column;
    for (let row = column + 1; row < augmented.length; row++) {
      if (
        Math.abs(augmented[row]![column]!) >
        Math.abs(augmented[pivotRow]![column]!)
      ) {
        pivotRow = row;
      }
    }
    if (Math.abs(augmented[pivotRow]![column]!) < 1e-9) return null;
    [augmented[column], augmented[pivotRow]] = [
      augmented[pivotRow]!,
      augmented[column]!,
    ];
    const pivot = augmented[column]![column]!;
    augmented[column] = augmented[column]!.map((value) => value / pivot);
    for (let row = 0; row < augmented.length; row++) {
      if (row === column) continue;
      const factor = augmented[row]![column]!;
      augmented[row] = augmented[row]!.map(
        (value, index) => value - factor * augmented[column]![index]!
      );
    }
  }
  return augmented.map((row) => row.at(-1)!);
}

export function fixedEffectVirginCoefficient(
  flights: FlightCruiseMetric[]
): number | null {
  const comparisonFlights = flights.filter(
    (flight) => flight.operatorCode === "QFA" || flight.operatorCode === "VOZ"
  );
  if (comparisonFlights.length === 0) return null;
  const routeColumns = dummyColumns(
    comparisonFlights,
    (flight) => flight.route
  );
  const dateColumns = dummyColumns(
    comparisonFlights,
    (flight) => flight.sampleDate
  );
  const typeColumns = dummyColumns(
    comparisonFlights,
    (flight) => flight.aircraftType
  );
  const design = comparisonFlights.map((flight) => [
    1,
    flight.operatorCode === "VOZ" ? 1 : 0,
    ...routeColumns.map((route) => (flight.route === route ? 1 : 0)),
    ...dateColumns.map((date) => (flight.sampleDate === date ? 1 : 0)),
    ...typeColumns.map((type) => (flight.aircraftType === type ? 1 : 0)),
  ]);
  const outcome = comparisonFlights.map(
    (flight) => flight.meanCruiseAltitudeFt
  );
  const columnCount = design[0]!.length;
  const crossProduct = Array.from({ length: columnCount }, (_, row) =>
    Array.from({ length: columnCount }, (_, column) =>
      design.reduce((sum, values) => sum + values[row]! * values[column]!, 0)
    )
  );
  const crossOutcome = Array.from({ length: columnCount }, (_, column) =>
    design.reduce(
      (sum, values, index) => sum + values[column]! * outcome[index]!,
      0
    )
  );
  return solveLinearSystem(crossProduct, crossOutcome)?.[1] ?? null;
}

export function analyzeMatchedRoutes(
  flights: FlightCruiseMetric[],
  options: AnalysisOptions
): BenchmarkAnalysis {
  if (!Number.isInteger(options.replicates) || options.replicates < 2) {
    throw new Error("Bootstrap replicates must be an integer of at least 2");
  }
  const routes = matchedRoutes(flights, options.minimumFlights);
  if (routes.length === 0) {
    throw new Error(
      "No directional route meets the Qantas and Virgin flight threshold"
    );
  }

  const pointEstimate = mean(routes.map(routeDifference));
  const distributions = bootstrap(routes, options.replicates, options.seed);
  const nationalInterval = confidenceInterval(distributions.national);
  const matchedFlights = allMatchedFlights(routes);
  const qantas = matchedFlights.filter(
    (flight) => flight.operatorCode === "QFA"
  );
  const virgin = matchedFlights.filter(
    (flight) => flight.operatorCode === "VOZ"
  );

  return {
    executive: {
      verdict: verdictForInterval(nationalInterval),
      adjustedDifferenceFt: pointEstimate,
      confidenceIntervalLowFt: nationalInterval[0],
      confidenceIntervalHighFt: nationalInterval[1],
      unadjustedDifferenceFt: altitudeMean(virgin) - altitudeMean(qantas),
      sensitivityVirginCoefficientFt:
        fixedEffectVirginCoefficient(matchedFlights),
      matchedRouteCount: routes.length,
      representedDateCount: uniqueCount(matchedFlights, "sampleDate"),
      qantasFlightCount: qantas.length,
      virginFlightCount: virgin.length,
      qantasAircraftCount: uniqueCount(qantas, "registration"),
      virginAircraftCount: uniqueCount(virgin, "registration"),
    },
    routes: routes.map((route) =>
      routeResult(route, distributions.byRoute.get(route.route)!)
    ),
    matchedFlights,
  };
}
