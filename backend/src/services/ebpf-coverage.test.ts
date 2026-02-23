import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';

const mockExecute = vi.fn(async () => ({ changes: 1 }));
const mockQuery = vi.fn(async (): Promise<any[]> => []);
const mockQueryOne = vi.fn(async (): Promise<any> => null);
const mockTransaction = vi.fn();
const mockDb = {
  execute: mockExecute,
  query: mockQuery,
  queryOne: mockQueryOne,
  transaction: mockTransaction,
  healthCheck: vi.fn(),
};

// Kept: DB mock — tests assert SQL query patterns
vi.mock('../db/app-db-router.js', () => ({
  getDbForDomain: () => mockDb,
}));

import * as portainerClient from '../core/portainer/portainer-client.js';
import * as portainerCache from '../core/portainer/portainer-cache.js';
import { cache } from '../core/portainer/portainer-cache.js';
import { closeTestRedis } from '../test-utils/test-redis-helper.js';
import {
  getEndpointCoverage,
  updateCoverageStatus,
  deleteCoverageRecord,
  syncEndpointCoverage,
  verifyCoverage,
  getCoverageSummary,
  detectBeylaOnEndpoint,
  BEYLA_COMPATIBLE_TYPES,
  deployBeyla,
  disableBeyla,
  enableBeyla,
  removeBeylaFromEndpoint,
} from './ebpf-coverage.js';

let mockGetContainers: any;
let mockGetEndpoints: any;
let mockGetEndpoint: any;
let mockPullImage: any;
let mockCreateContainer: any;
let mockStartContainer: any;
let mockStopContainer: any;
let mockRemoveContainer: any;

beforeAll(async () => {
  await cache.clear();
});

afterAll(async () => {
  await closeTestRedis();
});

