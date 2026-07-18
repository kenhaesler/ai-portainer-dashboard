import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { enrichEndpointsWithLiveDockerInfo, attachStackCounts, computeFleetTotals, collectFleetOverview } from './live-fleet.js';
import * as edgeLive from './edge-live-query.js';
import * as portainerClient from './portainer-client.js';
import * as settingsStore from '../services/settings-store.js';
import { resetConfig, setConfigForTest } from '../config/index.js';
import type { NormalizedEndpoint, NormalizedContainer } from './portainer-normalizers.js';

function ep(partial: Partial<NormalizedEndpoint>): NormalizedEndpoint {
  return {
    id: 1, name: 'e', type: 1, url: '', status: 'up',
    containersRunning: 0, containersStopped: 0,
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

describe('collectFleetOverview', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Bypass the cache so every stage calls its (mocked) fetcher directly.
    setConfigForTest({ CACHE_ENABLED: false, PORTAINER_API_URL: 'http://test.local' });
  });

  afterEach(() => resetConfig());

  it('runs live enrichment concurrently with the stacks fetch and container fan-out (#1500)', async () => {
    vi.spyOn(portainerClient, 'getEndpoints').mockResolvedValue([
      { Id: 1, Name: 'ep-1', Type: 1, URL: 'tcp://x', Status: 1 },
    ] as never);
    const getStacksSpy = vi.spyOn(portainerClient, 'getStacks').mockResolvedValue([] as never);
    const getContainersSpy = vi.spyOn(portainerClient, 'getContainers').mockResolvedValue([] as never);

    // Live enrichment hangs until we resolve it — the independent stages must
    // start anyway instead of serializing behind the /docker/info probes.
    let resolveLive!: (v: null) => void;
    vi.spyOn(edgeLive, 'fetchLiveDockerInfo').mockImplementation(
      () => new Promise((res) => { resolveLive = res; }),
    );

    const pending = collectFleetOverview(cfg);

    await vi.waitFor(() => {
      expect(getStacksSpy).toHaveBeenCalled();
      expect(getContainersSpy).toHaveBeenCalledWith(1);
    });
    resolveLive(null);

    const overview = await pending;
    expect(overview.endpoints).toHaveLength(1);
    expect(overview.endpoints[0].snapshotSource).toBe('unavailable');
    expect(overview.totals.endpoints).toBe(1);
  });

  it('still applies live counts to totals when enrichment succeeds', async () => {
    vi.spyOn(portainerClient, 'getEndpoints').mockResolvedValue([
      { Id: 1, Name: 'ep-1', Type: 1, URL: 'tcp://x', Status: 1 },
    ] as never);
    vi.spyOn(portainerClient, 'getStacks').mockResolvedValue([{ EndpointId: 1 }] as never);
    vi.spyOn(portainerClient, 'getContainers').mockResolvedValue([] as never);
    vi.spyOn(edgeLive, 'fetchLiveDockerInfo').mockResolvedValue({
      containers: 4, containersRunning: 3, containersStopped: 1, ncpu: 2, memTotal: 8e9, fetchedAt: Date.now(),
    });

    const overview = await collectFleetOverview(cfg);
    expect(overview.endpoints[0].snapshotSource).toBe('live');
    expect(overview.endpoints[0].stackCount).toBe(1);
    expect(overview.totals).toMatchObject({ running: 3, stopped: 1, total: 4, stacks: 1 });
  });

  // Issue #1566 — "All Hosts Down" flapping. `collectFleetOverview` is the
  // shared pipeline behind the endpoints route, the scheduler's KPI writer,
  // and LLM context — so this is the highest-leverage place to prove the
  // SWR-cache / Edge-heartbeat fix actually applies in the real (cached)
  // request path, not just in normalizeEndpoint's unit tests.
  describe('SWR-cache / heartbeat conflict (issue #1566)', () => {
    afterEach(() => vi.useRealTimers());

    it('keeps a healthy Edge endpoint "up" when the endpoints list is served stale out of the SWR cache', async () => {
      // Re-enable the real (in-memory) cache for this scenario — the rest of
      // this describe block bypasses it via CACHE_ENABLED: false. REDIS_URL
      // must be explicitly cleared: the shared vitest env config points it at
      // localhost:6379, and a reachable/unreachable Redis there would make
      // this test's cache-layer path (L1 vs. L2) environment-dependent.
      setConfigForTest({ CACHE_ENABLED: true, REDIS_URL: undefined, PORTAINER_API_URL: 'http://test.local' });

      vi.useFakeTimers({ toFake: ['Date'] });
      const fetchedAt = Date.now();
      const lastCheckIn = Math.floor(fetchedAt / 1000) - 30; // healthy 30s before fetch

      vi.spyOn(portainerClient, 'getEndpoints').mockResolvedValue([
        {
          Id: 1, Name: 'edge-1', Type: 4, URL: 'tcp://x', Status: 2,
          EdgeID: 'edge-1', LastCheckInDate: lastCheckIn, EdgeCheckinInterval: 5,
        },
      ] as never);
      vi.spyOn(portainerClient, 'getStacks').mockResolvedValue([] as never);
      vi.spyOn(portainerClient, 'getContainers').mockResolvedValue([] as never);
      vi.spyOn(edgeLive, 'fetchLiveDockerInfo').mockResolvedValue(null);

      // First call populates the endpoints cache (TTL.ENDPOINTS = 900s) and
      // correctly reports the endpoint as up.
      const first = await collectFleetOverview(cfg);
      expect(first.endpoints[0].status).toBe('up');

      // Jump 13 minutes forward — past the 80% staleAt threshold (720s) but
      // before the 900s expiry — so the SAME cached (now-stale) endpoint
      // payload is served immediately while a background refetch kicks off.
      vi.setSystemTime(fetchedAt + 13 * 60 * 1000);

      const second = await collectFleetOverview(cfg);
      // The endpoint's real heartbeat never actually stopped (the mock
      // returns the same LastCheckInDate) — it must still read "up" here.
      // Pre-fix, normalizeEndpoint measured elapsed time against the current
      // wall clock, so this would incorrectly flip to "down".
      expect(second.endpoints[0].status).toBe('up');
    });
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
