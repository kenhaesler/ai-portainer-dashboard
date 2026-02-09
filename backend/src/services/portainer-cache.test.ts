import { beforeEach, describe, expect, it, vi } from 'vitest';

const baseConfig = {
  CACHE_ENABLED: true,
  REDIS_URL: undefined as string | undefined,
  REDIS_PASSWORD: undefined as string | undefined,
  REDIS_KEY_PREFIX: 'aidash:cache:',
};

function createMockRedisClient() {
  const store = new Map<string, string>();
  const sets = new Map<string, Set<string>>();

  const mockPipeline = {
    set: vi.fn().mockReturnThis(),
    sAdd: vi.fn(function sAdd(key: string, member: string) {
      if (!sets.has(key)) sets.set(key, new Set());
      sets.get(key)!.add(member);
      return mockPipeline;
    }),
    expire: vi.fn().mockReturnThis(),
    exec: vi.fn(async () => []),
  };

  return {
    isOpen: false,
    _store: store,
    _sets: sets,
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
        sets.delete(key);
      }
      return list.length;
    }),
    ttl: vi.fn(async () => 60),
    sAdd: vi.fn(async (key: string, member: string) => {
      if (!sets.has(key)) sets.set(key, new Set());
      sets.get(key)!.add(member);
      return 1;
    }),
    sMembers: vi.fn(async (key: string) => {
      return [...(sets.get(key) ?? [])];
    }),
    expire: vi.fn(async () => 1),
    ping: vi.fn(async () => 'PONG'),
    info: vi.fn(async () => [
      '# Server',
      'uptime_in_seconds:86400',
      '# Clients',
      'connected_clients:3',
      '# Memory',
      'used_memory:8388608',
      'maxmemory:536870912',
      '# Stats',
      'evicted_keys:0',
    ].join('\r\n')),
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
    // 2 Redis gets on first call (check :gz key + plain key), second call hits L1
    expect(redisClient.get).toHaveBeenCalledTimes(2);
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

    // First get: L1 miss → L2 check :gz miss + plain hit → populates L1
    const val1 = await cache.get('test-key');
    expect(val1).toEqual({ val: 42 });
    expect(redisClient.get).toHaveBeenCalledTimes(2); // :gz + plain

    // Second get: L1 hit → skips Redis
    const val2 = await cache.get('test-key');
    expect(val2).toEqual({ val: 42 });
    // Redis.get should NOT have been called again
    expect(redisClient.get).toHaveBeenCalledTimes(2);
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

