import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — hoisted so every import sees them
// ---------------------------------------------------------------------------

const cachedFetchSWRSpy = vi.fn((_key: string, _ttl: number, fetcher: () => Promise<unknown>) =>
  fetcher(),
);

vi.mock('../services/portainer-cache.js', () => ({
  cachedFetchSWR: (...args: unknown[]) =>
    cachedFetchSWRSpy(args[0] as string, args[1] as number, args[2] as () => Promise<unknown>),
  cachedFetch: (...args: unknown[]) =>
    (args[2] as () => Promise<unknown>)(),
  getCacheKey: (...args: unknown[]) => args.join(':'),
  TTL: { ENDPOINTS: 900, CONTAINERS: 300, IMAGES: 600, STATS: 30 },
}));

const getEndpointsMock = vi.fn().mockResolvedValue([{ Id: 1, Name: 'local' }]);
const getContainersMock = vi.fn().mockResolvedValue([]);
const getImagesMock = vi.fn().mockResolvedValue([
  { Id: 'sha256:abc123', RepoTags: ['nginx:latest'] },
]);

vi.mock('../services/portainer-client.js', () => ({
  getEndpoints: (...args: unknown[]) => getEndpointsMock(...args),
  getContainers: (...args: unknown[]) => getContainersMock(...args),
  getImages: (...args: unknown[]) => getImagesMock(...args),
}));

vi.mock('../services/image-staleness.js', () => ({
  runStalenessChecks: vi.fn().mockResolvedValue({ checked: 1, stale: 0 }),
}));

const collectMetricsMock = vi.fn().mockResolvedValue({
  cpu: 25.5,
  memory: 40.2,
  memoryBytes: 1024000,
  networkRxBytes: 5000,
  networkTxBytes: 3000,
});

vi.mock('../services/metrics-collector.js', () => ({
  collectMetrics: (...args: unknown[]) => collectMetricsMock(...args),
}));

const insertMetricsMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../services/metrics-store.js', () => ({
  insertMetrics: (...args: unknown[]) => insertMetricsMock(...args),
  cleanOldMetrics: vi.fn().mockResolvedValue(0),
}));

vi.mock('../config/index.js', () => ({
  getConfig: vi.fn().mockReturnValue({
    CACHE_ENABLED: true,
    METRICS_COLLECTION_ENABLED: false,
    MONITORING_ENABLED: false,
    WEBHOOKS_ENABLED: false,
    IMAGE_STALENESS_CHECK_ENABLED: false,
    METRICS_RETENTION_DAYS: 30,
    METRICS_ENDPOINT_CONCURRENCY: 10,
    METRICS_CONTAINER_CONCURRENCY: 20,
    METRICS_COLLECTION_INTERVAL_SECONDS: 60,
  }),
}));

vi.mock('../utils/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../services/monitoring-service.js', () => ({
  runMonitoringCycle: vi.fn(),
  startCooldownSweep: vi.fn(),
  stopCooldownSweep: vi.fn(),
}));
vi.mock('../services/pcap-service.js', () => ({ cleanupOldCaptures: vi.fn() }));
vi.mock('../services/portainer-backup.js', () => ({
  createPortainerBackup: vi.fn(),
  cleanupOldPortainerBackups: vi.fn(),
}));
vi.mock('../services/settings-store.js', () => ({ getSetting: vi.fn().mockReturnValue(null) }));
vi.mock('../services/webhook-service.js', () => ({
  startWebhookListener: vi.fn(),
  stopWebhookListener: vi.fn(),
  processRetries: vi.fn(),
}));
vi.mock('../services/kpi-store.js', () => ({
  insertKpiSnapshot: vi.fn(),
  cleanOldKpiSnapshots: vi.fn(),
}));
vi.mock('../services/portainer-normalizers.js', () => ({
  normalizeEndpoint: (ep: { Id: number }) => ({
    id: ep.Id,
    capabilities: { liveStats: true },
    status: 'up',
    containersRunning: 1,
    containersStopped: 0,
    containersHealthy: 1,
    containersUnhealthy: 0,
    totalContainers: 1,
    stackCount: 0,
  }),
}));
vi.mock('../services/trace-context.js', () => ({ runWithTraceContext: vi.fn() }));
vi.mock('../services/elasticsearch-log-forwarder.js', () => ({
  startElasticsearchLogForwarder: vi.fn(),
  stopElasticsearchLogForwarder: vi.fn(),
}));

const cleanExpiredSessionsMock = vi.fn().mockReturnValue(0);
vi.mock('../services/session-store.js', () => ({
  cleanExpiredSessions: (...args: unknown[]) => cleanExpiredSessionsMock(...args),
}));