describe('ebpf-coverage service', () => {
  beforeEach(async () => {
    await cache.clear();
    vi.restoreAllMocks();
    // Bypass cache — calls fetcher directly
    vi.spyOn(portainerCache, 'cachedFetchSWR').mockImplementation(
      async (_key: string, _ttl: number, fetcher: () => Promise<unknown>) => fetcher(),
    );
    // Default portainer spies
    mockGetEndpoints = vi.spyOn(portainerClient, 'getEndpoints').mockResolvedValue([
      { Id: 1, Name: 'local', Type: 1, URL: 'tcp://localhost', Status: 1, Snapshots: [] },
      { Id: 2, Name: 'remote', Type: 1, URL: 'tcp://remote', Status: 1, Snapshots: [] },
    ] as any);
    mockGetEndpoint = vi.spyOn(portainerClient, 'getEndpoint').mockImplementation(async (id: number) => ({ Id: id, Name: `endpoint-${id}`, Type: 1, URL: 'tcp://localhost', Status: 1, Snapshots: [] }) as any);
    mockGetContainers = vi.spyOn(portainerClient, 'getContainers').mockResolvedValue([]);
    mockPullImage = vi.spyOn(portainerClient, 'pullImage').mockResolvedValue(undefined as any);
    mockCreateContainer = vi.spyOn(portainerClient, 'createContainer').mockResolvedValue({ Id: 'new-beyla-id' } as any);
    mockStartContainer = vi.spyOn(portainerClient, 'startContainer').mockResolvedValue(undefined as any);
    mockStopContainer = vi.spyOn(portainerClient, 'stopContainer').mockResolvedValue(undefined as any);
    mockRemoveContainer = vi.spyOn(portainerClient, 'removeContainer').mockResolvedValue(undefined as any);
    mockExecute.mockResolvedValue({ changes: 1 });
    mockQuery.mockResolvedValue([]);
    mockQueryOne.mockResolvedValue(null);
  });

  describe('BEYLA_COMPATIBLE_TYPES', () => {
    it('should include Docker Standalone (1), Swarm (2), Edge Agent Standard (4), and Edge Agent Async (7)', () => {
      expect(BEYLA_COMPATIBLE_TYPES.has(1)).toBe(true);
      expect(BEYLA_COMPATIBLE_TYPES.has(2)).toBe(true);
      expect(BEYLA_COMPATIBLE_TYPES.has(4)).toBe(true);
      expect(BEYLA_COMPATIBLE_TYPES.has(7)).toBe(true);
    });

    it('should exclude ACI (3) and other unsupported types', () => {
      expect(BEYLA_COMPATIBLE_TYPES.has(3)).toBe(false);
      expect(BEYLA_COMPATIBLE_TYPES.has(5)).toBe(false);
      expect(BEYLA_COMPATIBLE_TYPES.has(6)).toBe(false);
    });
  });

  describe('detectBeylaOnEndpoint', () => {
    it('should return deployed when beyla container is running', async () => {
      mockGetContainers.mockResolvedValueOnce([
        { Id: 'c1', Names: ['/beyla'], Image: 'grafana/beyla:latest', State: 'running', Status: 'Up', Created: 0, Ports: [], Labels: {}, NetworkSettings: { Networks: {} } },
      ] as any);
      const result = await detectBeylaOnEndpoint(1);
      expect(result).toBe('deployed');
    });

    it('should return failed when beyla container is stopped', async () => {
      mockGetContainers.mockResolvedValueOnce([
        { Id: 'c1', Names: ['/beyla'], Image: 'grafana/beyla:latest', State: 'exited', Status: 'Exited', Created: 0, Ports: [], Labels: {}, NetworkSettings: { Networks: {} } },
      ] as any);
      const result = await detectBeylaOnEndpoint(1);
      expect(result).toBe('failed');
    });

    it('should return not_found when no beyla container exists', async () => {
      mockGetContainers.mockResolvedValueOnce([
        { Id: 'c1', Names: ['/nginx'], Image: 'nginx:latest', State: 'running', Status: 'Up', Created: 0, Ports: [], Labels: {}, NetworkSettings: { Networks: {} } },
      ] as any);
      const result = await detectBeylaOnEndpoint(1);
      expect(result).toBe('not_found');
    });

    it('should return unreachable when API call fails', async () => {
      mockGetContainers.mockRejectedValueOnce(new Error('Connection refused'));
      const result = await detectBeylaOnEndpoint(1);
      expect(result).toBe('unreachable');
    });

    it('should return incompatible for ACI endpoints (type 3)', async () => {
      const result = await detectBeylaOnEndpoint(1, 3);
      expect(result).toBe('incompatible');
      expect(mockGetContainers).not.toHaveBeenCalled();
    });

    it('should proceed with detection for Edge Agent Standard (type 4)', async () => {
      mockGetContainers.mockResolvedValueOnce([]);
      const result = await detectBeylaOnEndpoint(1, 4);
      expect(result).toBe('not_found');
      expect(mockGetContainers).toHaveBeenCalledWith(1, true);
    });

    it('should proceed with detection for Docker Standalone (type 1)', async () => {
      mockGetContainers.mockResolvedValueOnce([]);
      const result = await detectBeylaOnEndpoint(1, 1);
      expect(result).toBe('not_found');
      expect(mockGetContainers).toHaveBeenCalledWith(1, true);
    });

    it('should proceed with detection when no type is provided', async () => {
      mockGetContainers.mockResolvedValueOnce([]);
      const result = await detectBeylaOnEndpoint(1);
      expect(result).toBe('not_found');
      expect(mockGetContainers).toHaveBeenCalledWith(1, true);
    });
  });

  describe('getEndpointCoverage', () => {
    it('should return all coverage records', async () => {
      const mockRecords = [
        { endpoint_id: 1, endpoint_name: 'local', status: 'deployed', drifted: false },
        { endpoint_id: 2, endpoint_name: 'remote', status: 'unknown', drifted: false },
      ];
      mockQuery.mockResolvedValueOnce(mockRecords);
      const result = await getEndpointCoverage();
      expect(result).toEqual(mockRecords);
    });

    it('should return empty array when no records exist', async () => {
      mockQuery.mockResolvedValueOnce([]);
      const result = await getEndpointCoverage();
      expect(result).toEqual([]);
    });
  });

  describe('updateCoverageStatus', () => {
    it('should update status for an endpoint', async () => {
      await updateCoverageStatus(1, 'deployed');
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE ebpf_coverage'),
        ['deployed', null, 1],
      );
    });

    it('should update status with a reason', async () => {
      await updateCoverageStatus(2, 'excluded', 'Development-only endpoint');
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE ebpf_coverage'),
        ['excluded', 'Development-only endpoint', 2],
      );
    });

    it('should accept new status types', async () => {
      await updateCoverageStatus(3, 'not_deployed');
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE ebpf_coverage'),
        ['not_deployed', null, 3],
      );
      await updateCoverageStatus(4, 'unreachable');
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE ebpf_coverage'),
        ['unreachable', null, 4],
      );
      await updateCoverageStatus(5, 'incompatible', 'Edge Agent');
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE ebpf_coverage'),
        ['incompatible', 'Edge Agent', 5],
      );
    });
  });

  describe('deleteCoverageRecord', () => {
    it('returns true when a row is deleted', async () => {
      mockExecute.mockResolvedValueOnce({ changes: 1 });

      const deleted = await deleteCoverageRecord(42);

      expect(deleted).toBe(true);
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM ebpf_coverage'),
        [42],
      );
    });

    it('returns false when no matching row exists', async () => {
      mockExecute.mockResolvedValueOnce({ changes: 0 });

      const deleted = await deleteCoverageRecord(999);

      expect(deleted).toBe(false);
    });
  });

  describe('syncEndpointCoverage', () => {
    it('should sync endpoints from Portainer', async () => {
      const txDb = {
        execute: vi.fn(async () => ({ changes: 1 })),
        query: vi.fn(),
        queryOne: vi.fn(),
        transaction: vi.fn(),
        healthCheck: vi.fn(),
      };
      mockTransaction.mockImplementation(async (fn: (db: typeof txDb) => Promise<void>) => fn(txDb));
      const added = await syncEndpointCoverage();
      expect(mockTransaction).toHaveBeenCalled();
      expect(typeof added).toBe('number');
    });

    it('should auto-detect beyla containers on endpoints', async () => {
      mockGetContainers.mockImplementation(async (endpointId: number) => {
        if (endpointId === 1) {
          return [
            { Id: 'c1', Names: ['/beyla'], Image: 'grafana/beyla:latest', State: 'running', Status: 'Up', Created: 0, Ports: [], Labels: {}, NetworkSettings: { Networks: {} } },
          ] as any;
        }
        return [];
      });
      const txDb = {
        execute: vi.fn(async () => ({ changes: 1 })),
        query: vi.fn(),
        queryOne: vi.fn(),
        transaction: vi.fn(),
        healthCheck: vi.fn(),
      };
      mockTransaction.mockImplementation(async (fn: (db: typeof txDb) => Promise<void>) => fn(txDb));
      await syncEndpointCoverage();
      expect(mockGetContainers).toHaveBeenCalledTimes(2);
      expect(mockTransaction).toHaveBeenCalled();
    });

    it('should detect Beyla on Edge Agent endpoints (type 4 is compatible)', async () => {
      mockGetEndpoints.mockResolvedValueOnce([
        { Id: 1, Name: 'local', Type: 1, URL: 'tcp://localhost', Status: 1, Snapshots: [] },
        { Id: 3, Name: 'edge-agent', Type: 4, URL: 'tcp://edge', Status: 1, Snapshots: [] },
      ] as any);
      mockGetContainers.mockResolvedValue([]);
      const txDb = {
        execute: vi.fn(async () => ({ changes: 1 })),
        query: vi.fn(),
        queryOne: vi.fn(),
        transaction: vi.fn(),
        healthCheck: vi.fn(),
      };
      mockTransaction.mockImplementation(async (fn: (db: typeof txDb) => Promise<void>) => fn(txDb));
      await syncEndpointCoverage();
      expect(mockGetContainers).toHaveBeenCalledTimes(2);
      expect(mockGetContainers).toHaveBeenCalledWith(1, true);
      expect(mockGetContainers).toHaveBeenCalledWith(3, true);
    });

    it('should mark ACI endpoints (type 3) as incompatible', async () => {
      mockGetEndpoints.mockResolvedValueOnce([
        { Id: 1, Name: 'local', Type: 1, URL: 'tcp://localhost', Status: 1, Snapshots: [] },
        { Id: 3, Name: 'aci-endpoint', Type: 3, URL: 'tcp://aci', Status: 1, Snapshots: [] },
      ] as any);
      mockGetContainers.mockResolvedValue([]);
      const txDb = {
        execute: vi.fn(async () => ({ changes: 1 })),
        query: vi.fn(),
        queryOne: vi.fn(),
        transaction: vi.fn(),
        healthCheck: vi.fn(),
      };
      mockTransaction.mockImplementation(async (fn: (db: typeof txDb) => Promise<void>) => fn(txDb));
      await syncEndpointCoverage();
      expect(mockGetContainers).toHaveBeenCalledTimes(1);
      expect(mockGetContainers).toHaveBeenCalledWith(1, true);
    });

    it('should mark down endpoints as unreachable', async () => {
      mockGetEndpoints.mockResolvedValueOnce([
        { Id: 1, Name: 'local', Type: 1, URL: 'tcp://localhost', Status: 1, Snapshots: [] },
        { Id: 2, Name: 'down-host', Type: 1, URL: 'tcp://down', Status: 2, Snapshots: [] },
      ] as any);
      mockGetContainers.mockResolvedValue([]);
      const txDb = {
        execute: vi.fn(async () => ({ changes: 1 })),
        query: vi.fn(),
        queryOne: vi.fn(),
        transaction: vi.fn(),
        healthCheck: vi.fn(),
      };
      mockTransaction.mockImplementation(async (fn: (db: typeof txDb) => Promise<void>) => fn(txDb));
      await syncEndpointCoverage();
      expect(mockGetContainers).toHaveBeenCalledTimes(1);
      expect(mockGetContainers).toHaveBeenCalledWith(1, true);
    });
  });

  describe('verifyCoverage', () => {
    it('should return verified=true when beyla container is running', async () => {
      mockGetContainers.mockResolvedValueOnce([
        { Id: 'c1', Names: ['/beyla'], Image: 'grafana/beyla:latest', State: 'running', Status: 'Up', Created: 0, Ports: [], Labels: {}, NetworkSettings: { Networks: {} } },
      ] as any);
      mockQueryOne.mockResolvedValueOnce({ start_time: '2025-01-01T12:00:00' });
      const result = await verifyCoverage(1);
      expect(result.verified).toBe(true);
      expect(result.beylaRunning).toBe(true);
      expect(result.lastTraceAt).toBe('2025-01-01T12:00:00');
    });

    it('should return verified=false when no beyla and no spans', async () => {
      mockGetContainers.mockResolvedValueOnce([]);
      mockQueryOne.mockResolvedValueOnce(null);
      const result = await verifyCoverage(1);
      expect(result.verified).toBe(false);
      expect(result.beylaRunning).toBe(false);
      expect(result.lastTraceAt).toBeNull();
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE ebpf_coverage'),
        ['not_deployed', null, 1],
      );
    });

    it('should handle spans query failure gracefully', async () => {
      mockGetContainers.mockResolvedValueOnce([]);
      mockQueryOne.mockRejectedValueOnce(new Error('table not found'));
      const result = await verifyCoverage(1);
      expect(result.verified).toBe(false);
      expect(result.lastTraceAt).toBeNull();
    });

    it('should detect failed beyla (container stopped)', async () => {
      mockGetContainers.mockResolvedValueOnce([
        { Id: 'c1', Names: ['/beyla'], Image: 'grafana/beyla:latest', State: 'exited', Status: 'Exited', Created: 0, Ports: [], Labels: {}, NetworkSettings: { Networks: {} } },
      ] as any);
      mockQueryOne.mockResolvedValueOnce(null);
      const result = await verifyCoverage(1);
      expect(result.beylaRunning).toBe(false);
      expect(result.verified).toBe(false);
    });

    it('should handle unreachable endpoint during verify', async () => {
      mockGetContainers.mockRejectedValueOnce(new Error('Connection refused'));
      mockQueryOne.mockResolvedValueOnce(null);
      const result = await verifyCoverage(1);
      expect(result.beylaRunning).toBe(false);
      expect(result.verified).toBe(false);
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE ebpf_coverage'),
        ['unreachable', null, 1],
      );
    });
  });

  describe('beyla lifecycle actions', () => {
    it('deployBeyla creates and starts container when missing', async () => {
      mockGetEndpoint.mockResolvedValueOnce({
        Id: 1,
        Name: 'prod-1',
        Type: 1,
        URL: 'tcp://prod-1',
        Status: 1,
        Snapshots: [],
      } as any);
      mockGetContainers.mockResolvedValueOnce([]);
      mockCreateContainer.mockResolvedValueOnce({ Id: 'beyla-1' });

      const result = await deployBeyla(1, {
        otlpEndpoint: 'http://dashboard.local/api/traces/otlp',
        tracesApiKey: 'abc123',
      });

      expect(result.status).toBe('deployed');
      expect(mockPullImage).toHaveBeenCalledWith(1, 'grafana/beyla', 'latest');
      expect(mockCreateContainer).toHaveBeenCalled();
      expect(mockStartContainer).toHaveBeenCalledWith(1, 'beyla-1');
    });

    it('deployBeyla recreates existing container when recreateExisting=true', async () => {
      mockGetEndpoint.mockResolvedValueOnce({
        Id: 1,
        Name: 'prod-1',
        Type: 1,
        URL: 'tcp://prod-1',
        Status: 1,
        Snapshots: [],
      } as any);
      mockGetContainers.mockResolvedValueOnce([
        { Id: 'old-beyla', Image: 'grafana/beyla:latest', State: 'running', Labels: {} },
      ] as any);
      mockCreateContainer.mockResolvedValueOnce({ Id: 'new-beyla' });

      const result = await deployBeyla(1, {
        otlpEndpoint: 'http://192.168.178.20:3051/api/traces/otlp',
        tracesApiKey: 'abc123',
        recreateExisting: true,
      });

      expect(result.status).toBe('deployed');
      expect(mockStopContainer).toHaveBeenCalledWith(1, 'old-beyla');
      expect(mockRemoveContainer).toHaveBeenCalledWith(1, 'old-beyla', true);
      expect(mockCreateContainer).toHaveBeenCalled();
      expect(mockStartContainer).toHaveBeenCalledWith(1, 'new-beyla');
    });

    it('disableBeyla stops existing container', async () => {
      mockGetEndpoint.mockResolvedValueOnce({
        Id: 1,
        Name: 'prod-1',
        Type: 1,
        URL: 'tcp://prod-1',
        Status: 1,
        Snapshots: [],
      } as any);
      mockGetContainers.mockResolvedValueOnce([
        { Id: 'beyla-1', Image: 'grafana/beyla:latest', State: 'running', Labels: { 'managed-by': 'ai-portainer-dashboard' } },
      ] as any);

      const result = await disableBeyla(1);
      expect(result.status).toBe('disabled');
      expect(mockStopContainer).toHaveBeenCalledWith(1, 'beyla-1');
    });

    it('enableBeyla starts stopped container', async () => {
      mockGetEndpoint.mockResolvedValueOnce({
        Id: 1,
        Name: 'prod-1',
        Type: 1,
        URL: 'tcp://prod-1',
        Status: 1,
        Snapshots: [],
      } as any);
      mockGetContainers.mockResolvedValueOnce([
        { Id: 'beyla-1', Image: 'grafana/beyla:latest', State: 'exited', Labels: {} },
      ] as any);

      const result = await enableBeyla(1);
      expect(result.status).toBe('enabled');
      expect(mockStartContainer).toHaveBeenCalledWith(1, 'beyla-1');
    });

    it('removeBeylaFromEndpoint removes non-managed Beyla containers', async () => {
      mockGetEndpoint.mockResolvedValueOnce({
        Id: 2,
        Name: 'prod-2',
        Type: 1,
        URL: 'tcp://prod-2',
        Status: 1,
        Snapshots: [],
      } as any);
      mockGetContainers.mockResolvedValueOnce([
        { Id: 'manual-beyla', Image: 'grafana/beyla:latest', State: 'running', Labels: { owner: 'manual' } },
      ] as any);

      const result = await removeBeylaFromEndpoint(2, true);
      expect(result.status).toBe('removed');
      expect(mockRemoveContainer).toHaveBeenCalledWith(2, 'manual-beyla', true);
    });

    it('removeBeylaFromEndpoint tolerates 404 when container is already gone', async () => {
      mockGetEndpoint.mockResolvedValueOnce({
        Id: 2,
        Name: 'prod-2',
        Type: 1,
        URL: 'tcp://prod-2',
        Status: 1,
        Snapshots: [],
      } as any);
      mockGetContainers
        .mockResolvedValueOnce([
          { Id: 'manual-beyla', Image: 'grafana/beyla:latest', State: 'running', Labels: { owner: 'manual' } },
        ] as any)
        .mockResolvedValueOnce([] as any);
      mockRemoveContainer.mockRejectedValueOnce(new Error('HTTP 404: Not Found'));

      const result = await removeBeylaFromEndpoint(2, true);
      expect(result.status).toBe('removed');
    });

    it('deployBeyla tolerates 404 on start when container becomes running', async () => {
      mockGetEndpoint.mockResolvedValueOnce({
        Id: 1,
        Name: 'prod-1',
        Type: 1,
        URL: 'tcp://prod-1',
        Status: 1,
        Snapshots: [],
      } as any);
      mockGetContainers
        .mockResolvedValueOnce([] as any)
        .mockResolvedValueOnce([
          { Id: 'beyla-1', Image: 'grafana/beyla:latest', State: 'running', Labels: {} },
        ] as any);
      mockCreateContainer.mockResolvedValueOnce({ Id: 'beyla-1' });
      mockStartContainer.mockRejectedValueOnce(new Error('HTTP 404: Not Found'));

      const result = await deployBeyla(1, {
        otlpEndpoint: 'http://dashboard.local/api/traces/otlp',
        tracesApiKey: 'abc123',
      });
      expect(result.status).toBe('deployed');
    });
  });

  describe('getCoverageSummary', () => {
    it('should return aggregate stats including new statuses', async () => {
      mockQuery.mockResolvedValueOnce([
        { status: 'deployed', count: 5 },
        { status: 'planned', count: 2 },
        { status: 'excluded', count: 1 },
        { status: 'failed', count: 0 },
        { status: 'unknown', count: 1 },
        { status: 'not_deployed', count: 3 },
        { status: 'unreachable', count: 2 },
        { status: 'incompatible', count: 1 },
      ]);
      const summary = await getCoverageSummary();
      expect(summary.total).toBe(15);
      expect(summary.deployed).toBe(5);
      expect(summary.planned).toBe(2);
      expect(summary.not_deployed).toBe(3);
      expect(summary.unreachable).toBe(2);
      expect(summary.incompatible).toBe(1);
      expect(summary.coveragePercent).toBe(33);
    });

    it('should handle empty coverage', async () => {
      mockQuery.mockResolvedValueOnce([]);
      const summary = await getCoverageSummary();
      expect(summary.total).toBe(0);
      expect(summary.coveragePercent).toBe(0);
      expect(summary.not_deployed).toBe(0);
      expect(summary.unreachable).toBe(0);
      expect(summary.incompatible).toBe(0);
    });
  });
});
