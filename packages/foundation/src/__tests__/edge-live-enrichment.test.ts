import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocked at the module boundary — we want to assert the orchestration logic in
// edge-live-enrichment.ts (which endpoints get queried, what the failure path
// does, that disabled config short-circuits) without exercising the real
// network / cache / settings DB.
vi.mock('@dashboard/core/portainer/edge-live-query.js', () => ({
  fetchEdgeLiveDockerInfo: vi.fn(),
}));
vi.mock('@dashboard/core/services/settings-store.js', () => ({
  getEffectiveEdgeLiveQueryConfig: vi.fn(),
}));

import { enrichEdgeStandardWithLiveInfo } from '../services/edge-live-enrichment.js';
import { fetchEdgeLiveDockerInfo } from '@dashboard/core/portainer/edge-live-query.js';
import { getEffectiveEdgeLiveQueryConfig } from '@dashboard/core/services/settings-store.js';
import type { NormalizedEndpoint } from '@dashboard/core/portainer/portainer-normalizers.js';

const mockFetch = vi.mocked(fetchEdgeLiveDockerInfo);
const mockGetConfig = vi.mocked(getEffectiveEdgeLiveQueryConfig);

function makeEndpoint(overrides: Partial<NormalizedEndpoint>): NormalizedEndpoint {
  return {
    id: 1,
    name: 'ep',
    type: 4,
    url: 'http://edge.local:9000',
    status: 'up',
    containersRunning: 0,
    containersStopped: 0,
    containersHealthy: 0,
    containersUnhealthy: 0,
    totalContainers: 0,
    stackCount: 0,
    totalCpu: 0,
    totalMemory: 0,
    isEdge: true,
    edgeMode: 'standard',
    snapshotAge: null,
    checkInInterval: null,
    capabilities: { exec: true, realtimeLogs: true, liveStats: true, immediateActions: true },
    snapshotSource: 'snapshot',
    ...overrides,
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  mockGetConfig.mockReset();
  mockGetConfig.mockResolvedValue({ enabled: true, concurrency: 2, intervalSeconds: 60, timeoutMs: 5000 });
});

describe('enrichEdgeStandardWithLiveInfo', () => {
  it('returns the input unchanged when the feature is disabled', async () => {
    mockGetConfig.mockResolvedValueOnce({ enabled: false, concurrency: 2, intervalSeconds: 60, timeoutMs: 5000 });
    const eps = [makeEndpoint({ id: 1 })];

    const result = await enrichEdgeStandardWithLiveInfo(eps);

    expect(result).toBe(eps);
    expect(result[0].snapshotSource).toBe('snapshot');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('skips endpoints that do not need a live fallback', async () => {
    // Non-edge, with healthy snapshot — must not be touched.
    const eps = [makeEndpoint({ id: 1, isEdge: false, edgeMode: null, containersRunning: 5, totalContainers: 5 })];
    await enrichEdgeStandardWithLiveInfo(eps);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(eps[0].snapshotSource).toBe('snapshot');
  });

  it('queries only Edge Standard endpoints with empty counts', async () => {
    mockFetch.mockResolvedValue({ containers: 3, containersRunning: 2, containersStopped: 1, containersPaused: 0, fetchedAt: 1234567 });

    const eps = [
      // Will be queried — Edge Standard with empty counts.
      makeEndpoint({ id: 1, name: 'edge-empty' }),
      // Skipped — Edge Standard but already has data.
      makeEndpoint({ id: 2, name: 'edge-with-data', containersRunning: 4, totalContainers: 4 }),
      // Skipped — non-edge.
      makeEndpoint({ id: 3, name: 'local', isEdge: false, edgeMode: null }),
      // Skipped — Edge Async.
      makeEndpoint({ id: 4, name: 'edge-async', edgeMode: 'async' }),
      // Skipped — Edge Standard but DOWN.
      makeEndpoint({ id: 5, name: 'edge-down', status: 'down' }),
    ];

    await enrichEdgeStandardWithLiveInfo(eps);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(1, expect.objectContaining({ enabled: true }));
    expect(eps[0].snapshotSource).toBe('live');
    expect(eps[0].containersRunning).toBe(2);
    expect(eps[0].totalContainers).toBe(3);
    // Untouched endpoints keep their original snapshotSource.
    expect(eps[1].snapshotSource).toBe('snapshot');
    expect(eps[2].snapshotSource).toBe('snapshot');
    expect(eps[3].snapshotSource).toBe('snapshot');
    expect(eps[4].snapshotSource).toBe('snapshot');
  });

  it('marks endpoint unavailable when the live fetcher returns null', async () => {
    mockFetch.mockResolvedValue(null);
    const eps = [makeEndpoint({ id: 7 })];

    await enrichEdgeStandardWithLiveInfo(eps);

    expect(eps[0].snapshotSource).toBe('unavailable');
    expect(eps[0].containersRunning).toBe(0);
    expect(eps[0].totalContainers).toBe(0);
  });

  it('isolates failure: one rejected fetch does not poison the others', async () => {
    // Endpoint 1 fails outright (rejection escapes — should not happen in
    // practice since fetcher catches, but allSettled keeps us safe), endpoint
    // 2 succeeds. The dashboard must still get data for the healthy node.
    mockFetch
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ containers: 5, containersRunning: 5, containersStopped: 0, fetchedAt: 1 });

    const eps = [
      makeEndpoint({ id: 1, name: 'bad' }),
      makeEndpoint({ id: 2, name: 'good' }),
    ];

    await enrichEdgeStandardWithLiveInfo(eps);

    expect(eps[0].snapshotSource).toBe('unavailable');
    expect(eps[1].snapshotSource).toBe('live');
    expect(eps[1].containersRunning).toBe(5);
  });
});
