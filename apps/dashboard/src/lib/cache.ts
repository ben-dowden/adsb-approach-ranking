/**
 * Simple LRU cache with TTL support
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const MAX_ENTRIES = 100;

/** Cache TTL in milliseconds */
export const CACHE_TTL = {
  SEQUENCES: 5 * 60 * 1000, // 5 minutes
  SEQUENCE: 5 * 60 * 1000, // 5 minutes
  STATES: 1 * 60 * 1000, // 1 minute
  TRAJECTORIES: 5 * 60 * 1000, // 5 minutes (static data)
} as const;

class LRUCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private maxEntries: number;

  constructor(maxEntries: number = MAX_ENTRIES) {
    this.maxEntries = maxEntries;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    // Move to end (most recently used) by re-inserting
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, ttlMs: number): void {
    // Delete if exists (to update position)
    this.cache.delete(key);

    // Evict oldest entries if at capacity
    while (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

// Singleton cache instance
export const cache = new LRUCache();
