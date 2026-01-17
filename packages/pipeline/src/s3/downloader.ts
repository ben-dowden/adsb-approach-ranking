/**
 * S3 object listing and downloading functionality
 */

import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { withRetry } from "../utils/retry.js";
import type {
  S3ObjectInfo,
  DownloadResult,
  ProgressCallback,
} from "./types.js";

/**
 * List objects in S3 bucket for a specific date, optionally filtered by hour range
 */
export async function listObjects(
  client: S3Client,
  bucket: string,
  date: string,
  startHH?: number,
  endHH?: number
): Promise<S3ObjectInfo[]> {
  // Date format: YYYY-MM-DD -> prefix: readsb-hist/YYYY/MM/DD/
  const [year, month, day] = date.split("-");
  const prefix = `readsb-hist/${year}/${month}/${day}/`;

  const objects: S3ObjectInfo[] = [];
  let continuationToken: string | undefined;

  do {
    const command = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    });

    const response = await withRetry(() => client.send(command));

    for (const obj of response.Contents ?? []) {
      if (!obj.Key || !obj.Size || !obj.LastModified || !obj.ETag) {
        continue;
      }

      // Filter by hour if specified
      // File format: readsb-hist/YYYY/MM/DD/HHMMSSZ.json.gz
      const filename = obj.Key.split("/").pop() ?? "";
      const hourStr = filename.substring(0, 2);
      const hour = parseInt(hourStr, 10);

      if (!isNaN(hour)) {
        if (startHH !== undefined && hour < startHH) continue;
        if (endHH !== undefined && hour >= endHH) continue;
      }

      objects.push({
        key: obj.Key,
        size: obj.Size,
        lastModified: obj.LastModified,
        etag: obj.ETag.replace(/"/g, ""),
      });
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  return objects;
}

/**
 * Check if a local file exists with the expected size
 */
async function fileExistsWithSize(
  path: string,
  expectedSize: number
): Promise<boolean> {
  try {
    const stats = await stat(path);
    return stats.size === expectedSize;
  } catch {
    return false;
  }
}

/**
 * Download a single S3 object to a local file
 */
export async function downloadObject(
  client: S3Client,
  bucket: string,
  object: S3ObjectInfo,
  outputDir: string
): Promise<DownloadResult> {
  const localPath = join(outputDir, object.key);

  // Skip if file already exists with correct size
  if (await fileExistsWithSize(localPath, object.size)) {
    return {
      key: object.key,
      localPath,
      skipped: true,
    };
  }

  try {
    // Ensure directory exists
    await mkdir(dirname(localPath), { recursive: true });

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: object.key,
    });

    const response = await withRetry(() => client.send(command));

    if (!response.Body) {
      throw new Error(`Empty response body for ${object.key}`);
    }

    // Stream the response to file
    const writeStream = createWriteStream(localPath);
    const bodyStream =
      response.Body instanceof Readable
        ? response.Body
        : Readable.fromWeb(response.Body as ReadableStream);

    await pipeline(bodyStream, writeStream);

    return {
      key: object.key,
      localPath,
      skipped: false,
    };
  } catch (error) {
    return {
      key: object.key,
      localPath,
      skipped: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Download all objects with progress reporting
 */
export async function downloadAll(
  client: S3Client,
  bucket: string,
  objects: S3ObjectInfo[],
  outputDir: string,
  onProgress?: ProgressCallback
): Promise<DownloadResult[]> {
  const results: DownloadResult[] = [];
  const total = objects.length;

  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i]!;
    onProgress?.(i, total, obj.key);

    const result = await downloadObject(client, bucket, obj, outputDir);
    results.push(result);
  }

  onProgress?.(total, total, "complete");
  return results;
}