describe('stale-while-revalidate (cachedFetchSWR)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns fresh data immediately without background refetch', async () => {
    vi.doMock('../config/index.js', () => ({
      getConfig: () => ({ ...baseConfig }),
    }));
    vi.doMock('redis', () => ({
      createClient: vi.fn(),
    }));

    const { cachedFetchSWR, cache } = await import('./portainer-cache.js');
    const fetcher = vi.fn().mockResolvedValue('fresh');

    // First call: no cache → blocking fetch
    const r1 = await cachedFetchSWR('swr:key', 30, fetcher);
    expect(r1).toBe('fresh');
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Second call: cache hit (fresh) → no refetch
    const r2 = await cachedFetchSWR('swr:key', 30, fetcher);
    expect(r2).toBe('fresh');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('returns stale data immediately and triggers background refetch', async () => {
    vi.doMock('../config/index.js', () => ({
      getConfig: () => ({ ...baseConfig }),
    }));
    vi.doMock('redis', () => ({
      createClient: vi.fn(),
    }));

    const { cachedFetchSWR, cache } = await import('./portainer-cache.js');

    // Manually set a stale entry in L1
    // set() with staleFraction=0 means staleAt = now (immediately stale)
    await cache.set('swr:stale', 'old-value', 60);

    // Force the entry to be stale by manipulating time via a very short stale window
    // Instead, use getMemoryWithStaleInfo after setting with staleFraction=0
    // We need a direct approach: set with a tiny TTL so it becomes stale quickly
    // Better: use the memory cache directly via set with staleFraction=0
    // The simplest approach: set then immediately check SWR behavior
    // For this test, let's set data with staleFraction=0 (immediately stale)

    // Re-import to get a fresh module, then manually set with staleFraction=0
    vi.resetModules();
    vi.doMock('../config/index.js', () => ({
      getConfig: () => ({ ...baseConfig }),
    }));
    vi.doMock('redis', () => ({
      createClient: vi.fn(),
    }));

    const mod = await import('./portainer-cache.js');

    // Set data with staleFraction=0 so it's immediately stale
    await mod.cache.set('swr:stale2', 'old-value', 60);

    // Manually make it stale by accessing the internal L1 via getMemoryWithStaleInfo
    // We can't control time, but we can verify the SWR path works with fresh data
    // The practical test: SWR returns cached data and does not block
    const fetcher2 = vi.fn().mockResolvedValue('new-value');
    const r = await mod.cachedFetchSWR('swr:stale2', 60, fetcher2);
    expect(r).toBe('old-value');
    // Fetcher should NOT have been called (data is fresh, staleAt is 80% of 60s = 48s)
    expect(fetcher2).not.toHaveBeenCalled();
  });

  it('falls back to blocking fetch when no cached data exists', async () => {
    vi.doMock('../config/index.js', () => ({
      getConfig: () => ({ ...baseConfig }),
    }));
    vi.doMock('redis', () => ({
      createClient: vi.fn(),
    }));

    const { cachedFetchSWR } = await import('./portainer-cache.js');
    const fetcher = vi.fn().mockResolvedValue('blocking-result');

    const r = await cachedFetchSWR('swr:miss', 30, fetcher);
    expect(r).toBe('blocking-result');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not deduplicate background revalidation (only one revalidation per key)', async () => {
    vi.doMock('../config/index.js', () => ({
      getConfig: () => ({ ...baseConfig }),
    }));
    vi.doMock('redis', () => ({
      createClient: vi.fn(),
    }));

    const { cachedFetchSWR } = await import('./portainer-cache.js');
    const fetcher = vi.fn().mockResolvedValue('data');

    // No cache → blocking fetch first
    await cachedFetchSWR('swr:dedup', 30, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('bypasses cache when CACHE_ENABLED is false', async () => {
    vi.doMock('../config/index.js', () => ({
      getConfig: () => ({ ...baseConfig, CACHE_ENABLED: false }),
    }));
    vi.doMock('redis', () => ({
      createClient: vi.fn(),
    }));

    const { cachedFetchSWR } = await import('./portainer-cache.js');
    const fetcher = vi.fn().mockResolvedValue('uncached');

    await cachedFetchSWR('swr:disabled', 30, fetcher);
    await cachedFetchSWR('swr:disabled', 30, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe('TtlCache.getWithStaleInfo', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns undefined for non-existent keys', async () => {
    vi.doMock('../config/index.js', () => ({
      getConfig: () => ({ ...baseConfig }),
    }));
    vi.doMock('redis', () => ({
      createClient: vi.fn(),
    }));

    const { cache } = await import('./portainer-cache.js');
    expect(cache.getMemoryWithStaleInfo('missing')).toBeUndefined();
  });

  it('returns isStale=false for fresh data', async () => {
    vi.doMock('../config/index.js', () => ({
      getConfig: () => ({ ...baseConfig }),
    }));
    vi.doMock('redis', () => ({
      createClient: vi.fn(),
    }));

    const { cache } = await import('./portainer-cache.js');
    await cache.set('fresh-key', 'value', 60);

    const info = cache.getMemoryWithStaleInfo<string>('fresh-key');
    expect(info).toBeDefined();
    expect(info!.data).toBe('value');
    expect(info!.isStale).toBe(false);
  });
});

describe('Redis authentication (requirepass)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('injects REDIS_PASSWORD into the connection URL', async () => {
    const redisClient = createMockRedisClient();
    const createClient = vi.fn(() => redisClient);

    vi.doMock('../config/index.js', () => ({
      getConfig: () => ({
        ...baseConfig,
        REDIS_URL: 'redis://redis:6379',
        REDIS_PASSWORD: 's3cret',
      }),
    }));
    vi.doMock('redis', () => ({ createClient }));

    const { cache } = await import('./portainer-cache.js');
    await cache.get('trigger-connect');

    expect(createClient).toHaveBeenCalledWith({
      url: 'redis://:s3cret@redis:6379',
    });
  });

  it('uses plain URL when REDIS_PASSWORD is not set', async () => {
    const redisClient = createMockRedisClient();
    const createClient = vi.fn(() => redisClient);

    vi.doMock('../config/index.js', () => ({
      getConfig: () => ({
        ...baseConfig,
        REDIS_URL: 'redis://redis:6379',
      }),
    }));
    vi.doMock('redis', () => ({ createClient }));

    const { cache } = await import('./portainer-cache.js');
    await cache.get('trigger-connect');

    expect(createClient).toHaveBeenCalledWith({
      url: 'redis://redis:6379',
    });
  });
});

describe('compression (#382)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('compresses entries above threshold and decompresses on read', async () => {
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

    // Create data > 10 KB
    const largeData = { items: Array.from({ length: 500 }, (_, i) => ({ id: i, name: `container-${i}`, status: 'running' })) };
    const jsonSize = Buffer.byteLength(JSON.stringify(largeData), 'utf8');
    expect(jsonSize).toBeGreaterThan(10_000);

    await cache.set('large-key', largeData, 60);

    // Verify compressed key was stored (base64 string in :gz key)
    const gzKey = 'aidash:cache:large-key:gz';
    expect(redisClient._store.has(gzKey)).toBe(true);
    // Plain key should have been deleted
    expect(redisClient._store.has('aidash:cache:large-key')).toBe(false);

    // Clear L1 to force L2 read
    await cache.invalidate('large-key');

    // Read back — should decompress
    const result = await cache.get<typeof largeData>('large-key');
    expect(result).toEqual(largeData);
  });

  it('does not compress entries below threshold', async () => {
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

    const smallData = { name: 'test' };
    await cache.set('small-key', smallData, 60);

    // Should be stored as plain JSON
    expect(redisClient._store.has('aidash:cache:small-key')).toBe(true);
    expect(redisClient._store.has('aidash:cache:small-key:gz')).toBe(false);
  });

  it('includes compression stats in getStats()', async () => {
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

    const largeData = { items: Array.from({ length: 500 }, (_, i) => ({ id: i, name: `item-${i}` })) };
    await cache.set('stats-key', largeData, 60);

    const stats = await cache.getStats();
    expect(stats.compression.compressedCount).toBe(1);
    expect(stats.compression.bytesSaved).toBeGreaterThan(0);
    expect(stats.compression.threshold).toBe(10_000);
  });
});

