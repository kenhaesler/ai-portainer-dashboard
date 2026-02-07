import { createChildLogger } from '../utils/logger.js';
import { getConfig } from '../config/index.js';
import { createClient } from 'redis';
import { withSpan } from './trace-context.js';

const log = createChildLogger('portainer-cache');
type RedisClient = ReturnType<typeof createClient>;

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

  getEntries(): Array<{ key: string; expiresIn: number }> {
    const now = Date.now();
    const entries: Array<{ key: string; expiresIn: number }> = [];
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
        continue;
      }
      entries.push({ key, expiresIn: Math.round((entry.expiresAt - now) / 1000) });
    }
    return entries;
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

class HybridCache {
  private memory = new TtlCache();
  private readonly l1TtlSeconds = 5; // Short L1 TTL for instant access
  private hits = 0;
  private misses = 0;
  private redisClient: RedisClient | null = null;
  private redisConnectPromise: Promise<void> | null = null;
  private redisDisabledUntil = 0;
  private readonly redisRetryMs = 30_000;

  private getRedisKey(key: string): string {
    const config = getConfig();
    const prefix = config.REDIS_KEY_PREFIX || 'aidash:cache:';
    return `${prefix}${key}`;
  }

  private isRedisConfigured(): boolean {
    const config = getConfig();
    return Boolean(config.REDIS_URL);
  }

  /**
   * Build the Redis connection URL, injecting the password when configured.
   * Supports both cases: REDIS_URL already contains a password, or REDIS_PASSWORD
   * is set separately. The separate REDIS_PASSWORD takes precedence.
   */
  private buildRedisUrl(baseUrl: string, password?: string): string {
    if (!password) return baseUrl;
    const parsed = new URL(baseUrl);
    parsed.password = password;
    return parsed.toString();
  }

  private disableRedisTemporarily(reason: string, err?: unknown): void {
    this.redisDisabledUntil = Date.now() + this.redisRetryMs;
    if (err) {
      log.warn({ err, reason }, 'Redis cache unavailable, using in-memory cache');
    } else {
      log.warn({ reason }, 'Redis cache unavailable, using in-memory cache');
    }
  }

  private async ensureRedisClient(): Promise<RedisClient | null> {
    if (!this.isRedisConfigured()) {
      return null;
    }
    if (Date.now() < this.redisDisabledUntil) {
      return null;
    }
    if (this.redisClient?.isOpen) {
      return this.redisClient;
    }
    if (this.redisConnectPromise) {
      await this.redisConnectPromise;
      return this.redisClient?.isOpen ? this.redisClient : null;
    }

    const config = getConfig();
    const redisUrl = this.buildRedisUrl(config.REDIS_URL!, config.REDIS_PASSWORD);
    const client = createClient({ url: redisUrl });
    client.on('error', (err) => {
      this.disableRedisTemporarily('redis-client-error', err);
    });
    client.on('end', () => {
      this.disableRedisTemporarily('redis-client-closed');
    });
    this.redisClient = client;
    this.redisConnectPromise = client.connect()
      .then(() => {
        const safeUrl = new URL(redisUrl);
        if (safeUrl.password) safeUrl.password = '***';
        log.info({ redisUrl: safeUrl.toString() }, 'Redis cache connected');
      })
      .catch((err) => {
        this.disableRedisTemporarily('redis-connect-failed', err);
      })
      .finally(() => {
        this.redisConnectPromise = null;
      });

    await this.redisConnectPromise;
    return this.redisClient?.isOpen ? this.redisClient : null;
  }

  private async redisKeys(client: RedisClient): Promise<string[]> {
    const config = getConfig();
    const prefix = config.REDIS_KEY_PREFIX || 'aidash:cache:';
    const keys: string[] = [];
    for await (const key of client.scanIterator({ MATCH: `${prefix}*`, COUNT: 250 })) {
      const normalized = Array.isArray(key) ? key[0] : key;
      keys.push(String(normalized));
    }
    return keys;
  }

