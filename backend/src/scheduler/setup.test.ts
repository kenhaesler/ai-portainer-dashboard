import { describe, it, expect, vi, beforeEach } from 'vitest';

const cachedFetchSWRSpy = vi.fn((_key: string, _ttl: number, fetcher: () => Promise<unknown>) =>
  fetcher(),
);

vi.mock('../services/portainer-cache.js', () => ({
  cachedFetchSWR: (...args: unknown[]) =>
    cachedFetchSWRSpy(args[0] as string, args[1] as number, args[2] as () => Promise<unknown>),
  getCacheKey: (...args: unknown[]) => args.join(':'),
  TTL: { ENDPOINTS: 900, CONTAINERS: 300, IMAGES: 600 },
}));

const getEndpointsMock = vi.fn().mockResolvedValue([{ Id: 1, Name: 'local' }]);
const getImagesMock = vi.fn().mockResolvedValue([
  { Id: 'sha256:abc123', RepoTags: ['nginx:latest'] },
]);

vi.mock('../services/portainer-client.js', () => ({
  getEndpoints: (...args: unknown[]) => getEndpointsMock(...args),
  getContainers: vi.fn().mockResolvedValue([]),
  getImages: (...args: unknown[]) => getImagesMock(...args),
}));

vi.mock('../services/image-staleness.js', () => ({
  runStalenessChecks: vi.fn().mockResolvedValue({ checked: 1, stale: 0 }),
}));

vi.mock('../config/index.js', () => ({
  getConfig: () => ({
    CACHE_ENABLED: true,
    METRICS_COLLECTION_ENABLED: false,
    MONITORING_ENABLED: false,
    WEBHOOKS_ENABLED: false,
    IMAGE_STALENESS_CHECK_ENABLED: false,
    METRICS_RETENTION_DAYS: 30,
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

vi.mock('../services/monitoring-service.js', () => ({ runMonitoringCycle: vi.fn() }));
vi.mock('../services/metrics-collector.js', () => ({ collectMetrics: vi.fn() }));
vi.mock('../services/metrics-store.js', () => ({ insertMetrics: vi.fn(), cleanOldMetrics: vi.fn() }));
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
vi.mock('../services/portainer-normalizers.js', () => ({ normalizeEndpoint: vi.fn() }));
vi.mock('../services/trace-context.js', () => ({ runWithTraceContext: vi.fn() }));
vi.mock('../services/elasticsearch-log-forwarder.js', () => ({
  startElasticsearchLogForwarder: vi.fn(),
  stopElasticsearchLogForwarder: vi.fn(),
}));

import { runImageStalenessCheck } from './setup.js';

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
});
