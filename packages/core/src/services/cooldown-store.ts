/**
 * Shared cooldown / suppression store (#1361 fix 4).
 *
 * Anomaly detectors suppress duplicate alerts with per-key cooldowns and
 * per-service rate limits. These used to live in module-level `Map`s, which
 * meant (a) every process restart wiped them — re-firing every active anomaly
 * on the next cycle — and (b) each replica kept its own state, so cooldowns and
 * rate limits were NOT shared across replicas (N× duplicate alerts).
 *
 * This store keeps the exact timestamp-vs-window semantics but persists the
 * marks in Redis when `REDIS_URL` is configured, so the suppression state is
 * shared across restarts and replicas. When Redis is unavailable — at startup
 * OR at runtime (#1496) — operations degrade to an in-memory map
 * (single-process behaviour — same as before) instead of rejecting, so a
 * Redis blip can never abort the monitoring cycle. The connection reconnects
 * lazily with exponential backoff (see `resilient-redis.ts`).
 */
import { getConfig } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';
import {
  ResilientRedisConnection,
  type RedisConnectionLike,
} from './resilient-redis.js';

const log = createChildLogger('cooldown-store');

const KEY_PREFIX = 'anomaly:cooldown:';
/** Marks self-expire after this long so Redis does not accumulate dead keys. */
const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1h — longer than any cooldown window

export interface CooldownStore {
  /** True if `key` was marked within the last `windowMs`. `now` is injectable for tests. */
  isHot(key: string, windowMs: number, now?: number): Promise<boolean>;
  /** Record `key` as used at `now` (epoch ms). */
  mark(key: string, now?: number): Promise<void>;
  /** Remove entries older than `olderThanMs`; returns how many were removed. */
  sweep(olderThanMs: number, now?: number): Promise<number>;
  /** Clear all state (test helper). */
  reset(): Promise<void>;
}

export class InMemoryCooldownStore implements CooldownStore {
  private readonly store = new Map<string, number>();

  async isHot(key: string, windowMs: number, now: number = Date.now()): Promise<boolean> {
    if (windowMs <= 0) return false;
    const ts = this.store.get(key);
    return ts !== undefined && now - ts < windowMs;
  }

  async mark(key: string, now: number = Date.now()): Promise<void> {
    this.store.set(key, now);
  }

  async sweep(olderThanMs: number, now: number = Date.now()): Promise<number> {
    let swept = 0;
    for (const [key, ts] of this.store) {
      if (now - ts >= olderThanMs) {
        this.store.delete(key);
        swept++;
      }
    }
    return swept;
  }

  async reset(): Promise<void> {
    this.store.clear();
  }
}

/** Minimal slice of the `redis` client this store needs. */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts: { PX: number }): Promise<unknown>;
}

/**
 * Redis-backed store. NB: `isHot` then `mark` is intentionally check-then-act,
 * NOT atomic. The window is a READ-time parameter (the trace path checks the
 * same key against different windows — a 10-min per-dimension cooldown vs a
 * 5-min per-service rate limit), so it cannot be baked into a single
 * `SET key val NX PX=window` write. Two replicas racing the same key could each
 * miss-then-mark and both fire once; that is acceptable because cooldown is
 * best-effort de-duplication, not a mutual-exclusion lock, and it is no weaker
 * than the previous in-memory Maps (which were per-replica anyway).
 */
export class RedisCooldownStore implements CooldownStore {
  constructor(
    private readonly client: RedisLike,
    private readonly ttlMs: number = DEFAULT_TTL_MS,
  ) {}

  async isHot(key: string, windowMs: number, now: number = Date.now()): Promise<boolean> {
    if (windowMs <= 0) return false;
    const raw = await this.client.get(KEY_PREFIX + key);
    if (raw === null) return false;
    const ts = Number(raw);
    return Number.isFinite(ts) && now - ts < windowMs;
  }

  async mark(key: string, now: number = Date.now()): Promise<void> {
    await this.client.set(KEY_PREFIX + key, String(now), { PX: this.ttlMs });
  }

  async sweep(): Promise<number> {
    // Redis entries self-expire via the PX TTL set in mark(), so there is
    // nothing to sweep. Returning 0 keeps the CooldownStore contract.
    return 0;
  }

  async reset(): Promise<void> {
    // Keys self-expire via PX TTL; there is no cheap, safe bulk-delete that is
    // worth running in production. Tests use InMemoryCooldownStore.
  }
}