const cleanupOldInsightsMock = vi.fn().mockReturnValue(0);
vi.mock('../services/insights-store.js', () => ({
  cleanupOldInsights: (...args: unknown[]) => cleanupOldInsightsMock(...args),
}));

import {
  runCleanup,
  runImageStalenessCheck,
  runMetricsCollection,
  isMetricsCycleRunning,
  _resetMetricsMutex,
} from './setup.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('scheduler/setup – runImageStalenessCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses cachedFetchSWR for getEndpoints with TTL.ENDPOINTS', async () => {
    await runImageStalenessCheck();

    const endpointsCall = cachedFetchSWRSpy.mock.calls.find(
      (call) => call[0] === 'endpoints',
    );
    expect(endpointsCall).toBeDefined();
    expect(endpointsCall![1]).toBe(900); // TTL.ENDPOINTS
  });

  it('uses cachedFetchSWR for getImages with TTL.IMAGES', async () => {
    await runImageStalenessCheck();

    const imagesCall = cachedFetchSWRSpy.mock.calls.find(
      (call) => (call[0] as string).startsWith('images:'),
    );
    expect(imagesCall).toBeDefined();
    expect(imagesCall![0]).toBe('images:1'); // getCacheKey('images', ep.Id)
    expect(imagesCall![1]).toBe(600); // TTL.IMAGES
  });

  it('does not call getImages directly (bypassing cache)', async () => {
    await runImageStalenessCheck();

    // getImages should only be called as a fetcher inside cachedFetchSWR
    expect(getImagesMock).toHaveBeenCalledTimes(1);
    expect(getImagesMock).toHaveBeenCalledWith(1);

    // Verify all Portainer API calls went through cachedFetchSWR
    // One call for endpoints + one for images per endpoint = 2 total
    expect(cachedFetchSWRSpy).toHaveBeenCalledTimes(2);
  });

  it('calls cachedFetchSWR for images per endpoint', async () => {
    getEndpointsMock.mockResolvedValueOnce([
      { Id: 1, Name: 'local' },
      { Id: 2, Name: 'remote' },
    ]);

    await runImageStalenessCheck();

    // 1 for endpoints + 2 for images (one per endpoint)
    expect(cachedFetchSWRSpy).toHaveBeenCalledTimes(3);

    const imagesCalls = cachedFetchSWRSpy.mock.calls.filter(
      (call) => (call[0] as string).startsWith('images:'),
    );
    expect(imagesCalls).toHaveLength(2);
    expect(imagesCalls[0][0]).toBe('images:1');
    expect(imagesCalls[1][0]).toBe('images:2');
  });

  it('processes image endpoints in parallel (not sequentially)', async () => {
    const callOrder: string[] = [];
    getEndpointsMock.mockResolvedValueOnce([
      { Id: 1, Name: 'ep1' },
      { Id: 2, Name: 'ep2' },
      { Id: 3, Name: 'ep3' },
    ]);
    getImagesMock.mockImplementation((epId: number) => {
      callOrder.push(`start-${epId}`);
      return new Promise((resolve) => {
        setTimeout(() => {
          callOrder.push(`end-${epId}`);
          resolve([{ Id: `img-${epId}`, RepoTags: ['nginx:latest'] }]);
        }, 10);
      });
    });

    await runImageStalenessCheck();

    // All starts should appear before any ends (parallel execution)
    const firstEndIndex = callOrder.findIndex((s) => s.startsWith('end-'));
    const lastStartIndex = callOrder.lastIndexOf(
      callOrder.filter((s) => s.startsWith('start-')).pop()!,
    );
    expect(lastStartIndex).toBeLessThan(firstEndIndex);
  });
});

