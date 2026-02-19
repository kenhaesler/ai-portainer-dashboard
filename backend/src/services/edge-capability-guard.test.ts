import { describe, it, expect, vi, beforeEach } from 'vitest';

// Kept: portainer mocks use shared factories (phase 5)
vi.mock('./portainer-client.js', async () =>
  (await import('../test-utils/mock-portainer.js')).createPortainerClientMock()
);
vi.mock('./portainer-cache.js', async () =>
  (await import('../test-utils/mock-portainer.js')).createPortainerCacheMock()
);

import { getEndpointCapabilities, assertCapability, supportsLiveFeatures } from './edge-capability-guard.js';
import { getEndpoint } from './portainer-client.js';

const mockGetEndpoint = vi.mocked(getEndpoint);

function makeRawEndpoint(overrides: Record<string, unknown> = {}) {
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
      Time: Math.floor(Date.now() / 1000) - 60,
    }],
    TagIds: [],
    ...overrides,
  };
}

describe('edge-capability-guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getEndpointCapabilities', () => {
    it('returns full capabilities for a non-edge endpoint', async () => {
      mockGetEndpoint.mockResolvedValue(makeRawEndpoint() as any);
      const caps = await getEndpointCapabilities(1);
      expect(caps).toEqual({
        exec: true,
        realtimeLogs: true,
        liveStats: true,
        immediateActions: true,
      });
    });

    it('returns full capabilities for Edge Standard endpoint', async () => {
      mockGetEndpoint.mockResolvedValue(makeRawEndpoint({
        Type: 4,
        EdgeID: 'edge-std-123',
        LastCheckInDate: Math.floor(Date.now() / 1000) - 30,
        EdgeCheckinInterval: 5,
      }) as any);
      const caps = await getEndpointCapabilities(1);
      expect(caps).toEqual({
        exec: true,
        realtimeLogs: true,
        liveStats: true,
        immediateActions: true,
      });
    });

    it('returns no capabilities for Edge Async endpoint (Type 7)', async () => {
      mockGetEndpoint.mockResolvedValue(makeRawEndpoint({
        Type: 7,
        EdgeID: 'edge-async-456',
        LastCheckInDate: Math.floor(Date.now() / 1000) - 120,
        EdgeCheckinInterval: 60,
      }) as any);
      const caps = await getEndpointCapabilities(1);
      expect(caps).toEqual({
        exec: false,
        realtimeLogs: false,
        liveStats: false,
        immediateActions: false,
      });
    });
  });

  describe('assertCapability', () => {
    it('does not throw for a capable endpoint', async () => {
      mockGetEndpoint.mockResolvedValue(makeRawEndpoint() as any);
      await expect(assertCapability(1, 'exec')).resolves.toBeUndefined();
    });

    it('throws 422 for Edge Async endpoint missing exec capability', async () => {
      mockGetEndpoint.mockResolvedValue(makeRawEndpoint({
        Type: 7,
        EdgeID: 'edge-async',
        LastCheckInDate: Math.floor(Date.now() / 1000) - 120,
        EdgeCheckinInterval: 60,
      }) as any);

      try {
        await assertCapability(1, 'exec');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.statusCode).toBe(422);
        expect(err.message).toContain('Edge Async');
        expect(err.message).toContain('exec');
      }
    });

    it('throws 422 for each capability type on Edge Async', async () => {
      const asyncEndpoint = makeRawEndpoint({
        Type: 7,
        EdgeID: 'edge-async',
        LastCheckInDate: Math.floor(Date.now() / 1000) - 120,
        EdgeCheckinInterval: 60,
      });

      for (const cap of ['exec', 'realtimeLogs', 'liveStats', 'immediateActions'] as const) {
        mockGetEndpoint.mockResolvedValue(asyncEndpoint as any);
        await expect(assertCapability(1, cap)).rejects.toThrow(/Edge Async/);
      }
    });
  });

  describe('supportsLiveFeatures', () => {
    it('returns true for non-edge endpoint', async () => {
      mockGetEndpoint.mockResolvedValue(makeRawEndpoint() as any);
      expect(await supportsLiveFeatures(1)).toBe(true);
    });

    it('returns false for Edge Async endpoint (Type 7)', async () => {
      mockGetEndpoint.mockResolvedValue(makeRawEndpoint({
        Type: 7,
        EdgeID: 'edge-async',
        LastCheckInDate: Math.floor(Date.now() / 1000) - 120,
        EdgeCheckinInterval: 60,
      }) as any);
      expect(await supportsLiveFeatures(1)).toBe(false);
    });

    it('returns true when endpoint lookup fails (safe default)', async () => {
      mockGetEndpoint.mockRejectedValue(new Error('Network error'));
      expect(await supportsLiveFeatures(999)).toBe(true);
    });
  });
});
