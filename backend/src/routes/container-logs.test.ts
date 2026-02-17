import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';
import { containerLogsRoutes } from './container-logs.js';

vi.mock('../services/portainer-client.js', () => ({
  getContainerLogs: vi.fn(),
  streamContainerLogs: vi.fn(),
  getContainers: vi.fn(),
}));

vi.mock('../services/edge-log-fetcher.js', () => ({
  getContainerLogsWithRetry: vi.fn(),
  waitForTunnel: vi.fn(),
}));

vi.mock('../services/edge-capability-guard.js', () => ({
  assertCapability: vi.fn(),
  isEdgeStandard: vi.fn(),
  isEdgeAsync: vi.fn(),
}));

vi.mock('../services/edge-async-log-fetcher.js', () => ({
  initiateEdgeAsyncLogCollection: vi.fn(),
  checkEdgeJobStatus: vi.fn(),
  retrieveEdgeJobLogs: vi.fn(),
  cleanupEdgeJob: vi.fn(),
}));

vi.mock('../services/docker-frame-decoder.js', () => ({
  IncrementalDockerFrameDecoder: vi.fn().mockImplementation(() => ({
    push: vi.fn().mockReturnValue([]),
    drain: vi.fn().mockReturnValue([]),
  })),
}));

vi.mock('../plugins/auth.js', () => ({
  authenticateBearerHeader: vi.fn(),
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
import { getContainerLogsWithRetry, waitForTunnel } from '../services/edge-log-fetcher.js';
import { assertCapability, isEdgeStandard, isEdgeAsync } from '../services/edge-capability-guard.js';
import {
  initiateEdgeAsyncLogCollection,
  checkEdgeJobStatus,
  retrieveEdgeJobLogs,
  cleanupEdgeJob,
} from '../services/edge-async-log-fetcher.js';

const mockGetContainerLogs = vi.mocked(portainer.getContainerLogs);
const mockStreamContainerLogs = vi.mocked(portainer.streamContainerLogs);
const mockGetContainerLogsWithRetry = vi.mocked(getContainerLogsWithRetry);
const mockWaitForTunnel = vi.mocked(waitForTunnel);
const mockAssertCapability = vi.mocked(assertCapability);
const mockIsEdgeStandard = vi.mocked(isEdgeStandard);
const mockIsEdgeAsync = vi.mocked(isEdgeAsync);
const mockInitiateCollection = vi.mocked(initiateEdgeAsyncLogCollection);
const mockCheckStatus = vi.mocked(checkEdgeJobStatus);
const mockRetrieveLogs = vi.mocked(retrieveEdgeJobLogs);
const mockCleanup = vi.mocked(cleanupEdgeJob);

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

  // ─── Existing GET /logs tests ────────────────────────────────────

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

  // ─── POST /logs/collect tests ────────────────────────────────────

  it('POST /logs/collect returns 202 with jobId for Edge Async endpoint', async () => {
    const app = buildApp();
    mockIsEdgeAsync.mockResolvedValue(true);
    mockInitiateCollection.mockResolvedValue({ jobId: 42, endpointId: 7, containerId: 'abc123' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/containers/7/abc123/logs/collect',
    });

    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body);
    expect(body.jobId).toBe(42);
    expect(body.status).toBe('collecting');
    expect(mockInitiateCollection).toHaveBeenCalledWith(7, 'abc123', { tail: undefined });
    await app.close();
  });

  it('POST /logs/collect returns 400 for non-Edge-Async endpoint', async () => {
    const app = buildApp();
    mockIsEdgeAsync.mockResolvedValue(false);

    const res = await app.inject({
      method: 'POST',
      url: '/api/containers/1/abc123/logs/collect',
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('not Edge Async');
    expect(mockInitiateCollection).not.toHaveBeenCalled();
    await app.close();
  });

  // ─── GET /logs/collect/:jobId tests ──────────────────────────────

  it('GET /logs/collect/:jobId returns 200 with logs when ready', async () => {
    const app = buildApp();
    mockCheckStatus.mockResolvedValue({ ready: true, taskId: 'task-1' });
    mockRetrieveLogs.mockResolvedValue('collected log output\n');
    mockCleanup.mockResolvedValue(undefined);

    const res = await app.inject({
      method: 'GET',
      url: '/api/containers/7/abc123/logs/collect/42',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.logs).toBe('collected log output\n');
    expect(body.containerId).toBe('abc123');
    expect(body.endpointId).toBe(7);
    expect(body.source).toBe('edge-job');
    expect(typeof body.durationMs).toBe('number');
    expect(mockCleanup).toHaveBeenCalledWith(42);
    await app.close();
  });

  it('GET /logs/collect/:jobId returns 202 when still collecting', async () => {
    const app = buildApp();
    mockCheckStatus.mockResolvedValue({ ready: false });

    const res = await app.inject({
      method: 'GET',
      url: '/api/containers/7/abc123/logs/collect/42',
    });

    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body);
    expect(body.jobId).toBe(42);
    expect(body.status).toBe('collecting');
    expect(mockRetrieveLogs).not.toHaveBeenCalled();
    await app.close();
  });

  // ─── GET /logs/stream SSE tests ──────────────────────────────────

  it('stream returns 422 for Edge Async endpoint', async () => {
    const app = buildApp();
    const err = new Error('Edge Async endpoints do not support "realtimeLogs" operations.');
    (err as any).statusCode = 422;
    mockAssertCapability.mockRejectedValue(err);

    const res = await app.inject({
      method: 'GET',
      url: '/api/containers/7/abc123/logs/stream',
    });

    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body);
    expect(body.code).toBe('EDGE_ASYNC_UNSUPPORTED');
    await app.close();
  });

  it('stream returns 504 when Edge Standard tunnel warmup fails', async () => {
    const app = buildApp();
    mockAssertCapability.mockResolvedValue(undefined);
    mockIsEdgeStandard.mockResolvedValue(true);
    const tunnelErr = new Error('Edge agent tunnel did not establish within timeout');
    (tunnelErr as any).status = 504;
    mockWaitForTunnel.mockRejectedValue(tunnelErr);

    const res = await app.inject({
      method: 'GET',
      url: '/api/containers/4/def456/logs/stream',
    });

    expect(res.statusCode).toBe(504);
    const body = JSON.parse(res.body);
    expect(body.code).toBe('EDGE_TUNNEL_TIMEOUT');
    expect(mockWaitForTunnel).toHaveBeenCalledWith(4);
    await app.close();
  });

  it('stream returns 502 when streamContainerLogs fails', async () => {
    const app = buildApp();
    mockAssertCapability.mockResolvedValue(undefined);
    mockIsEdgeStandard.mockResolvedValue(false);
    mockStreamContainerLogs.mockRejectedValue(new Error('Log stream failed: 502'));

    const res = await app.inject({
      method: 'GET',
      url: '/api/containers/1/abc123/logs/stream',
    });

    expect(res.statusCode).toBe(502);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('Log stream failed');
    await app.close();
  });

  it('stream verifies waitForTunnel called for Edge Standard before streaming', async () => {
    const app = buildApp();
    mockAssertCapability.mockResolvedValue(undefined);
    mockIsEdgeStandard.mockResolvedValue(true);
    mockWaitForTunnel.mockResolvedValue(undefined);
    // After tunnel warmup, streamContainerLogs fails — we just need to verify the call order
    mockStreamContainerLogs.mockRejectedValue(new Error('stream failed'));

    const res = await app.inject({
      method: 'GET',
      url: '/api/containers/4/def456/logs/stream',
    });

    // Should have called waitForTunnel before attempting stream
    expect(mockWaitForTunnel).toHaveBeenCalledWith(4);
    expect(mockStreamContainerLogs).toHaveBeenCalled();
    expect(res.statusCode).toBe(502);
    await app.close();
  });

  it('stream opens SSE connection with correct Content-Type', async () => {
    const app = buildApp();
    mockAssertCapability.mockResolvedValue(undefined);
    mockIsEdgeStandard.mockResolvedValue(false);

    // Create a mock readable stream that ends immediately
    const { Readable } = await import('stream');
    const mockReadable = new Readable({
      read() {
        this.push(null); // Signal end of stream
      },
    });

    mockStreamContainerLogs.mockResolvedValue({
      body: mockReadable as any,
      abort: vi.fn(),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/containers/1/abc123/logs/stream',
    });

    // Hijacked responses return 200 with the SSE content type
    expect(res.headers['content-type']).toBe('text/event-stream');
    await app.close();
  });
});