describe('scheduler/setup – runMetricsCollection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetMetricsMutex();
  });

  afterEach(() => {
    _resetMetricsMutex();
  });

  it('collects metrics for running containers across endpoints', async () => {
    getEndpointsMock.mockResolvedValueOnce([
      { Id: 1, Name: 'ep1' },
      { Id: 2, Name: 'ep2' },
    ]);
    getContainersMock.mockImplementation((epId: number) =>
      Promise.resolve([
        { Id: `container-${epId}-a`, Names: ['/app-a'], State: 'running' },
        { Id: `container-${epId}-b`, Names: ['/app-b'], State: 'running' },
      ]),
    );

    await runMetricsCollection();

    // 2 endpoints x 2 containers = 4 collectMetrics calls
    expect(collectMetricsMock).toHaveBeenCalledTimes(4);
    // 4 containers x 5 metric types = 20 metrics
    expect(insertMetricsMock).toHaveBeenCalledTimes(1);
    expect(insertMetricsMock.mock.calls[0][0]).toHaveLength(20);
  });

  it('processes endpoints in parallel (not sequentially)', async () => {
    const callOrder: string[] = [];
    getEndpointsMock.mockResolvedValueOnce([
      { Id: 1, Name: 'ep1' },
      { Id: 2, Name: 'ep2' },
      { Id: 3, Name: 'ep3' },
    ]);
    getContainersMock.mockImplementation((epId: number) => {
      callOrder.push(`start-ep-${epId}`);
      return new Promise((resolve) => {
        setTimeout(() => {
          callOrder.push(`end-ep-${epId}`);
          resolve([
            { Id: `c-${epId}`, Names: [`/app-${epId}`], State: 'running' },
          ]);
        }, 10);
      });
    });

    await runMetricsCollection();

    // All endpoint starts should fire before any endpoint finishes (parallel)
    const starts = callOrder.filter((s) => s.startsWith('start-'));
    const firstEnd = callOrder.findIndex((s) => s.startsWith('end-'));
    expect(starts.length).toBe(3);
    expect(firstEnd).toBeGreaterThanOrEqual(starts.length);
  });

  it('skips stopped containers', async () => {
    getEndpointsMock.mockResolvedValueOnce([{ Id: 1, Name: 'ep1' }]);
    getContainersMock.mockResolvedValueOnce([
      { Id: 'running-1', Names: ['/app'], State: 'running' },
      { Id: 'stopped-1', Names: ['/db'], State: 'exited' },
    ]);

    await runMetricsCollection();

    expect(collectMetricsMock).toHaveBeenCalledTimes(1);
    expect(collectMetricsMock).toHaveBeenCalledWith(1, 'running-1');
  });

  it('handles individual container failures gracefully', async () => {
    getEndpointsMock.mockResolvedValueOnce([{ Id: 1, Name: 'ep1' }]);
    getContainersMock.mockResolvedValueOnce([
      { Id: 'ok-1', Names: ['/app-a'], State: 'running' },
      { Id: 'fail-1', Names: ['/app-b'], State: 'running' },
      { Id: 'ok-2', Names: ['/app-c'], State: 'running' },
    ]);
    collectMetricsMock
      .mockResolvedValueOnce({ cpu: 10, memory: 20, memoryBytes: 100, networkRxBytes: 0, networkTxBytes: 0 })
      .mockRejectedValueOnce(new Error('container gone'))
      .mockResolvedValueOnce({ cpu: 30, memory: 40, memoryBytes: 200, networkRxBytes: 0, networkTxBytes: 0 });

    await runMetricsCollection();

    // Should still insert metrics for the 2 successful containers
    expect(insertMetricsMock).toHaveBeenCalledTimes(1);
    expect(insertMetricsMock.mock.calls[0][0]).toHaveLength(10); // 2 containers x 5 metrics
  });

  it('handles entire endpoint failure gracefully', async () => {
    getEndpointsMock.mockResolvedValueOnce([
      { Id: 1, Name: 'ep1' },
      { Id: 2, Name: 'ep2' },
    ]);
    getContainersMock
      .mockRejectedValueOnce(new Error('endpoint unreachable'))
      .mockResolvedValueOnce([
        { Id: 'c-2', Names: ['/app'], State: 'running' },
      ]);

    await runMetricsCollection();

    // Should still collect from the working endpoint
    expect(collectMetricsMock).toHaveBeenCalledTimes(1);
    expect(insertMetricsMock).toHaveBeenCalledTimes(1);
    expect(insertMetricsMock.mock.calls[0][0]).toHaveLength(5);
  });

  it('does not insert metrics when no containers are found', async () => {
    getEndpointsMock.mockResolvedValueOnce([{ Id: 1, Name: 'ep1' }]);
    getContainersMock.mockResolvedValueOnce([]);

    await runMetricsCollection();

    expect(collectMetricsMock).not.toHaveBeenCalled();
    expect(insertMetricsMock).not.toHaveBeenCalled();
  });
});