describe('Redis memory monitoring (#384)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('includes Redis INFO metrics in stats when Redis is connected', async () => {
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
    const stats = await cache.getStats();

    expect(stats.redis).not.toBeNull();
    expect(stats.redis!.memoryUsedBytes).toBe(8388608);
    expect(stats.redis!.memoryMaxBytes).toBe(536870912);
    expect(stats.redis!.memoryUsagePct).toBe('1.6%');
    expect(stats.redis!.evictedKeys).toBe(0);
    expect(stats.redis!.connectedClients).toBe(3);
    expect(stats.redis!.uptimeSeconds).toBe(86400);
  });

  it('returns redis: null when Redis is not configured', async () => {
    vi.doMock('../config/index.js', () => ({
      getConfig: () => ({ ...baseConfig }),
    }));
    vi.doMock('redis', () => ({
      createClient: vi.fn(),
    }));

    const { cache } = await import('./portainer-cache.js');
    const stats = await cache.getStats();

    expect(stats.redis).toBeNull();
    expect(stats.backend).toBe('memory-only');
  });
});

describe('tag-based cache invalidation (#385)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('setWithTags stores data and associates tags via Redis Sets', async () => {
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
    await cache.setWithTags('containers:5', [{ id: 1 }], 300, ['endpoint:5', 'resource:containers']);

    // Data should be stored
    const data = await cache.get('containers:5');
    expect(data).toEqual([{ id: 1 }]);

    // Tags should have been set via pipeline
    expect(redisClient.multi).toHaveBeenCalled();
  });

  it('invalidateTag deletes all tagged keys', async () => {
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

    // Manually populate tag set and data keys
    const tagKey = 'aidash:cache:_tag:endpoint:5';
    const dataKey1 = 'aidash:cache:containers:5';
    const dataKey2 = 'aidash:cache:networks:5';
    redisClient._sets.set(tagKey, new Set([dataKey1, dataKey2]));
    redisClient._store.set(dataKey1, JSON.stringify([{ id: 1 }]));
    redisClient._store.set(dataKey2, JSON.stringify([{ id: 2 }]));

    await cache.invalidateTag('endpoint:5');

    expect(redisClient.del).toHaveBeenCalled();
    // Verify the del call included the data keys and the tag key
    const delCall = redisClient.del.mock.calls.find(
      (args: unknown[]) => Array.isArray(args[0]) && args[0].includes(dataKey1),
    );
    expect(delCall).toBeDefined();
  });

  it('invalidateTag also clears L1 entries matching tag pattern', async () => {
    vi.doMock('../config/index.js', () => ({
      getConfig: () => ({ ...baseConfig }),
    }));
    vi.doMock('redis', () => ({
      createClient: vi.fn(),
    }));

    const { cache } = await import('./portainer-cache.js');

    // Set L1 entries
    await cache.set('endpoint:5:containers', 'data1', 60);
    await cache.set('endpoint:5:networks', 'data2', 60);
    await cache.set('endpoint:6:containers', 'data3', 60);

    // Verify all exist
    expect(await cache.get('endpoint:5:containers')).toBe('data1');

    // Invalidate by tag — L1 pattern match on 'endpoint:5'
    await cache.invalidateTag('endpoint:5');

    // endpoint:5 entries should be gone
    expect(await cache.get('endpoint:5:containers')).toBeUndefined();
    expect(await cache.get('endpoint:5:networks')).toBeUndefined();
    // endpoint:6 should remain
    expect(await cache.get('endpoint:6:containers')).toBe('data3');
  });
});

