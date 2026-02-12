import * as portainer from './portainer-client.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('edge-log-fetcher');

/**
 * Check if an error indicates the Docker proxy is unavailable
 * (tunnel not yet established for Edge Standard endpoints).
 */
export function isDockerProxyUnavailable(err: unknown): boolean {
  if (err && typeof err === 'object' && 'status' in err) {
    const status = (err as { status: number }).status;
    return status === 502 || status === 404;
  }
  return false;
}

/**
 * Poll until the Edge agent tunnel is established by making lightweight
 * Docker API calls. The first proxy request triggers Portainer's
 * `SetTunnelStatusToRequired()`, and subsequent polls wait for the
 * Chisel reverse tunnel to come up.
 */
export async function waitForTunnel(
  endpointId: number,
  options: { maxWaitMs?: number; pollIntervalMs?: number } = {},
): Promise<void> {
  const { maxWaitMs = 15000, pollIntervalMs = 2000 } = options;
  const deadline = Date.now() + maxWaitMs;

  log.info({ endpointId, maxWaitMs, pollIntervalMs }, 'Waiting for Edge tunnel to establish');

  while (Date.now() < deadline) {
    try {
      await portainer.getContainers(endpointId, false);
      log.info({ endpointId }, 'Edge tunnel established');
      return;
    } catch {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await new Promise((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, remaining)));
    }
  }

  const err = new Error('Edge agent tunnel did not establish within timeout');
  (err as any).status = 504;
  throw err;
}

/**
 * Fetch container logs with automatic tunnel warm-up retry.
 * On 502/404 (tunnel not established), triggers a lightweight Docker API call
 * to open the tunnel, polls until ready, then retries the log fetch.
 */
export async function getContainerLogsWithRetry(
  endpointId: number,
  containerId: string,
  options: { tail?: number; since?: number; until?: number; timestamps?: boolean } = {},
  retryOptions: { maxWaitMs?: number; pollIntervalMs?: number } = {},
): Promise<string> {
  try {
    return await portainer.getContainerLogs(endpointId, containerId, options);
  } catch (err) {
    if (isDockerProxyUnavailable(err)) {
      log.info({ endpointId, containerId }, 'Docker proxy unavailable, attempting tunnel warm-up');
      await waitForTunnel(endpointId, retryOptions);
      return await portainer.getContainerLogs(endpointId, containerId, options);
    }
    throw err;
  }
}
