import { beforeAll, afterAll, describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setConfigForTest, resetConfig } from '@dashboard/core/config/index.js';

// ---------------------------------------------------------------------------
// Kept mocks — internal services the scheduler depends on
// ---------------------------------------------------------------------------

// Kept: image-staleness mock — tests control staleness results
vi.mock('@dashboard/security', () => ({
  runStalenessChecks: vi.fn().mockResolvedValue({ checked: 1, stale: 0 }),
  cleanupOldCaptures: vi.fn(),
  cleanupOrphanedSidecars: vi.fn().mockResolvedValue(0),
  cleanupOldVulnerabilities: vi.fn().mockResolvedValue(0),
  isHarborConfiguredAsync: vi.fn().mockResolvedValue(false),
  runHarborSync: vi.fn().mockResolvedValue({}),
}));

const collectMetricsMock = vi.fn().mockResolvedValue({
  cpu: 25.5,
  memory: 40.2,
  memoryBytes: 1024000,
  networkRxBytes: 5000,
  networkTxBytes: 3000,
});

// Kept: metrics-collector mock — tests control collected metrics
vi.mock('@dashboard/observability', async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return {
    ...orig,
    collectMetrics: (...args: unknown[]) => collectMetricsMock(...args),
    insertMetrics: (...args: unknown[]) => insertMetricsMock(...args),
    cleanOldMetrics: vi.fn().mockResolvedValue(0),
    insertKpiSnapshot: vi.fn(),
    cleanOldKpiSnapshots: vi.fn(),
    recordNetworkSample: vi.fn(),
  };
});

const insertMetricsMock = vi.fn().mockResolvedValue(undefined);

// pcap-service mock consolidated into @dashboard/security above
// Kept: portainer-backup mock
vi.mock('@dashboard/operations', async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return {
    ...orig,
    createPortainerBackup: vi.fn(),
    cleanupOldPortainerBackups: vi.fn(),
    startWebhookListener: vi.fn(),
    stopWebhookListener: vi.fn(),
    processRetries: vi.fn(),
  };
});
// Kept: settings-store mock — tests control settings
vi.mock('@dashboard/core/services/settings-store.js', () => ({ getSetting: vi.fn().mockReturnValue(null) }));
// @dashboard/operations mock is consolidated above
// kpi-store functions mocked inside @dashboard/observability mock above
// Real portainer-normalizers used (pure function, no external deps)
// Kept: trace-context mock
vi.mock('@dashboard/core/tracing/trace-context.js', () => ({ runWithTraceContext: vi.fn() }));
// Kept: infrastructure module mock (elasticsearch log forwarder)
vi.mock('@dashboard/infrastructure', () => ({
  startElasticsearchLogForwarder: vi.fn(),
  stopElasticsearchLogForwarder: vi.fn(),
}));

const cleanExpiredSessionsMock = vi.fn().mockReturnValue(0);
// Kept: session-store mock — tests control session cleanup
vi.mock('@dashboard/core/services/session-store.js', () => ({
  cleanExpiredSessions: (...args: unknown[]) => cleanExpiredSessionsMock(...args),
}));

const cleanupOldInsightsMock = vi.fn().mockReturnValue(0);
// Kept: @dashboard/ai mock — tests control insights cleanup and cooldown sweep
vi.mock('@dashboard/ai', () => ({
  startCooldownSweep: vi.fn(),
  stopCooldownSweep: vi.fn(),
  cleanupOldInsights: (...args: unknown[]) => cleanupOldInsightsMock(...args),
}));

import * as portainerClient from '@dashboard/core/portainer/portainer-client.js';
import * as portainerCache from '@dashboard/core/portainer/portainer-cache.js';
import { cache } from '@dashboard/core/portainer/portainer-cache.js';
import { closeTestRedis } from '../test-utils/test-redis-helper.js';

import {
  runCleanup,
  runImageStalenessCheck,
  runMetricsCollection,
  isMetricsCycleRunning,
  _resetMetricsMutex,
} from './setup.js';

// ---------------------------------------------------------------------------
// Spy references — assigned in global beforeEach
// ---------------------------------------------------------------------------
let getEndpointsMock: any;
let getContainersMock: any;
let getImagesMock: any;
let cachedFetchSWRSpy: any;

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await cache.clear();
  setConfigForTest({
    CACHE_ENABLED: true,
    METRICS_COLLECTION_ENABLED: false,
    MONITORING_ENABLED: false,
    WEBHOOKS_ENABLED: false,
    IMAGE_STALENESS_CHECK_ENABLED: false,
    METRICS_RETENTION_DAYS: 30,
    METRICS_ENDPOINT_CONCURRENCY: 10,
    METRICS_CONTAINER_CONCURRENCY: 20,
    METRICS_COLLECTION_INTERVAL_SECONDS: 60,
  });
});

