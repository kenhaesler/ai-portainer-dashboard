import { createChildLogger } from '../utils/logger.js';
import { getConfig } from '../config/index.js';
import { createClient } from 'redis';
import { withSpan } from './trace-context.js';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const COMPRESSION_THRESHOLD = 10_000; // 10 KB

const log = createChildLogger('portainer-cache');
type RedisClient = ReturnType<typeof createClient>;

interface CacheEntry<T> {
  data: T;
  staleAt: number;
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

  getWithStaleInfo<T>(key: string): { data: T; isStale: boolean } | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    const now = Date.now();
    if (now > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return { data: entry.data as T, isStale: now > entry.staleAt };
  }

  set<T>(key: string, data: T, ttlSeconds: number, staleFraction = 0.8): void {
    const now = Date.now();
    this.store.set(key, {
      data,
      staleAt: now + ttlSeconds * 1000 * staleFraction,
      expiresAt: now + ttlSeconds * 1000,
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
  private readonly l1TtlSeconds = 30; // L1 TTL for instant access without Redis round-trip
  private hits = 0;
  private misses = 0;
  private compressedCount = 0;
  private bytesSaved = 0;
  private redisClient: RedisClient | null = null;
  private redisConnectPromise: Promise<void> | null = null;
  private redisDisabledUntil = 0;
  private redisFailureCount = 0;
  private static readonly BACKOFF_BASE_MS = 2_000;
  private static readonly BACKOFF_CAP_MS = 300_000; // 5 minutes

  /**
   * Check L1 (in-memory) cache with stale info — synchronous, no Redis round-trip.
   * Used by stale-while-revalidate to return stale data immediately.
   */
  getMemoryWithStaleInfo<T>(key: string): { data: T; isStale: boolean } | undefined {
    return this.memory.getWithStaleInfo<T>(key);
  }

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
    this.redisFailureCount++;
    const delayMs = Math.min(
      HybridCache.BACKOFF_BASE_MS * Math.pow(2, this.redisFailureCount - 1),
      HybridCache.BACKOFF_CAP_MS,
    );
    this.redisDisabledUntil = Date.now() + delayMs;
    if (err) {
      log.warn({ err, reason, attempt: this.redisFailureCount, backoffMs: delayMs }, 'Redis cache unavailable, using in-memory cache');
    } else {
      log.warn({ reason, attempt: this.redisFailureCount, backoffMs: delayMs }, 'Redis cache unavailable, using in-memory cache');
    }
  }

  private resetRedisBackoff(): void {
    if (this.redisFailureCount > 0) {
      log.info({ previousFailures: this.redisFailureCount }, 'Redis recovered, resetting backoff');
      this.redisFailureCount = 0;
      this.redisDisabledUntil = 0;
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
          // Check compressed key first, then plain key
          const gzKey = this.getRedisKey(key) + ':gz';
          const gzB64 = await client.get(gzKey);
          if (gzB64 != null) {
            const decompressed = await gunzipAsync(Buffer.from(gzB64, 'base64'));
            const parsed = JSON.parse(decompressed.toString('utf8')) as T;
            this.memory.set(key, parsed, this.l1TtlSeconds);
            this.hits++;
            this.resetRedisBackoff();
            return parsed;
          }

          const raw = await client.get(this.getRedisKey(key));
          if (raw != null) {
            const parsed = JSON.parse(raw) as T;
            this.memory.set(key, parsed, this.l1TtlSeconds);
            this.hits++;
            this.resetRedisBackoff();
            return parsed;
          }
          // Successful Redis operation (miss is still success)
          this.resetRedisBackoff();
        } catch (err) {
          this.disableRedisTemporarily('redis-get-failed', err);
        }
      }

      this.misses++;
      return undefined;
    });
  }

  async set<T>(key: string, data: T, ttlSeconds: number): Promise<void> {
    // Always write to L1 uncompressed (short TTL for instant reads)
    this.memory.set(key, data, Math.min(ttlSeconds, this.l1TtlSeconds));

    // Write to L2 (Redis) with full TTL — compress if above threshold (traced)
    await withSpan('cache.set', 'redis-cache', 'internal', async () => {
      const client = await this.ensureRedisClient();
      if (client) {
        try {
          const json = JSON.stringify(data);
          const jsonBytes = Buffer.byteLength(json, 'utf8');

          if (jsonBytes >= COMPRESSION_THRESHOLD) {
            const compressed = await gzipAsync(Buffer.from(json, 'utf8'));
            const saved = jsonBytes - compressed.length;
            this.compressedCount++;
            this.bytesSaved += saved;
            if (jsonBytes > 1_000_000) {
              log.warn({ key, originalSize: jsonBytes, compressedSize: compressed.length }, 'Cache entry exceeds 1 MB');
            }
            // Store compressed + delete any old uncompressed key
            const redisKey = this.getRedisKey(key);
            await client.set(redisKey + ':gz', compressed.toString('base64'), { EX: ttlSeconds });
            await client.del(redisKey);
          } else {
            // Store uncompressed + delete any old compressed key
            const redisKey = this.getRedisKey(key);
            await client.set(redisKey, json, { EX: ttlSeconds });
            await client.del(redisKey + ':gz');
          }
          this.resetRedisBackoff();
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
        this.resetRedisBackoff();
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
        this.resetRedisBackoff();
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

  /**
   * Store a cache entry with associated tags for surgical invalidation.
   * Tags are stored as Redis Sets mapping tag → keys.
   */
  async setWithTags<T>(key: string, data: T, ttlSeconds: number, tags: string[]): Promise<void> {
    await this.set(key, data, ttlSeconds);

    const client = await this.ensureRedisClient();
    if (client && tags.length > 0) {
      try {
        const redisKey = this.getRedisKey(key);
        const pipeline = client.multi();
        for (const tag of tags) {
          const tagKey = this.getRedisKey(`_tag:${tag}`);
          pipeline.sAdd(tagKey, redisKey);
          pipeline.expire(tagKey, ttlSeconds);
        }
        await pipeline.exec();
      } catch (err) {
        this.disableRedisTemporarily('redis-set-tags-failed', err);
      }
    }
  }

  /**
   * Invalidate all cache entries associated with a tag.
   * Deletes all member keys + the tag set itself.
   */
  async invalidateTag(tag: string): Promise<void> {
    // Invalidate L1 entries matching the tag pattern
    this.memory.invalidatePattern(tag);

    const client = await this.ensureRedisClient();
    if (client) {
      try {
        const tagKey = this.getRedisKey(`_tag:${tag}`);
        const members = await client.sMembers(tagKey);
        if (members.length > 0) {
          // Also delete compressed variants
          const allKeys = members.flatMap((k) => [k, `${k}:gz`]);
          await client.del([...allKeys, tagKey]);
        } else {
          await client.del(tagKey);
        }
      } catch (err) {
        this.disableRedisTemporarily('redis-invalidate-tag-failed', err);
      }
    }
  }

  private redisInfoCache: { data: Record<string, string | number>; fetchedAt: number } | null = null;
  private readonly redisInfoCacheTtlMs = 10_000; // 10s

  private async getRedisInfo(client: RedisClient): Promise<Record<string, string | number> | null> {
    const now = Date.now();
    if (this.redisInfoCache && now - this.redisInfoCache.fetchedAt < this.redisInfoCacheTtlMs) {
      return this.redisInfoCache.data;
    }
    try {
      const infoRaw = await client.info();
      const parsed: Record<string, string | number> = {};
      for (const line of infoRaw.split('\r\n')) {
        const idx = line.indexOf(':');
        if (idx > 0) {
          const k = line.slice(0, idx);
          const v = line.slice(idx + 1);
          parsed[k] = /^\d+$/.test(v) ? Number(v) : v;
        }
      }
      this.redisInfoCache = { data: parsed, fetchedAt: now };
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * Ping Redis to check connectivity. Returns true if Redis responds, false otherwise.
   * Returns false when Redis is not configured (memory-only mode).
   */
  async ping(): Promise<boolean> {
    if (!this.isRedisConfigured()) {
      return false;
    }
    try {
      const client = await this.ensureRedisClient();
      if (!client) return false;
      await client.ping();
      this.resetRedisBackoff();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the current backoff state for diagnostics and health checks.
   */
  getBackoffState(): { failureCount: number; disabledUntil: number; configured: boolean } {
    return {
      failureCount: this.redisFailureCount,
      disabledUntil: this.redisDisabledUntil,
      configured: this.isRedisConfigured(),
    };
  }

  async getStats() {
    const memoryStats = this.memory.getStats();
    const client = await this.ensureRedisClient();
    let l2Size = 0;
    let backend: 'multi-layer' | 'memory-only' = 'memory-only';
    let redis: {
      memoryUsedBytes: number;
      memoryMaxBytes: number;
      memoryUsagePct: string;
      evictedKeys: number;
      connectedClients: number;
      uptimeSeconds: number;
    } | null = null;

    if (client) {
      try {
        l2Size = (await this.redisKeys(client)).length;
        backend = 'multi-layer';

        const info = await this.getRedisInfo(client);
        if (info) {
          const usedMem = Number(info['used_memory']) || 0;
          const maxMem = Number(info['maxmemory']) || 0;
          redis = {
            memoryUsedBytes: usedMem,
            memoryMaxBytes: maxMem,
            memoryUsagePct: maxMem > 0 ? `${(usedMem / maxMem * 100).toFixed(1)}%` : 'unlimited',
            evictedKeys: Number(info['evicted_keys']) || 0,
            connectedClients: Number(info['connected_clients']) || 0,
            uptimeSeconds: Number(info['uptime_in_seconds']) || 0,
          };
        }
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
      compression: {
        compressedCount: this.compressedCount,
        bytesSaved: this.bytesSaved,
        threshold: COMPRESSION_THRESHOLD,
      },
      redis,
    };
  }
}

export const cache = new HybridCache();

// TTL presets
export const TTL = {
  ENDPOINTS: 900,    // 15 minutes
  CONTAINERS: 300,   // 5 minutes
  CONTAINER_INSPECT: 300, // 5 minutes — host config changes very infrequently
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
 * Stale-while-revalidate variant of cachedFetch.
 * Returns stale data immediately while kicking off a background refetch.
 * Falls back to a blocking fetch when no cached data exists.
 */
export function cachedFetchSWR<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const config = getConfig();
  if (!config.CACHE_ENABLED) {
    return fetcher();
  }

  // Check in-memory SWR data (synchronous — no Redis round-trip)
  const staleInfo = cache.getMemoryWithStaleInfo<T>(key);
  if (staleInfo) {
    if (staleInfo.isStale) {
      // Return stale data immediately, kick off background revalidation
      if (!inFlight.has(key)) {
        const revalidate = (async () => {
          try {
            const data = await fetcher();
            await cache.set(key, data, ttlSeconds);
          } catch (err) {
            log.warn({ key, err }, 'SWR background revalidation failed');
          }
        })();
        inFlight.set(key, revalidate);
        revalidate.finally(() => { inFlight.delete(key); });
      }
    }
    return Promise.resolve(staleInfo.data);
  }

  // No data at all — blocking fetch
  return cachedFetch(key, ttlSeconds, fetcher);
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
