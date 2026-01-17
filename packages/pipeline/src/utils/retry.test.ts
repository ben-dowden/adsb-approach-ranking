import { describe, it, expect, vi } from "vitest";
import { isRetryableError, withRetry } from "./retry.js";

describe("isRetryableError", () => {
  it("returns false for non-Error values", () => {
    expect(isRetryableError("string")).toBe(false);
    expect(isRetryableError(null)).toBe(false);
    expect(isRetryableError(undefined)).toBe(false);
    expect(isRetryableError(42)).toBe(false);
  });

  it("returns true for timeout errors", () => {
    const error = new Error("Request timeout");
    error.name = "TimeoutError";
    expect(isRetryableError(error)).toBe(true);
  });

  it("returns true for throttling errors", () => {
    const error = new Error("Rate exceeded");
    error.name = "ThrottlingException";
    expect(isRetryableError(error)).toBe(true);
  });

  it("returns true for 5xx errors in message", () => {
    expect(isRetryableError(new Error("HTTP 500 error"))).toBe(true);
    expect(isRetryableError(new Error("HTTP 503 Service Unavailable"))).toBe(
      true
    );
    expect(isRetryableError(new Error("internal server error"))).toBe(true);
  });

  it("returns true for network errors in message", () => {
    expect(isRetryableError(new Error("connection reset by peer"))).toBe(true);
    expect(isRetryableError(new Error("socket hang up"))).toBe(true);
    expect(isRetryableError(new Error("Request throttled"))).toBe(true);
  });

  it("returns true for network error names", () => {
    const econnreset = new Error("reset");
    econnreset.name = "ECONNRESET";
    expect(isRetryableError(econnreset)).toBe(true);

    const etimedout = new Error("timed out");
    etimedout.name = "ETIMEDOUT";
    expect(isRetryableError(etimedout)).toBe(true);
  });

  it("returns false for non-retryable errors", () => {
    expect(isRetryableError(new Error("Access Denied"))).toBe(false);
    expect(isRetryableError(new Error("NoSuchBucket"))).toBe(false);
    expect(isRetryableError(new Error("Invalid credentials"))).toBe(false);
  });
});

describe("withRetry", () => {
  it("returns result on first success", async () => {
    const fn = vi.fn().mockResolvedValue("success");

    const result = await withRetry(fn);

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on retryable errors", async () => {
    const error = new Error("timeout");
    error.name = "TimeoutError";
    const fn = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockRejectedValueOnce(error)
      .mockResolvedValue("success");

    const result = await withRetry(fn, { baseDelayMs: 1, maxDelayMs: 10 });

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws immediately on non-retryable errors", async () => {
    const error = new Error("Access Denied");
    const fn = vi.fn().mockRejectedValue(error);

    await expect(
      withRetry(fn, { baseDelayMs: 1, maxDelayMs: 10 })
    ).rejects.toThrow("Access Denied");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws after max attempts exceeded", async () => {
    const error = new Error("timeout");
    error.name = "TimeoutError";
    const fn = vi.fn().mockRejectedValue(error);

    await expect(
      withRetry(fn, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 10 })
    ).rejects.toThrow("timeout");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("converts non-Error to Error", async () => {
    const fn = vi.fn().mockRejectedValue("string error");

    await expect(
      withRetry(fn, { maxAttempts: 1, baseDelayMs: 1 })
    ).rejects.toThrow("string error");
  });
});
