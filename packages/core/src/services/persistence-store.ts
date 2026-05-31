/**
 * Decision-history store for M-of-N persistence (#1363).
 *
 * Anomaly alerting suppresses isolated benign blips by requiring an anomaly to
 * persist — ≥ M of the last N per-cycle decisions for a key must be anomalous
 * before it is confirmed. That needs a short rolling history of recent
 * decisions per key, shared across restarts and replicas (like the cooldown
 * store), so this is Redis-backed with an in-memory fallback.
 */
import { getConfig } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';
import { createClient } from 'redis';

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
  try {
    const url = buildRedisUrl(config.REDIS_URL, config.REDIS_PASSWORD);
    const client = createClient({
      url,
      socket: { connectTimeout: 3_000, reconnectStrategy: false },
    });
    client.on('error', (err) => log.debug({ err }, 'persistence redis client error'));
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        client.connect(),
        new Promise((_, reject) => {
          timeoutHandle = setTimeout(
            () => reject(new Error('redis connect timeout (5s)')),
            5_000,
          );
        }),
      ]);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
    log.info('persistence store: using Redis (shared across restarts and replicas)');
    return new RedisPersistenceStore(client as unknown as RedisListLike);
  } catch (err) {
    log.warn({ err }, 'persistence store: Redis unavailable, falling back to in-memory');
    return new InMemoryPersistenceStore();
  }
}
