/**
 * JSONL manifest file handling for tracking downloaded files
 */

import { createReadStream, createWriteStream } from "node:fs";
import { access } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { ManifestEntry, S3ObjectInfo } from "./types.js";

/**
 * Read an existing manifest file into a Map keyed by source_key
 */
export async function readManifest(
  path: string
): Promise<Map<string, ManifestEntry>> {
  const entries = new Map<string, ManifestEntry>();

  // Check if file exists
  try {
    await access(path);
  } catch {
    return entries;
  }

  const fileStream = createReadStream(path);
  const rl = createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const entry = JSON.parse(trimmed) as ManifestEntry;
      entries.set(entry.source_key, entry);
    } catch {
      // Skip malformed lines
    }
  }

  return entries;
}

/**
 * Append a single entry to the manifest file
 */
export async function appendManifest(
  path: string,
  entry: ManifestEntry
): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = createWriteStream(path, { flags: "a" });
    stream.write(JSON.stringify(entry) + "\n", (err) => {
      stream.end();
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * Create a manifest entry from S3 object metadata and local path
 */
export function createManifestEntry(
  object: S3ObjectInfo,
  localPath: string
): ManifestEntry {
  return {
    source_key: object.key,
    local_path: localPath,
    size_bytes: object.size,
    last_modified: object.lastModified.toISOString(),
    downloaded_at_utc: new Date().toISOString(),
  };
}
