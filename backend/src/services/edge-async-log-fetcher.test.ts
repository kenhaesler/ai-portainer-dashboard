import { describe, it, expect, vi, beforeEach } from 'vitest';

import * as portainer from '../core/portainer/portainer-client.js';
import {
  initiateEdgeAsyncLogCollection,
  checkEdgeJobStatus,
  retrieveEdgeJobLogs,
  cleanupEdgeJob,
  getEdgeAsyncContainerLogs,
} from './edge-async-log-fetcher.js';

describe('edge-async-log-fetcher', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('initiateEdgeAsyncLogCollection', () => {
    it('creates an Edge Job with correct script and config', async () => {
      vi.spyOn(portainer, 'createEdgeJob').mockResolvedValue({
        Id: 42,
        Created: Date.now(),
        CronExpression: '0 0 1 1 *',
        Name: 'ci-logs-test',
        Recurring: false,
      });

      const handle = await initiateEdgeAsyncLogCollection(5, 'abc123def456', { tail: 200 });

      expect(handle).toEqual({ jobId: 42, endpointId: 5, containerId: 'abc123def456' });
      expect(portainer.createEdgeJob).toHaveBeenCalledWith({
        name: expect.stringMatching(/^ci-logs-abc123def456-\d+$/),
        cronExpression: '0 0 1 1 *',
        recurring: false,
        endpoints: [5],
        fileContent: '#!/bin/sh\ndocker logs --tail 200 --timestamps abc123def456 2>&1',
      });
    });

    it('defaults to tail 100 when not specified', async () => {
      vi.spyOn(portainer, 'createEdgeJob').mockResolvedValue({
        Id: 1,
        Created: Date.now(),
        CronExpression: '0 0 1 1 *',
        Name: 'ci-logs-test',
        Recurring: false,
      });

      await initiateEdgeAsyncLogCollection(1, 'container1');

      expect(portainer.createEdgeJob).toHaveBeenCalledWith(
        expect.objectContaining({
          fileContent: expect.stringContaining('--tail 100'),
        }),
      );
    });
  });

  describe('checkEdgeJobStatus', () => {
    it('returns ready=true with taskId when LogsStatus is 2', async () => {
      vi.spyOn(portainer, 'getEdgeJobTasks').mockResolvedValue([
        { Id: 'task-1', EndpointId: 5, LogsStatus: 2 },
      ]);

      const result = await checkEdgeJobStatus({ jobId: 42, endpointId: 5, containerId: 'abc' });

      expect(result).toEqual({ ready: true, taskId: 'task-1' });
    });

    it('returns ready=false when LogsStatus is not 2', async () => {
      vi.spyOn(portainer, 'getEdgeJobTasks').mockResolvedValue([
        { Id: 'task-1', EndpointId: 5, LogsStatus: 1 },
      ]);

      const result = await checkEdgeJobStatus({ jobId: 42, endpointId: 5, containerId: 'abc' });

      expect(result).toEqual({ ready: false });
    });

    it('returns ready=false when no task matches endpointId', async () => {
      vi.spyOn(portainer, 'getEdgeJobTasks').mockResolvedValue([
        { Id: 'task-1', EndpointId: 99, LogsStatus: 2 },
      ]);

      const result = await checkEdgeJobStatus({ jobId: 42, endpointId: 5, containerId: 'abc' });

      expect(result).toEqual({ ready: false });
    });

    it('returns ready=false when task list is empty', async () => {
      vi.spyOn(portainer, 'getEdgeJobTasks').mockResolvedValue([]);

      const result = await checkEdgeJobStatus({ jobId: 42, endpointId: 5, containerId: 'abc' });

      expect(result).toEqual({ ready: false });
    });
  });

  describe('retrieveEdgeJobLogs', () => {
    it('triggers collection then retrieves text', async () => {
      vi.spyOn(portainer, 'collectEdgeJobTaskLogs').mockResolvedValue(undefined);
      vi.spyOn(portainer, 'getEdgeJobTaskLogs').mockResolvedValue('2024-01-01T00:00:00Z log line 1\n');

      const logs = await retrieveEdgeJobLogs(42, 'task-1');

      expect(portainer.collectEdgeJobTaskLogs).toHaveBeenCalledWith(42, 'task-1');
      expect(portainer.getEdgeJobTaskLogs).toHaveBeenCalledWith(42, 'task-1');
      expect(logs).toContain('log line 1');
    });
  });

  describe('cleanupEdgeJob', () => {
    it('calls deleteEdgeJob', async () => {
      vi.spyOn(portainer, 'deleteEdgeJob').mockResolvedValue(undefined);

      await cleanupEdgeJob(42);

      expect(portainer.deleteEdgeJob).toHaveBeenCalledWith(42);
    });

    it('warns but does not throw on failure', async () => {
      vi.spyOn(portainer, 'deleteEdgeJob').mockRejectedValue(new Error('Not found'));

      await expect(cleanupEdgeJob(42)).resolves.toBeUndefined();
    });
  });

  describe('getEdgeAsyncContainerLogs', () => {
    it('completes full lifecycle: initiate, poll, retrieve, cleanup', async () => {
      vi.spyOn(portainer, 'createEdgeJob').mockResolvedValue({
        Id: 42,
        Created: Date.now(),
        CronExpression: '0 0 1 1 *',
        Name: 'test',
        Recurring: false,
      });

      // First poll: not ready; second poll: ready
      vi.spyOn(portainer, 'getEdgeJobTasks')
        .mockResolvedValueOnce([{ Id: 'task-1', EndpointId: 5, LogsStatus: 1 }])
        .mockResolvedValueOnce([{ Id: 'task-1', EndpointId: 5, LogsStatus: 2 }]);

      vi.spyOn(portainer, 'collectEdgeJobTaskLogs').mockResolvedValue(undefined);
      vi.spyOn(portainer, 'getEdgeJobTaskLogs').mockResolvedValue('collected logs\n');
      vi.spyOn(portainer, 'deleteEdgeJob').mockResolvedValue(undefined);

      const logs = await getEdgeAsyncContainerLogs(5, 'abc123', {
        tail: 50,
        maxWaitMs: 15000,
        pollIntervalMs: 10,
      });

      expect(logs).toBe('collected logs\n');
      expect(portainer.createEdgeJob).toHaveBeenCalledTimes(1);
      expect(portainer.getEdgeJobTasks).toHaveBeenCalledTimes(2);
      expect(portainer.collectEdgeJobTaskLogs).toHaveBeenCalledTimes(1);
      expect(portainer.deleteEdgeJob).toHaveBeenCalledWith(42);
    });

    it('throws on timeout and still cleans up', async () => {
      vi.spyOn(portainer, 'createEdgeJob').mockResolvedValue({
        Id: 99,
        Created: Date.now(),
        CronExpression: '0 0 1 1 *',
        Name: 'test',
        Recurring: false,
      });

      vi.spyOn(portainer, 'getEdgeJobTasks').mockResolvedValue([
        { Id: 'task-1', EndpointId: 5, LogsStatus: 1 },
      ]);
      vi.spyOn(portainer, 'deleteEdgeJob').mockResolvedValue(undefined);

      await expect(
        getEdgeAsyncContainerLogs(5, 'abc123', { maxWaitMs: 50, pollIntervalMs: 10 }),
      ).rejects.toThrow(/timed out/);

      expect(portainer.deleteEdgeJob).toHaveBeenCalledWith(99);
    });

    it('cleans up even when retrieval fails', async () => {
      vi.spyOn(portainer, 'createEdgeJob').mockResolvedValue({
        Id: 77,
        Created: Date.now(),
        CronExpression: '0 0 1 1 *',
        Name: 'test',
        Recurring: false,
      });

      vi.spyOn(portainer, 'getEdgeJobTasks').mockResolvedValue([
        { Id: 'task-1', EndpointId: 5, LogsStatus: 2 },
      ]);
      vi.spyOn(portainer, 'collectEdgeJobTaskLogs').mockRejectedValue(new Error('Collection failed'));
      vi.spyOn(portainer, 'deleteEdgeJob').mockResolvedValue(undefined);

      await expect(
        getEdgeAsyncContainerLogs(5, 'abc123', { maxWaitMs: 5000, pollIntervalMs: 10 }),
      ).rejects.toThrow('Collection failed');

      expect(portainer.deleteEdgeJob).toHaveBeenCalledWith(77);
    });
  });
});
