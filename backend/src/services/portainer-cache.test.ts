import { beforeEach, describe, expect, it, vi } from 'vitest';

const baseConfig = {
  CACHE_ENABLED: true,
  REDIS_URL: undefined,
  REDIS_KEY_PREFIX: 'aidash:cache:',
};

function createMockRedisClient() {
  const store = new Map<string, string>();

  return {
    isOpen: false,
    connect: vi.fn(async function connect(this: { isOpen: boolean }) {
      this.isOpen = true;
    }),
    on: vi.fn(),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (keys: string | string[]) => {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const key of list) {
        store.delete(key);
      }
      return list.length;
    }),
    ttl: vi.fn(async () => 60),
    scanIterator: vi.fn(async function* scanIterator({ MATCH }: { MATCH: string }) {
      const prefix = MATCH.replace('*', '');
      for (const key of store.keys()) {
        if (key.startsWith(prefix)) {
          yield key;
        }
      }
    }),
  };
}

describe('portainer-cache hybrid backend', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('uses in-memory cache when Redis is not configured', async () => {
    vi.doMock('../config/index.js', () => ({
      getConfig: () => ({ ...baseConfig }),
    }));
    vi.doMock('redis', () => ({
      createClient: vi.fn(),
    }));

    const { cachedFetch, cache } = await import('./portainer-cache.js');
    const fetcher = vi.fn().mockResolvedValue({ ok: true });

    await cachedFetch('containers:test', 30, fetcher);
    await cachedFetch('containers:test', 30, fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(cache.getStats()).resolves.toMatchObject({ backend: 'memory' });
  });

  it('uses Redis cache when configured and available', async () => {
    const redisClient = createMockRedisClient();
    const createClient = vi.fn(() => redisClient);

    vi.doMock('../config/index.js', () => ({
      getConfig: () => ({
        ...baseConfig,
        REDIS_URL: 'redis://redis:6379',
      }),
    }));
    vi.doMock('redis', () => ({
      createClient,
    }));

    const { cachedFetch, cache } = await import('./portainer-cache.js');
    const fetcher = vi.fn().mockResolvedValue({ ok: true });

    await cachedFetch('containers:test', 30, fetcher);
    await cachedFetch('containers:test', 30, fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledWith({ url: 'redis://redis:6379' });
    expect(redisClient.connect).toHaveBeenCalledTimes(1);
    expect(redisClient.set).toHaveBeenCalledTimes(1);
    expect(redisClient.get).toHaveBeenCalledTimes(2);
    await expect(cache.getStats()).resolves.toMatchObject({ backend: 'redis' });
  });

  it('falls back to memory cache when Redis connection fails', async () => {
    const failingRedisClient = {
      ...createMockRedisClient(),
      connect: vi.fn(async () => {
        throw new Error('connect failed');
      }),
    };

    vi.doMock('../config/index.js', () => ({
      getConfig: () => ({
        ...baseConfig,
        REDIS_URL: 'redis://redis:6379',
      }),
    }));
    vi.doMock('redis', () => ({
      createClient: vi.fn(() => failingRedisClient),
    }));

    const { cachedFetch, cache } = await import('./portainer-cache.js');
    const fetcher = vi.fn().mockResolvedValue({ ok: true });

    await cachedFetch('containers:test', 30, fetcher);
    await cachedFetch('containers:test', 30, fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(cache.getStats()).resolves.toMatchObject({ backend: 'memory' });
  });
});
