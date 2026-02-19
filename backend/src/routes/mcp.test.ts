import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { mcpRoutes } from './mcp.js';

// Mock AppDb adapter
const mockQuery = vi.fn().mockResolvedValue([]);
const mockQueryOne = vi.fn().mockResolvedValue(null);
const mockExecute = vi.fn().mockResolvedValue({ changes: 1, lastInsertRowid: 1 });
vi.mock('../db/app-db-router.js', () => ({
  getDbForDomain: () => ({
    query: (...args: unknown[]) => mockQuery(...args),
    queryOne: (...args: unknown[]) => mockQueryOne(...args),
    execute: (...args: unknown[]) => mockExecute(...args),
  }),
}));

// Mock audit logger
vi.mock('../services/audit-logger.js', () => ({
  writeAuditLog: vi.fn(),
}));

// Mock mcp-manager
const mockConnectServer = vi.fn();
const mockDisconnectServer = vi.fn();
const mockGetConnectedServers = vi.fn().mockReturnValue([]);
const mockGetServerTools = vi.fn().mockReturnValue([]);
const mockIsConnected = vi.fn().mockReturnValue(false);

vi.mock('../services/mcp-manager.js', () => ({
  connectServer: (...args: unknown[]) => mockConnectServer(...args),
  disconnectServer: (...args: unknown[]) => mockDisconnectServer(...args),
  getConnectedServers: () => mockGetConnectedServers(),
  getServerTools: (...args: unknown[]) => mockGetServerTools(...args),
  isConnected: (...args: unknown[]) => mockIsConnected(...args),
}));