  async get<T>(key: string): Promise<T | undefined> {
    // L1: Check in-memory cache first (instant, no network)
    const l1Value = this.memory.get<T>(key);
    if (l1Value !== undefined) {
      this.hits++;
      return l1Value;
    }

    // L2: Check Redis (traced)
    return withSpan('cache.get', 'redis-cache', 'internal', async () => {
      const client = await this.ensureRedisClient();
      if (client) {
        try {
          const raw = await client.get(this.getRedisKey(key));
          if (raw != null) {
            const parsed = JSON.parse(raw) as T;
            // Populate L1 on L2 hit for subsequent instant access
            this.memory.set(key, parsed, this.l1TtlSeconds);
            this.hits++;
            return parsed;
          }
        } catch (err) {
          this.disableRedisTemporarily('redis-get-failed', err);
        }
      }

      this.misses++;
      return undefined;
    });
  }

  async set<T>(key: string, data: T, ttlSeconds: number): Promise<void> {
    // Always write to L1 (short TTL for instant reads)
    this.memory.set(key, data, Math.min(ttlSeconds, this.l1TtlSeconds));

    // Write to L2 (Redis) with full TTL (traced)
    await withSpan('cache.set', 'redis-cache', 'internal', async () => {
      const client = await this.ensureRedisClient();
      if (client) {
        try {
          await client.set(this.getRedisKey(key), JSON.stringify(data), { EX: ttlSeconds });
        } catch (err) {
          this.disableRedisTemporarily('redis-set-failed', err);
        }
      }
    });
  }

  async invalidate(key: string): Promise<void> {
    // Clear from both layers
    this.memory.invalidate(key);

    const client = await this.ensureRedisClient();
    if (client) {
      try {
        await client.del(this.getRedisKey(key));
      } catch (err) {
        this.disableRedisTemporarily('redis-invalidate-failed', err);
      }
    }
  }

  async invalidatePattern(pattern: string): Promise<void> {
    // Clear from both layers
    this.memory.invalidatePattern(pattern);

    const client = await this.ensureRedisClient();
    if (client) {
      try {
        const keys = await this.redisKeys(client);
        const matched = keys.filter((key) => key.includes(pattern));
        if (matched.length > 0) {
          await client.del(matched);
        }
      } catch (err) {
        this.disableRedisTemporarily('redis-invalidate-pattern-failed', err);
      }
    }
  }

  async getEntries(): Promise<Array<{ key: string; expiresIn: number }>> {
    const client = await this.ensureRedisClient();
    if (client) {
      try {
        const keys = await this.redisKeys(client);
        const config = getConfig();
        const prefix = config.REDIS_KEY_PREFIX || 'aidash:cache:';
        const entries: Array<{ key: string; expiresIn: number }> = [];
        for (const redisKey of keys) {
          const ttl = await client.ttl(redisKey);
          entries.push({
            key: redisKey.replace(prefix, ''),
            expiresIn: ttl > 0 ? ttl : 0,
          });
        }
        return entries;
      } catch (err) {
        this.disableRedisTemporarily('redis-get-entries-failed', err);
      }
    }

    return this.memory.getEntries();
  }

  async clear(): Promise<void> {
    // Clear both layers
    this.memory.clear();

    const client = await this.ensureRedisClient();
    if (client) {
      try {
        const keys = await this.redisKeys(client);
        if (keys.length > 0) {
          await client.del(keys);
        }
        log.info('Cache cleared (all layers)');
      } catch (err) {
        this.disableRedisTemporarily('redis-clear-failed', err);
      }
    }
  }

