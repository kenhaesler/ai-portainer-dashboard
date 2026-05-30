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
 * shared across restarts and replicas. When Redis is unavailable it falls back
 * to an in-memory map (single-process behaviour — same as before).
 */
import { getConfig } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';
import { createClient } from 'redis';

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
  try {
    const url = buildRedisUrl(config.REDIS_URL, config.REDIS_PASSWORD);
    const client = createClient({
      url,
      socket: { connectTimeout: 3_000, reconnectStrategy: false },
    });
    client.on('error', (err) => log.debug({ err }, 'cooldown redis client error'));
    await Promise.race([
      client.connect(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('redis connect timeout (5s)')), 5_000),
      ),
    ]);
    log.info('cooldown store: using Redis (shared across restarts and replicas)');
    return new RedisCooldownStore(client as unknown as RedisLike);
  } catch (err) {
    log.warn({ err }, 'cooldown store: Redis unavailable, falling back to in-memory');
    return new InMemoryCooldownStore();
  }
}
