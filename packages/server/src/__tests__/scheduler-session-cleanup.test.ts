/**
 * Issue #1114 — hourly expired-session cleanup.
 *
 * Verifies that startScheduler() registers a 1-hour interval that calls
 * cleanExpiredSessions, plus a startup-delay run. Kept separate from the
 * main scheduler.test.ts because this suite uses fake timers across the
 * whole test, which would interfere with the cache/Redis setup there.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { setConfigForTest, resetConfig } from '@dashboard/core/config/index.js';

// Capture the cleanExpiredSessions mock so we can assert against it.
const cleanExpiredSessionsMock = vi.fn().mockResolvedValue(0);
vi.mock('@dashboard/core/services/session-store.js', () => ({
  cleanExpiredSessions: (...args: unknown[]) => cleanExpiredSessionsMock(...args),
}));
// The scheduler imports cleanExpiredSessions via the services barrel.
vi.mock('@dashboard/core/services/index.js', async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return {
    ...orig,
    cleanExpiredSessions: (...args: unknown[]) => cleanExpiredSessionsMock(...args),
    // Settings reads must return null so the Portainer-backup branch is skipped.
    getSetting: vi.fn().mockResolvedValue(null),
    // Monitoring/Harbor config: disabled so those intervals stay quiet.
    getEffectiveMonitoringSchedulerConfig: vi.fn().mockResolvedValue({ enabled: false, intervalMinutes: 60 }),
    getEffectiveHarborConfig: vi.fn().mockResolvedValue({ enabled: false, syncIntervalMinutes: 30 }),
  };
});

// Domain mocks — keep the scheduler's other subsystems quiet.
vi.mock('@dashboard/security', () => ({
  runStalenessChecks: vi.fn().mockResolvedValue({ checked: 0, stale: 0 }),
  cleanupOldCaptures: vi.fn(),
  cleanupOrphanedSidecars: vi.fn().mockResolvedValue(0),
  cleanupOldVulnerabilities: vi.fn().mockResolvedValue(0),
  isHarborConfiguredAsync: vi.fn().mockResolvedValue(false),
  isHarborSyncRunning: vi.fn().mockReturnValue(false),
  runHarborSync: vi.fn().mockResolvedValue({}),
}));

vi.mock('@dashboard/observability', async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return {
    ...orig,
    collectMetrics: vi.fn().mockResolvedValue({ cpu: 0, memory: 0, memoryBytes: 0, networkRxBytes: 0, networkTxBytes: 0 }),
    insertMetrics: vi.fn().mockResolvedValue(undefined),
    cleanOldMetrics: vi.fn().mockResolvedValue(0),
    insertKpiSnapshot: vi.fn(),
    cleanOldKpiSnapshots: vi.fn().mockResolvedValue(0),
    recordNetworkSample: vi.fn(),
    pruneStaleEntries: vi.fn().mockReturnValue(0),
  };
});

vi.mock('@dashboard/operations', () => ({
  createPortainerBackup: vi.fn(),
  cleanupOldPortainerBackups: vi.fn(),
  startWebhookListener: vi.fn(),
  stopWebhookListener: vi.fn(),
  processRetries: vi.fn().mockResolvedValue(0),
}));

vi.mock('@dashboard/ai', () => ({
  startCooldownSweep: vi.fn(),
  stopCooldownSweep: vi.fn(),
  cleanupOldInsights: vi.fn().mockResolvedValue(0),
}));
// initCooldownStore would otherwise attempt a real Redis connect at startup.
vi.mock('@dashboard/core/services/cooldown-store.js', () => ({
  initCooldownStore: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@dashboard/infrastructure', () => ({
  startElasticsearchLogForwarder: vi.fn().mockResolvedValue(undefined),
  stopElasticsearchLogForwarder: vi.fn(),
}));

// Run the trace-context callback for real so the interval body actually
// invokes cleanExpiredSessions.
vi.mock('@dashboard/core/tracing/index.js', () => ({
  runWithTraceContext: (_ctx: unknown, fn: () => unknown) => fn(),
}));

// Bypass Portainer client — getEndpoints returns [] so waitForPortainer
// succeeds on the first attempt.
vi.mock('@dashboard/core/portainer/index.js', async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return {
    ...orig,
    getEndpoints: vi.fn().mockResolvedValue([]),
    getContainers: vi.fn().mockResolvedValue([]),
    getImages: vi.fn().mockResolvedValue([]),
    isEndpointDegraded: vi.fn().mockReturnValue(false),
    cachedFetch: vi.fn(async (_k: string, _t: number, fn: () => Promise<unknown>) => fn()),
    cachedFetchSWR: vi.fn(async (_k: string, _t: number, fn: () => Promise<unknown>) => fn()),
    getCacheKey: vi.fn((...args: (string | number)[]) => args.join(':')),
    TTL: { ENDPOINTS: 900, CONTAINERS: 300, IMAGES: 600 },
  };
});

import { startScheduler, stopScheduler } from '../scheduler.js';

beforeAll(() => {
  setConfigForTest({
    CACHE_ENABLED: false,
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

afterAll(() => {
  resetConfig();
});

beforeEach(() => {
  cleanExpiredSessionsMock.mockClear();
  cleanExpiredSessionsMock.mockResolvedValue(0);
});

afterEach(() => {
  stopScheduler();
  vi.useRealTimers();
});

describe('scheduler — hourly session cleanup (issue #1114)', () => {
  it('runs cleanExpiredSessions ~30 s after startup', async () => {
    vi.useFakeTimers();
    const noopMonitoring = async () => {};
    const startPromise = startScheduler(noopMonitoring);
    // waitForPortainer + warmCache resolve via the mocked getEndpoints
    await vi.advanceTimersByTimeAsync(0);
    await startPromise;

    // Startup delay is 30 s — advance just past it.
    await vi.advanceTimersByTimeAsync(30_001);

    expect(cleanExpiredSessionsMock).toHaveBeenCalled();
  });

  it('runs cleanExpiredSessions on every hour after the first hourly tick', async () => {
    vi.useFakeTimers();
    const noopMonitoring = async () => {};
    const startPromise = startScheduler(noopMonitoring);
    await vi.advanceTimersByTimeAsync(0);
    await startPromise;

    // Skip past the 30 s startup-delay run so we count only hourly ticks.
    await vi.advanceTimersByTimeAsync(30_001);
    cleanExpiredSessionsMock.mockClear();

    // First hourly tick.
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(cleanExpiredSessionsMock).toHaveBeenCalledTimes(1);

    // Second hourly tick.
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(cleanExpiredSessionsMock).toHaveBeenCalledTimes(2);
  });

  it('does not run hourly cleanup before the first hour elapses', async () => {
    vi.useFakeTimers();
    const noopMonitoring = async () => {};
    const startPromise = startScheduler(noopMonitoring);
    await vi.advanceTimersByTimeAsync(0);
    await startPromise;

    // Skip past startup-delay run.
    await vi.advanceTimersByTimeAsync(30_001);
    cleanExpiredSessionsMock.mockClear();

    // Advance only 30 minutes — not enough for the hourly interval.
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(cleanExpiredSessionsMock).not.toHaveBeenCalled();
  });

  it('continues running even when cleanExpiredSessions throws', async () => {
    vi.useFakeTimers();
    cleanExpiredSessionsMock.mockRejectedValue(new Error('DB unavailable'));

    const noopMonitoring = async () => {};
    const startPromise = startScheduler(noopMonitoring);
    await vi.advanceTimersByTimeAsync(0);
    await startPromise;

    // Startup-delay run swallows the error.
    await vi.advanceTimersByTimeAsync(30_001);
    expect(cleanExpiredSessionsMock).toHaveBeenCalled();
    cleanExpiredSessionsMock.mockClear();

    // Subsequent hourly tick still fires.
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(cleanExpiredSessionsMock).toHaveBeenCalledTimes(1);
  });
});
