import { describe, it, expect, vi, beforeEach } from 'vitest';
import { enrichEndpointsWithLiveDockerInfo, attachStackCounts, computeFleetTotals } from './live-fleet.js';
import * as edgeLive from './edge-live-query.js';
import * as settingsStore from '../services/settings-store.js';
import type { NormalizedEndpoint, NormalizedContainer } from './portainer-normalizers.js';

function ep(partial: Partial<NormalizedEndpoint>): NormalizedEndpoint {
  return {
    id: 1, name: 'e', type: 1, url: '', status: 'up',
    containersRunning: 0, containersStopped: 0, containersHealthy: 0, containersUnhealthy: 0,
    totalContainers: 0, stackCount: 0, totalCpu: 0, totalMemory: 0,
    isEdge: false, edgeMode: null, snapshotAge: null, checkInInterval: null,
    capabilities: { exec: true, realtimeLogs: true, liveStats: true, immediateActions: true },
    snapshotSource: 'unavailable', ...partial,
  };
}
const cfg = { enabled: true, concurrency: 2, intervalSeconds: 60, timeoutMs: 5000 };

describe('enrichEndpointsWithLiveDockerInfo', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('overlays live counts/cpu/mem on up Docker endpoints', async () => {
    vi.spyOn(edgeLive, 'fetchLiveDockerInfo').mockResolvedValue({ containers: 12, containersRunning: 9, containersStopped: 3, ncpu: 8, memTotal: 16e9, fetchedAt: Date.now() });
    const eps = [ep({ id: 1, type: 1, status: 'up' })];
    await enrichEndpointsWithLiveDockerInfo(eps, cfg);
    expect(eps[0].snapshotSource).toBe('live');
    expect(eps[0].containersRunning).toBe(9);
    expect(eps[0].totalCpu).toBe(8);
  });

  it('marks unsupported (down / Edge Async / K8s) unavailable without fetching', async () => {
    const spy = vi.spyOn(edgeLive, 'fetchLiveDockerInfo').mockResolvedValue(null);
    const eps = [ep({ id: 1, type: 1, status: 'down' }), ep({ id: 7, type: 7, status: 'up', isEdge: true, edgeMode: 'async' })];
    await enrichEndpointsWithLiveDockerInfo(eps, cfg);
    expect(eps[0].snapshotSource).toBe('unavailable');
    expect(eps[1].snapshotSource).toBe('unavailable');
    expect(spy).not.toHaveBeenCalled();
  });

  it('marks supported endpoint unavailable when fetch returns null', async () => {
    vi.spyOn(edgeLive, 'fetchLiveDockerInfo').mockResolvedValue(null);
    const eps = [ep({ id: 1, type: 4, status: 'up', isEdge: true, edgeMode: 'standard' })];
    await enrichEndpointsWithLiveDockerInfo(eps, cfg);
    expect(eps[0].snapshotSource).toBe('unavailable');
  });

  it('isolates a single failure across endpoints', async () => {
    vi.spyOn(edgeLive, 'fetchLiveDockerInfo').mockImplementation(async (id: number) => id === 1 ? null : { containers: 1, containersRunning: 1, containersStopped: 0, ncpu: 1, memTotal: 1, fetchedAt: Date.now() });
    const eps = [ep({ id: 1, type: 1 }), ep({ id: 2, type: 1 })];
    await enrichEndpointsWithLiveDockerInfo(eps, cfg);
    expect(eps[0].snapshotSource).toBe('unavailable');
    expect(eps[1].snapshotSource).toBe('live');
  });

  it('disabled config leaves everything unavailable, no fetch', async () => {
    const spy = vi.spyOn(edgeLive, 'fetchLiveDockerInfo').mockResolvedValue(null);
    const eps = [ep({ id: 1, type: 1, status: 'up' })];
    await enrichEndpointsWithLiveDockerInfo(eps, { ...cfg, enabled: false });
    expect(eps[0].snapshotSource).toBe('unavailable');
    expect(spy).not.toHaveBeenCalled();
  });

  it('config load failure leaves everything unavailable without fetching', async () => {
    vi.spyOn(settingsStore, 'getEffectiveEdgeLiveQueryConfig').mockRejectedValue(new Error('db unavailable'));
    const spy = vi.spyOn(edgeLive, 'fetchLiveDockerInfo');
    const eps = [ep({ id: 1, type: 1, status: 'up' })];
    await enrichEndpointsWithLiveDockerInfo(eps); // no cfg → triggers the load path
    expect(eps[0].snapshotSource).toBe('unavailable');
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('attachStackCounts', () => {
  it('counts Portainer stacks per endpoint id', () => {
    const eps = [ep({ id: 1 }), ep({ id: 2 })];
    attachStackCounts(eps, [{ EndpointId: 1 }, { EndpointId: 1 }, { EndpointId: 2 }] as any);
    expect(eps[0].stackCount).toBe(2);
    expect(eps[1].stackCount).toBe(1);
  });
  it('zeroes endpoints with no stacks', () => {
    const eps = [ep({ id: 9 })];
    attachStackCounts(eps, [{ EndpointId: 1 }] as any);
    expect(eps[0].stackCount).toBe(0);
  });
});

describe('computeFleetTotals', () => {
  const c = (healthStatus?: string, state = 'running'): NormalizedContainer => ({
    id: 'x', name: 'n', image: 'i', state: state as NormalizedContainer['state'], status: '', created: 0,
    endpointId: 1, endpointName: 'e', ports: [], networks: [], networkIPs: {}, labels: {}, healthStatus,
  });
  it('sums endpoint counts and derives health from containers + stacks total', () => {
    const eps = [ep({ id: 1, status: 'up', containersRunning: 9, containersStopped: 3, totalContainers: 12 }), ep({ id: 2, status: 'down' })];
    const totals = computeFleetTotals(eps, [c('healthy'), c('unhealthy'), c(undefined)], 5);
    expect(totals).toMatchObject({ endpoints: 2, endpointsUp: 1, endpointsDown: 1, running: 9, stopped: 3, total: 12, healthy: 1, unhealthy: 1, stacks: 5 });
  });
});
