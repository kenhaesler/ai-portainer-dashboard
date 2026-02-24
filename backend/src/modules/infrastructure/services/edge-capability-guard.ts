import { getEndpoint } from '../../../core/portainer/portainer-client.js';
import { normalizeEndpoint, type EdgeCapabilities } from '../../../core/portainer/portainer-normalizers.js';
import { cachedFetchSWR, getCacheKey, TTL } from '../../../core/portainer/portainer-cache.js';
import { createChildLogger } from '../../../core/utils/logger.js';

const log = createChildLogger('edge-capability-guard');

export type CapabilityName = keyof EdgeCapabilities;

/**
 * Look up an endpoint and return its edge capabilities.
 * Uses the cached endpoint data to avoid extra API calls.
 */
export async function getEndpointCapabilities(endpointId: number): Promise<EdgeCapabilities> {
  const raw = await cachedFetchSWR(
    getCacheKey('endpoint', endpointId),
    TTL.ENDPOINTS,
    () => getEndpoint(endpointId),
  );
  return normalizeEndpoint(raw).capabilities;
}

/**
 * Assert that an endpoint supports a given capability.
 * Throws a structured error (status 422) if the capability is unavailable.
 *
 * Usage in route handlers:
 * ```ts
 * await assertCapability(endpointId, 'exec');
 * ```
 */
export async function assertCapability(
  endpointId: number,
  capability: CapabilityName,
): Promise<void> {
  const caps = await getEndpointCapabilities(endpointId);
  if (!caps[capability]) {
    log.warn({ endpointId, capability }, 'Capability unavailable on Edge Async endpoint');
    const err = new Error(
      `Edge Async endpoints do not support "${capability}" operations. ` +
      'This endpoint uses asynchronous communication without a persistent tunnel.',
    );
    (err as any).statusCode = 422;
    throw err;
  }
}

/**
 * Check if an endpoint supports live/interactive features (exec, stats, logs).
 * Returns false for Edge Async endpoints.
 * Useful for filtering endpoints in background tasks (scheduler, monitoring).
 */
export async function supportsLiveFeatures(endpointId: number): Promise<boolean> {
  try {
    const caps = await getEndpointCapabilities(endpointId);
    return caps.liveStats;
  } catch {
    return true; // Default to true if we can't determine — let the operation try and fail normally
  }
}

/**
 * Check if an endpoint is Edge Standard (Type 4 with Chisel tunnel).
 * These endpoints may need tunnel warm-up before Docker proxy calls succeed.
 */
export async function isEdgeStandard(endpointId: number): Promise<boolean> {
  try {
    const raw = await cachedFetchSWR(
      getCacheKey('endpoint', endpointId),
      TTL.ENDPOINTS,
      () => getEndpoint(endpointId),
    );
    const norm = normalizeEndpoint(raw);
    return norm.edgeMode === 'standard';
  } catch {
    return false;
  }
}

/**
 * Check if an endpoint is Edge Async (Type 7 — no Docker tunnel).
 * These endpoints require Edge Jobs for log retrieval.
 */
export async function isEdgeAsync(endpointId: number): Promise<boolean> {
  try {
    const raw = await cachedFetchSWR(
      getCacheKey('endpoint', endpointId),
      TTL.ENDPOINTS,
      () => getEndpoint(endpointId),
    );
    const norm = normalizeEndpoint(raw);
    return norm.edgeMode === 'async';
  } catch {
    return false;
  }
}
