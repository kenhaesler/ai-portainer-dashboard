/**
 * Test helper — connects to real Redis for integration tests.
 * Flushes cache keys between tests for isolation.
 *
 * Gracefully degrades when Redis is unavailable (e.g. in CI without
 * service containers): all operations become no-ops so tests can still
 * run using the in-memory cache layer only.
 */
import { createClient } from 'redis';

type RedisClient = ReturnType<typeof createClient>;

const DEFAULT_REDIS_URL = 'redis://localhost:6379';
const CACHE_PREFIX = 'aidash:cache:';

/** Connection timeout in ms — fail fast when Redis is unreachable */
const CONNECT_TIMEOUT_MS = 2_000;

let client: RedisClient | null = null;
/** Once a connection attempt fails, skip all future attempts in this test run */
let redisUnavailable = false;

async function ensureClient(): Promise<RedisClient | null> {
  if (redisUnavailable) return null;
  if (client?.isOpen) return client;

  try {
    client = createClient({
      url: process.env.REDIS_URL ?? DEFAULT_REDIS_URL,
      socket: { connectTimeout: CONNECT_TIMEOUT_MS },
    });
    // Suppress unhandled error events (connection failures are caught below)
    client.on('error', () => {});
    await client.connect();
    return client;
  } catch {
    // Redis is not reachable — degrade gracefully for the rest of this run
    redisUnavailable = true;
    client = null;
    return null;
  }
}

/**
 * Flush all cache keys (aidash:cache:*) from Redis.
 * Call in beforeEach for test isolation.
 * No-op when Redis is unavailable.
 */
export async function flushTestCache(): Promise<void> {
  const c = await ensureClient();
  if (!c) return;
  try {
    const keys = await c.keys(`${CACHE_PREFIX}*`);
    if (keys.length > 0) {
      await c.del(keys);
    }
  } catch {
    // Redis went away mid-test — ignore
  }
}

/**
 * Returns a connected Redis client for direct assertions in tests,
 * or null when Redis is unavailable.
 */
export async function getTestRedisClient(): Promise<RedisClient | null> {
  return ensureClient();
}

/**
 * Disconnect Redis client. Call in afterAll.
 */
export async function closeTestRedis(): Promise<void> {
  if (client) {
    try {
      await client.quit();
    } catch {
      // Already disconnected — ignore
    }
    client = null;
  }
}
