import * as portainer from './portainer-client.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('edge-async-log-fetcher');

export interface EdgeAsyncLogHandle {
  jobId: number;
  endpointId: number;
  containerId: string;
}

export interface EdgeAsyncLogOptions {
  tail?: number;
}

export interface EdgeJobStatusResult {
  ready: boolean;
  taskId?: string;
}

/**
 * Create an Edge Job that runs `docker logs` on the agent.
 * Returns a handle for subsequent status checks and log retrieval.
 */
export async function initiateEdgeAsyncLogCollection(
  endpointId: number,
  containerId: string,
  opts: EdgeAsyncLogOptions = {},
): Promise<EdgeAsyncLogHandle> {
  const tail = opts.tail ?? 100;
  const script = `#!/bin/sh\ndocker logs --tail ${tail} --timestamps ${containerId} 2>&1`;
  const name = `ci-logs-${containerId.slice(0, 12)}-${Date.now()}`;

  log.info({ endpointId, containerId, tail, name }, 'Creating Edge Job for async log collection');

  const job = await portainer.createEdgeJob({
    name,
    cronExpression: '0 0 1 1 *',
    recurring: false,
    endpoints: [endpointId],
    fileContent: script,
  });

  return { jobId: job.Id, endpointId, containerId };
}

/**
 * Check whether the Edge Job task has completed and logs are available.
 * LogsStatus === 2 means logs are collected and ready for retrieval.
 */
export async function checkEdgeJobStatus(handle: EdgeAsyncLogHandle): Promise<EdgeJobStatusResult> {
  const tasks = await portainer.getEdgeJobTasks(handle.jobId);
  const task = tasks.find((t) => t.EndpointId === handle.endpointId);

  if (!task) {
    return { ready: false };
  }

  if (task.LogsStatus === 2) {
    return { ready: true, taskId: task.Id };
  }

  return { ready: false };
}

/**
 * Trigger log collection on a completed task and retrieve the log text.
 */
export async function retrieveEdgeJobLogs(jobId: number, taskId: string): Promise<string> {
  await portainer.collectEdgeJobTaskLogs(jobId, taskId);
  return await portainer.getEdgeJobTaskLogs(jobId, taskId);
}

/**
 * Delete the Edge Job. Logs a warning on failure but does not throw.
 */
export async function cleanupEdgeJob(jobId: number): Promise<void> {
  try {
    await portainer.deleteEdgeJob(jobId);
    log.info({ jobId }, 'Cleaned up Edge Job');
  } catch (err) {
    log.warn({ jobId, err }, 'Failed to clean up Edge Job');
  }
}

/**
 * Blocking convenience function: initiate log collection, poll until ready,
 * retrieve logs, and clean up. Suitable for LLM tool calls where blocking is acceptable.
 * Max wait: 120s (configurable via maxWaitMs).
 */
export async function getEdgeAsyncContainerLogs(
  endpointId: number,
  containerId: string,
  opts: EdgeAsyncLogOptions & { maxWaitMs?: number; pollIntervalMs?: number } = {},
): Promise<string> {
  const { maxWaitMs = 120000, pollIntervalMs = 5000, ...logOpts } = opts;
  const handle = await initiateEdgeAsyncLogCollection(endpointId, containerId, logOpts);

  try {
    const deadline = Date.now() + maxWaitMs;

    while (Date.now() < deadline) {
      const status = await checkEdgeJobStatus(handle);
      if (status.ready && status.taskId) {
        const logs = await retrieveEdgeJobLogs(handle.jobId, status.taskId);
        return logs;
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await new Promise((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, remaining)));
    }

    throw new Error(`Edge Job log collection timed out after ${maxWaitMs}ms`);
  } finally {
    await cleanupEdgeJob(handle.jobId);
  }
}
