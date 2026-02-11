import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';
import { containerLogsRoutes } from './container-logs.js';

vi.mock('../services/portainer-client.js', () => ({
  getContainerLogs: vi.fn(),
}));

vi.mock('../services/edge-capability-guard.js', () => ({
  assertCapability: vi.fn(),
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
import { assertCapability } from '../services/edge-capability-guard.js';

const mockGetContainerLogs = vi.mocked(portainer.getContainerLogs);
const mockAssertCapability = vi.mocked(assertCapability);

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

  it('returns logs when endpoint supports realtimeLogs', async () => {
    const app = buildApp();
    mockAssertCapability.mockResolvedValue(undefined);
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
    await app.close();
  });

  it('returns 422 when endpoint lacks realtimeLogs capability', async () => {
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
    await app.close();
  });

  it('returns 502 when Docker proxy fails', async () => {
    const app = buildApp();
    mockAssertCapability.mockResolvedValue(undefined);
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
});
