import { existsSync } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadDotEnv } from "dotenv";
import { glob } from "glob";
import minimist from "minimist";

import {
  DEFAULT_CRUISE_CONFIG,
  buildOutputTables,
  discoverCompleteDays,
  processCruiseFiles,
  writeOutputTables,
  type AnalysisBundle,
  type CoverageCandidate,
  type SelectedDayFiles,
} from "../cruise/index.js";
import { createS3Client, loadS3Config } from "../s3/client.js";
import { downloadAll, listObjects } from "../s3/downloader.js";
import {
  appendManifest,
  createManifestEntry,
  readManifest,
} from "../s3/manifest.js";
import type { S3ObjectInfo } from "../s3/types.js";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const monorepoRoot = resolve(scriptDirectory, "../../../..");
const pipelineRoot = resolve(scriptDirectory, "../..");
const environmentPath = join(monorepoRoot, ".env");
loadDotEnv(existsSync(environmentPath) ? { path: environmentPath } : {});

interface CruiseCliOptions {
  asOf: string;
  months: number;
  intervalMinutes: number;
  maximumLookbackMonths: number;
  bootstrapReplicates: number;
  outputDirectory: string;
  rawDirectory: string;
  skipDownload: boolean;
}

const USAGE = `
Usage: pnpm pipeline:cruise -- [options]

Options:
  --asOf <YYYY-MM-DD>              Latest month considered (default: today)
  --months <number>                Complete first-of-month days (default: 12)
  --intervalMinutes <number>       Snapshot cadence (default: 5)
  --maxLookbackMonths <number>     Maximum discovery window (default: 36)
  --bootstrapReplicates <number>   Confidence interval replicates (default: 10000)
  --outputDir <path>               Analysis output directory
  --localRawDir <path>             Raw archive root
  --skipDownload                   Use complete locally cached days only
  --help                           Show this help
`;

function positiveInteger(
  value: unknown,
  name: string,
  fallback: number
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseArguments(): CruiseCliOptions | null {
  const commandArguments = process.argv.slice(2);
  if (commandArguments[0] === "--") commandArguments.shift();
  const args = minimist(commandArguments, {
    string: ["asOf", "outputDir", "localRawDir"],
    boolean: ["skipDownload", "help"],
  });
  if (args.help) {
    console.log(USAGE);
    return null;
  }

  const asOf = args.asOf ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    throw new Error("asOf must use YYYY-MM-DD format");
  }
  const months = positiveInteger(args.months, "months", 12);
  const intervalMinutes = positiveInteger(
    args.intervalMinutes,
    "intervalMinutes",
    DEFAULT_CRUISE_CONFIG.sampleIntervalMinutes
  );
  const maximumLookbackMonths = positiveInteger(
    args.maxLookbackMonths,
    "maxLookbackMonths",
    DEFAULT_CRUISE_CONFIG.maximumLookbackMonths
  );
  const bootstrapReplicates = positiveInteger(
    args.bootstrapReplicates,
    "bootstrapReplicates",
    DEFAULT_CRUISE_CONFIG.bootstrapReplicates
  );
  const runTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const analysisRunId = `cruise-${asOf}-${runTimestamp}`;
  return {
    asOf,
    months,
    intervalMinutes,
    maximumLookbackMonths,
    bootstrapReplicates,
    outputDirectory: resolve(
      args.outputDir ??
        join(pipelineRoot, "data", "analysis", "cruise", analysisRunId)
    ),
    rawDirectory: resolve(
      args.localRawDir ?? join(pipelineRoot, "data", "raw")
    ),
    skipDownload: Boolean(args.skipDownload),
  };
}

async function localObjectsForDate(
  rawDirectory: string,
  date: string
): Promise<S3ObjectInfo[]> {
  const [year, month, day] = date.split("-");
  const files = await glob(
    join(
      rawDirectory,
      date,
      "readsb-hist",
      year!,
      month!,
      day!,
      "*.json.gz"
    ).replace(/\\/g, "/")
  );
  return Promise.all(
    files.map(async (filePath) => {
      const fileStats = await stat(filePath);
      return {
        key: `readsb-hist/${year}/${month}/${day}/${filePath.replace(/\\/g, "/").split("/").at(-1)}`,
        size: fileStats.size,
        lastModified: fileStats.mtime,
        etag: `local-${fileStats.size}-${fileStats.mtimeMs}`,
      };
    })
  );
}

function localPathForObject(
  rawDirectory: string,
  date: string,
  object: S3ObjectInfo
): string {
  return join(rawDirectory, date, ...object.key.split("/"));
}

function coverageRecord(candidate: CoverageCandidate) {
  return {
    date: candidate.date,
    reason: candidate.reason,
    complete: candidate.complete,
    discovered_object_count: candidate.discoveredCount,
    selected_object_count: candidate.objects.length,
    expected_object_count: candidate.expectedCount,
    missing_timestamp_count: candidate.missingTimestamps.length,
    missing_timestamps: candidate.missingTimestamps,
  };
}

async function writeCoverageReport(
  outputDirectory: string,
  candidates: CoverageCandidate[],
  selected: CoverageCandidate[]
): Promise<void> {
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    join(outputDirectory, "coverage_candidates.json"),
    `${JSON.stringify(candidates.map(coverageRecord), null, 2)}\n`,
    "utf8"
  );
  const selectedObjects = selected.flatMap((candidate) =>
    candidate.objects.map((object) => ({
      date: candidate.date,
      source_key: object.key,
      size_bytes: object.size,
      last_modified_utc: object.lastModified.toISOString(),
      etag: object.etag,
    }))
  );
  await writeFile(
    join(outputDirectory, "selected_source_objects.json"),
    `${JSON.stringify(selectedObjects, null, 2)}\n`,
    "utf8"
  );
}

