import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock undici fetch — the only external boundary this module crosses.
vi.mock('undici', () => ({
  fetch: vi.fn(),
}));

import { fetch as undiciFetch } from 'undici';
import {
  fetchEdgeLiveDockerInfo,
  edgeLiveQueryCacheKey,
  getEdgeLiveQueryConfigFromEnv,
  _resetEdgeLiveQueryState,
  type EdgeLiveQueryConfig,
} from './edge-live-query.js';
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

describe('fetchEdgeLiveDockerInfo', () => {
  it('returns null when disabled and never touches the network', async () => {
    const result = await fetchEdgeLiveDockerInfo(7, cfg({ enabled: false }));
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('maps Docker /info response into the EdgeDockerInfo shape', async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({ Containers: 7, ContainersRunning: 5, ContainersStopped: 2, ContainersPaused: 0 }),
    );
    const result = await fetchEdgeLiveDockerInfo(7, cfg());

    expect(result).toMatchObject({
      containers: 7,
      containersRunning: 5,
      containersStopped: 2,
      containersPaused: 0,
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
    const result = await fetchEdgeLiveDockerInfo(7, cfg());
    expect(result?.containers).toBe(5);
  });

  it('treats missing count fields as zero rather than NaN/undefined', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({}));
    const result = await fetchEdgeLiveDockerInfo(7, cfg());
    expect(result).toMatchObject({
      containers: 0,
      containersRunning: 0,
      containersStopped: 0,
      containersPaused: 0,
    });
  });

  it('returns null on non-2xx response and logs (no throw)', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({}, 502));
    const result = await fetchEdgeLiveDockerInfo(7, cfg());
    expect(result).toBeNull();
  });

  it('returns null when the fetch itself rejects (network / abort)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('AbortError'));
    const result = await fetchEdgeLiveDockerInfo(7, cfg());
    expect(result).toBeNull();
  });

  it('passes an AbortController signal so timeouts can cancel the request', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ Containers: 0 }));
    await fetchEdgeLiveDockerInfo(7, cfg({ timeoutMs: 1234 }));
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
    const tasks = [1, 2, 3, 4, 5].map((id) => fetchEdgeLiveDockerInfo(id, config));
    await Promise.all(tasks);

    expect(mockFetch).toHaveBeenCalledTimes(5);
    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBeGreaterThan(0);
  });

  it('rebuilds the limiter when concurrency changes between calls', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ Containers: 0 }));
    await fetchEdgeLiveDockerInfo(1, cfg({ concurrency: 2 }));
    // After this call the cached limiter has concurrency=2.
    // Calling with concurrency=5 should rebuild it without throwing.
    await fetchEdgeLiveDockerInfo(2, cfg({ concurrency: 5 }));
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

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
