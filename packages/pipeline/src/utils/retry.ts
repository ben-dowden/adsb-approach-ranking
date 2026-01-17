/**
 * Retry utility with exponential backoff and jitter
 */

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterFactor: number;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitterFactor: 0.3,
};

/**
 * Check if an error is retryable (network/S3 transient errors)
 */
export function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const name = error.name;
  const message = error.message.toLowerCase();

  // AWS SDK retryable errors
  const retryableNames = [
    "TimeoutError",
    "ThrottlingException",
    "ServiceUnavailable",
    "InternalError",
    "RequestTimeout",
    "SlowDown",
    "ECONNRESET",
    "ETIMEDOUT",
    "ENOTFOUND",
    "ECONNREFUSED",
  ];

  if (retryableNames.some((n) => name.includes(n))) {
    return true;
  }

  // Check for 5xx status codes in message
  if (/5\d{2}/.test(message) || message.includes("internal server error")) {
    return true;
  }

  // Network-related errors
  if (
    message.includes("timeout") ||
    message.includes("throttl") ||
    message.includes("rate limit") ||
    message.includes("socket hang up") ||
    message.includes("connection reset")
  ) {
    return true;
  }

  return false;
}

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitterFactor: number
): number {
  // Exponential backoff: base * 2^attempt
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);

  // Cap at max delay
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);

  // Add jitter: delay * (1 - jitter/2 + random * jitter)
  const jitter = 1 - jitterFactor / 2 + Math.random() * jitterFactor;
  return Math.floor(cappedDelay * jitter);
}

/**
 * Execute a function with retry logic
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      const isLastAttempt = attempt === opts.maxAttempts - 1;
      const shouldRetry = !isLastAttempt && isRetryableError(error);

      if (!shouldRetry) {
        throw lastError;
      }

      const delay = calculateDelay(
        attempt,
        opts.baseDelayMs,
        opts.maxDelayMs,
        opts.jitterFactor
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError ?? new Error("Retry failed with no error captured");
}
