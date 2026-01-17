import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readManifest,
  appendManifest,
  createManifestEntry,
} from "./manifest.js";
import type { ManifestEntry, S3ObjectInfo } from "./types.js";

describe("manifest", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `manifest-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("readManifest", () => {
    it("returns empty map for non-existent file", async () => {
      const path = join(tempDir, "nonexistent.jsonl");
      const result = await readManifest(path);
      expect(result.size).toBe(0);
    });

    it("reads existing manifest entries", async () => {
      const path = join(tempDir, "manifest.jsonl");
      const entries: ManifestEntry[] = [
        {
          source_key: "2025/01/15/000000.json",
          local_path: "/data/2025/01/15/000000.json",
          size_bytes: 1024,
          last_modified: "2025-01-15T00:00:00.000Z",
          downloaded_at_utc: "2025-01-16T10:00:00.000Z",
        },
        {
          source_key: "2025/01/15/001000.json",
          local_path: "/data/2025/01/15/001000.json",
          size_bytes: 2048,
          last_modified: "2025-01-15T00:10:00.000Z",
          downloaded_at_utc: "2025-01-16T10:00:00.000Z",
        },
      ];

      await writeFile(
        path,
        entries.map((e) => JSON.stringify(e)).join("\n") + "\n"
      );

      const result = await readManifest(path);

      expect(result.size).toBe(2);
      expect(result.get("2025/01/15/000000.json")).toEqual(entries[0]);
      expect(result.get("2025/01/15/001000.json")).toEqual(entries[1]);
    });

    it("skips malformed lines", async () => {
      const path = join(tempDir, "manifest.jsonl");
      const validEntry: ManifestEntry = {
        source_key: "2025/01/15/000000.json",
        local_path: "/data/2025/01/15/000000.json",
        size_bytes: 1024,
        last_modified: "2025-01-15T00:00:00.000Z",
        downloaded_at_utc: "2025-01-16T10:00:00.000Z",
      };

      await writeFile(
        path,
        [
          JSON.stringify(validEntry),
          "not valid json",
          "",
          "{incomplete",
        ].join("\n")
      );

      const result = await readManifest(path);

      expect(result.size).toBe(1);
      expect(result.get("2025/01/15/000000.json")).toEqual(validEntry);
    });
  });

  describe("appendManifest", () => {
    it("creates new file and appends entry", async () => {
      const path = join(tempDir, "manifest.jsonl");
      const entry: ManifestEntry = {
        source_key: "2025/01/15/000000.json",
        local_path: "/data/2025/01/15/000000.json",
        size_bytes: 1024,
        last_modified: "2025-01-15T00:00:00.000Z",
        downloaded_at_utc: "2025-01-16T10:00:00.000Z",
      };

      await appendManifest(path, entry);

      const content = await readFile(path, "utf-8");
      expect(content).toBe(JSON.stringify(entry) + "\n");
    });

    it("appends to existing file", async () => {
      const path = join(tempDir, "manifest.jsonl");
      const entry1: ManifestEntry = {
        source_key: "2025/01/15/000000.json",
        local_path: "/data/2025/01/15/000000.json",
        size_bytes: 1024,
        last_modified: "2025-01-15T00:00:00.000Z",
        downloaded_at_utc: "2025-01-16T10:00:00.000Z",
      };
      const entry2: ManifestEntry = {
        source_key: "2025/01/15/001000.json",
        local_path: "/data/2025/01/15/001000.json",
        size_bytes: 2048,
        last_modified: "2025-01-15T00:10:00.000Z",
        downloaded_at_utc: "2025-01-16T10:01:00.000Z",
      };

      await appendManifest(path, entry1);
      await appendManifest(path, entry2);

      const content = await readFile(path, "utf-8");
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]!)).toEqual(entry1);
      expect(JSON.parse(lines[1]!)).toEqual(entry2);
    });
  });

  describe("createManifestEntry", () => {
    it("creates entry from S3 object info", () => {
      const object: S3ObjectInfo = {
        key: "2025/01/15/000000.json",
        size: 1024,
        lastModified: new Date("2025-01-15T00:00:00.000Z"),
        etag: "abc123",
      };

      const before = new Date();
      const entry = createManifestEntry(object, "/data/2025/01/15/000000.json");
      const after = new Date();

      expect(entry.source_key).toBe("2025/01/15/000000.json");
      expect(entry.local_path).toBe("/data/2025/01/15/000000.json");
      expect(entry.size_bytes).toBe(1024);
      expect(entry.last_modified).toBe("2025-01-15T00:00:00.000Z");

      const downloadedAt = new Date(entry.downloaded_at_utc);
      expect(downloadedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(downloadedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });
});
