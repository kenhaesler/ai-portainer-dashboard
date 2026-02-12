import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';
import { containerLogsRoutes } from './container-logs.js';

vi.mock('../services/portainer-client.js', () => ({
  getContainerLogs: vi.fn(),
}));

vi.mock('../services/edge-log-fetcher.js', () => ({
  getContainerLogsWithRetry: vi.fn(),
}));

vi.mock('../services/edge-capability-guard.js', () => ({
  assertCapability: vi.fn(),
  isEdgeStandard: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import * as portainer from '../services/portainer-client.js';
import { getContainerLogsWithRetry } from '../services/edge-log-fetcher.js';
import { assertCapability, isEdgeStandard } from '../services/edge-capability-guard.js';

const mockGetContainerLogs = vi.mocked(portainer.getContainerLogs);
const mockGetContainerLogsWithRetry = vi.mocked(getContainerLogsWithRetry);
const mockAssertCapability = vi.mocked(assertCapability);
const mockIsEdgeStandard = vi.mocked(isEdgeStandard);

function buildApp() {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.decorate('authenticate', async () => undefined);
  app.register(containerLogsRoutes);
  return app;
}

describe('container-logs routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns logs when endpoint supports realtimeLogs (non-edge)', async () => {
    const app = buildApp();
    mockAssertCapability.mockResolvedValue(undefined);
    mockIsEdgeStandard.mockResolvedValue(false);
    mockGetContainerLogs.mockResolvedValue('2024-01-01T00:00:00Z hello world\n');

    const res = await app.inject({
      method: 'GET',
      url: '/api/containers/1/abc123/logs',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.logs).toContain('hello world');
    expect(body.endpointId).toBe(1);
    expect(body.containerId).toBe('abc123');
    expect(mockAssertCapability).toHaveBeenCalledWith(1, 'realtimeLogs');
    expect(mockGetContainerLogs).toHaveBeenCalled();
    expect(mockGetContainerLogsWithRetry).not.toHaveBeenCalled();
    await app.close();
  });

  it('uses retry wrapper for Edge Standard endpoints', async () => {
    const app = buildApp();
    mockAssertCapability.mockResolvedValue(undefined);
    mockIsEdgeStandard.mockResolvedValue(true);
    mockGetContainerLogsWithRetry.mockResolvedValue('edge logs here\n');

    const res = await app.inject({
      method: 'GET',
      url: '/api/containers/4/def456/logs',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.logs).toContain('edge logs here');
    expect(mockGetContainerLogsWithRetry).toHaveBeenCalled();
    expect(mockGetContainerLogs).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns 422 with EDGE_ASYNC_UNSUPPORTED when endpoint lacks realtimeLogs', async () => {
    const app = buildApp();
    const err = new Error('Edge Async endpoints do not support "realtimeLogs" operations.');
    (err as any).statusCode = 422;
    mockAssertCapability.mockRejectedValue(err);

    const res = await app.inject({
      method: 'GET',
      url: '/api/containers/4/abc123/logs',
    });

    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('realtimeLogs');
    expect(body.code).toBe('EDGE_ASYNC_UNSUPPORTED');
    await app.close();
  });

  it('returns 504 with EDGE_TUNNEL_TIMEOUT when tunnel warmup fails', async () => {
    const app = buildApp();
    mockAssertCapability.mockResolvedValue(undefined);
    mockIsEdgeStandard.mockResolvedValue(true);
    const tunnelErr = new Error('Edge agent tunnel did not establish within timeout');
    (tunnelErr as any).status = 504;
    mockGetContainerLogsWithRetry.mockRejectedValue(tunnelErr);

    const res = await app.inject({
      method: 'GET',
      url: '/api/containers/4/def456/logs',
    });

    expect(res.statusCode).toBe(504);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('tunnel did not establish');
    expect(body.code).toBe('EDGE_TUNNEL_TIMEOUT');
    await app.close();
  });

  it('returns 502 when Docker proxy fails', async () => {
    const app = buildApp();
    mockAssertCapability.mockResolvedValue(undefined);
    mockIsEdgeStandard.mockResolvedValue(false);
    mockGetContainerLogs.mockRejectedValue(
      new Error('Container logs unavailable — Docker daemon on this endpoint may be unreachable'),
    );

    const res = await app.inject({
      method: 'GET',
      url: '/api/containers/1/abc123/logs',
    });

    expect(res.statusCode).toBe(502);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('Docker daemon');
    await app.close();
  });

  it('does not use retry wrapper for non-edge endpoints', async () => {
    const app = buildApp();
    mockAssertCapability.mockResolvedValue(undefined);
    mockIsEdgeStandard.mockResolvedValue(false);
    mockGetContainerLogs.mockResolvedValue('normal logs\n');

    const res = await app.inject({
      method: 'GET',
      url: '/api/containers/1/abc123/logs',
    });

    expect(res.statusCode).toBe(200);
    expect(mockGetContainerLogs).toHaveBeenCalled();
    expect(mockGetContainerLogsWithRetry).not.toHaveBeenCalled();
    await app.close();
  });
});
