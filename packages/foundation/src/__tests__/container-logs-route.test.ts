import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';
import { containerLogsRoutes } from '../routes/container-logs.js';

const mockIsEdgeAsync = vi.fn();
const mockInitiateEdgeAsyncLogCollection = vi.fn();

// Kept: Portainer/Edge APIs are external boundaries unavailable in CI.
vi.mock('@dashboard/infrastructure', () => ({
  getContainerLogsWithRetry: vi.fn(),
  waitForTunnel: vi.fn(),
  assertCapability: vi.fn(),
  isEdgeStandard: vi.fn(),
  isEdgeAsync: (...args: unknown[]) => mockIsEdgeAsync(...args),
  initiateEdgeAsyncLogCollection: (...args: unknown[]) => mockInitiateEdgeAsyncLogCollection(...args),
  checkEdgeJobStatus: vi.fn(),
  retrieveEdgeJobLogs: vi.fn(),
  cleanupEdgeJob: vi.fn(),
  IncrementalDockerFrameDecoder: class {
    push() { return []; }
    flush() { return []; }
  },
}));

vi.mock('@dashboard/core/portainer/portainer-client.js', async (importOriginal) =>
  await importOriginal()
);

describe('Edge Async container log collection route security', () => {
  let app: ReturnType<typeof Fastify>;
  let currentRole: 'viewer' | 'admin';

  beforeEach(async () => {
    vi.clearAllMocks();
    currentRole = 'admin';
    mockIsEdgeAsync.mockResolvedValue(true);
    mockInitiateEdgeAsyncLogCollection.mockResolvedValue({
      jobId: 42,
      endpointId: 1,
      containerId: 'abc123',
    });

    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.decorate('authenticate', async () => undefined);
    app.decorate('requireRole', () => async (request: FastifyRequest, reply: FastifyReply) => {
      if (request.user?.role !== 'admin') {
        return reply.code(403).send({ error: 'Insufficient permissions' });
      }
    });
    app.decorateRequest('user', undefined);
    app.addHook('preHandler', async (request: FastifyRequest) => {
      request.user = {
        sub: 'user-1',
        username: 'tester',
        sessionId: 'session-1',
        role: currentRole,
      };
    });
    await app.register(containerLogsRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects a viewer before creating an Edge Job', async () => {
    currentRole = 'viewer';

    const response = await app.inject({
      method: 'POST',
      url: '/api/containers/1/abc123/logs/collect',
      payload: { tail: 100 },
    });

    expect(response.statusCode).toBe(403);
    expect(mockInitiateEdgeAsyncLogCollection).not.toHaveBeenCalled();
  });

  it('rejects a viewer before polling or cleaning up an Edge Job', async () => {
    currentRole = 'viewer';

    const response = await app.inject({
      method: 'GET',
      url: '/api/containers/1/abc123/logs/collect/42',
    });

    expect(response.statusCode).toBe(403);
  });

  it('rejects a non-numeric tail before creating an Edge Job', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/containers/1/abc123/logs/collect',
      payload: { tail: '100; uname -a' },
    });

    expect(response.statusCode).toBe(400);
    expect(mockInitiateEdgeAsyncLogCollection).not.toHaveBeenCalled();
  });

  it('rejects shell syntax in the container path parameter', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/containers/1/abc123%3Buname/logs/collect',
      payload: { tail: 100 },
    });

    expect(response.statusCode).toBe(400);
    expect(mockInitiateEdgeAsyncLogCollection).not.toHaveBeenCalled();
  });

  it('creates an Edge Job for validated admin input', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/containers/1/abc123/logs/collect',
      payload: { tail: 100 },
    });

    expect(response.statusCode).toBe(202);
    expect(mockInitiateEdgeAsyncLogCollection).toHaveBeenCalledWith(1, 'abc123', { tail: 100 });
  });

  it('uses a stable upstream error and guarded development details', async () => {
    mockInitiateEdgeAsyncLogCollection.mockRejectedValueOnce(
      new Error('Portainer failed at http://edge.internal:9000'),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/containers/1/abc123/logs/collect',
      payload: { tail: 100 },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({
      error: 'Failed to initiate log collection',
      details: 'Portainer failed at http://edge.internal:9000',
    });
  });
});
