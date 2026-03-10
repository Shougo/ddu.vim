import type { DduItem } from "./types.ts";

type CacheEntry = {
  value: DduItem;
  ts: number;
};

export class ConverterCache {
  #map = new Map<string, CacheEntry>();
  #maxEntries: number;
  #ttl: number;
  #hits = 0;
  #misses = 0;
  #evicted = 0;

  constructor(maxEntries = 1000, ttl = 60000) {
    this.#maxEntries = maxEntries;
    this.#ttl = ttl;
  }

  get(key: string): DduItem | undefined {
    const entry = this.#map.get(key);
    if (!entry) {
      this.#misses++;
      return undefined;
    }
    // TTL eviction
    if (Date.now() - entry.ts >= this.#ttl) {
      this.#map.delete(key);
      this.#evicted++;
      this.#misses++;
      return undefined;
    }
    // LRU: refresh by re-inserting at the end
    this.#map.delete(key);
    this.#map.set(key, entry);
    this.#hits++;
    return entry.value;
  }

  set(key: string, value: DduItem): void {
    // Remove existing key to update its position in insertion order
    if (this.#map.has(key)) {
      this.#map.delete(key);
    }
    // LRU eviction: remove oldest entry when at capacity
    if (this.#map.size >= this.#maxEntries) {
      const oldestKey = this.#map.keys().next().value;
      if (oldestKey !== undefined) {
        this.#map.delete(oldestKey);
        this.#evicted++;
      }
    }
    this.#map.set(key, { value, ts: Date.now() });
  }

  clear(): void {
    this.#map.clear();
    this.#hits = 0;
    this.#misses = 0;
    this.#evicted = 0;
  }

  stats(): { size: number; hits: number; misses: number; evicted: number } {
    return {
      size: this.#map.size,
      hits: this.#hits,
      misses: this.#misses,
      evicted: this.#evicted,
    };
  }

  reconfigure(opts: { maxEntries?: number; ttl?: number }): void {
    if (opts.maxEntries !== undefined) {
      this.#maxEntries = opts.maxEntries;
      // Evict excess entries (oldest first)
      while (this.#map.size > this.#maxEntries) {
        const oldestKey = this.#map.keys().next().value;
        if (oldestKey !== undefined) {
          this.#map.delete(oldestKey);
          this.#evicted++;
        } else {
          break;
        }
      }
    }
    if (opts.ttl !== undefined) {
      this.#ttl = opts.ttl;
    }
  }
}

export const converterCache = new ConverterCache();
