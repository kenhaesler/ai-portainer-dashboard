import { beforeEach, describe, expect, it, vi } from 'vitest';

const baseConfig = {
  CACHE_ENABLED: true,
  REDIS_URL: undefined,
  REDIS_KEY_PREFIX: 'aidash:cache:',
};

function createMockRedisClient() {
  const store = new Map<string, string>();

  const mockPipeline = {
    set: vi.fn().mockReturnThis(),
    exec: vi.fn(async () => []),
  };

  return {
    isOpen: false,
    _store: store,
    connect: vi.fn(async function connect(this: { isOpen: boolean }) {
      this.isOpen = true;
    }),
    on: vi.fn(),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    mGet: vi.fn(async (keys: string[]) =>
      keys.map((k) => store.get(k) ?? null),
    ),
    multi: vi.fn(() => mockPipeline),
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
    await expect(cache.getStats()).resolves.toMatchObject({ backend: 'memory-only' });
  });

  it('uses multi-layer cache when Redis is configured', async () => {
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

    // First call: L1 miss → L2 miss → fetch → write L1 + L2
    await cachedFetch('containers:test', 30, fetcher);
    // Second call: L1 hit (populated from set) → skip L2
    await cachedFetch('containers:test', 30, fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledWith({ url: 'redis://redis:6379' });
    expect(redisClient.connect).toHaveBeenCalledTimes(1);
    expect(redisClient.set).toHaveBeenCalledTimes(1);
    // Only 1 Redis get (first call), second call hits L1
    expect(redisClient.get).toHaveBeenCalledTimes(1);
    await expect(cache.getStats()).resolves.toMatchObject({ backend: 'multi-layer' });
  });

  it('populates L1 on L2 hit', async () => {
    const redisClient = createMockRedisClient();

    vi.doMock('../config/index.js', () => ({
      getConfig: () => ({
        ...baseConfig,
        REDIS_URL: 'redis://redis:6379',
      }),
    }));
    vi.doMock('redis', () => ({
      createClient: vi.fn(() => redisClient),
    }));

    const { cache } = await import('./portainer-cache.js');

    // Manually set in Redis only (simulating L1 miss, L2 hit)
    const redisKey = 'aidash:cache:test-key';
    await redisClient.connect.call(redisClient);
    await redisClient.set(redisKey, JSON.stringify({ val: 42 }));

    // First get: L1 miss → L2 hit → populates L1
    const val1 = await cache.get('test-key');
    expect(val1).toEqual({ val: 42 });
    expect(redisClient.get).toHaveBeenCalledTimes(1);

    // Second get: L1 hit → skips Redis
    const val2 = await cache.get('test-key');
    expect(val2).toEqual({ val: 42 });
    // Redis.get should NOT have been called again
    expect(redisClient.get).toHaveBeenCalledTimes(1);
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
    await expect(cache.getStats()).resolves.toMatchObject({ backend: 'memory-only' });
  });

  it('invalidate clears from both layers', async () => {
    const redisClient = createMockRedisClient();

    vi.doMock('../config/index.js', () => ({
      getConfig: () => ({
        ...baseConfig,
        REDIS_URL: 'redis://redis:6379',
      }),
    }));
    vi.doMock('redis', () => ({
      createClient: vi.fn(() => redisClient),
    }));

    const { cachedFetch, cache } = await import('./portainer-cache.js');
    const fetcher = vi.fn().mockResolvedValue({ data: 1 });

    await cachedFetch('key1', 30, fetcher);
    await cache.invalidate('key1');

    // After invalidation, fetcher should be called again
    await cachedFetch('key1', 30, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(redisClient.del).toHaveBeenCalled();
  });
});

describe('stampede prevention', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('deduplicates concurrent fetches for the same key', async () => {
    vi.doMock('../config/index.js', () => ({
      getConfig: () => ({ ...baseConfig }),
    }));
    vi.doMock('redis', () => ({
      createClient: vi.fn(),
    }));

    const { cachedFetch, getInFlightCount } = await import('./portainer-cache.js');

    let resolveOuter!: (v: string) => void;
    const slowFetcher = vi.fn(() => new Promise<string>((r) => { resolveOuter = r; }));

    // Launch 3 concurrent requests for the same key
    const p1 = cachedFetch('slow:key', 30, slowFetcher);
    const p2 = cachedFetch('slow:key', 30, slowFetcher);
    const p3 = cachedFetch('slow:key', 30, slowFetcher);

    // Only one in-flight promise should exist
    expect(getInFlightCount()).toBe(1);

    // Yield to microtask queue so the IIFE progresses past cache.get() to call the fetcher
    await new Promise((r) => setTimeout(r, 0));
    expect(slowFetcher).toHaveBeenCalledTimes(1);

    resolveOuter('result');
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    expect(r1).toBe('result');
    expect(r2).toBe('result');
    expect(r3).toBe('result');
    expect(getInFlightCount()).toBe(0);
  });

  it('cleans up in-flight map after completion so next call re-fetches', async () => {
    vi.doMock('../config/index.js', () => ({
      getConfig: () => ({ ...baseConfig }),
    }));
    vi.doMock('redis', () => ({
      createClient: vi.fn(),
    }));

    const { cachedFetch, getInFlightCount } = await import('./portainer-cache.js');

    let resolveFirst!: (v: string) => void;
    const firstFetcher = vi.fn(() => new Promise<string>((r) => { resolveFirst = r; }));

    const p1 = cachedFetch('cleanup:key', 30, firstFetcher);
    expect(getInFlightCount()).toBe(1);

    // Let the IIFE progress to the fetcher
    await new Promise((r) => setTimeout(r, 0));
    resolveFirst('first');
    await p1;

    // After resolution, in-flight should be cleaned up
    await new Promise((r) => setTimeout(r, 0));
    expect(getInFlightCount()).toBe(0);

    // Second call with a new fetcher should invoke the fetcher (not reuse stale promise)
    const secondFetcher = vi.fn().mockResolvedValue('second');
    // Uses a different key to bypass cache hit on first value
    const result = await cachedFetch('cleanup:key2', 30, secondFetcher);
    expect(result).toBe('second');
    expect(secondFetcher).toHaveBeenCalledTimes(1);
  });

  it('does not deduplicate fetches for different keys', async () => {
    vi.doMock('../config/index.js', () => ({
      getConfig: () => ({ ...baseConfig }),
    }));
    vi.doMock('redis', () => ({
      createClient: vi.fn(),
    }));

    const { cachedFetch } = await import('./portainer-cache.js');
    const fetcher1 = vi.fn().mockResolvedValue('a');
    const fetcher2 = vi.fn().mockResolvedValue('b');

    const [r1, r2] = await Promise.all([
      cachedFetch('key:1', 30, fetcher1),
      cachedFetch('key:2', 30, fetcher2),
    ]);

    expect(r1).toBe('a');
    expect(r2).toBe('b');
    expect(fetcher1).toHaveBeenCalledTimes(1);
    expect(fetcher2).toHaveBeenCalledTimes(1);
  });
});

