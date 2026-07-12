/**
 * Decision-history store for M-of-N persistence (#1363).
 *
 * Anomaly alerting suppresses isolated benign blips by requiring an anomaly to
 * persist — ≥ M of the last N per-cycle decisions for a key must be anomalous
 * before it is confirmed. That needs a short rolling history of recent
 * decisions per key, shared across restarts and replicas (like the cooldown
 * store), so this is Redis-backed with an in-memory fallback. The fallback
 * applies at runtime too (#1496): a Redis drop degrades `record` to the
 * per-process in-memory history instead of rejecting — the M-of-N gate keeps
 * working (single-replica semantics) and the monitoring cycle survives. The
 * connection reconnects lazily with exponential backoff (`resilient-redis.ts`).
 */
import { getConfig } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';
import {
  ResilientRedisConnection,
  type RedisConnectionLike,
} from './resilient-redis.js';

const log = createChildLogger('persistence-store');

const KEY_PREFIX = 'anomaly:persist:';
/** History keys self-expire after this idle period. */
const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1h

export interface PersistenceStore {
  /**
   * Record a per-cycle decision for `key` (anomalous or not), keep only the
   * most recent `n`, and return how many of those `n` are anomalous (including
   * the one just recorded). The caller confirms when the count ≥ M.
   */
  record(key: string, anomalous: boolean, n: number): Promise<number>;
  /** Clear all history (test helper). */
  reset(): Promise<void>;
}

export class InMemoryPersistenceStore implements PersistenceStore {
  private readonly store = new Map<string, boolean[]>();

  async record(key: string, anomalous: boolean, n: number): Promise<number> {
    const history = [anomalous, ...(this.store.get(key) ?? [])].slice(0, Math.max(1, n));
    this.store.set(key, history);
    return history.filter(Boolean).length;
  }

  async reset(): Promise<void> {
    this.store.clear();
  }
}

/** Minimal slice of the `redis` list API this store needs. */
export interface RedisListLike {
  lPush(key: string, value: string): Promise<unknown>;
  lTrim(key: string, start: number, stop: number): Promise<unknown>;
  lRange(key: string, start: number, stop: number): Promise<string[]>;
  pExpire(key: string, ms: number): Promise<unknown>;
}

export class RedisPersistenceStore implements PersistenceStore {
  constructor(
    private readonly client: RedisListLike,
    private readonly ttlMs: number = DEFAULT_TTL_MS,
  ) {}

  async record(key: string, anomalous: boolean, n: number): Promise<number> {
    const k = KEY_PREFIX + key;
    const cap = Math.max(1, n);
    await this.client.lPush(k, anomalous ? '1' : '0');
    await this.client.lTrim(k, 0, cap - 1);
    await this.client.pExpire(k, this.ttlMs);
    const items = await this.client.lRange(k, 0, cap - 1);
    return items.filter((x) => x === '1').length;
  }

  async reset(): Promise<void> {
    // Keys self-expire via the PX TTL; tests use InMemoryPersistenceStore.
  }
}

/**
 * Resilient store (#1496): Redis-backed with graceful runtime degradation.
 * `record` fails safe — when Redis is down (or a command fails) the decision
 * is answered from a per-process in-memory shadow instead of rejecting, so
 * the anomaly gate (and with it the whole monitoring cycle) survives a Redis
 * outage. Decisions are shadowed in memory even while Redis is healthy, so
 * the rolling M-of-N window stays warm across a mid-stream Redis drop.
 */
export class ResilientPersistenceStore implements PersistenceStore {
  private readonly fallback = new InMemoryPersistenceStore();
  private redisStore: RedisPersistenceStore | null = null;
  private redisClient: object | null = null;

  constructor(
    private readonly conn: RedisConnectionLike,
    private readonly ttlMs: number = DEFAULT_TTL_MS,
  ) {}

  private async getRedisStore(): Promise<RedisPersistenceStore | null> {
    const client = await this.conn.getClient();
    if (!client) return null;
    if (client !== this.redisClient) {
      // Reconnection handed us a fresh client — rebind the Redis-backed store.
      this.redisClient = client;
      this.redisStore = new RedisPersistenceStore(client as RedisListLike, this.ttlMs);
    }
    return this.redisStore;
  }

  async record(key: string, anomalous: boolean, n: number): Promise<number> {
    // Always shadow the decision in memory so the rolling window is already
    // warm if Redis drops mid-stream.
    const fallbackCount = await this.fallback.record(key, anomalous, n);
    const redis = await this.getRedisStore();
    if (redis) {
      try {
        return await redis.record(key, anomalous, n);
      } catch (err) {
        this.conn.reportFailure('persistence-record-failed', err);
      }
    }
    return fallbackCount;
  }

  async reset(): Promise<void> {
    // Redis keys self-expire (see RedisPersistenceStore.reset); clear the shadow.
    await this.fallback.reset();
  }
}

// ── singleton ───────────────────────────────────────────────────────────────
let current: PersistenceStore = new InMemoryPersistenceStore();
let override: PersistenceStore | null = null;

/** Synchronous accessor — returns the active store (methods are async). */
export function getPersistenceStore(): PersistenceStore {
  return override ?? current;
}

/** Upgrade the singleton to Redis when configured. Call once at startup. */
export async function initPersistenceStore(): Promise<void> {
  current = await buildStore();
}

/** Test hook: force a specific store for isolation. */
export function setPersistenceStoreForTest(store: PersistenceStore | null): void {
  override = store;
}

function buildRedisUrl(baseUrl: string, password?: string): string {
  if (!password) return baseUrl;
  const parsed = new URL(baseUrl);
  parsed.password = password;
  return parsed.toString();
}

async function buildStore(): Promise<PersistenceStore> {
  const config = getConfig();
  if (!config.REDIS_URL) {
    log.info('persistence store: REDIS_URL unset, using in-memory (not replica-safe)');
    return new InMemoryPersistenceStore();
  }
  const url = buildRedisUrl(config.REDIS_URL, config.REDIS_PASSWORD);
  const conn = new ResilientRedisConnection(url, log, 'persistence store');
  // Eager first connect so startup logs reflect the actual state. Either way
  // the resilient store is returned: it reconnects with backoff if Redis is —
  // or later becomes — unavailable (#1496), degrading to in-memory meanwhile.
  const client = await conn.getClient();
  if (client) {
    log.info('persistence store: using Redis (shared across restarts and replicas)');
  } else {
    log.warn('persistence store: Redis unavailable at startup, starting on in-memory fallback (will keep retrying)');
  }
  return new ResilientPersistenceStore(conn);
}