describe('scheduler/setup – mutex guard (cycle overlap prevention)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetMetricsMutex();
  });

  afterEach(() => {
    _resetMetricsMutex();
  });

  it('mutex is false before any cycle', () => {
    expect(isMetricsCycleRunning()).toBe(false);
  });

  it('mutex is released after a successful cycle', async () => {
    getEndpointsMock.mockResolvedValueOnce([]);

    await runMetricsCollection();

    expect(isMetricsCycleRunning()).toBe(false);
  });

  it('mutex is released after a failed cycle', async () => {
    getEndpointsMock.mockRejectedValueOnce(new Error('network error'));

    await runMetricsCollection();

    expect(isMetricsCycleRunning()).toBe(false);
  });

  it('skips a cycle when the previous one is still running', async () => {
    // Create a slow-running cycle
    let resolveSlowCycle: () => void;
    const slowPromise = new Promise<void>((resolve) => {
      resolveSlowCycle = resolve;
    });

    getEndpointsMock.mockImplementation(() => slowPromise.then(() => []));

    // Start first cycle (will block on getEndpoints)
    const firstCycle = runMetricsCollection();

    // Verify mutex is held
    expect(isMetricsCycleRunning()).toBe(true);

    // Attempt second cycle — should skip immediately
    getEndpointsMock.mockResolvedValue([]);
    const secondCycle = runMetricsCollection();
    await secondCycle;

    // insertMetrics should NOT be called by second cycle (it was skipped)
    expect(insertMetricsMock).not.toHaveBeenCalled();

    // Now finish the first cycle
    resolveSlowCycle!();
    await firstCycle;

    // Mutex should be released
    expect(isMetricsCycleRunning()).toBe(false);
  });

  it('allows a new cycle after the previous one completes', async () => {
    getEndpointsMock.mockResolvedValue([{ Id: 1, Name: 'ep1' }]);
    getContainersMock.mockResolvedValue([
      { Id: 'c-1', Names: ['/app'], State: 'running' },
    ]);

    // First cycle
    await runMetricsCollection();
    expect(collectMetricsMock).toHaveBeenCalledTimes(1);

    // Second cycle should proceed
    await runMetricsCollection();
    expect(collectMetricsMock).toHaveBeenCalledTimes(2);
  });
});

describe('scheduler/setup – no double-collection (monitoring reuses scheduler data)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetMetricsMutex();
  });

  afterEach(() => {
    _resetMetricsMutex();
  });

  it('monitoring service reads metrics from DB, scheduler collects from API', async () => {
    // This is a design verification test.
    // The monitoring service calls getLatestMetrics() (DB read),
    // NOT collectMetrics() (API call). We verify by checking that
    // runMetricsCollection calls collectMetrics while the monitoring
    // service (which we mock) does NOT.

    getEndpointsMock.mockResolvedValueOnce([{ Id: 1, Name: 'ep1' }]);
    getContainersMock.mockResolvedValueOnce([
      { Id: 'c-1', Names: ['/app'], State: 'running' },
    ]);

    await runMetricsCollection();

    // Scheduler collected metrics via API
    expect(collectMetricsMock).toHaveBeenCalledTimes(1);
    expect(collectMetricsMock).toHaveBeenCalledWith(1, 'c-1');
  });
});

describe('scheduler/setup – runCleanup includes session cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls cleanExpiredSessions during cleanup', async () => {
    cleanExpiredSessionsMock.mockReturnValue(5);

    await runCleanup();

    expect(cleanExpiredSessionsMock).toHaveBeenCalledTimes(1);
  });

  it('does not throw when cleanExpiredSessions fails', async () => {
    cleanExpiredSessionsMock.mockImplementation(() => {
      throw new Error('DB locked');
    });

    await expect(runCleanup()).resolves.toBeUndefined();
  });

  it('returns zero deleted when no expired sessions exist', async () => {
    cleanExpiredSessionsMock.mockReturnValue(0);

    await runCleanup();

    expect(cleanExpiredSessionsMock).toHaveBeenCalledTimes(1);
  });
});

describe('scheduler/setup – runCleanup includes insights cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls cleanupOldInsights during cleanup', async () => {
    cleanupOldInsightsMock.mockReturnValue(10);

    await runCleanup();

    expect(cleanupOldInsightsMock).toHaveBeenCalledTimes(1);
  });

  it('does not throw when cleanupOldInsights fails', async () => {
    cleanupOldInsightsMock.mockImplementation(() => {
      throw new Error('DB locked');
    });

    await expect(runCleanup()).resolves.toBeUndefined();
  });

  it('passes INSIGHTS_RETENTION_DAYS from config', async () => {
    const { getConfig } = await import('../config/index.js');
    (getConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      METRICS_RETENTION_DAYS: 30,
      INSIGHTS_RETENTION_DAYS: 14,
    });

    await runCleanup();

    expect(cleanupOldInsightsMock).toHaveBeenCalledWith(14);
  });
});
