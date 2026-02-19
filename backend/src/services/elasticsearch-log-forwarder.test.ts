import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetElasticsearchConfig = vi.fn();

vi.mock('./elasticsearch-config.js', () => ({
  getElasticsearchConfig: (...args: unknown[]) => mockGetElasticsearchConfig(...args),
}));

vi.mock('./portainer-client.js', async () =>
  (await import('../test-utils/mock-portainer.js')).createPortainerClientMock()
);
vi.mock('./portainer-cache.js', async () =>
  (await import('../test-utils/mock-portainer.js')).createPortainerCacheMock()
);

const {
  resetElasticsearchLogForwarderState,
  runElasticsearchLogForwardingCycle,
  startElasticsearchLogForwarder,
  stopElasticsearchLogForwarder,
} = await import('./elasticsearch-log-forwarder.js');
import { getEndpoints, getContainers, getContainerLogs } from './portainer-client.js';
import { cachedFetchSWR, cachedFetch } from './portainer-cache.js';
const mockGetEndpoints = vi.mocked(getEndpoints);
const mockGetContainers = vi.mocked(getContainers);
const mockGetContainerLogs = vi.mocked(getContainerLogs);
const mockCachedFetchSWR = vi.mocked(cachedFetchSWR);
const mockCachedFetch = vi.mocked(cachedFetch);

describe('elasticsearch-log-forwarder', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    resetElasticsearchLogForwarderState();
    global.fetch = mockFetch;

    mockGetElasticsearchConfig.mockResolvedValue({
      enabled: true,
      endpoint: 'https://logs.internal:9200',
      apiKey: 'abc123',
      indexPattern: 'logs-*',
      verifySsl: true,
    });

    mockGetEndpoints.mockResolvedValue([
      { Id: 1, Name: 'prod-endpoint' },
    ]);

    mockGetContainers.mockResolvedValue([
      {
        Id: 'container-1',
        Names: ['/api'],
        State: 'running',
        Status: 'Up 10 minutes',
        Image: 'api:latest',
      },
    ]);

    mockGetContainerLogs.mockResolvedValue(
      '2026-02-07T12:00:00.000Z INFO Service started\n2026-02-07T12:00:01.000Z ERROR Connection timeout\n'
    );

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ errors: false }),
    });
  });

  it('does not run when elasticsearch is disabled', async () => {
    mockGetElasticsearchConfig.mockResolvedValue(null);

    await runElasticsearchLogForwardingCycle();

    expect(mockGetEndpoints).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('forwards running container logs to elasticsearch bulk api with container metadata', async () => {
    await runElasticsearchLogForwardingCycle();

    expect(mockGetEndpoints).toHaveBeenCalledTimes(1);
    expect(mockGetContainers).toHaveBeenCalledWith(1, true);
    expect(mockGetContainerLogs).toHaveBeenCalledWith(
      1,
      'container-1',
      expect.objectContaining({
        tail: expect.any(Number),
        timestamps: true,
      }),
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0] as [string, { body: string; headers: Record<string, string> }];
    expect(url).toBe('https://logs.internal:9200/_bulk');
    expect(options.headers.Authorization).toBe('ApiKey abc123');

    const lines = options.body.trim().split('\n');
    const firstDoc = JSON.parse(lines[1]);
    const secondDoc = JSON.parse(lines[3]);

    expect(firstDoc.log_origin).toBe('container');
    expect(firstDoc.containerId).toBe('container-1');
    expect(firstDoc.containerName).toBe('api');
    expect(firstDoc.endpointId).toBe(1);
    expect(firstDoc.endpointName).toBe('prod-endpoint');
    expect(firstDoc.level).toBe('info');

    expect(secondDoc.log_origin).toBe('container');
    expect(secondDoc.level).toBe('error');
    expect(secondDoc.containerState).toBe('running');
    expect(secondDoc.containerStatus).toBe('Up 10 minutes');
    expect(secondDoc.containerImage).toBe('api:latest');
  });

  it('uses cachedFetchSWR for endpoints and containers, cachedFetch for logs', async () => {
    await runElasticsearchLogForwardingCycle();

    // cachedFetchSWR should be called for endpoints (1) + containers (1 per endpoint)
    expect(mockCachedFetchSWR).toHaveBeenCalledTimes(2);
    expect(mockCachedFetchSWR).toHaveBeenCalledWith('endpoints', 900, expect.any(Function));
    expect(mockCachedFetchSWR).toHaveBeenCalledWith('containers:1', 300, expect.any(Function));

    // cachedFetch should be called for container logs (1 per running container)
    expect(mockCachedFetch).toHaveBeenCalledTimes(1);
    expect(mockCachedFetch).toHaveBeenCalledWith('es-logs:1:container-1', 25, expect.any(Function));
  });

  it('halts work when elasticsearch gets disabled mid-cycle', async () => {
    mockGetContainers.mockResolvedValue([
      {
        Id: 'container-1',
        Names: ['/api'],
        State: 'running',
        Status: 'Up 10 minutes',
        Image: 'api:latest',
      },
      {
        Id: 'container-2',
        Names: ['/worker'],
        State: 'running',
        Status: 'Up 2 minutes',
        Image: 'worker:latest',
      },
    ]);

    let calls = 0;
    mockGetElasticsearchConfig.mockImplementation(async () => {
      calls += 1;
      if (calls >= 4) return null;
      return {
        enabled: true,
        endpoint: 'https://logs.internal:9200',
        apiKey: 'abc123',
        indexPattern: 'logs-*',
        verifySsl: true,
      };
    });

    await runElasticsearchLogForwardingCycle();

    expect(mockGetContainerLogs).toHaveBeenCalledTimes(1);
    expect(mockGetContainerLogs).toHaveBeenCalledWith(1, 'container-1', expect.any(Object));
  });

  it('retries bulk indexing failures', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ errors: false }),
      });

    await runElasticsearchLogForwardingCycle();

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  describe('startElasticsearchLogForwarder', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      stopElasticsearchLogForwarder();
      vi.useRealTimers();
    });

    it('does not create timer when elasticsearch is disabled', async () => {
      mockGetElasticsearchConfig.mockResolvedValue(null);

      await startElasticsearchLogForwarder();

      // Advance past the interval — no cycle should run
      vi.advanceTimersByTime(60_000);
      expect(mockGetEndpoints).not.toHaveBeenCalled();
    });

    it('creates timer when elasticsearch is enabled', async () => {
      await startElasticsearchLogForwarder();

      // The immediate cycle should have triggered endpoint fetch
      expect(mockGetEndpoints).toHaveBeenCalled();
    });
  });
});
