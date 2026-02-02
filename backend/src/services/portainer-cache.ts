import { createChildLogger } from '../utils/logger.js';
import { getConfig } from '../config/index.js';

const log = createChildLogger('portainer-cache');

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

class TtlCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private hits = 0;
  private misses = 0;

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.misses++;
      return undefined;
    }
    this.hits++;
    return entry.data as T;
  }

  set<T>(key: string, data: T, ttlSeconds: number): void {
    this.store.set(key, {
      data,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }

  invalidatePattern(pattern: string): void {
    for (const key of this.store.keys()) {
      if (key.includes(pattern)) {
        this.store.delete(key);
      }
    }
  }

  clear(): void {
    this.store.clear();
    log.info('Cache cleared');
  }

  getStats() {
    return {
      size: this.store.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits + this.misses > 0
        ? (this.hits / (this.hits + this.misses) * 100).toFixed(1) + '%'
        : 'N/A',
    };
  }
}

export const cache = new TtlCache();

// TTL presets
export const TTL = {
  ENDPOINTS: 900,    // 15 minutes
  CONTAINERS: 300,   // 5 minutes
  STACKS: 600,       // 10 minutes
  IMAGES: 600,       // 10 minutes
  NETWORKS: 600,     // 10 minutes
  STATS: 60,         // 1 minute
} as const;

export function getCacheKey(resource: string, ...args: (string | number)[]): string {
  return [resource, ...args].join(':');
}

export async function cachedFetch<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const config = getConfig();
  if (!config.CACHE_ENABLED) {
    return fetcher();
  }

  const cached = cache.get<T>(key);
  if (cached !== undefined) {
    return cached;
  }

  const data = await fetcher();
  cache.set(key, data, ttlSeconds);
  return data;
}
