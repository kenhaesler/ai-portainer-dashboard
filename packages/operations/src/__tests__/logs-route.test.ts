import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';
import { logsRoutes } from '../routes/logs.js';

// Kept: infrastructure mock — no Elasticsearch in CI
const mockGetElasticsearchConfig = vi.fn();

vi.mock('@dashboard/infrastructure', () => ({
  getElasticsearchConfig: (...args: unknown[]) => mockGetElasticsearchConfig(...args),
}));

const defaultEsConfig = {
  endpoint: 'https://elasticsearch.example.com',
  apiKey: 'test-api-key',
  indexPattern: 'logs-*',
  verifySsl: true,
};

describe('Logs Routes', () => {
  let app: FastifyInstance;
  let currentRole: 'viewer' | 'operator' | 'admin';
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    currentRole = 'admin';
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.decorate('authenticate', async () => undefined);
    app.decorate('requireRole', (minRole: 'viewer' | 'operator' | 'admin') => async (request: any, reply: any) => {
      const rank = { viewer: 0, operator: 1, admin: 2 };
      const userRole = request.user?.role ?? 'viewer';
      if (rank[userRole] < rank[minRole]) {
        reply.code(403).send({ error: 'Insufficient permissions' });
      }
    });
    app.decorateRequest('user', undefined);
    app.addHook('preHandler', async (request) => {
      request.user = { sub: 'u1', username: 'admin', sessionId: 's1', role: currentRole };
    });
    await app.register(logsRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    currentRole = 'admin';
    mockGetElasticsearchConfig.mockResolvedValue(defaultEsConfig);
    // Mock global fetch used by the route for ES queries
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  describe('GET /api/logs/search', () => {
    it('returns 503 when Elasticsearch is not configured', async () => {
      mockGetElasticsearchConfig.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/api/logs/search',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('Elasticsearch');
    });

    it('returns log hits on successful search', async () => {
      const esResponse = {
        hits: {
          total: { value: 1 },
          hits: [{
            _id: 'log-1',
            _source: {
              '@timestamp': '2026-01-01T00:00:00.000Z',
              message: 'Container started',
              host: { name: 'server-01' },
              log: { level: 'info' },
            },
          }],
        },
      };
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => esResponse,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/logs/search?query=started',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.logs).toHaveLength(1);
      expect(body.logs[0].id).toBe('log-1');
      expect(body.logs[0].message).toBe('Container started');
      expect(body.total).toBe(1);
    });

    it('returns 502 when Elasticsearch query fails', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/logs/search',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('Elasticsearch');
    });

    it('returns 502 when fetch throws (connection error)', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      const response = await app.inject({
        method: 'GET',
        url: '/api/logs/search',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(502);
    });

    it('applies query filters correctly', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ hits: { total: { value: 0 }, hits: [] } }),
      });

      await app.inject({
        method: 'GET',
        url: '/api/logs/search?query=error&hostname=server-01&level=error',
        headers: { authorization: 'Bearer test' },
      });

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain('logs-*/_search');
      const body = JSON.parse(opts.body);
      expect(body.query.bool.must).toContainEqual(expect.objectContaining({ query_string: expect.objectContaining({ query: 'error' }) }));
      expect(body.query.bool.must).toContainEqual({ match: { 'host.name': 'server-01' } });
      expect(body.query.bool.must).toContainEqual({ match: { 'log.level': 'error' } });
    });
  });

  describe('GET /api/logs/config', () => {
    it('returns configured=true when ES is set up', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/logs/config',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.configured).toBe(true);
      expect(body.indexPattern).toBe('logs-*');
    });

    it('returns configured=false when ES is not set up', async () => {
      mockGetElasticsearchConfig.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/api/logs/config',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.configured).toBe(false);
      expect(body.endpoint).toBeNull();
    });

    it('redacts credentials from endpoint URL', async () => {
      mockGetElasticsearchConfig.mockResolvedValue({
        ...defaultEsConfig,
        endpoint: 'https://user:password@elasticsearch.example.com',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/logs/config',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.endpoint).not.toContain('password');
      expect(body.endpoint).toContain('***');
    });
  });

  describe('POST /api/logs/test-connection', () => {
    it('returns success when cluster health check passes', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          cluster_name: 'my-cluster',
          status: 'green',
          number_of_nodes: 3,
        }),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/logs/test-connection',
        headers: { authorization: 'Bearer test' },
        payload: { endpoint: 'https://elasticsearch.example.com', apiKey: 'key123', verifySsl: true },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.cluster_name).toBe('my-cluster');
      expect(body.status).toBe('green');
    });

    it('returns 400 when cluster health check fails', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/logs/test-connection',
        headers: { authorization: 'Bearer test' },
        payload: { endpoint: 'https://elasticsearch.example.com' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
    });

    it('returns 400 when connection throws', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      const response = await app.inject({
        method: 'POST',
        url: '/api/logs/test-connection',
        headers: { authorization: 'Bearer test' },
        payload: { endpoint: 'https://unreachable.example.com' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error).toContain('ECONNREFUSED');
    });

    it('requires endpoint field', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/logs/test-connection',
        headers: { authorization: 'Bearer test' },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
