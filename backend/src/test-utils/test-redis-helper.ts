/**
 * Test helper — connects to real Redis for integration tests.
 * Flushes cache keys between tests for isolation.
 */
import { createClient } from 'redis';

type RedisClient = ReturnType<typeof createClient>;

const DEFAULT_REDIS_URL = 'redis://localhost:6379';
const CACHE_PREFIX = 'aidash:cache:';

let client: RedisClient | null = null;

async function ensureClient(): Promise<RedisClient> {
  if (client?.isOpen) return client;
  client = createClient({ url: process.env.REDIS_URL ?? DEFAULT_REDIS_URL });
  await client.connect();
  return client;
}

/**
 * Flush all cache keys (aidash:cache:*) from Redis.
 * Call in beforeEach for test isolation.
 * Uses KEYS command instead of SCAN for reliability in test environments.
 */
export async function flushTestCache(): Promise<void> {
  const c = await ensureClient();
  const keys = await c.keys(`${CACHE_PREFIX}*`);
  if (keys.length > 0) {
    await c.del(keys);
  }
}

/**
 * Returns a connected Redis client for direct assertions in tests.
 */
export async function getTestRedisClient(): Promise<RedisClient> {
  return ensureClient();
}

/**
 * Disconnect Redis client. Call in afterAll.
 */
export async function closeTestRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}
