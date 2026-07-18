import { createChildLogger } from '../utils/logger.js';
import { getConfig } from '../config/index.js';
import { createClient } from 'redis';
import { withSpan } from '../tracing/trace-context.js';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const COMPRESSION_THRESHOLD = 10_000; // 10 KB
// Entries become stale (eligible for SWR revalidation) at this fraction of
// their TTL and expire at 100%. Shared by L1 (TtlCache) and the L2 envelope.
const STALE_FRACTION = 0.8;

const log = createChildLogger('portainer-cache');
// ReturnType of the uninstantiated createClient signature resolves the RESP
// generic to its constraint (2 | 3), but redis v6 infers the literal default
// 3 at the call site and the client type is invariant in RESP — instantiate
// explicitly so the alias matches what createClient({ ... }) returns.
type RedisClient = ReturnType<typeof createClient<{}, {}, {}, 3, {}>>;

interface CacheEntry<T> {
  data: T;
  staleAt: number;
  expiresAt: number;
}

class TtlCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private hits = 0;
  private misses = 0;
  private readonly maxSize: number;

  constructor(maxSize = 5000) {
    this.maxSize = maxSize;
  }

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

  set<T>(key: string, data: T, ttlSeconds: number, staleFraction = STALE_FRACTION): void {
    this.setWithStaleAt(key, data, ttlSeconds, Date.now() + ttlSeconds * 1000 * staleFraction);
  }

  /**
   * Like set(), but with an explicit absolute staleAt timestamp (epoch ms).
   * Used when the freshness window is dictated by the L2 envelope rather
   * than the L1 TTL — staleAt may exceed expiresAt, in which case the entry
   * simply expires before it ever reports stale (#1499).
   */
  setWithStaleAt<T>(key: string, data: T, ttlSeconds: number, staleAtMs: number): void {
    this.store.set(key, {
      data,
      staleAt: staleAtMs,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
    // LRU eviction: remove oldest entries (by staleAt) when over maxSize
    if (this.store.size > this.maxSize) {
      this.evictOldest(this.store.size - this.maxSize);
    }
  }

  /**
   * Evict `count` entries with the earliest `staleAt` timestamps.
   *
   * Complexity is O(n log n) due to the full sort on each overflow. This is
   * acceptable while `maxSize` ≤ 5000 — at that scale the sort is sub-ms and
   * only runs when the cache is over its cap. If `maxSize` is raised
   * substantially (≥ ~50k) or eviction shows up in profiling, replace this
   * with a proper LRU (doubly-linked list + Map for O(1) eviction). See
   * issue #1116 for the cost/benefit analysis — at current scale the
   * algorithmic upgrade adds bug surface to a security-critical cache for
   * no measurable performance gain.
   */
  private evictOldest(count: number): void {
    const entries = [...this.store.entries()]
      .sort((a, b) => a[1].staleAt - b[1].staleAt);
    for (let i = 0; i < count && i < entries.length; i++) {
      this.store.delete(entries[i][0]);
    }
    log.debug({ evicted: count, remaining: this.store.size }, 'LRU eviction triggered');
  }

  /** Current number of entries in the cache */
  size(): number {
    return this.store.size;
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

/**
 * L2 (Redis) staleness envelope. Redis TTLs only bound expiry, so without
 * this envelope every L2 hit looked stale and forced a background origin
 * fetch (#1499). Values written by set() are wrapped; legacy bare-JSON
 * entries (pre-envelope deploys, setMany) unwrap as immediately stale.
 */
interface CacheEnvelope<T> {
  __swrEnvelope: 1;
  staleAt: number;
  data: T;
}

function isCacheEnvelope<T>(value: unknown): value is CacheEnvelope<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>).__swrEnvelope === 1 &&
    typeof (value as Record<string, unknown>).staleAt === 'number' &&
    'data' in value
  );
}