/**
 * Resilient store (#1496): Redis-backed with graceful runtime degradation.
 * Every operation fails open — when Redis is down (or a command fails) the
 * call falls back to a per-process in-memory shadow instead of rejecting, so
 * one Redis blip cannot permanently disable anomaly detection. Marks are
 * shadowed in memory even while Redis is healthy, so suppression state
 * survives a mid-stream Redis drop without a warm-up gap.
 */
export class ResilientCooldownStore implements CooldownStore {
  private readonly fallback = new InMemoryCooldownStore();
  private redisStore: RedisCooldownStore | null = null;
  private redisClient: object | null = null;

  constructor(
    private readonly conn: RedisConnectionLike,
    private readonly ttlMs: number = DEFAULT_TTL_MS,
  ) {}

  private async getRedisStore(): Promise<RedisCooldownStore | null> {
    const client = await this.conn.getClient();
    if (!client) return null;
    if (client !== this.redisClient) {
      // Reconnection handed us a fresh client — rebind the Redis-backed store.
      this.redisClient = client;
      this.redisStore = new RedisCooldownStore(client as RedisLike, this.ttlMs);
    }
    return this.redisStore;
  }

  async isHot(key: string, windowMs: number, now: number = Date.now()): Promise<boolean> {
    const redis = await this.getRedisStore();
    if (redis) {
      try {
        return await redis.isHot(key, windowMs, now);
      } catch (err) {
        this.conn.reportFailure('cooldown-isHot-failed', err);
      }
    }
    // Fail open: with Redis unreachable, answer from the in-memory shadow —
    // a duplicate alert is acceptable; a dead monitoring cycle is not.
    return this.fallback.isHot(key, windowMs, now);
  }

  async mark(key: string, now: number = Date.now()): Promise<void> {
    // Shadow every mark in memory first so cooldowns keep suppressing
    // (per-process) if Redis drops right after — or during — the write.
    await this.fallback.mark(key, now);
    const redis = await this.getRedisStore();
    if (redis) {
      try {
        await redis.mark(key, now);
      } catch (err) {
        this.conn.reportFailure('cooldown-mark-failed', err);
      }
    }
  }

  async sweep(olderThanMs: number, now: number = Date.now()): Promise<number> {
    // Redis entries self-expire via PX TTL; only the in-memory shadow needs sweeping.
    return this.fallback.sweep(olderThanMs, now);
  }

  async reset(): Promise<void> {
    // Redis keys self-expire (see RedisCooldownStore.reset); clear the shadow.
    await this.fallback.reset();
  }
}

// ── singleton ───────────────────────────────────────────────────────────────
// Defaults to in-memory (restart-safe within a process) so the store is usable
// without any async setup. `initCooldownStore()` upgrades it to Redis at server
// startup so suppression state is shared across restarts and replicas.
let current: CooldownStore = new InMemoryCooldownStore();
let override: CooldownStore | null = null;

/** Synchronous accessor — returns the active store (methods are still async). */
export function getCooldownStore(): CooldownStore {
  return override ?? current;
}

/** Upgrade the singleton to Redis when configured. Call once at startup. */
export async function initCooldownStore(): Promise<void> {
  current = await buildStore();
}

/** Test hook: force a specific store (e.g. a fresh InMemory) for isolation. */
export function setCooldownStoreForTest(store: CooldownStore | null): void {
  override = store;
}

function buildRedisUrl(baseUrl: string, password?: string): string {
  if (!password) return baseUrl;
  const parsed = new URL(baseUrl);
  parsed.password = password;
  return parsed.toString();
}

async function buildStore(): Promise<CooldownStore> {
  const config = getConfig();
  if (!config.REDIS_URL) {
    log.info('cooldown store: REDIS_URL unset, using in-memory (not replica-safe)');
    return new InMemoryCooldownStore();
  }
  const url = buildRedisUrl(config.REDIS_URL, config.REDIS_PASSWORD);
  const conn = new ResilientRedisConnection(url, log, 'cooldown store');
  // Eager first connect so startup logs reflect the actual state. Either way
  // the resilient store is returned: it reconnects with backoff if Redis is —
  // or later becomes — unavailable (#1496), degrading to in-memory meanwhile.
  const client = await conn.getClient();
  if (client) {
    log.info('cooldown store: using Redis (shared across restarts and replicas)');
  } else {
    log.warn('cooldown store: Redis unavailable at startup, starting on in-memory fallback (will keep retrying)');
  }
  return new ResilientCooldownStore(conn);
}
