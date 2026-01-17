/**
 * S3-specific type definitions for the data downloader
 */

/**
 * Information about an S3 object from listing
 */
export interface S3ObjectInfo {
  key: string;
  size: number;
  lastModified: Date;
  etag: string;
}

/**
 * Entry in the download manifest (JSONL format)
 */
export interface ManifestEntry {
  source_key: string;
  local_path: string;
  size_bytes: number;
  last_modified: string;
  downloaded_at_utc: string;
}

/**
 * Result of attempting to download a single object
 */
export interface DownloadResult {
  key: string;
  localPath: string;
  skipped: boolean;
  error?: string;
}

/**
 * CLI arguments for the ingest command
 */
export interface IngestArgs {
  airport: string;
  date: string;
  startHH?: number;
  endHH?: number;
}

/**
 * S3 client configuration
 */
export interface S3Config {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

/**
 * Progress callback for batch downloads
 */
export type ProgressCallback = (
  completed: number,
  total: number,
  current: string
) => void;
