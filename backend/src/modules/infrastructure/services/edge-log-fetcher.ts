import * as portainer from '../../../core/portainer/portainer-client.js';
import { createChildLogger } from '../../../core/utils/logger.js';

const log = createChildLogger('edge-log-fetcher');

/**
 * Check if an error indicates the Docker proxy is unavailable
 * (tunnel not yet established for Edge Standard endpoints).
 * Checks for 404, 502, and 503 — all indicate the proxy cannot reach Docker.
 */
export function isDockerProxyUnavailable(err: unknown): boolean {
  if (err && typeof err === 'object' && 'status' in err) {
    const status = (err as { status: number }).status;
    return status === 502 || status === 503 || status === 404;
  }
  return false;
}

/**
 * Poll until the Edge agent tunnel is established by making lightweight
 * Docker API calls. The first proxy request triggers Portainer's
 * `SetTunnelStatusToRequired()`, and subsequent polls wait for the
 * Chisel reverse tunnel to come up.
 *
 * After confirming the tunnel is up, waits an additional stabilization
 * delay to allow the proxy to fully initialize for all Docker API operations.
 */
export async function waitForTunnel(
  endpointId: number,
  options: { maxWaitMs?: number; pollIntervalMs?: number; stabilizationMs?: number } = {},
): Promise<void> {
  const { maxWaitMs = 15000, pollIntervalMs = 2000, stabilizationMs = 1000 } = options;
  const deadline = Date.now() + maxWaitMs;

  log.info({ endpointId, maxWaitMs, pollIntervalMs }, 'Waiting for Edge tunnel to establish');

  while (Date.now() < deadline) {
    try {
      await portainer.getContainers(endpointId, false);
      log.info({ endpointId }, 'Edge tunnel established');

      // Wait for the proxy to fully stabilize before returning.
      // The tunnel may accept list operations before individual container
      // operations (logs, inspect) are fully routable.
      if (stabilizationMs > 0) {
        log.debug({ endpointId, stabilizationMs }, 'Waiting for proxy stabilization');
        await new Promise((resolve) => setTimeout(resolve, stabilizationMs));
      }
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
 * On 502/503/404 (tunnel not established or proxy unavailable), triggers a
 * lightweight Docker API call to open the tunnel, polls until ready, then
 * retries the log fetch with exponential backoff (up to 3 attempts).
 */
export async function getContainerLogsWithRetry(
  endpointId: number,
  containerId: string,
  options: { tail?: number; since?: number; until?: number; timestamps?: boolean } = {},
  retryOptions: { maxWaitMs?: number; pollIntervalMs?: number } = {},
): Promise<string> {
  const MAX_RETRIES = 3;
  let lastErr: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await portainer.getContainerLogs(endpointId, containerId, options);
    } catch (err) {
      lastErr = err;

      if (!isDockerProxyUnavailable(err)) {
        throw err;
      }

      if (attempt === 0) {
        log.info({ endpointId, containerId }, 'Docker proxy unavailable, attempting tunnel warm-up');
        await waitForTunnel(endpointId, retryOptions);
      } else {
        // Subsequent retries use exponential backoff
        const delay = Math.pow(2, attempt) * 500;
        log.info(
          { endpointId, containerId, attempt, delay },
          'Log fetch still failing after tunnel warm-up, retrying with backoff',
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastErr;
}
