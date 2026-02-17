import { describe, it, expect, vi, beforeEach } from 'vitest';
import { normalizeEndpoint } from './portainer-normalizers.js';
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

  it('computes snapshotAge from snapshot Time field', () => {
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

    // snapshotAge should be ~120,000ms (2 minutes)
    expect(result.snapshotAge).toBeGreaterThanOrEqual(119000);
    expect(result.snapshotAge).toBeLessThanOrEqual(121000);
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
    expect(result.containersRunning).toBe(3);
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

    it('keeps Edge endpoint "up" even at cache expiry (15 min after check-in)', () => {
      const ep = makeEndpoint({
        Type: 4,
        EdgeID: 'edge-3',
        Status: 2,
        LastCheckInDate: Math.floor(Date.now() / 1000) - 900, // 15 min ago (cache TTL)
        EdgeCheckinInterval: 5,
      });
      // Threshold = max((5*2)+20, 60) + 900 = 960s. 900 < 960 → still up
      expect(normalizeEndpoint(ep).status).toBe('up');
    });

    it('marks Edge endpoint as "down" when check-in exceeds cache-aware threshold', () => {
      const ep = makeEndpoint({
        Type: 4,
        EdgeID: 'edge-4',
        Status: 2,
        LastCheckInDate: Math.floor(Date.now() / 1000) - 1200, // 20 min ago
        EdgeCheckinInterval: 5,
      });
      // Threshold = max((5*2)+20, 60) + 900 = 960s. 1200 > 960 → down
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
});