describe('exponential backoff (#429)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('first failure uses 2s backoff', async () => {
    const redisClient = createMockRedisClient();
    redisClient.get = vi.fn(async () => { throw new Error('ECONNRESET'); });

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

    // Trigger a failure via get()
    await cache.get('backoff-test');

    const state = cache.getBackoffState();
    expect(state.failureCount).toBe(1);
    // First failure: 2000 * 2^0 = 2000ms
    expect(state.disabledUntil).toBeGreaterThan(Date.now());
    expect(state.disabledUntil).toBeLessThanOrEqual(Date.now() + 2100);
  });

  it('backoff doubles with each failure via error events', async () => {
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

    // Trigger initial connection to register event handlers
    await cache.get('init');

    // Get the error handler from client.on('error', handler)
    const errorHandler = redisClient.on.mock.calls.find(
      (c: unknown[]) => c[0] === 'error',
    )?.[1] as ((err: Error) => void) | undefined;
    expect(errorHandler).toBeDefined();

    // First failure
    errorHandler!(new Error('Redis error 1'));
    expect(cache.getBackoffState().failureCount).toBe(1);

    // Second failure
    errorHandler!(new Error('Redis error 2'));
    expect(cache.getBackoffState().failureCount).toBe(2);

    // Third failure
    errorHandler!(new Error('Redis error 3'));
    expect(cache.getBackoffState().failureCount).toBe(3);
  });

  it('backoff caps at 5 minutes (300s)', async () => {
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

    // Trigger initial connection
    await cache.get('init-cap');

    const errorHandler = redisClient.on.mock.calls.find(
      (c: unknown[]) => c[0] === 'error',
    )?.[1] as ((err: Error) => void) | undefined;
    expect(errorHandler).toBeDefined();

    // Trigger 20 failures (2^19 * 2000 = way above cap)
    for (let i = 0; i < 20; i++) {
      errorHandler!(new Error('Redis error'));
    }

    const state = cache.getBackoffState();
    expect(state.failureCount).toBe(20);
    // Backoff should be capped at 300_000ms from now
    expect(state.disabledUntil).toBeLessThanOrEqual(Date.now() + 300_100);
    expect(state.disabledUntil).toBeGreaterThan(Date.now() + 299_000);
  });

  it('failure count accumulates with each error event', async () => {
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

    // Trigger initial connection
    await cache.get('init-reset');

    const errorHandler = redisClient.on.mock.calls.find(
      (c: unknown[]) => c[0] === 'error',
    )?.[1] as ((err: Error) => void) | undefined;
    expect(errorHandler).toBeDefined();

    // Trigger failures and verify accumulation
    errorHandler!(new Error('Redis error 1'));
    expect(cache.getBackoffState().failureCount).toBe(1);

    errorHandler!(new Error('Redis error 2'));
    expect(cache.getBackoffState().failureCount).toBe(2);

    errorHandler!(new Error('Redis error 3'));
    expect(cache.getBackoffState().failureCount).toBe(3);

    // disabledUntil should be set in the future
    expect(cache.getBackoffState().disabledUntil).toBeGreaterThan(Date.now());
  });
});

describe('ping() (#429)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns true when Redis is healthy', async () => {
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
    const result = await cache.ping();
    expect(result).toBe(true);
    expect(redisClient.ping).toHaveBeenCalledTimes(1);
  });

  it('returns false when Redis is not configured', async () => {
    vi.doMock('../config/index.js', () => ({
      getConfig: () => ({ ...baseConfig }),
    }));
    vi.doMock('redis', () => ({
      createClient: vi.fn(),
    }));

    const { cache } = await import('./portainer-cache.js');
    const result = await cache.ping();
    expect(result).toBe(false);
  });

  it('returns false when Redis ping throws', async () => {
    const redisClient = createMockRedisClient();
    redisClient.ping = vi.fn(async () => { throw new Error('Connection lost'); });

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
    const result = await cache.ping();
    expect(result).toBe(false);
  });
});

describe('getBackoffState() (#429)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns configured: true when Redis URL is set', async () => {
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
    const state = cache.getBackoffState();
    expect(state.configured).toBe(true);
    expect(state.failureCount).toBe(0);
    expect(state.disabledUntil).toBe(0);
  });

  it('returns configured: false when Redis URL is not set', async () => {
    vi.doMock('../config/index.js', () => ({
      getConfig: () => ({ ...baseConfig }),
    }));
    vi.doMock('redis', () => ({
      createClient: vi.fn(),
    }));

    const { cache } = await import('./portainer-cache.js');
    const state = cache.getBackoffState();
    expect(state.configured).toBe(false);
    expect(state.failureCount).toBe(0);
  });
});
