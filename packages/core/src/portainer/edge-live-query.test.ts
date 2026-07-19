import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock undici fetch — the only external boundary this module crosses.
vi.mock('undici', () => ({
  fetch: vi.fn(),
}));

import { fetch as undiciFetch } from 'undici';
import {
  fetchLiveDockerInfo,
  edgeLiveQueryCacheKey,
  edgeLiveQueryNegativeCacheKey,
  getEdgeLiveQueryConfigFromEnv,
  _resetEdgeLiveQueryState,
  EDGE_LIVE_NEGATIVE_TTL_SECONDS,
  type EdgeLiveQueryConfig,
  type LiveDockerInfo,
} from './edge-live-query.js';
import { cache, waitForInFlight } from './portainer-cache.js';
import { resetConfig, setConfigForTest } from '../config/index.js';

const mockFetch = vi.mocked(undiciFetch);

function mockJsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Awaited<ReturnType<typeof undiciFetch>>;
}

beforeEach(() => {
  resetConfig();
  // Disable the SWR cache layer so each test exercises the real fetch path —
  // cache behavior is already covered by portainer-cache.test.ts and caching
  // would hide call-count assertions here.
  setConfigForTest({ CACHE_ENABLED: false, PORTAINER_API_URL: 'http://test.local' });
  _resetEdgeLiveQueryState();
  mockFetch.mockReset();
});

afterEach(() => {
  resetConfig();
});

function cfg(overrides: Partial<EdgeLiveQueryConfig> = {}): EdgeLiveQueryConfig {
  return { enabled: true, concurrency: 2, intervalSeconds: 60, timeoutMs: 5000, ...overrides };
}

