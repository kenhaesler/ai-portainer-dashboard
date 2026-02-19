import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./portainer-client.js', async () =>
  (await import('../test-utils/mock-portainer.js')).createPortainerClientMock()
);
vi.mock('./portainer-cache.js', async () =>
  (await import('../test-utils/mock-portainer.js')).createPortainerCacheMock()
);

const { collectMetrics } = await import('./metrics-collector.js');
import { getContainerStats } from './portainer-client.js';
import { cachedFetch } from './portainer-cache.js';
const mockGetContainerStats = vi.mocked(getContainerStats);
const mockCachedFetch = vi.mocked(cachedFetch);

describe('metrics-collector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetContainerStats.mockResolvedValue({
      cpu_stats: {
        cpu_usage: { total_usage: 200 },
        system_cpu_usage: 1000,
        online_cpus: 2,
      },
      precpu_stats: {
        cpu_usage: { total_usage: 100 },
        system_cpu_usage: 500,
      },
      memory_stats: {
        usage: 1_048_576,
        limit: 2_097_152,
        stats: { cache: 0 },
      },
      networks: {
        eth0: { rx_bytes: 1024, tx_bytes: 512 },
      },
    });
  });

  it('returns cpu, memory, and network metrics', async () => {
    const result = await collectMetrics(1, 'abc123');

    expect(result).toHaveProperty('cpu');
    expect(result).toHaveProperty('memory');
    expect(result).toHaveProperty('memoryBytes');
    expect(result).toHaveProperty('networkRxBytes');
    expect(result).toHaveProperty('networkTxBytes');
    expect(result.cpu).toBeGreaterThanOrEqual(0);
    expect(result.memory).toBeGreaterThanOrEqual(0);
  });

  it('wraps getContainerStats in cachedFetch with STATS TTL', async () => {
    await collectMetrics(1, 'abc123');

    expect(mockCachedFetch).toHaveBeenCalledTimes(1);
    expect(mockCachedFetch).toHaveBeenCalledWith('stats:1:abc123', 60, expect.any(Function));
  });

  it('calls getContainerStats with correct endpoint and container IDs', async () => {
    await collectMetrics(5, 'def456');

    expect(mockGetContainerStats).toHaveBeenCalledWith(5, 'def456');
    expect(mockCachedFetch).toHaveBeenCalledWith('stats:5:def456', 60, expect.any(Function));
  });

  it('computes network totals across multiple interfaces', async () => {
    mockGetContainerStats.mockResolvedValue({
      cpu_stats: {
        cpu_usage: { total_usage: 200 },
        system_cpu_usage: 1000,
        online_cpus: 1,
      },
      precpu_stats: {
        cpu_usage: { total_usage: 100 },
        system_cpu_usage: 500,
      },
      memory_stats: {
        usage: 1024,
        limit: 4096,
        stats: {},
      },
      networks: {
        eth0: { rx_bytes: 100, tx_bytes: 50 },
        eth1: { rx_bytes: 200, tx_bytes: 150 },
      },
    });

    const result = await collectMetrics(1, 'multi-net');

    expect(result.networkRxBytes).toBe(300);
    expect(result.networkTxBytes).toBe(200);
  });
});