function unwrapEnvelope<T>(parsed: unknown): { data: T; staleAt: number } {
  if (isCacheEnvelope<T>(parsed)) {
    return { data: parsed.data, staleAt: parsed.staleAt };
  }
  // Legacy bare-JSON entry — treat as immediately stale so SWR revalidates it.
  return { data: parsed as T, staleAt: 0 };
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
    const client = createClient({
      url: redisUrl,
      socket: {
        connectTimeout: 3_000,
        reconnectStrategy: false,
      },
    });
    client.on('error', (err) => {
      this.disableRedisTemporarily('redis-client-error', err);
    });
    client.on('end', () => {
      this.disableRedisTemporarily('redis-client-closed');
    });
    this.redisClient = client;

    // Race the connect() against a short deadline so tests and environments
    // without Redis fail fast instead of hanging until vitest's hook timeout.
    const connectWithTimeout = Promise.race([
      client.connect(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Redis connect timeout (5s)')), 5_000),
      ),
    ]);

    this.redisConnectPromise = connectWithTimeout
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
    return client.keys(`${prefix}*`);
  }

  /**
   * Read a key from L2 (Redis), unwrap the staleness envelope, and repopulate
   * L1 as a short hot layer carrying the envelope's staleAt so SWR freshness
   * follows the caller's TTL rather than the L1 window (#1499). Legacy
   * bare-JSON entries are treated as immediately stale.
   */
  private async readL2<T>(key: string): Promise<{ data: T; staleAt: number } | undefined> {
    const client = await this.ensureRedisClient();
    if (!client) return undefined;
    try {
      // Check compressed key first, then plain key
      let raw: string | null;
      const gzB64 = await client.get(this.getRedisKey(key) + ':gz');
      if (gzB64 != null) {
        const decompressed = await gunzipAsync(Buffer.from(gzB64, 'base64'));
        raw = decompressed.toString('utf8');
      } else {
        raw = await client.get(this.getRedisKey(key));
      }
      // Successful Redis operation (miss is still success)
      this.resetRedisBackoff();
      if (raw == null) return undefined;

      const { data, staleAt } = unwrapEnvelope<T>(JSON.parse(raw));
      this.memory.setWithStaleAt(key, data, this.l1TtlSeconds, staleAt);
      return { data, staleAt };
    } catch (err) {
      this.disableRedisTemporarily('redis-get-failed', err);
      return undefined;
    }
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
      const result = await this.readL2<T>(key);
      if (result !== undefined) {
        this.hits++;
        return result.data;
      }
      this.misses++;
      return undefined;
    });
  }

  /**
   * Check L2 (Redis) with stale info for stale-while-revalidate. Returns the
   * unwrapped data plus whether the entry has passed its staleAt (#1499).
   * Legacy bare-JSON entries always report stale.
   */
  async getL2WithStaleInfo<T>(key: string): Promise<{ data: T; isStale: boolean } | undefined> {
    return withSpan('cache.get', 'redis-cache', 'internal', async () => {
      const result = await this.readL2<T>(key);
      if (result === undefined) {
        this.misses++;
        return undefined;
      }
      this.hits++;
      return { data: result.data, isStale: Date.now() > result.staleAt };
    });
  }

  async set<T>(key: string, data: T, ttlSeconds: number): Promise<void> {
    const staleAt = Date.now() + ttlSeconds * 1000 * STALE_FRACTION;
    if (!this.isRedisConfigured() || Date.now() < this.redisDisabledUntil) {
      // Memory-only mode (no Redis, or Redis in failure backoff): L1 is the
      // only copy, so honor the caller's full TTL — the 30s cap is only
      // meaningful as an L1-freshness bound when L2 exists (#1499).
      this.memory.set(key, data, ttlSeconds);
    } else {
      // L1 stays a short hot layer (uncompressed, instant reads), but carries
      // the full-TTL staleAt so SWR revalidation follows the preset (#1499).
      this.memory.setWithStaleAt(key, data, Math.min(ttlSeconds, this.l1TtlSeconds), staleAt);
    }

    // Write to L2 (Redis) with full TTL — wrapped in a staleness envelope,
    // compressed if above threshold (traced)
    await withSpan('cache.set', 'redis-cache', 'internal', async () => {
      const client = await this.ensureRedisClient();
      if (client) {
        try {
          const envelope: CacheEnvelope<T> = { __swrEnvelope: 1, staleAt, data };
          const json = JSON.stringify(envelope);
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
        // set() may store under either the plain key or the `:gz` compressed
        // variant, so invalidation must delete both — otherwise a stale
        // compressed entry survives invalidate-on-failure and re-poisons reads.
        const redisKey = this.getRedisKey(key);
        await client.del([redisKey, redisKey + ':gz']);
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
          // Entries written via set() carry a staleness envelope; unwrap it.
          return unwrapEnvelope<T>(JSON.parse(raw)).data;
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
  // Kubernetes resources
  K8S_PODS: 300,         // 5 minutes — pods change frequently
  K8S_DEPLOYMENTS: 300,  // 5 minutes
  K8S_SERVICES: 600,     // 10 minutes — services are relatively stable
  K8S_NAMESPACES: 900,   // 15 minutes — namespaces rarely change
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

/**
 * Tracks, per cache key, the wall-clock instant the underlying value was last
 * fetched fresh from its origin — as opposed to the (possibly much later)
 * instant it is read back out of cache. This is a side-channel independent of
 * the TtlCache/Redis staleness bookkeeping above; it exists purely so
 * time-sensitive consumers can evaluate a cached-but-still-valid payload
 * against the moment it was actually captured rather than the moment it
 * happens to be read.
 *
 * Concretely: `normalizeEndpoint`'s Edge heartbeat check computes
 * `elapsed = now - lastCheckIn`. The Portainer endpoints list is served from
 * this module's SWR/TTL cache (`TTL.ENDPOINTS` = 15 minutes), so a healthy
 * endpoint whose `LastCheckInDate` was fresh *when the snapshot was fetched*
 * gets judged against the current wall clock on every cache read and
 * incorrectly flips to `down` as the cached snapshot ages — the "All Hosts
 * Down" flapping in issue #1566. Callers that read endpoints through
 * `cachedFetch`/`cachedFetchSWR` should look up `getSnapshotTimestamp(key)`
 * and pass it as `normalizeEndpoint`'s `referenceTimeMs`.
 */
const originFetchTimestamps = new Map<string, number>();

/**
 * Record that `key` was just fetched fresh from its origin at `fetchedAt`.
 * A no-op for an undefined/failed fetch result — mirrors the "undefined
 * never populates the cache" guard (#1270) so a failed fetch can't poison
 * the timestamp for the next caller.
 */
function recordOriginFetchTimestamp(key: string, data: unknown, fetchedAt: number): void {
  if (data === undefined) return;
  originFetchTimestamps.set(key, fetchedAt);
}

/**
 * Look up when the value currently cached under `key` was actually fetched
 * from its origin, as opposed to when it is being read right now. Returns
 * `undefined` when untracked (caching disabled, the key was never populated
 * via `cachedFetch`/`cachedFetchSWR`, or nothing has been fetched yet) —
 * callers must treat `undefined` as "fetched now" and fall back to
 * `Date.now()`.
 */
export function getSnapshotTimestamp(key: string): number | undefined {
  return originFetchTimestamps.get(key);
}

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

  // Prevent Node.js unhandled rejection warning: the caller will handle
  // the rejection via .then()/.catch()/await, but the handler may not be
  // attached in the same microtask tick as the rejection.
  promise.catch(() => {});
  inFlight.set(key, promise);

  // Run the fetch in a self-contained async block.
  // All errors are caught and forwarded explicitly via reject(),
  // preventing unhandled promise rejections from crashing the process.
  // inFlight cleanup is in `finally` to avoid a dangling promise chain
  // (.finally() on the promise would create a second unhandled rejection).
  (async () => {
    try {
      const cached = await cache.get<T>(key);
      if (cached !== undefined) {
        resolve(cached);
        return;
      }
      const data = await fetcher();
      if (data !== undefined) {
        await cache.set(key, data, ttlSeconds);
      }
      recordOriginFetchTimestamp(key, data, Date.now());
      resolve(data);
    } catch (err) {
      // Invalidate stale cache entry on fetch failure so the next call
      // retries instead of returning a stale/undefined value (issue #1270).
      try {
        await cache.invalidate(key);
      } catch {
        // Best-effort invalidation — don't let it mask the real error
      }
      reject(err);
    } finally {
      inFlight.delete(key);
    }
  })();

  return promise;
}

/**
 * Kick off a background SWR revalidation and register it in the shared
 * `inFlight` map. The registered promise MUST resolve to the fetched data:
 * cachedFetch consults `inFlight` before any cache lookup and returns the
 * found promise as `Promise<T>`, so a void promise here made concurrent
 * cachedFetch callers resolve to `undefined` during every revalidation
 * window (#1495). On failure the cache entry is still invalidated (so the
 * next call retries), but the promise resolves to the stale value the
 * caller would otherwise have been served — never `undefined`, never a
 * rejection (no caller is guaranteed to be awaiting it).
 */
function startBackgroundRevalidation<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
  staleData: T,
  failureLogMessage: string,
): void {
  const revalidate: Promise<T> = (async () => {
    try {
      const data = await fetcher();
      if (data !== undefined) {
        await cache.set(key, data, ttlSeconds);
        recordOriginFetchTimestamp(key, data, Date.now());
        return data;
      }
      // Fetcher resolved undefined — keep the stale value for any awaiting
      // cachedFetch caller (the cache itself is left untouched, see #1270).
      return staleData;
    } catch (err) {
      // Invalidate on failure so the next call retries (#1270)…
      try {
        await cache.invalidate(key);
      } catch {
        // Best-effort
      }
      log.warn({ key, err }, failureLogMessage);
      // …but still hand awaiting callers the stale data (#1495).
      return staleData;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, revalidate);
  // Safety net: catch any error that escapes the inner try/catch (e.g. from finally)
  revalidate.catch((err) => {
    log.warn({ key, err }, 'SWR background revalidation unhandled error');
  });
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
    if (staleInfo.isStale && !inFlight.has(key)) {
      // Return stale data immediately, kick off background revalidation
      startBackgroundRevalidation(key, ttlSeconds, fetcher, staleInfo.data, 'SWR background revalidation failed');
    }
    return Promise.resolve(staleInfo.data);
  }

  // L1 missed — check L2 (Redis) for data before blocking on fetch
  return cache.getL2WithStaleInfo<T>(key).then((l2Info) => {
    if (l2Info !== undefined) {
      // Fresh L2 entries (within their envelope's staleAt) skip revalidation
      // entirely (#1499); stale ones are served immediately while a
      // background refetch runs.
      if (l2Info.isStale && !inFlight.has(key)) {
        startBackgroundRevalidation(key, ttlSeconds, fetcher, l2Info.data, 'SWR L2 background revalidation failed');
      }
      return l2Info.data;
    }

    // No data in L1 or L2 — blocking fetch
    return cachedFetch(key, ttlSeconds, fetcher);
  });
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

/** Wait for all in-flight cache promises to settle (for test isolation) */
export async function waitForInFlight(): Promise<void> {
  const pending = [...inFlight.values()];
  if (pending.length === 0) return;
  await Promise.allSettled(pending);
}