  /**
   * Batch get: fetches multiple keys in a single Redis pipeline round-trip.
   * Falls back to sequential in-memory gets when Redis is unavailable.
   */
  async getMany<T>(keys: string[]): Promise<Array<T | undefined>> {
    if (keys.length === 0) return [];

    const client = await this.ensureRedisClient();
    if (client) {
      try {
        const redisKeys = keys.map((k) => this.getRedisKey(k));
        const results = await client.mGet(redisKeys);
        return results.map((raw) => {
          if (raw == null) {
            this.misses++;
            return undefined;
          }
          this.hits++;
          return JSON.parse(raw) as T;
        });
      } catch (err) {
        this.disableRedisTemporarily('redis-mget-failed', err);
      }
    }

    return keys.map((key) => {
      const value = this.memory.get<T>(key);
      if (value === undefined) {
        this.misses++;
        return undefined;
      }
      this.hits++;
      return value;
    });
  }

  /**
   * Batch set: stores multiple key-value pairs using Redis pipeline.
   * Falls back to sequential in-memory sets when Redis is unavailable.
   */
  async setMany<T>(entries: Array<{ key: string; data: T; ttlSeconds: number }>): Promise<void> {
    if (entries.length === 0) return;

    const client = await this.ensureRedisClient();
    if (client) {
      try {
        const pipeline = client.multi();
        for (const entry of entries) {
          pipeline.set(this.getRedisKey(entry.key), JSON.stringify(entry.data), { EX: entry.ttlSeconds });
        }
        await pipeline.exec();
        return;
      } catch (err) {
        this.disableRedisTemporarily('redis-mset-failed', err);
      }
    }

    for (const entry of entries) {
      this.memory.set(entry.key, entry.data, entry.ttlSeconds);
    }
  }

  async getStats() {
    const memoryStats = this.memory.getStats();
    const client = await this.ensureRedisClient();
    let l2Size = 0;
    let backend: 'multi-layer' | 'memory-only' = 'memory-only';

    if (client) {
      try {
        l2Size = (await this.redisKeys(client)).length;
        backend = 'multi-layer';
      } catch (err) {
        this.disableRedisTemporarily('redis-stats-failed', err);
      }
    }

    return {
      size: backend === 'multi-layer' ? l2Size : memoryStats.size,
      l1Size: memoryStats.size,
      l2Size,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits + this.misses > 0
        ? `${(this.hits / (this.hits + this.misses) * 100).toFixed(1)}%`
        : 'N/A',
      backend,
    };
  }
}

export const cache = new HybridCache();

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

/**
 * In-flight promise map for stampede prevention.
 * When multiple callers request the same key simultaneously,
 * only one fetcher runs and the rest share its promise.
 */
const inFlight = new Map<string, Promise<unknown>>();

export function cachedFetch<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const config = getConfig();
  if (!config.CACHE_ENABLED) {
    return fetcher();
  }

  // Stampede prevention: check in-flight BEFORE async cache lookup
  // so that synchronous concurrent calls share the same promise.
  const existing = inFlight.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  // Use explicit resolve/reject to share a single promise across callers
  // while preventing unhandled rejections when no caller is awaiting.
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  inFlight.set(key, promise);
  promise.finally(() => {
    inFlight.delete(key);
  });

  // Run the fetch in a self-contained async block.
  // All errors are caught and forwarded explicitly via reject(),
  // preventing unhandled promise rejections from crashing the process.
  (async () => {
    try {
      const cached = await cache.get<T>(key);
      if (cached !== undefined) {
        resolve(cached);
        return;
      }
      const data = await fetcher();
      await cache.set(key, data, ttlSeconds);
      resolve(data);
    } catch (err) {
      reject(err);
    }
  })();

  return promise;
}

/**
 * Batch fetch multiple keys in a single round-trip.
 * Uses Redis pipeline when available, falls back to parallel in-memory gets.
 */
export async function cachedFetchMany<T>(
  entries: Array<{ key: string; ttlSeconds: number; fetcher: () => Promise<T> }>,
): Promise<T[]> {
  const config = getConfig();
  if (!config.CACHE_ENABLED) {
    return Promise.all(entries.map((e) => e.fetcher()));
  }
  return Promise.all(entries.map((e) => cachedFetch(e.key, e.ttlSeconds, e.fetcher)));
}

/** Expose inFlight map size for testing/monitoring */
export function getInFlightCount(): number {
  return inFlight.size;
}
