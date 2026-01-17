import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { sdkStreamMixin } from "@smithy/util-stream";
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import { mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { listObjects, downloadObject, downloadAll } from "./downloader.js";
import type { S3ObjectInfo } from "./types.js";

const s3Mock = mockClient(S3Client);

describe("listObjects", () => {
  beforeEach(() => {
    s3Mock.reset();
  });

  it("lists objects with date prefix", async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [
        {
          Key: "readsb-hist/2025/01/15/000000.json",
          Size: 1024,
          LastModified: new Date("2025-01-15T00:00:00Z"),
          ETag: '"abc123"',
        },
        {
          Key: "readsb-hist/2025/01/15/001000.json",
          Size: 2048,
          LastModified: new Date("2025-01-15T00:10:00Z"),
          ETag: '"def456"',
        },
      ],
    });

    const client = new S3Client({});
    const objects = await listObjects(client, "test-bucket", "2025-01-15");

    expect(objects).toHaveLength(2);
    expect(objects[0]!).toEqual({
      key: "readsb-hist/2025/01/15/000000.json",
      size: 1024,
      lastModified: new Date("2025-01-15T00:00:00Z"),
      etag: "abc123",
    });
  });

  it("filters by hour range", async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [
        {
          Key: "readsb-hist/2025/01/15/050000.json",
          Size: 100,
          LastModified: new Date("2025-01-15T05:00:00Z"),
          ETag: '"a"',
        },
        {
          Key: "readsb-hist/2025/01/15/060000.json",
          Size: 100,
          LastModified: new Date("2025-01-15T06:00:00Z"),
          ETag: '"b"',
        },
        {
          Key: "readsb-hist/2025/01/15/120000.json",
          Size: 100,
          LastModified: new Date("2025-01-15T12:00:00Z"),
          ETag: '"c"',
        },
        {
          Key: "readsb-hist/2025/01/15/130000.json",
          Size: 100,
          LastModified: new Date("2025-01-15T13:00:00Z"),
          ETag: '"d"',
        },
      ],
    });

    const client = new S3Client({});
    const objects = await listObjects(
      client,
      "test-bucket",
      "2025-01-15",
      6,
      12
    );

    expect(objects).toHaveLength(1);
    expect(objects[0]!.key).toBe("readsb-hist/2025/01/15/060000.json");
  });

  it("handles pagination", async () => {
    s3Mock
      .on(ListObjectsV2Command)
      .resolvesOnce({
        Contents: [
          {
            Key: "readsb-hist/2025/01/15/000000.json",
            Size: 100,
            LastModified: new Date(),
            ETag: '"a"',
          },
        ],
        NextContinuationToken: "token123",
      })
      .resolvesOnce({
        Contents: [
          {
            Key: "readsb-hist/2025/01/15/001000.json",
            Size: 100,
            LastModified: new Date(),
            ETag: '"b"',
          },
        ],
      });

    const client = new S3Client({});
    const objects = await listObjects(client, "test-bucket", "2025-01-15");

    expect(objects).toHaveLength(2);
  });

  it("skips objects with missing metadata", async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [
        { Key: "readsb-hist/2025/01/15/000000.json" }, // Missing size, lastModified, etag
        {
          Key: "readsb-hist/2025/01/15/001000.json",
          Size: 100,
          LastModified: new Date(),
          ETag: '"valid"',
        },
      ],
    });

    const client = new S3Client({});
    const objects = await listObjects(client, "test-bucket", "2025-01-15");

    expect(objects).toHaveLength(1);
    expect(objects[0]!.key).toBe("readsb-hist/2025/01/15/001000.json");
  });
});

describe("downloadObject", () => {
  let tempDir: string;

  beforeEach(async () => {
    s3Mock.reset();
    tempDir = join(tmpdir(), `s3-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("downloads file to correct path", async () => {
    const content = '{"test": true}';
    s3Mock.on(GetObjectCommand).resolves({
      Body: sdkStreamMixin(Readable.from([content])),
    });

    const client = new S3Client({});
    const object: S3ObjectInfo = {
      key: "readsb-hist/2025/01/15/000000.json",
      size: content.length,
      lastModified: new Date(),
      etag: "abc",
    };

    const result = await downloadObject(client, "bucket", object, tempDir);

    expect(result.skipped).toBe(false);
    expect(result.error).toBeUndefined();

    const downloadedContent = await readFile(result.localPath, "utf-8");
    expect(downloadedContent).toBe(content);
  });

  it("skips existing file with correct size", async () => {
    const content = '{"test": true}';
    const localPath = join(tempDir, "readsb-hist/2025/01/15/000000.json");
    await mkdir(join(tempDir, "readsb-hist/2025/01/15"), { recursive: true });
    const fs = await import("node:fs/promises");
    await fs.writeFile(localPath, content);

    const client = new S3Client({});
    const object: S3ObjectInfo = {
      key: "readsb-hist/2025/01/15/000000.json",
      size: content.length,
      lastModified: new Date(),
      etag: "abc",
    };

    const result = await downloadObject(client, "bucket", object, tempDir);

    expect(result.skipped).toBe(true);
    expect(s3Mock.calls()).toHaveLength(0);
  });

  it("returns error on failure", async () => {
    s3Mock.on(GetObjectCommand).rejects(new Error("Access Denied"));

    const client = new S3Client({});
    const object: S3ObjectInfo = {
      key: "readsb-hist/2025/01/15/000000.json",
      size: 100,
      lastModified: new Date(),
      etag: "abc",
    };

    const result = await downloadObject(client, "bucket", object, tempDir);

    expect(result.skipped).toBe(false);
    expect(result.error).toContain("Access Denied");
  });
});

describe("downloadAll", () => {
  let tempDir: string;

  beforeEach(async () => {
    s3Mock.reset();
    tempDir = join(tmpdir(), `s3-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("downloads multiple objects with progress", async () => {
    s3Mock.on(GetObjectCommand).resolves({
      Body: sdkStreamMixin(Readable.from(["content"])),
    });

    const client = new S3Client({});
    const objects: S3ObjectInfo[] = [
      {
        key: "readsb-hist/2025/01/15/000000.json",
        size: 7,
        lastModified: new Date(),
        etag: "a",
      },
      {
        key: "readsb-hist/2025/01/15/001000.json",
        size: 7,
        lastModified: new Date(),
        etag: "b",
      },
    ];

    const progressCalls: Array<[number, number, string]> = [];
    const results = await downloadAll(
      client,
      "bucket",
      objects,
      tempDir,
      (completed, total, current) => {
        progressCalls.push([completed, total, current]);
      }
    );

    expect(results).toHaveLength(2);
    expect(progressCalls).toContainEqual([0, 2, "readsb-hist/2025/01/15/000000.json"]);
    expect(progressCalls).toContainEqual([1, 2, "readsb-hist/2025/01/15/001000.json"]);
    expect(progressCalls).toContainEqual([2, 2, "complete"]);
  });
});
