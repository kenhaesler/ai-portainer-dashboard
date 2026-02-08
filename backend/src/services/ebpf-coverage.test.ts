import { describe, it, expect, vi, beforeEach } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockAll = vi.fn((): any[] => []);
const mockGet = vi.fn();
const mockRun = vi.fn(() => ({ changes: 1 }));
const mockPrepare = vi.fn(() => ({
  all: mockAll,
  get: mockGet,
  run: mockRun,
}));
const mockExec = vi.fn();
const mockTransaction = vi.fn((fn: () => void) => () => fn());

vi.mock('../db/sqlite.js', () => ({
  getDb: vi.fn(() => ({
    prepare: mockPrepare,
    exec: mockExec,
    transaction: mockTransaction,
  })),
  prepareStmt: vi.fn(() => ({
    all: mockAll,
    get: mockGet,
    run: mockRun,
  })),
}));

vi.mock('./portainer-client.js', () => ({
  getEndpoints: vi.fn(async () => [
    { Id: 1, Name: 'local', Type: 1, URL: 'tcp://localhost', Status: 1, Snapshots: [] },
    { Id: 2, Name: 'remote', Type: 1, URL: 'tcp://remote', Status: 1, Snapshots: [] },
  ]),
  getContainers: vi.fn(async () => []),
}));

vi.mock('../utils/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import {
  getEndpointCoverage,
  updateCoverageStatus,
  syncEndpointCoverage,
  verifyCoverage,
  getCoverageSummary,
} from './ebpf-coverage.js';
import { getContainers } from './portainer-client.js';

const mockGetContainers = vi.mocked(getContainers);

describe('ebpf-coverage service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getEndpointCoverage', () => {
    it('should return all coverage records', () => {
      const mockRecords = [
        { endpoint_id: 1, endpoint_name: 'local', status: 'deployed' },
        { endpoint_id: 2, endpoint_name: 'remote', status: 'unknown' },
      ];
      mockAll.mockReturnValueOnce(mockRecords);

      const result = getEndpointCoverage();
      expect(result).toEqual(mockRecords);
    });

    it('should return empty array when no records exist', () => {
      mockAll.mockReturnValueOnce([]);
      const result = getEndpointCoverage();
      expect(result).toEqual([]);
    });
  });

  describe('updateCoverageStatus', () => {
    it('should update status for an endpoint', () => {
      updateCoverageStatus(1, 'deployed');
      expect(mockRun).toHaveBeenCalledWith('deployed', null, 1);
    });

    it('should update status with a reason', () => {
      updateCoverageStatus(2, 'excluded', 'Development-only endpoint');
      expect(mockRun).toHaveBeenCalledWith('excluded', 'Development-only endpoint', 2);
    });
  });

  describe('syncEndpointCoverage', () => {
    it('should sync endpoints from Portainer', async () => {
      // Simulate that both are new insertions
      mockRun.mockReturnValue({ changes: 1 });

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
      mockRun.mockReturnValue({ changes: 1 });

      await syncEndpointCoverage();
      expect(mockGetContainers).toHaveBeenCalledTimes(2); // once per endpoint
      expect(mockTransaction).toHaveBeenCalled();
    });
  });

  describe('verifyCoverage', () => {
    it('should return verified=true when beyla container is running', async () => {
      mockGetContainers.mockResolvedValueOnce([
        { Id: 'c1', Names: ['/beyla'], Image: 'grafana/beyla:latest', State: 'running', Status: 'Up', Created: 0, Ports: [], Labels: {}, NetworkSettings: { Networks: {} } },
      ] as any);
      // Table exists
      mockGet.mockReturnValueOnce({ name: 'spans' });
      // Recent span found
      mockGet.mockReturnValueOnce({ start_time: '2025-01-01T12:00:00' });

      const result = await verifyCoverage(1);
      expect(result.verified).toBe(true);
      expect(result.beylaRunning).toBe(true);
      expect(result.lastTraceAt).toBe('2025-01-01T12:00:00');
    });

    it('should return verified=false when no beyla and no spans', async () => {
      mockGetContainers.mockResolvedValueOnce([]);
      // Table exists
      mockGet.mockReturnValueOnce({ name: 'spans' });
      // No recent span
      mockGet.mockReturnValueOnce(undefined);

      const result = await verifyCoverage(1);
      expect(result.verified).toBe(false);
      expect(result.beylaRunning).toBe(false);
      expect(result.lastTraceAt).toBeNull();
    });

    it('should handle missing spans table', async () => {
      mockGetContainers.mockResolvedValueOnce([]);
      // Table does not exist
      mockGet.mockReturnValueOnce(undefined);

      const result = await verifyCoverage(1);
      expect(result.verified).toBe(false);
      expect(result.lastTraceAt).toBeNull();
    });

    it('should detect failed beyla (container stopped)', async () => {
      mockGetContainers.mockResolvedValueOnce([
        { Id: 'c1', Names: ['/beyla'], Image: 'grafana/beyla:latest', State: 'exited', Status: 'Exited', Created: 0, Ports: [], Labels: {}, NetworkSettings: { Networks: {} } },
      ] as any);
      mockGet.mockReturnValueOnce({ name: 'spans' });
      mockGet.mockReturnValueOnce(undefined);

      const result = await verifyCoverage(1);
      expect(result.beylaRunning).toBe(false);
      expect(result.verified).toBe(false);
    });
  });

  describe('getCoverageSummary', () => {
    it('should return aggregate stats', () => {
      mockAll.mockReturnValueOnce([
        { status: 'deployed', count: 5 },
        { status: 'planned', count: 2 },
        { status: 'excluded', count: 1 },
        { status: 'failed', count: 0 },
        { status: 'unknown', count: 2 },
      ]);

      const summary = getCoverageSummary();
      expect(summary.total).toBe(10);
      expect(summary.deployed).toBe(5);
      expect(summary.planned).toBe(2);
      expect(summary.excluded).toBe(1);
      expect(summary.coveragePercent).toBe(50);
    });

    it('should handle empty coverage', () => {
      mockAll.mockReturnValueOnce([]);

      const summary = getCoverageSummary();
      expect(summary.total).toBe(0);
      expect(summary.coveragePercent).toBe(0);
    });
  });
});
