import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  normalizeEndpoint,
  normalizeEndpointAsOf,
  endpointSupportsLiveDockerInfo,
  applyLiveDockerInfo,
  markLiveUnavailable,
} from './portainer-normalizers.js';
import type { Endpoint } from '../models/portainer.js';

function makeEndpoint(overrides: Partial<Endpoint> = {}): Endpoint {
  return {
    Id: 1,
    Name: 'test-endpoint',
    Type: 1,
    URL: 'tcp://10.0.0.1:9001',
    Status: 1,
    Snapshots: [{
      TotalCPU: 4,
      TotalMemory: 8589934592,
      RunningContainerCount: 3,
      StoppedContainerCount: 1,
      HealthyContainerCount: 2,
      UnhealthyContainerCount: 0,
      StackCount: 2,
      Time: Math.floor(Date.now() / 1000) - 60, // 60 seconds ago
    }],
    TagIds: [],
    ...overrides,
  } as Endpoint;
}

describe('normalizeEndpoint — Edge Agent fields', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-10T12:00:00Z'));
  });

  it('returns edgeMode: null for non-Edge endpoint (Type 1)', () => {
    const ep = makeEndpoint({ Type: 1 });
    const result = normalizeEndpoint(ep);

    expect(result.isEdge).toBe(false);
    expect(result.edgeMode).toBeNull();
    expect(result.checkInInterval).toBeNull();
  });

  it('returns edgeMode: "standard" for Edge Standard endpoint (EdgeID set, no QueryDate)', () => {
    const ep = makeEndpoint({
      Type: 4,
      EdgeID: 'edge-abc-123',
      EdgeKey: 'key123',
      LastCheckInDate: Math.floor(Date.now() / 1000) - 30,
      EdgeCheckinInterval: 5,
    });
    const result = normalizeEndpoint(ep);

    expect(result.isEdge).toBe(true);
    expect(result.edgeMode).toBe('standard');
    expect(result.checkInInterval).toBe(5);
    expect(result.lastCheckIn).toBeDefined();
  });

  it('returns edgeMode: "async" for Edge Async endpoint (Type 7)', () => {
    const ep = makeEndpoint({
      Type: 7,
      EdgeID: 'edge-async-456',
      EdgeKey: 'key456',
      LastCheckInDate: Math.floor(Date.now() / 1000) - 120,
      EdgeCheckinInterval: 60,
    });
    const result = normalizeEndpoint(ep);

    expect(result.isEdge).toBe(true);
    expect(result.edgeMode).toBe('async');
    expect(result.checkInInterval).toBe(60);
  });

  it('returns edgeMode: "standard" for Type 4 Edge endpoint even with QueryDate set', () => {
    const ep = makeEndpoint({
      Type: 4,
      EdgeID: 'edge-std-with-qd',
      EdgeKey: 'key789',
      LastCheckInDate: Math.floor(Date.now() / 1000) - 30,
      EdgeCheckinInterval: 5,
      QueryDate: Math.floor(Date.now() / 1000) - 300,
    } as any);
    const result = normalizeEndpoint(ep);

    expect(result.isEdge).toBe(true);
    expect(result.edgeMode).toBe('standard');
    expect(result.capabilities.realtimeLogs).toBe(true);
  });

  it('snapshotAge is null from normalizeEndpoint (set only by applyLiveDockerInfo)', () => {
    const snapshotTime = Math.floor(Date.now() / 1000) - 120; // 2 minutes ago
    const ep = makeEndpoint({
      Snapshots: [{
        TotalCPU: 4,
        TotalMemory: 8589934592,
        RunningContainerCount: 3,
        StoppedContainerCount: 1,
        HealthyContainerCount: 2,
        UnhealthyContainerCount: 0,
        StackCount: 2,
        Time: snapshotTime,
      }],
    });
    const result = normalizeEndpoint(ep);

    // normalizeEndpoint no longer reads Snapshots[]; snapshotAge is always null
    // until applyLiveDockerInfo sets it from fetchedAt.
    expect(result.snapshotAge).toBeNull();
  });

  it('returns snapshotAge: null when no snapshot Time', () => {
    const ep = makeEndpoint({
      Snapshots: [{
        TotalCPU: 4,
        TotalMemory: 8589934592,
        RunningContainerCount: 0,
        StoppedContainerCount: 0,
        HealthyContainerCount: 0,
        UnhealthyContainerCount: 0,
        StackCount: 0,
      }],
    });
    const result = normalizeEndpoint(ep);
    expect(result.snapshotAge).toBeNull();
  });

  it('returns snapshotAge: null when no snapshots', () => {
    const ep = makeEndpoint({ Snapshots: [] });
    const result = normalizeEndpoint(ep);
    expect(result.snapshotAge).toBeNull();
  });

  describe('capabilities', () => {
    it('returns all true for non-edge endpoint', () => {
      const ep = makeEndpoint({ Type: 1 });
      const result = normalizeEndpoint(ep);
      expect(result.capabilities).toEqual({
        exec: true,
        realtimeLogs: true,
        liveStats: true,
        immediateActions: true,
      });
    });

    it('returns all true for Edge Standard endpoint', () => {
      const ep = makeEndpoint({
        Type: 4,
        EdgeID: 'edge-std',
      });
      const result = normalizeEndpoint(ep);
      expect(result.capabilities).toEqual({
        exec: true,
        realtimeLogs: true,
        liveStats: true,
        immediateActions: true,
      });
    });

    it('returns all false for Edge Async endpoint (Type 7)', () => {
      const ep = makeEndpoint({
        Type: 7,
        EdgeID: 'edge-async',
      });
      const result = normalizeEndpoint(ep);
      expect(result.capabilities).toEqual({
        exec: false,
        realtimeLogs: false,
        liveStats: false,
        immediateActions: false,
      });
    });
  });

  it('preserves existing normalizeEndpoint fields', () => {
    const ep = makeEndpoint({
      Agent: { Version: '2.19.0' },
    });
    const result = normalizeEndpoint(ep);

    expect(result.id).toBe(1);
    expect(result.name).toBe('test-endpoint');
    expect(result.status).toBe('up');
    // Snapshot counts are no longer read — all counts start at 0.
    expect(result.containersRunning).toBe(0);
    expect(result.agentVersion).toBe('2.19.0');
  });

  describe('Edge status detection (cache-aware heartbeat)', () => {
    it('marks Edge endpoint as "up" when Portainer Status=1', () => {
      const ep = makeEndpoint({
        Type: 4,
        EdgeID: 'edge-1',
        Status: 1,
      });
      expect(normalizeEndpoint(ep).status).toBe('up');
    });

    it('marks Edge endpoint as "up" when Status=2 but checked in recently', () => {
      const ep = makeEndpoint({
        Type: 4,
        EdgeID: 'edge-2',
        Status: 2,
        LastCheckInDate: Math.floor(Date.now() / 1000) - 30, // 30s ago
        EdgeCheckinInterval: 5,
      });
      // Status=2 for Edge means "tunnel closed" (normal), heartbeat is recent → up
      expect(normalizeEndpoint(ep).status).toBe('up');
    });

    it('marks Edge endpoint as "down" when check-in is 900s ago (regression: was "up" before #1006)', () => {
      const ep = makeEndpoint({
        Type: 4,
        EdgeID: 'edge-3',
        Status: 2,
        LastCheckInDate: Math.floor(Date.now() / 1000) - 900, // 15 min ago
        EdgeCheckinInterval: 5,
      });
      // Threshold = max((5*2)+20, 60) + 30 = 90s. 900 > 90 → down (issue #1006)
      expect(normalizeEndpoint(ep).status).toBe('down');
    });

    it('marks Edge endpoint as "up" when check-in is within jitter threshold', () => {
      const ep = makeEndpoint({
        Type: 4,
        EdgeID: 'edge-3b',
        Status: 2,
        LastCheckInDate: Math.floor(Date.now() / 1000) - 85, // 85s ago
        EdgeCheckinInterval: 5,
      });
      // Threshold = max((5*2)+20, 60) + 30 = 90s. 85 <= 90 → up
      expect(normalizeEndpoint(ep).status).toBe('up');
    });

    it('marks Edge endpoint as "down" when check-in exceeds heartbeat + jitter threshold', () => {
      const ep = makeEndpoint({
        Type: 4,
        EdgeID: 'edge-4',
        Status: 2,
        LastCheckInDate: Math.floor(Date.now() / 1000) - 1200, // 20 min ago
        EdgeCheckinInterval: 5,
      });
      // Threshold = max((5*2)+20, 60) + 30 = 90s. 1200 > 90 → down
      expect(normalizeEndpoint(ep).status).toBe('down');
    });

    it('marks Edge endpoint as "down" when no LastCheckInDate', () => {
      const ep = makeEndpoint({
        Type: 4,
        EdgeID: 'edge-5',
        Status: 2,
      });
      expect(normalizeEndpoint(ep).status).toBe('down');
    });

    it('marks Edge endpoint as "down" when LastCheckInDate is 0', () => {
      const ep = makeEndpoint({
        Type: 4,
        EdgeID: 'edge-6',
        Status: 2,
        LastCheckInDate: 0,
      });
      expect(normalizeEndpoint(ep).status).toBe('down');
    });

    it('non-Edge trusts Portainer Status field directly', () => {
      const up = makeEndpoint({ Type: 1, Status: 1 });
      expect(normalizeEndpoint(up).status).toBe('up');

      const down = makeEndpoint({ Type: 1, Status: 2 });
      expect(normalizeEndpoint(down).status).toBe('down');
    });
  });

  // Issue #1566 — "All Hosts Down" flapping caused by an SWR-cache /
  // Edge-heartbeat conflict. The endpoints list is served from a 15-minute
  // stale-while-revalidate cache (TTL.ENDPOINTS = 900s in portainer-cache.ts).
  // `determineEdgeStatus` computes `elapsed = now - lastCheckIn` — if a
  // *cached* endpoint (whose LastCheckInDate was fresh when the snapshot was
  // originally fetched, minutes ago) is evaluated against the *current*
  // wall clock instead of the fetch-time snapshot, every Edge endpoint
  // appears to have gone silent even though nothing actually changed.
  describe('SWR-cache / heartbeat conflict (issue #1566)', () => {
    it('reproduces the bug: a healthy endpoint served from a stale SWR cache flips to "down" when evaluated against the current wall clock instead of fetch time', () => {
      // The endpoint checked in 30s before the snapshot was fetched — well
      // within the ~90s heartbeat threshold at fetch time.
      const fetchedAt = Date.now();
      const lastCheckIn = Math.floor(fetchedAt / 1000) - 30;
      const ep = makeEndpoint({
        Type: 4,
        EdgeID: 'edge-swr-bug',
        Status: 2,
        LastCheckInDate: lastCheckIn,
        EdgeCheckinInterval: 5,
      });

      // At fetch time, the endpoint is correctly "up".
      expect(normalizeEndpointAsOf(ep, { referenceTimeMs: fetchedAt }).status).toBe('up');

      // Wall-clock time actually advances 5 minutes (the raw endpoint payload
      // itself is unchanged — this simulates the same cached snapshot being
      // served again out of the 15-minute SWR cache, well past the ~90s
      // heartbeat + jitter window, even though the endpoint never actually
      // stopped checking in).
      vi.setSystemTime(new Date(fetchedAt + 5 * 60 * 1000));

      // BUGGY behavior: re-normalizing the identical cached payload with no
      // reference time (i.e. evaluating against "now") incorrectly flips it
      // to "down" — this is issue #1566.
      expect(normalizeEndpoint(ep).status).toBe('down');

      // FIXED behavior: passing the snapshot's original fetch time keeps the
      // endpoint correctly "up", regardless of how much later it is actually
      // read out of the cache.
      expect(normalizeEndpointAsOf(ep, { referenceTimeMs: fetchedAt }).status).toBe('up');
    });

    it('evaluates elapsed time against the passed referenceTimeMs, not Date.now()', () => {
      const fetchedAt = Date.now();
      const lastCheckIn = Math.floor(fetchedAt / 1000) - 45; // 45s before fetch — within threshold
      const ep = makeEndpoint({
        Type: 4,
        EdgeID: 'edge-reference-time',
        Status: 2,
        LastCheckInDate: lastCheckIn,
        EdgeCheckinInterval: 5,
      });

      // Passing the original fetch time keeps it "up" even though "now"
      // (simulated via vi.setSystemTime in the outer beforeEach, fixed at
      // 2026-02-10T12:00:00Z) may be arbitrarily far in the future relative
      // to fetchedAt.
      expect(normalizeEndpointAsOf(ep, { referenceTimeMs: fetchedAt }).status).toBe('up');

      // Passing a reference time far past the heartbeat threshold correctly
      // reports "down" — proving the function is reference-time-aware in
      // both directions, not just defaulting everything to "up".
      const farFuture = fetchedAt + 20 * 60 * 1000; // +20 minutes
      expect(normalizeEndpointAsOf(ep, { referenceTimeMs: farFuture }).status).toBe('down');
    });

    it('is safe under bare Array.prototype.map(normalizeEndpoint) / (normalizeEndpointAsOf) — the array index must never be mistaken for a reference time', () => {
      // `endpoints.map(normalizeEndpoint)` is the dominant call pattern
      // throughout the codebase, and Array.prototype.map invokes its callback
      // as (element, index, array). This is exactly why the time-aware
      // variant is a *separate* function (normalizeEndpointAsOf) rather than
      // a bare `referenceTimeMs: number` second parameter bolted onto
      // normalizeEndpoint itself: a positional number parameter would let
      // every element's array index (0, 1, 2, ...) silently masquerade as a
      // reference time (the classic `["1","2"].map(parseInt)` footgun),
      // corrupting the heartbeat elapsed-time calculation. Two properties
      // must both hold:
      //  1. `normalizeEndpoint`'s signature is untouched, so bare `.map()` use
      //     is unaffected (and still uses Date.now(), never an index).
      //  2. `normalizeEndpointAsOf` takes an options *object*, so even if it
      //     were (mis)used bare via `.map()`, the numeric index has no
      //     `.referenceTimeMs` property and safely falls through to
      //     Date.now() instead of being misread as a timestamp.
      const healthyEndpoints = [
        makeEndpoint({
          Type: 4,
          EdgeID: 'edge-map-0',
          Status: 2,
          LastCheckInDate: Math.floor(Date.now() / 1000) - 20, // healthy
          EdgeCheckinInterval: 5,
        }),
        makeEndpoint({
          Type: 4,
          EdgeID: 'edge-map-1',
          Status: 2,
          LastCheckInDate: Math.floor(Date.now() / 1000) - 5000, // genuinely down (>90s threshold)
          EdgeCheckinInterval: 5,
        }),
      ];

      // If the index leaked in as referenceTimeMs, index 0 would compute
      // elapsed as a huge negative number (Date.now()=0 epoch-adjacent) and
      // always report "up" regardless of actual health, and index 1 would
      // fare no better — the real LastCheckInDate values must be respected.
      const viaNormalizeEndpoint = healthyEndpoints.map(normalizeEndpoint);
      expect(viaNormalizeEndpoint[0].status).toBe('up');
      expect(viaNormalizeEndpoint[1].status).toBe('down');

      // Defense in depth: even if a future caller mistakenly wrote
      // `.map(normalizeEndpointAsOf)` bare (instead of wrapping it), the
      // options-object second parameter keeps it safe.
      const viaNormalizeEndpointAsOf = healthyEndpoints.map(normalizeEndpointAsOf);
      expect(viaNormalizeEndpointAsOf[0].status).toBe('up');
      expect(viaNormalizeEndpointAsOf[1].status).toBe('down');
    });

    it('degrades safely to Date.now() when referenceTimeMs/options is omitted', () => {
      const ep = makeEndpoint({
        Type: 4,
        EdgeID: 'edge-default-arg',
        Status: 2,
        LastCheckInDate: Math.floor(Date.now() / 1000) - 30,
        EdgeCheckinInterval: 5,
      });

      // normalizeEndpoint's signature is untouched by #1566 — unaffected.
      expect(normalizeEndpoint(ep).status).toBe('up');
      // normalizeEndpointAsOf with no options object at all...
      expect(normalizeEndpointAsOf(ep).status).toBe('up');
      // ...and with an options object that omits referenceTimeMs — both
      // degrade safely to Date.now(), matching normalizeEndpoint's behavior.
      expect(normalizeEndpointAsOf(ep, {}).status).toBe('up');
    });
  });

  // Issue #1249 — live Docker-info fallback for Edge Standard endpoints whose
  // Portainer Snapshots[] is permanently empty.
  describe('Live fallback helpers (issue #1249)', () => {
    it('normalizeEndpoint ignores Snapshots[]: zero counts, source unavailable', () => {
      const ep = normalizeEndpoint(makeEndpoint({
        Id: 1, Type: 1, Status: 1,
        Snapshots: [{ DockerSnapshotRaw: { Containers: 99, ContainersRunning: 99 }, RunningContainerCount: 99, StackCount: 7, TotalCPU: 4, TotalMemory: 999, Time: Math.floor(Date.now()/1000) }],
      }));
      expect(ep.containersRunning).toBe(0);
      expect(ep.containersStopped).toBe(0);
      expect(ep.totalContainers).toBe(0);
      expect(ep.stackCount).toBe(0);
      expect(ep.totalCpu).toBe(0);
      expect(ep.totalMemory).toBe(0);
      expect(ep.snapshotAge).toBeNull();
      expect(ep.snapshotSource).toBe('unavailable');
      expect(ep.snapshotFetchedAt).toBeUndefined();
    });

    it('endpointSupportsLiveDockerInfo: true for up Docker (types 1/2/4)', () => {
      for (const Type of [1, 2, 4]) {
        const ep = normalizeEndpoint(makeEndpoint({ Id: Type, Type, Status: 1, EdgeID: Type === 4 ? 'e' : undefined, LastCheckInDate: Math.floor(Date.now()/1000) }));
        expect(endpointSupportsLiveDockerInfo(ep)).toBe(true);
      }
    });

    it('endpointSupportsLiveDockerInfo: false for down, K8s (5/6), Edge Async (7)', () => {
      expect(endpointSupportsLiveDockerInfo(normalizeEndpoint(makeEndpoint({ Id: 1, Type: 1, Status: 2 })))).toBe(false);
      for (const Type of [5, 6, 7]) {
        const ep = normalizeEndpoint(makeEndpoint({ Id: Type, Type, Status: 1, EdgeID: 'e', LastCheckInDate: Math.floor(Date.now()/1000) }));
        expect(endpointSupportsLiveDockerInfo(ep)).toBe(false);
      }
    });

    it('applyLiveDockerInfo overlays counts + cpu/mem and flips source to live', () => {
      const ep = normalizeEndpoint(makeEndpoint({ Id: 1, Type: 4, Status: 1, EdgeID: 'e', LastCheckInDate: Math.floor(Date.now()/1000) }));
      const fetchedAt = Date.now();
      applyLiveDockerInfo(ep, { containers: 12, containersRunning: 9, containersStopped: 3, ncpu: 8, memTotal: 16000000000, fetchedAt });
      expect(ep.containersRunning).toBe(9);
      expect(ep.containersStopped).toBe(3);
      expect(ep.totalContainers).toBe(12);
      expect(ep.totalCpu).toBe(8);
      expect(ep.totalMemory).toBe(16000000000);
      expect(ep.snapshotSource).toBe('live');
      expect(ep.snapshotFetchedAt).toBe(fetchedAt);
      expect(ep.snapshotAge).toBeGreaterThanOrEqual(0);
    });

    it('markLiveUnavailable flips snapshotSource without changing counts', () => {
      const ep = makeEndpoint({
        Type: 4,
        EdgeID: 'edge-unavailable',
        Status: 1,
        Snapshots: [],
      });
      const normalized = normalizeEndpoint(ep);
      const before = { ...normalized };

      const result = markLiveUnavailable(normalized);
      expect(result.snapshotSource).toBe('unavailable');
      expect(result.containersRunning).toBe(before.containersRunning);
      expect(result.containersStopped).toBe(before.containersStopped);
      expect(result.totalContainers).toBe(before.totalContainers);
    });
  });
});