describe('fetchLiveDockerInfo', () => {
  it('returns null when disabled and never touches the network', async () => {
    const result = await fetchLiveDockerInfo(7, cfg({ enabled: false }));
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('maps Docker /info response into the LiveDockerInfo shape', async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({ Containers: 12, ContainersRunning: 9, ContainersStopped: 3, ContainersPaused: 0, NCPU: 8, MemTotal: 16000000000 }),
    );
    const result = await fetchLiveDockerInfo(7, cfg());

    expect(result).toMatchObject({
      containers: 12,
      containersRunning: 9,
      containersStopped: 3,
      ncpu: 8,
      memTotal: 16000000000,
    });
    expect(typeof result?.fetchedAt).toBe('number');
    // /docker/info path is the contract — keep this assertion explicit.
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const url = String(mockFetch.mock.calls[0][0]);
    expect(url).toContain('/api/endpoints/7/docker/info');
  });

  it('falls back to summing running+stopped+paused when Containers field is missing', async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({ ContainersRunning: 3, ContainersStopped: 1, ContainersPaused: 1 }),
    );
    const result = await fetchLiveDockerInfo(7, cfg());
    expect(result?.containers).toBe(5);
  });

  it('treats missing count fields as zero rather than NaN/undefined', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({}));
    const result = await fetchLiveDockerInfo(7, cfg());
    expect(result).toMatchObject({
      containers: 0,
      containersRunning: 0,
      containersStopped: 0,
      containersPaused: 0,
      ncpu: 0,
      memTotal: 0,
    });
  });

  it('returns null on non-2xx response and logs (no throw)', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({}, 502));
    const result = await fetchLiveDockerInfo(7, cfg());
    expect(result).toBeNull();
  });

  it('returns null when the fetch itself rejects (network / abort)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('AbortError'));
    const result = await fetchLiveDockerInfo(7, cfg());
    expect(result).toBeNull();
  });

  it('passes an AbortController signal so timeouts can cancel the request', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ Containers: 0 }));
    await fetchLiveDockerInfo(7, cfg({ timeoutMs: 1234 }));
    const opts = mockFetch.mock.calls[0][1] as { signal?: AbortSignal };
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it('respects the concurrency limit — at most N fetches in flight simultaneously', async () => {
    // Each fetch settles after a tiny delay. With concurrency=2 and 5 tasks,
    // the limiter must serialize batches so peak inflight never exceeds 2.
    let inFlight = 0;
    let peak = 0;
    mockFetch.mockImplementation(() => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      return new Promise((resolve) => {
        setTimeout(() => {
          inFlight--;
          resolve(mockJsonResponse({ Containers: 0 }));
        }, 20);
      });
    });

    const config = cfg({ concurrency: 2 });
    const tasks = [1, 2, 3, 4, 5].map((id) => fetchLiveDockerInfo(id, config));
    await Promise.all(tasks);

    expect(mockFetch).toHaveBeenCalledTimes(5);
    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBeGreaterThan(0);
  });

  it('rebuilds the limiter when concurrency changes between calls', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ Containers: 0 }));
    await fetchLiveDockerInfo(1, cfg({ concurrency: 2 }));
    // After this call the cached limiter has concurrency=2.
    // Calling with concurrency=5 should rebuild it without throwing.
    await fetchLiveDockerInfo(2, cfg({ concurrency: 5 }));
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe('negative caching of failed live probes (#1500)', () => {
  // These tests run with the cache layer enabled (unlike the suite default):
  // negative caching is a cache-layer behavior. REDIS_URL is cleared so the
  // hybrid cache stays memory-only — no external service needed.
  beforeEach(async () => {
    setConfigForTest({
      CACHE_ENABLED: true,
      REDIS_URL: undefined,
      PORTAINER_API_URL: 'http://test.local',
    });
    await cache.clear();
  });

  afterEach(async () => {
    await waitForInFlight();
    await cache.clear();
  });

  it('fails fast on subsequent calls within the negative-TTL window', async () => {
    mockFetch.mockRejectedValue(new Error('connect timeout'));

    expect(await fetchLiveDockerInfo(41, cfg())).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Second and third calls must not re-pay the probe timeout — the failure
    // marker short-circuits them without touching the network.
    expect(await fetchLiveDockerInfo(41, cfg())).toBeNull();
    expect(await fetchLiveDockerInfo(41, cfg())).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('scopes failure markers per endpoint — one down endpoint does not block others', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(mockJsonResponse({ Containers: 2, ContainersRunning: 2 }));

    expect(await fetchLiveDockerInfo(42, cfg())).toBeNull();
    const other = await fetchLiveDockerInfo(43, cfg());
    expect(other?.containers).toBe(2);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('re-probes the endpoint after the negative TTL expires', async () => {
    mockFetch.mockRejectedValueOnce(new Error('boom'));
    expect(await fetchLiveDockerInfo(44, cfg())).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const realNow = Date.now();
    const nowSpy = vi.spyOn(Date, 'now')
      .mockReturnValue(realNow + (EDGE_LIVE_NEGATIVE_TTL_SECONDS + 1) * 1000);
    try {
      mockFetch.mockResolvedValueOnce(mockJsonResponse({ Containers: 5, ContainersRunning: 5 }));
      const result = await fetchLiveDockerInfo(44, cfg());
      expect(result?.containers).toBe(5);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('does not consult or store markers when the cache layer is disabled', async () => {
    setConfigForTest({ CACHE_ENABLED: false, PORTAINER_API_URL: 'http://test.local' });
    mockFetch.mockRejectedValue(new Error('boom'));

    expect(await fetchLiveDockerInfo(45, cfg())).toBeNull();
    expect(await fetchLiveDockerInfo(45, cfg())).toBeNull();
    // No fail-fast: every call goes to the real probe, exactly as before.
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('kill-switch (enabled=false) returns null before any cache or network access', async () => {
    // Seed a failure marker, then flip the kill-switch — semantics must be
    // identical to the pre-negative-cache behavior: null, no fetch.
    mockFetch.mockRejectedValueOnce(new Error('boom'));
    expect(await fetchLiveDockerInfo(46, cfg())).toBeNull();

    mockFetch.mockClear();
    expect(await fetchLiveDockerInfo(46, cfg({ enabled: false }))).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('uses a key prefix distinct from the positive cache entry', () => {
    expect(edgeLiveQueryNegativeCacheKey(7)).toBe('edge-live-info-failed:7');
    expect(edgeLiveQueryNegativeCacheKey(7)).not.toBe(edgeLiveQueryCacheKey(7));
  });
});

// Ensure the type alias is exported (compile-time check via usage)
const _typeCheck: LiveDockerInfo = {} as LiveDockerInfo;

describe('edgeLiveQueryCacheKey', () => {
  it('produces a stable, unambiguous key per endpoint id', () => {
    expect(edgeLiveQueryCacheKey(7)).toBe('edge-live-info:7');
    expect(edgeLiveQueryCacheKey(123)).toBe('edge-live-info:123');
  });
});

describe('getEdgeLiveQueryConfigFromEnv', () => {
  it('reads defaults from getConfig()', () => {
    const c = getEdgeLiveQueryConfigFromEnv();
    expect(c.enabled).toBeTypeOf('boolean');
    expect(c.concurrency).toBeGreaterThanOrEqual(1);
    expect(c.intervalSeconds).toBeGreaterThanOrEqual(15);
    expect(c.timeoutMs).toBeGreaterThanOrEqual(1000);
  });
});
