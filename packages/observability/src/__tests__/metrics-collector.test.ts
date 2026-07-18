import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';

import * as portainerClient from '@dashboard/core/portainer/portainer-client.js';
import * as portainerCache from '@dashboard/core/portainer/portainer-cache.js';
import { cache } from '@dashboard/core/portainer/portainer-cache.js';
import { closeTestRedis } from '@dashboard/core/test-utils/test-redis-helper.js';

const { collectMetrics } = await import('../services/metrics-collector.js');

beforeAll(async () => {
  await cache.clear();
});

afterAll(async () => {
  await closeTestRedis();
});

describe('metrics-collector', () => {
  beforeEach(async () => {
    await cache.clear();
    vi.restoreAllMocks();
    vi.spyOn(portainerClient, 'getContainerStats').mockResolvedValue({
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
    // Well-formed stats: (cpuDelta=100 / systemDelta=500) * numCpus=2 * 100 = 40
    expect(result.cpu).toBe(40);
    // (usage=1_048_576 - cache=0) / limit=2_097_152 * 100 = 50
    expect(result.memory).toBe(50);
  });

  // #1567 — a container whose CPU/memory could not be reliably computed must
  // be reported as `null` ("unknown"), never as a fabricated `0`, so callers
  // that persist/aggregate these values can exclude the sample instead of
  // silently counting "unknown" as "idle".
  describe('#1567 — unknown samples reported as null, not 0', () => {
    it('reports cpu as null when system_cpu_usage is missing from the current snapshot', async () => {
      vi.spyOn(portainerClient, 'getContainerStats').mockResolvedValue({
        cpu_stats: {
          cpu_usage: { total_usage: 200 },
          // system_cpu_usage missing
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
      });

      const result = await collectMetrics(1, 'missing-current-system-cpu');

      expect(result.cpu).toBeNull();
      // Memory is independently computable and must not be affected.
      expect(result.memory).toBe(50);
    });

    it('reports cpu as null when system_cpu_usage is missing from the previous snapshot', async () => {
      vi.spyOn(portainerClient, 'getContainerStats').mockResolvedValue({
        cpu_stats: {
          cpu_usage: { total_usage: 200 },
          system_cpu_usage: 1000,
          online_cpus: 2,
        },
        precpu_stats: {
          cpu_usage: { total_usage: 100 },
          // system_cpu_usage missing
        },
        memory_stats: {
          usage: 1_048_576,
          limit: 2_097_152,
          stats: { cache: 0 },
        },
      });

      const result = await collectMetrics(1, 'missing-precpu-system-cpu');

      expect(result.cpu).toBeNull();
      expect(result.memory).toBe(50);
    });

    it('reports cpu as null when the system_cpu_usage delta is non-positive (counter reset)', async () => {
      vi.spyOn(portainerClient, 'getContainerStats').mockResolvedValue({
        cpu_stats: {
          cpu_usage: { total_usage: 200 },
          system_cpu_usage: 400, // lower than precpu's 500 -> non-positive delta
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
      });

      const result = await collectMetrics(1, 'non-positive-system-delta');

      expect(result.cpu).toBeNull();
    });

    it('reports memory as null when memory_stats.limit is missing', async () => {
      vi.spyOn(portainerClient, 'getContainerStats').mockResolvedValue({
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
          // limit missing
          stats: { cache: 0 },
        },
      });

      const result = await collectMetrics(1, 'missing-memory-limit');

      expect(result.memory).toBeNull();
      // CPU is independently computable and must not be affected.
      expect(result.cpu).toBe(40);
      // The raw byte usage is still known and reported (not a percentage).
      expect(result.memoryBytes).toBe(1_048_576);
    });

    it('reports memory as null when memory_stats.usage is missing', async () => {
      vi.spyOn(portainerClient, 'getContainerStats').mockResolvedValue({
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
          // usage missing — a valid limit alone cannot establish utilization
          limit: 2_097_152,
          stats: { cache: 0 },
        },
      });

      const result = await collectMetrics(1, 'missing-memory-usage');

      expect(result.memory).toBeNull();
      expect(result.cpu).toBe(40);
      expect(result.memoryBytes).toBe(0);
    });

    it('reports memory as null when memory_stats.limit is zero', async () => {
      vi.spyOn(portainerClient, 'getContainerStats').mockResolvedValue({
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
          limit: 0,
          stats: { cache: 0 },
        },
      });

      const result = await collectMetrics(1, 'zero-memory-limit');

      expect(result.memory).toBeNull();
    });

    it('reports both cpu and memory as null when both are unknown', async () => {
      vi.spyOn(portainerClient, 'getContainerStats').mockResolvedValue({
        cpu_stats: {
          cpu_usage: { total_usage: 200 },
          online_cpus: 2,
        },
        precpu_stats: {
          cpu_usage: { total_usage: 100 },
        },
        memory_stats: {
          usage: 1_048_576,
          stats: { cache: 0 },
        },
      });

      const result = await collectMetrics(1, 'both-unknown');

      expect(result.cpu).toBeNull();
      expect(result.memory).toBeNull();
      // Network + byte totals are unrelated and still reported.
      expect(result.memoryBytes).toBe(1_048_576);
    });
  });

  it('wraps getContainerStats in cachedFetch with STATS TTL', async () => {
    const cachedFetchSpy = vi.spyOn(portainerCache, 'cachedFetch');

    await collectMetrics(1, 'abc123');

    expect(cachedFetchSpy).toHaveBeenCalledTimes(1);
    expect(cachedFetchSpy).toHaveBeenCalledWith('stats:1:abc123', 60, expect.any(Function));
  });

  it('calls getContainerStats with correct endpoint and container IDs', async () => {
    // Bypass cache to ensure fetcher is called (verifies getContainerStats args)
    vi.spyOn(portainerCache, 'cachedFetch').mockImplementation(
      async (_key: string, _ttl: number, fetcher: () => Promise<unknown>) => fetcher(),
    );

    await collectMetrics(5, 'def456');

    expect(portainerClient.getContainerStats).toHaveBeenCalledWith(5, 'def456');
    expect(portainerCache.cachedFetch).toHaveBeenCalledWith('stats:5:def456', 60, expect.any(Function));
  });

  it('computes network totals across multiple interfaces', async () => {
    vi.spyOn(portainerClient, 'getContainerStats').mockResolvedValue({
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