describe('cachedFetchMany', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('fetches multiple entries in parallel', async () => {
    vi.doMock('../config/index.js', () => ({
      getConfig: () => ({ ...baseConfig }),
    }));
    vi.doMock('redis', () => ({
      createClient: vi.fn(),
    }));

    const { cachedFetchMany } = await import('./portainer-cache.js');

    const results = await cachedFetchMany([
      { key: 'batch:a', ttlSeconds: 60, fetcher: () => Promise.resolve('alpha') },
      { key: 'batch:b', ttlSeconds: 60, fetcher: () => Promise.resolve('beta') },
      { key: 'batch:c', ttlSeconds: 60, fetcher: () => Promise.resolve('gamma') },
    ]);

    expect(results).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('skips cache when CACHE_ENABLED is false', async () => {
    vi.doMock('../config/index.js', () => ({
      getConfig: () => ({ ...baseConfig, CACHE_ENABLED: false }),
    }));
    vi.doMock('redis', () => ({
      createClient: vi.fn(),
    }));

    const { cachedFetchMany } = await import('./portainer-cache.js');
    const fetcher = vi.fn().mockResolvedValue('val');

    await cachedFetchMany([
      { key: 'x', ttlSeconds: 60, fetcher },
      { key: 'x', ttlSeconds: 60, fetcher },
    ]);

    // Both calls go through since cache is disabled
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe('batch operations (getMany / setMany)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('getMany returns cached values from memory', async () => {
    vi.doMock('../config/index.js', () => ({
      getConfig: () => ({ ...baseConfig }),
    }));
    vi.doMock('redis', () => ({
      createClient: vi.fn(),
    }));

    const { cache } = await import('./portainer-cache.js');

    await cache.set('k1', 'v1', 60);
    await cache.set('k2', 'v2', 60);

    const results = await cache.getMany<string>(['k1', 'k2', 'k3']);
    expect(results).toEqual(['v1', 'v2', undefined]);
  });

  it('setMany stores multiple entries in memory', async () => {
    vi.doMock('../config/index.js', () => ({
      getConfig: () => ({ ...baseConfig }),
    }));
    vi.doMock('redis', () => ({
      createClient: vi.fn(),
    }));

    const { cache } = await import('./portainer-cache.js');

    await cache.setMany([
      { key: 'batch:1', data: 100, ttlSeconds: 60 },
      { key: 'batch:2', data: 200, ttlSeconds: 60 },
    ]);

    expect(await cache.get<number>('batch:1')).toBe(100);
    expect(await cache.get<number>('batch:2')).toBe(200);
  });

  it('getMany uses Redis mGet when available', async () => {
    const redisClient = createMockRedisClient();
    redisClient._store.set('aidash:cache:r1', JSON.stringify('redis-v1'));

    vi.doMock('../config/index.js', () => ({
      getConfig: () => ({
        ...baseConfig,
        REDIS_URL: 'redis://redis:6379',
      }),
    }));
    vi.doMock('redis', () => ({
      createClient: vi.fn(() => redisClient),
    }));

    const { cache } = await import('./portainer-cache.js');
    const results = await cache.getMany<string>(['r1', 'r2']);

    expect(redisClient.mGet).toHaveBeenCalled();
    expect(results).toEqual(['redis-v1', undefined]);
  });

  it('setMany uses Redis pipeline when available', async () => {
    const execResults: unknown[] = [];
    const mockPipeline = {
      set: vi.fn().mockReturnThis(),
      exec: vi.fn(async () => execResults),
    };
    const redisClient = {
      ...createMockRedisClient(),
      multi: vi.fn(() => mockPipeline),
    };

    vi.doMock('../config/index.js', () => ({
      getConfig: () => ({
        ...baseConfig,
        REDIS_URL: 'redis://redis:6379',
      }),
    }));
    vi.doMock('redis', () => ({
      createClient: vi.fn(() => redisClient),
    }));

    const { cache } = await import('./portainer-cache.js');
    await cache.setMany([
      { key: 'p1', data: 'a', ttlSeconds: 60 },
      { key: 'p2', data: 'b', ttlSeconds: 120 },
    ]);

    expect(redisClient.multi).toHaveBeenCalledTimes(1);
    expect(mockPipeline.set).toHaveBeenCalledTimes(2);
    expect(mockPipeline.exec).toHaveBeenCalledTimes(1);
  });
});
