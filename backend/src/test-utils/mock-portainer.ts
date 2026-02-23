/**
 * Shared mock factories for portainer-client and portainer-cache.
 * Eliminates duplicate inline vi.mock() stubs across 30+ test files.
 *
 * Usage:
 *   import { createPortainerClientMock } from '../test-utils/mock-portainer.js';
 *   vi.mock('../services/portainer-client.js', () => createPortainerClientMock());
 */
import { vi } from 'vitest';

/** Returns a fresh mock object covering every export from portainer-client.ts */
export function createPortainerClientMock(): Record<string, unknown> {
  return {
    _resetClientState: vi.fn(),
    isEndpointDegraded: vi.fn().mockReturnValue(false),
    isCircuitOpen: vi.fn().mockReturnValue(false),
    pruneStaleBreakers: vi.fn().mockReturnValue(0),
    startBreakerPruning: vi.fn(),
    stopBreakerPruning: vi.fn(),
    getCircuitBreakerStats: vi.fn().mockReturnValue({ breakers: [], degradedCount: 0 }),
    sanitizeContainerLabels: vi.fn((labels: Record<string, string>) => labels),
    decodeDockerLogPayload: vi.fn((buf: Buffer) => buf.toString()),
    checkPortainerReachable: vi.fn().mockResolvedValue({ reachable: true, ok: true }),
    buildApiUrl: vi.fn((path: string) => `http://portainer:9000/api${path}`),
    buildApiHeaders: vi.fn().mockReturnValue({ 'X-API-Key': 'test' }),
    getEndpoints: vi.fn().mockResolvedValue([]),
    getEndpoint: vi.fn().mockResolvedValue(null),
    getContainers: vi.fn().mockResolvedValue([]),
    getContainer: vi.fn().mockResolvedValue(null),
    getContainerHostConfig: vi.fn().mockResolvedValue({}),
    startContainer: vi.fn().mockResolvedValue(undefined),
    stopContainer: vi.fn().mockResolvedValue(undefined),
    restartContainer: vi.fn().mockResolvedValue(undefined),
    pullImage: vi.fn().mockResolvedValue(undefined),
    createContainer: vi.fn().mockResolvedValue(undefined),
    removeContainer: vi.fn().mockResolvedValue(undefined),
    getContainerLogs: vi.fn().mockResolvedValue(''),
    streamContainerLogs: vi.fn().mockResolvedValue(undefined),
    getContainerStats: vi.fn().mockResolvedValue({}),
    getStacks: vi.fn().mockResolvedValue([]),
    getStacksByEndpoint: vi.fn().mockResolvedValue([]),
    getStack: vi.fn().mockResolvedValue(null),
    getNetworks: vi.fn().mockResolvedValue([]),
    getImages: vi.fn().mockResolvedValue([]),
    createExec: vi.fn().mockResolvedValue('exec-id'),
    startExec: vi.fn().mockResolvedValue(undefined),
    inspectExec: vi.fn().mockResolvedValue({ Running: false, ExitCode: 0 }),
    getArchive: vi.fn().mockResolvedValue(Buffer.alloc(0)),
    getEdgeJobs: vi.fn().mockResolvedValue([]),
    getEdgeJob: vi.fn().mockResolvedValue(null),
    createEdgeJob: vi.fn().mockResolvedValue({}),
    deleteEdgeJob: vi.fn().mockResolvedValue(undefined),
    getEdgeJobTasks: vi.fn().mockResolvedValue([]),
    collectEdgeJobTaskLogs: vi.fn().mockResolvedValue(undefined),
    getEdgeJobTaskLogs: vi.fn().mockResolvedValue(''),
  };
}

/** Returns a fresh mock object covering every export from portainer-cache.ts */
export function createPortainerCacheMock(): Record<string, unknown> {
  return {
    cachedFetch: vi.fn((_key: string, _ttl: number, fn: () => Promise<unknown>) => fn()),
    cachedFetchSWR: vi.fn((_key: string, _ttl: number, fn: () => Promise<unknown>) => fn()),
    cachedFetchMany: vi.fn(async (_keys: string[], _ttl: number, fn: () => Promise<unknown>) => fn()),
    getCacheKey: vi.fn((...args: (string | number)[]) => args.join(':')),
    getInFlightCount: vi.fn().mockReturnValue(0),
    TTL: {
      ENDPOINTS: 900,
      CONTAINERS: 300,
      CONTAINER_INSPECT: 300,
      STACKS: 600,
      IMAGES: 600,
      NETWORKS: 600,
      STATS: 60,
    },
    cache: {
      get: vi.fn(),
      set: vi.fn(),
      clear: vi.fn(),
      invalidate: vi.fn(),
      invalidatePattern: vi.fn(),
      getEntries: vi.fn().mockReturnValue([]),
      size: vi.fn().mockReturnValue(0),
      getStats: vi.fn().mockReturnValue({ size: 0, hits: 0, misses: 0, hitRate: 'N/A' }),
      getMemoryWithStaleInfo: vi.fn(),
      getBackoffState: vi.fn().mockReturnValue({ failureCount: 0, disabledUntil: 0, configured: false }),
      ping: vi.fn().mockResolvedValue(false),
    },
  };
}