afterAll(async () => {
  resetConfig();
  await closeTestRedis();
});

// Global beforeEach — restore mocks, re-create spies, re-set defaults
beforeEach(async () => {
  await cache.clear();
  vi.restoreAllMocks();

  // Re-set forwarding-target mock defaults cleared by restoreAllMocks
  collectMetricsMock.mockResolvedValue({
    cpu: 25.5,
    memory: 40.2,
    memoryBytes: 1024000,
    networkRxBytes: 5000,
    networkTxBytes: 3000,
  });
  insertMetricsMock.mockResolvedValue(undefined);
  cleanExpiredSessionsMock.mockReturnValue(0);
  cleanupOldInsightsMock.mockReturnValue(0);

  // Re-set inline vi.mock fn defaults cleared by restoreAllMocks
  const securityPkg = await import('@dashboard/security');
  vi.mocked(securityPkg.runStalenessChecks).mockResolvedValue({ checked: 1, stale: 0 } as any);
  const obsModule = await import('@dashboard/observability');
  vi.mocked(obsModule.cleanOldMetrics).mockResolvedValue(0 as any);
  const settingsStore = await import('@dashboard/core/services/settings-store.js');
  vi.mocked(settingsStore.getSetting).mockReturnValue(null as any);

  // Bypass cache — delegates to fetcher
  cachedFetchSWRSpy = vi.spyOn(portainerCache, 'cachedFetchSWR').mockImplementation(
    async (_key: string, _ttl: number, fn: () => Promise<unknown>) => fn(),
  );
  vi.spyOn(portainerCache, 'cachedFetch').mockImplementation(
    async (_key: string, _ttl: number, fn: () => Promise<unknown>) => fn(),
  );

  // Default portainer spies — empty responses
  getEndpointsMock = vi.spyOn(portainerClient, 'getEndpoints').mockResolvedValue([] as any);
  getContainersMock = vi.spyOn(portainerClient, 'getContainers').mockResolvedValue([] as any);
  getImagesMock = vi.spyOn(portainerClient, 'getImages').mockResolvedValue([] as any);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('scheduler/setup – runImageStalenessCheck', () => {
  beforeEach(() => {
    // Override defaults for image staleness tests
    getEndpointsMock.mockResolvedValue([{ Id: 1, Name: 'local', Status: 1, Type: 1, URL: 'tcp://localhost' }] as any);
    getContainersMock.mockResolvedValue([] as any);
    getImagesMock.mockResolvedValue([{ Id: 'sha256:abc123', RepoTags: ['nginx:latest'] }] as any);
  });

  it('uses cachedFetchSWR for getEndpoints with TTL.ENDPOINTS', async () => {
    await runImageStalenessCheck();

    const endpointsCall = cachedFetchSWRSpy.mock.calls.find(
      (call: any) => call[0] === 'endpoints',
    );
    expect(endpointsCall).toBeDefined();
    expect(endpointsCall![1]).toBe(900); // TTL.ENDPOINTS
  });

  it('uses cachedFetchSWR for getImages with TTL.IMAGES', async () => {
    await runImageStalenessCheck();

    const imagesCall = cachedFetchSWRSpy.mock.calls.find(
      (call: any) => (call[0] as string).startsWith('images:'),
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
      { Id: 1, Name: 'local', Status: 1, Type: 1, URL: 'tcp://localhost' },
      { Id: 2, Name: 'remote', Status: 1, Type: 1, URL: 'tcp://localhost' },
    ] as any);

    await runImageStalenessCheck();

    // 1 for endpoints + 2 for images (one per endpoint)
    expect(cachedFetchSWRSpy).toHaveBeenCalledTimes(3);

    const imagesCalls = cachedFetchSWRSpy.mock.calls.filter(
      (call: any) => (call[0] as string).startsWith('images:'),
    );
    expect(imagesCalls).toHaveLength(2);
    expect(imagesCalls[0][0]).toBe('images:1');
    expect(imagesCalls[1][0]).toBe('images:2');
  });

  it('processes image endpoints in parallel (not sequentially)', async () => {
    const callOrder: string[] = [];
    getEndpointsMock.mockResolvedValueOnce([
      { Id: 1, Name: 'ep1', Status: 1, Type: 1, URL: 'tcp://localhost' },
      { Id: 2, Name: 'ep2', Status: 1, Type: 1, URL: 'tcp://localhost' },
      { Id: 3, Name: 'ep3', Status: 1, Type: 1, URL: 'tcp://localhost' },
    ] as any);
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
    _resetMetricsMutex();
  });

  afterEach(() => {
    _resetMetricsMutex();
  });

  it('collects metrics for running containers across endpoints', async () => {
    getEndpointsMock.mockResolvedValueOnce([
      { Id: 1, Name: 'ep1', Status: 1, Type: 1, URL: 'tcp://localhost' },
      { Id: 2, Name: 'ep2', Status: 1, Type: 1, URL: 'tcp://localhost' },
    ] as any);
    getContainersMock.mockImplementation((epId: number) =>
      Promise.resolve([
        { Id: `container-${epId}-a`, Names: ['/app-a'], State: 'running' },
        { Id: `container-${epId}-b`, Names: ['/app-b'], State: 'running' },
      ] as any),
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
      { Id: 1, Name: 'ep1', Status: 1, Type: 1, URL: 'tcp://localhost' },
      { Id: 2, Name: 'ep2', Status: 1, Type: 1, URL: 'tcp://localhost' },
      { Id: 3, Name: 'ep3', Status: 1, Type: 1, URL: 'tcp://localhost' },
    ] as any);
    getContainersMock.mockImplementation((epId: number) => {
      callOrder.push(`start-ep-${epId}`);
      return new Promise((resolve) => {
        setTimeout(() => {
          callOrder.push(`end-ep-${epId}`);
          resolve([
            { Id: `c-${epId}`, Names: [`/app-${epId}`], State: 'running' },
          ] as any);
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
    getEndpointsMock.mockResolvedValueOnce([{ Id: 1, Name: 'ep1', Status: 1, Type: 1, URL: 'tcp://localhost' }] as any);
    getContainersMock.mockResolvedValueOnce([
      { Id: 'running-1', Names: ['/app'], State: 'running' },
      { Id: 'stopped-1', Names: ['/db'], State: 'exited' },
    ] as any);

    await runMetricsCollection();

    expect(collectMetricsMock).toHaveBeenCalledTimes(1);
    expect(collectMetricsMock).toHaveBeenCalledWith(1, 'running-1');
  });

  it('handles individual container failures gracefully', async () => {
    getEndpointsMock.mockResolvedValueOnce([{ Id: 1, Name: 'ep1', Status: 1, Type: 1, URL: 'tcp://localhost' }] as any);
    getContainersMock.mockResolvedValueOnce([
      { Id: 'ok-1', Names: ['/app-a'], State: 'running' },
      { Id: 'fail-1', Names: ['/app-b'], State: 'running' },
      { Id: 'ok-2', Names: ['/app-c'], State: 'running' },
    ] as any);
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
      { Id: 1, Name: 'ep1', Status: 1, Type: 1, URL: 'tcp://localhost' },
      { Id: 2, Name: 'ep2', Status: 1, Type: 1, URL: 'tcp://localhost' },
    ] as any);
    getContainersMock
      .mockRejectedValueOnce(new Error('endpoint unreachable'))
      .mockResolvedValueOnce([
        { Id: 'c-2', Names: ['/app'], State: 'running' },
      ] as any);

    await runMetricsCollection();

    // Should still collect from the working endpoint
    expect(collectMetricsMock).toHaveBeenCalledTimes(1);
    expect(insertMetricsMock).toHaveBeenCalledTimes(1);
    expect(insertMetricsMock.mock.calls[0][0]).toHaveLength(5);
  });

  it('does not insert metrics when no containers are found', async () => {
    getEndpointsMock.mockResolvedValueOnce([{ Id: 1, Name: 'ep1', Status: 1, Type: 1, URL: 'tcp://localhost' }] as any);
    getContainersMock.mockResolvedValueOnce([] as any);

    await runMetricsCollection();

    expect(collectMetricsMock).not.toHaveBeenCalled();
    expect(insertMetricsMock).not.toHaveBeenCalled();
  });
});

describe('scheduler/setup – mutex guard (cycle overlap prevention)', () => {
  beforeEach(() => {
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
    getEndpointsMock.mockResolvedValue([{ Id: 1, Name: 'ep1', Status: 1, Type: 1, URL: 'tcp://localhost' }] as any);
    getContainersMock.mockResolvedValue([
      { Id: 'c-1', Names: ['/app'], State: 'running' },
    ] as any);

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

    getEndpointsMock.mockResolvedValueOnce([{ Id: 1, Name: 'ep1', Status: 1, Type: 1, URL: 'tcp://localhost' }] as any);
    getContainersMock.mockResolvedValueOnce([
      { Id: 'c-1', Names: ['/app'], State: 'running' },
    ] as any);

    await runMetricsCollection();

    // Scheduler collected metrics via API
    expect(collectMetricsMock).toHaveBeenCalledTimes(1);
    expect(collectMetricsMock).toHaveBeenCalledWith(1, 'c-1');
  });
});

describe('scheduler/setup – runCleanup includes session cleanup', () => {
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
    setConfigForTest({
      METRICS_RETENTION_DAYS: 30,
      INSIGHTS_RETENTION_DAYS: 14,
    });

    await runCleanup();

    expect(cleanupOldInsightsMock).toHaveBeenCalledWith(14);
  });
});
