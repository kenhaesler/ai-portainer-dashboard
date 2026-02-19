import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./portainer-client.js', () => ({
  createEdgeJob: vi.fn(),
  getEdgeJobTasks: vi.fn(),
  collectEdgeJobTaskLogs: vi.fn(),
  getEdgeJobTaskLogs: vi.fn(),
  deleteEdgeJob: vi.fn(),
}));

import * as portainer from './portainer-client.js';
import {
  initiateEdgeAsyncLogCollection,
  checkEdgeJobStatus,
  retrieveEdgeJobLogs,
  cleanupEdgeJob,
  getEdgeAsyncContainerLogs,
} from './edge-async-log-fetcher.js';

const mockCreateEdgeJob = vi.mocked(portainer.createEdgeJob);
const mockGetEdgeJobTasks = vi.mocked(portainer.getEdgeJobTasks);
const mockCollectEdgeJobTaskLogs = vi.mocked(portainer.collectEdgeJobTaskLogs);
const mockGetEdgeJobTaskLogs = vi.mocked(portainer.getEdgeJobTaskLogs);
const mockDeleteEdgeJob = vi.mocked(portainer.deleteEdgeJob);

describe('edge-async-log-fetcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initiateEdgeAsyncLogCollection', () => {
    it('creates an Edge Job with correct script and config', async () => {
      mockCreateEdgeJob.mockResolvedValue({
        Id: 42,
        Created: Date.now(),
        CronExpression: '0 0 1 1 *',
        Name: 'ci-logs-test',
        Recurring: false,
      });

      const handle = await initiateEdgeAsyncLogCollection(5, 'abc123def456', { tail: 200 });

      expect(handle).toEqual({ jobId: 42, endpointId: 5, containerId: 'abc123def456' });
      expect(mockCreateEdgeJob).toHaveBeenCalledWith({
        name: expect.stringMatching(/^ci-logs-abc123def456-\d+$/),
        cronExpression: '0 0 1 1 *',
        recurring: false,
        endpoints: [5],
        fileContent: '#!/bin/sh\ndocker logs --tail 200 --timestamps abc123def456 2>&1',
      });
    });

    it('defaults to tail 100 when not specified', async () => {
      mockCreateEdgeJob.mockResolvedValue({
        Id: 1,
        Created: Date.now(),
        CronExpression: '0 0 1 1 *',
        Name: 'ci-logs-test',
        Recurring: false,
      });

      await initiateEdgeAsyncLogCollection(1, 'container1');

      expect(mockCreateEdgeJob).toHaveBeenCalledWith(
        expect.objectContaining({
          fileContent: expect.stringContaining('--tail 100'),
        }),
      );
    });
  });

  describe('checkEdgeJobStatus', () => {
    it('returns ready=true with taskId when LogsStatus is 2', async () => {
      mockGetEdgeJobTasks.mockResolvedValue([
        { Id: 'task-1', EndpointId: 5, LogsStatus: 2 },
      ]);

      const result = await checkEdgeJobStatus({ jobId: 42, endpointId: 5, containerId: 'abc' });

      expect(result).toEqual({ ready: true, taskId: 'task-1' });
    });

    it('returns ready=false when LogsStatus is not 2', async () => {
      mockGetEdgeJobTasks.mockResolvedValue([
        { Id: 'task-1', EndpointId: 5, LogsStatus: 1 },
      ]);

      const result = await checkEdgeJobStatus({ jobId: 42, endpointId: 5, containerId: 'abc' });

      expect(result).toEqual({ ready: false });
    });

    it('returns ready=false when no task matches endpointId', async () => {
      mockGetEdgeJobTasks.mockResolvedValue([
        { Id: 'task-1', EndpointId: 99, LogsStatus: 2 },
      ]);

      const result = await checkEdgeJobStatus({ jobId: 42, endpointId: 5, containerId: 'abc' });

      expect(result).toEqual({ ready: false });
    });

    it('returns ready=false when task list is empty', async () => {
      mockGetEdgeJobTasks.mockResolvedValue([]);

      const result = await checkEdgeJobStatus({ jobId: 42, endpointId: 5, containerId: 'abc' });

      expect(result).toEqual({ ready: false });
    });
  });

  describe('retrieveEdgeJobLogs', () => {
    it('triggers collection then retrieves text', async () => {
      mockCollectEdgeJobTaskLogs.mockResolvedValue(undefined);
      mockGetEdgeJobTaskLogs.mockResolvedValue('2024-01-01T00:00:00Z log line 1\n');

      const logs = await retrieveEdgeJobLogs(42, 'task-1');

      expect(mockCollectEdgeJobTaskLogs).toHaveBeenCalledWith(42, 'task-1');
      expect(mockGetEdgeJobTaskLogs).toHaveBeenCalledWith(42, 'task-1');
      expect(logs).toContain('log line 1');
    });
  });

  describe('cleanupEdgeJob', () => {
    it('calls deleteEdgeJob', async () => {
      mockDeleteEdgeJob.mockResolvedValue(undefined);

      await cleanupEdgeJob(42);

      expect(mockDeleteEdgeJob).toHaveBeenCalledWith(42);
    });

    it('warns but does not throw on failure', async () => {
      mockDeleteEdgeJob.mockRejectedValue(new Error('Not found'));

      await expect(cleanupEdgeJob(42)).resolves.toBeUndefined();
    });
  });

  describe('getEdgeAsyncContainerLogs', () => {
    it('completes full lifecycle: initiate, poll, retrieve, cleanup', async () => {
      mockCreateEdgeJob.mockResolvedValue({
        Id: 42,
        Created: Date.now(),
        CronExpression: '0 0 1 1 *',
        Name: 'test',
        Recurring: false,
      });

      // First poll: not ready; second poll: ready
      mockGetEdgeJobTasks
        .mockResolvedValueOnce([{ Id: 'task-1', EndpointId: 5, LogsStatus: 1 }])
        .mockResolvedValueOnce([{ Id: 'task-1', EndpointId: 5, LogsStatus: 2 }]);

      mockCollectEdgeJobTaskLogs.mockResolvedValue(undefined);
      mockGetEdgeJobTaskLogs.mockResolvedValue('collected logs\n');
      mockDeleteEdgeJob.mockResolvedValue(undefined);

      const logs = await getEdgeAsyncContainerLogs(5, 'abc123', {
        tail: 50,
        maxWaitMs: 15000,
        pollIntervalMs: 10,
      });

      expect(logs).toBe('collected logs\n');
      expect(mockCreateEdgeJob).toHaveBeenCalledTimes(1);
      expect(mockGetEdgeJobTasks).toHaveBeenCalledTimes(2);
      expect(mockCollectEdgeJobTaskLogs).toHaveBeenCalledTimes(1);
      expect(mockDeleteEdgeJob).toHaveBeenCalledWith(42);
    });

    it('throws on timeout and still cleans up', async () => {
      mockCreateEdgeJob.mockResolvedValue({
        Id: 99,
        Created: Date.now(),
        CronExpression: '0 0 1 1 *',
        Name: 'test',
        Recurring: false,
      });

      mockGetEdgeJobTasks.mockResolvedValue([
        { Id: 'task-1', EndpointId: 5, LogsStatus: 1 },
      ]);
      mockDeleteEdgeJob.mockResolvedValue(undefined);

      await expect(
        getEdgeAsyncContainerLogs(5, 'abc123', { maxWaitMs: 50, pollIntervalMs: 10 }),
      ).rejects.toThrow(/timed out/);

      expect(mockDeleteEdgeJob).toHaveBeenCalledWith(99);
    });

    it('cleans up even when retrieval fails', async () => {
      mockCreateEdgeJob.mockResolvedValue({
        Id: 77,
        Created: Date.now(),
        CronExpression: '0 0 1 1 *',
        Name: 'test',
        Recurring: false,
      });

      mockGetEdgeJobTasks.mockResolvedValue([
        { Id: 'task-1', EndpointId: 5, LogsStatus: 2 },
      ]);
      mockCollectEdgeJobTaskLogs.mockRejectedValue(new Error('Collection failed'));
      mockDeleteEdgeJob.mockResolvedValue(undefined);

      await expect(
        getEdgeAsyncContainerLogs(5, 'abc123', { maxWaitMs: 5000, pollIntervalMs: 10 }),
      ).rejects.toThrow('Collection failed');

      expect(mockDeleteEdgeJob).toHaveBeenCalledWith(77);
    });
  });
});