describe('MCP Routes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    app.decorateRequest('user', undefined);
    app.decorate('authenticate', async (request: any) => {
      request.user = { sub: 'test-user', username: 'admin', role: 'admin' };
    });
    app.decorate('requireRole', () => async () => undefined);
    await app.register(mcpRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /api/mcp/servers', () => {
    it('returns list of servers with connection status', async () => {
      const servers = [
        { id: 1, name: 'fs-server', transport: 'stdio', command: 'npx server', url: null, enabled: 1, args: null, env: null, disabled_tools: null },
      ];
      mockQuery.mockResolvedValue(servers);
      mockIsConnected.mockReturnValue(true);
      mockGetConnectedServers.mockReturnValue([{ name: 'fs-server', transport: 'stdio', connected: true, toolCount: 3 }]);

      const res = await app.inject({ method: 'GET', url: '/api/mcp/servers' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body).toHaveLength(1);
      expect(body[0].name).toBe('fs-server');
      expect(body[0].connected).toBe(true);
      expect(body[0].toolCount).toBe(3);
    });
  });

  describe('POST /api/mcp/servers', () => {
    it('creates a new stdio server', async () => {
      mockExecute.mockResolvedValue({ changes: 1, lastInsertRowid: 1 });

      const res = await app.inject({
        method: 'POST',
        url: '/api/mcp/servers',
        payload: {
          name: 'test-server',
          transport: 'stdio',
          command: 'npx -y @mcp/server',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.name).toBe('test-server');
      expect(mockExecute).toHaveBeenCalled();
    });

    it('validates name format', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/mcp/servers',
        payload: {
          name: 'invalid name!',
          transport: 'stdio',
          command: 'test',
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('requires command for stdio transport', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/mcp/servers',
        payload: {
          name: 'test',
          transport: 'stdio',
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('requires URL for SSE transport', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/mcp/servers',
        payload: {
          name: 'test',
          transport: 'sse',
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('validates args as JSON', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/mcp/servers',
        payload: {
          name: 'test',
          transport: 'stdio',
          command: 'test',
          args: 'not-json',
        },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('PUT /api/mcp/servers/:id', () => {
    it('updates an existing server', async () => {
      // First queryOne for existing lookup, execute for update, second queryOne for return
      mockQueryOne
        .mockResolvedValueOnce({ id: 1, name: 'test', transport: 'stdio' })
        .mockResolvedValueOnce({ id: 1, name: 'updated', transport: 'stdio' });
      mockExecute.mockResolvedValue({ changes: 1 });

      const res = await app.inject({
        method: 'PUT',
        url: '/api/mcp/servers/1',
        payload: { name: 'updated' },
      });

      expect(res.statusCode).toBe(200);
    });

    it('returns 404 for unknown server', async () => {
      mockQueryOne.mockResolvedValue(null);

      const res = await app.inject({
        method: 'PUT',
        url: '/api/mcp/servers/999',
        payload: { name: 'updated' },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('DELETE /api/mcp/servers/:id', () => {
    it('deletes an existing server', async () => {
      mockQueryOne.mockResolvedValue({ id: 1, name: 'test' });
      mockExecute.mockResolvedValue({ changes: 1 });
      mockIsConnected.mockReturnValue(false);

      const res = await app.inject({ method: 'DELETE', url: '/api/mcp/servers/1' });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
    });

    it('disconnects connected server before deleting', async () => {
      mockQueryOne.mockResolvedValue({ id: 1, name: 'test' });
      mockExecute.mockResolvedValue({ changes: 1 });
      mockIsConnected.mockReturnValue(true);

      await app.inject({ method: 'DELETE', url: '/api/mcp/servers/1' });

      expect(mockDisconnectServer).toHaveBeenCalledWith('test');
    });

    it('returns 404 for unknown server', async () => {
      mockQueryOne.mockResolvedValue(null);

      const res = await app.inject({ method: 'DELETE', url: '/api/mcp/servers/999' });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /api/mcp/servers/:id/connect', () => {
    it('connects to a server', async () => {
      mockQueryOne.mockResolvedValue({
        id: 1, name: 'test', transport: 'stdio', command: 'test',
        enabled: 1, url: null, args: null, env: null, disabled_tools: null,
      });
      mockConnectServer.mockResolvedValue(undefined);

      const res = await app.inject({ method: 'POST', url: '/api/mcp/servers/1/connect' });
      expect(res.statusCode).toBe(200);
      expect(mockConnectServer).toHaveBeenCalled();
    });

    it('returns 502 on connection failure', async () => {
      mockQueryOne.mockResolvedValue({
        id: 1, name: 'test', transport: 'stdio', command: 'test',
        enabled: 1, url: null, args: null, env: null, disabled_tools: null,
      });
      mockConnectServer.mockRejectedValue(new Error('Connection refused'));

      const res = await app.inject({ method: 'POST', url: '/api/mcp/servers/1/connect' });
      expect(res.statusCode).toBe(502);
    });
  });

  describe('POST /api/mcp/servers/:id/disconnect', () => {
    it('disconnects from a server', async () => {
      mockQueryOne.mockResolvedValue({ id: 1, name: 'test', transport: 'stdio' });

      const res = await app.inject({ method: 'POST', url: '/api/mcp/servers/1/disconnect' });
      expect(res.statusCode).toBe(200);
      expect(mockDisconnectServer).toHaveBeenCalledWith('test');
    });
  });

  describe('GET /api/mcp/servers/:id/tools', () => {
    it('returns tools for a connected server', async () => {
      mockQueryOne.mockResolvedValue({ id: 1, name: 'test', transport: 'stdio' });
      mockIsConnected.mockReturnValue(true);
      mockGetServerTools.mockReturnValue([
        { serverName: 'test', name: 'read_file', description: 'Read a file', inputSchema: {} },
      ]);

      const res = await app.inject({ method: 'GET', url: '/api/mcp/servers/1/tools' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.tools).toHaveLength(1);
      expect(body.tools[0].name).toBe('read_file');
    });

    it('returns 400 if server not connected', async () => {
      mockQueryOne.mockResolvedValue({ id: 1, name: 'test', transport: 'stdio' });
      mockIsConnected.mockReturnValue(false);

      const res = await app.inject({ method: 'GET', url: '/api/mcp/servers/1/tools' });
      expect(res.statusCode).toBe(400);
    });
  });
});
