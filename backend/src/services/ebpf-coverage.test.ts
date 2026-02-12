import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  getEndpoint: vi.fn(async (id: number) => ({ Id: id, Name: `endpoint-${id}`, Type: 1, URL: 'tcp://localhost', Status: 1, Snapshots: [] })),
  getContainers: vi.fn(async () => []),
  pullImage: vi.fn(async () => {}),
  createContainer: vi.fn(async () => ({ Id: 'new-beyla-id' })),
  startContainer: vi.fn(async () => {}),
  stopContainer: vi.fn(async () => {}),
  removeContainer: vi.fn(async () => {}),
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
  detectBeylaOnEndpoint,
  BEYLA_COMPATIBLE_TYPES,
  deployBeyla,
  disableBeyla,
  enableBeyla,
  removeBeylaFromEndpoint,
} from './ebpf-coverage.js';
import {
  getEndpoints,
  getContainers,
  getEndpoint,
  pullImage,
  createContainer,
  startContainer,
  stopContainer,
  removeContainer,
} from './portainer-client.js';

const mockGetContainers = vi.mocked(getContainers);
const mockGetEndpoints = vi.mocked(getEndpoints);
const mockGetEndpoint = vi.mocked(getEndpoint);
const mockPullImage = vi.mocked(pullImage);
const mockCreateContainer = vi.mocked(createContainer);
const mockStartContainer = vi.mocked(startContainer);
const mockStopContainer = vi.mocked(stopContainer);
const mockRemoveContainer = vi.mocked(removeContainer);

describe('ebpf-coverage service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    it('should return all coverage records', () => {
      const mockRecords = [
        { endpoint_id: 1, endpoint_name: 'local', status: 'deployed', drifted: false },
        { endpoint_id: 2, endpoint_name: 'remote', status: 'unknown', drifted: false },
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

    it('should accept new status types', () => {
      updateCoverageStatus(3, 'not_deployed');
      expect(mockRun).toHaveBeenCalledWith('not_deployed', null, 3);
      updateCoverageStatus(4, 'unreachable');
      expect(mockRun).toHaveBeenCalledWith('unreachable', null, 4);
      updateCoverageStatus(5, 'incompatible', 'Edge Agent');
      expect(mockRun).toHaveBeenCalledWith('incompatible', 'Edge Agent', 5);
    });
  });

  describe('syncEndpointCoverage', () => {
    it('should sync endpoints from Portainer', async () => {
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
      expect(mockGetContainers).toHaveBeenCalledTimes(2);
      expect(mockTransaction).toHaveBeenCalled();
    });

    it('should detect Beyla on Edge Agent endpoints (type 4 is compatible)', async () => {
      mockGetEndpoints.mockResolvedValueOnce([
        { Id: 1, Name: 'local', Type: 1, URL: 'tcp://localhost', Status: 1, Snapshots: [] },
        { Id: 3, Name: 'edge-agent', Type: 4, URL: 'tcp://edge', Status: 1, Snapshots: [] },
      ] as any);
      mockGetContainers.mockResolvedValue([]);
      mockRun.mockReturnValue({ changes: 1 });
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
      mockRun.mockReturnValue({ changes: 1 });
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
      mockRun.mockReturnValue({ changes: 1 });
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
      mockGet.mockReturnValueOnce({ name: 'spans' });
      mockGet.mockReturnValueOnce({ start_time: '2025-01-01T12:00:00' });
      const result = await verifyCoverage(1);
      expect(result.verified).toBe(true);
      expect(result.beylaRunning).toBe(true);
      expect(result.lastTraceAt).toBe('2025-01-01T12:00:00');
    });

    it('should return verified=false when no beyla and no spans', async () => {
      mockGetContainers.mockResolvedValueOnce([]);
      mockGet.mockReturnValueOnce({ name: 'spans' });
      mockGet.mockReturnValueOnce(undefined);
      const result = await verifyCoverage(1);
      expect(result.verified).toBe(false);
      expect(result.beylaRunning).toBe(false);
      expect(result.lastTraceAt).toBeNull();
    });

    it('should handle missing spans table', async () => {
      mockGetContainers.mockResolvedValueOnce([]);
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

    it('should handle unreachable endpoint during verify', async () => {
      mockGetContainers.mockRejectedValueOnce(new Error('Connection refused'));
      mockGet.mockReturnValueOnce({ name: 'spans' });
      mockGet.mockReturnValueOnce(undefined);
      const result = await verifyCoverage(1);
      expect(result.beylaRunning).toBe(false);
      expect(result.verified).toBe(false);
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
    it('should return aggregate stats including new statuses', () => {
      mockAll.mockReturnValueOnce([
        { status: 'deployed', count: 5 },
        { status: 'planned', count: 2 },
        { status: 'excluded', count: 1 },
        { status: 'failed', count: 0 },
        { status: 'unknown', count: 1 },
        { status: 'not_deployed', count: 3 },
        { status: 'unreachable', count: 2 },
        { status: 'incompatible', count: 1 },
      ]);
      const summary = getCoverageSummary();
      expect(summary.total).toBe(15);
      expect(summary.deployed).toBe(5);
      expect(summary.planned).toBe(2);
      expect(summary.not_deployed).toBe(3);
      expect(summary.unreachable).toBe(2);
      expect(summary.incompatible).toBe(1);
      expect(summary.coveragePercent).toBe(33);
    });

    it('should handle empty coverage', () => {
      mockAll.mockReturnValueOnce([]);
      const summary = getCoverageSummary();
      expect(summary.total).toBe(0);
      expect(summary.coveragePercent).toBe(0);
      expect(summary.not_deployed).toBe(0);
      expect(summary.unreachable).toBe(0);
      expect(summary.incompatible).toBe(0);
    });
  });
});
