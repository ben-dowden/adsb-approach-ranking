/**
 * S3 client factory with environment-based configuration
 * Supports Cloudflare R2 and other S3-compatible storage
 */

import { S3Client } from "@aws-sdk/client-s3";
import type { S3Config } from "./types.js";

const DEFAULT_BUCKET = "adsbx-sample-data";
const DEFAULT_REGION = "auto";
const DEFAULT_ENDPOINT =
  "https://6ff2cd7dae70306649e2c1e1500e2e0a.r2.cloudflarestorage.com";

/**
 * Load S3 configuration from environment variables
 */
export function loadS3Config(): S3Config {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      "Missing AWS credentials. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables."
    );
  }

  return {
    bucket: process.env.S3_BUCKET ?? DEFAULT_BUCKET,
    region: process.env.AWS_REGION ?? DEFAULT_REGION,
    endpoint: process.env.S3_ENDPOINT ?? DEFAULT_ENDPOINT,
    accessKeyId,
    secretAccessKey,
  };
}

/**
 * Create an S3 client with the given configuration
 * Configured for Cloudflare R2 compatibility
 */
export function createS3Client(config: S3Config): S3Client {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    credentials:
      config.accessKeyId && config.secretAccessKey
        ? {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
          }
        : undefined,
  });
}