async function coverageFailure(
  options: CruiseCliOptions,
  selectedCount: number
): Promise<void> {
  const runId = options.outputDirectory.split(/[\\/]/).at(-1)!;
  const bundle: AnalysisBundle = {
    analysisRunId: runId,
    flights: [],
    analysis: null,
    qualityRows: [
      {
        stage: "coverage",
        reason: "complete_sample_days",
        count: selectedCount,
        percentage: (selectedCount / options.months) * 100,
      },
      {
        stage: "coverage",
        reason: "required_sample_days",
        count: options.months,
        percentage: 100,
      },
    ],
  };
  await writeOutputTables(options.outputDirectory, buildOutputTables(bundle));
  await writeFile(
    join(options.outputDirectory, "analysis_run_manifest.json"),
    `${JSON.stringify(
      {
        analysis_run_id: runId,
        status: "coverage_failure",
        selected_complete_days: selectedCount,
        required_complete_days: options.months,
        sample_interval_minutes: options.intervalMinutes,
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

async function downloadCandidate(
  candidate: CoverageCandidate,
  rawDirectory: string,
  client: ReturnType<typeof createS3Client>,
  bucket: string
): Promise<SelectedDayFiles> {
  const dayDirectory = join(rawDirectory, candidate.date);
  const results = await downloadAll(
    client,
    bucket,
    candidate.objects,
    dayDirectory,
    (completed, total) => {
      const percentage = Math.round((completed / total) * 100);
      process.stdout.write(
        `\r[cruise] ${candidate.date}: ${percentage}% (${completed}/${total})`
      );
    }
  );
  process.stdout.write("\n");
  const errors = results.filter((result) => result.error);
  if (errors.length > 0) {
    throw new Error(
      `Failed to download ${errors.length} sampled files for ${candidate.date}: ${errors[0]!.error}`
    );
  }

  const manifestPath = join(dayDirectory, "manifest.jsonl");
  const manifest = await readManifest(manifestPath);
  for (let index = 0; index < results.length; index++) {
    const result = results[index]!;
    const object = candidate.objects[index]!;
    if (!manifest.has(object.key)) {
      await appendManifest(
        manifestPath,
        createManifestEntry(object, result.localPath)
      );
      manifest.set(object.key, createManifestEntry(object, result.localPath));
    }
  }
  return {
    date: candidate.date,
    files: results.map((result) => result.localPath),
  };
}

async function selectedFiles(
  options: CruiseCliOptions,
  selected: CoverageCandidate[],
  source: { client?: ReturnType<typeof createS3Client>; bucket?: string }
): Promise<SelectedDayFiles[]> {
  if (options.skipDownload) {
    return selected.map((candidate) => ({
      date: candidate.date,
      files: candidate.objects.map((object) =>
        localPathForObject(options.rawDirectory, candidate.date, object)
      ),
    }));
  }
  return Promise.all(
    selected.map((candidate) =>
      downloadCandidate(
        candidate,
        options.rawDirectory,
        source.client!,
        source.bucket!
      )
    )
  );
}

async function run(options: CruiseCliOptions): Promise<void> {
  console.log(
    `[cruise] Discovering ${options.months} complete first-of-month days at ${options.intervalMinutes}-minute cadence`
  );
  let source: { client?: ReturnType<typeof createS3Client>; bucket?: string } =
    {};
  const listForDate = options.skipDownload
    ? (date: string) => localObjectsForDate(options.rawDirectory, date)
    : (() => {
        const configuration = loadS3Config();
        const client = createS3Client(configuration);
        source = { client, bucket: configuration.bucket };
        return (date: string) =>
          listObjects(client, configuration.bucket, date);
      })();

  const coverage = await discoverCompleteDays({
    asOf: options.asOf,
    requiredDays: options.months,
    maximumLookbackMonths: options.maximumLookbackMonths,
    intervalMinutes: options.intervalMinutes,
    listForDate,
  });
  await writeCoverageReport(
    options.outputDirectory,
    coverage.candidates,
    coverage.selected
  );
  if (coverage.selected.length < options.months) {
    await coverageFailure(options, coverage.selected.length);
    throw new Error(
      `Only ${coverage.selected.length} complete sampled days were found; ${options.months} are required`
    );
  }

  const files = await selectedFiles(options, coverage.selected, source);
  const analysisRunId = options.outputDirectory.split(/[\\/]/).at(-1)!;
  const result = await processCruiseFiles({
    analysisRunId,
    selectedDays: files,
    outputDirectory: options.outputDirectory,
    minimumFlights: DEFAULT_CRUISE_CONFIG.minimumMatchedFlights,
    bootstrapReplicates: options.bootstrapReplicates,
    bootstrapSeed: DEFAULT_CRUISE_CONFIG.bootstrapSeed,
  });
  console.log(`[cruise] Qualifying flights: ${result.flights.length}`);
  console.log(
    `[cruise] Matched routes: ${result.analysis?.routes.length ?? 0}`
  );
  console.log(`[cruise] Output: ${options.outputDirectory}`);
}

async function main(): Promise<void> {
  const options = parseArguments();
  if (!options) return;
  await run(options);
}

main().catch((error) => {
  console.error(
    `[cruise] ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
});
