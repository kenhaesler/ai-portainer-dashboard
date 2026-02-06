import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { healthRoutes } from './health.js';

// Mock dependencies
vi.mock('../db/sqlite.js', () => ({
  isDbHealthy: vi.fn(),
}));

vi.mock('../config/index.js', () => ({
  getConfig: () => ({
    PORTAINER_API_URL: 'http://localhost:9000',
    PORTAINER_API_KEY: 'test-api-key',
    OLLAMA_BASE_URL: 'http://localhost:11434',
  }),
}));

// Get mocked functions
import { isDbHealthy } from '../db/sqlite.js';
const mockIsDbHealthy = vi.mocked(isDbHealthy);

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Health Routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(healthRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /health', () => {
    it('should return ok status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('ok');
      expect(body.timestamp).toBeDefined();
    });

    it('should return valid ISO timestamp', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      const body = JSON.parse(response.body);
      const timestamp = new Date(body.timestamp);
      expect(timestamp.toISOString()).toBe(body.timestamp);
    });
  });

  describe('GET /health/ready', () => {
    it('should return healthy when all checks pass', async () => {
      mockIsDbHealthy.mockReturnValue(true);
      mockFetch.mockResolvedValue({ ok: true });

      const response = await app.inject({
        method: 'GET',
        url: '/health/ready',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('healthy');
      expect(body.checks.database.status).toBe('healthy');
      expect(body.checks.portainer.status).toBe('healthy');
      expect(body.checks.ollama.status).toBe('healthy');
    });

    it('should return unhealthy when database fails', async () => {
      mockIsDbHealthy.mockReturnValue(false);
      mockFetch.mockResolvedValue({ ok: true });

      const response = await app.inject({
        method: 'GET',
        url: '/health/ready',
      });

      const body = JSON.parse(response.body);
      expect(body.status).toBe('unhealthy');
      expect(body.checks.database.status).toBe('unhealthy');
    });

    it('should return degraded when Portainer returns non-ok', async () => {
      mockIsDbHealthy.mockReturnValue(true);
      mockFetch
        .mockResolvedValueOnce({ ok: false }) // Portainer
        .mockResolvedValueOnce({ ok: true }); // Ollama

      const response = await app.inject({
        method: 'GET',
        url: '/health/ready',
      });

      const body = JSON.parse(response.body);
      expect(body.status).toBe('degraded');
      expect(body.checks.portainer.status).toBe('degraded');
    });

    it('should return unhealthy when Portainer connection fails', async () => {
      mockIsDbHealthy.mockReturnValue(true);
      mockFetch
        .mockRejectedValueOnce(new Error('Connection refused')) // Portainer
        .mockResolvedValueOnce({ ok: true }); // Ollama

      const response = await app.inject({
        method: 'GET',
        url: '/health/ready',
      });

      const body = JSON.parse(response.body);
      expect(body.status).toBe('unhealthy');
      expect(body.checks.portainer.status).toBe('unhealthy');
    });

    it('should return unhealthy when Ollama connection fails', async () => {
      mockIsDbHealthy.mockReturnValue(true);
      mockFetch
        .mockResolvedValueOnce({ ok: true }) // Portainer
        .mockRejectedValueOnce(new Error('Ollama not running')); // Ollama

      const response = await app.inject({
        method: 'GET',
        url: '/health/ready',
      });

      const body = JSON.parse(response.body);
      expect(body.status).toBe('unhealthy');
      expect(body.checks.ollama.status).toBe('unhealthy');
    });

    it('should include URLs in check responses', async () => {
      mockIsDbHealthy.mockReturnValue(true);
      mockFetch.mockResolvedValue({ ok: true });

      const response = await app.inject({
        method: 'GET',
        url: '/health/ready',
      });

      const body = JSON.parse(response.body);
      expect(body.checks.portainer.url).toBe('http://localhost:9000');
      expect(body.checks.ollama.url).toBe('http://localhost:11434');
    });

    it('should include timestamp in response', async () => {
      mockIsDbHealthy.mockReturnValue(true);
      mockFetch.mockResolvedValue({ ok: true });

      const response = await app.inject({
        method: 'GET',
        url: '/health/ready',
      });

      const body = JSON.parse(response.body);
      expect(body.timestamp).toBeDefined();
      const timestamp = new Date(body.timestamp);
      expect(timestamp.toISOString()).toBe(body.timestamp);
    });

    it('should handle all services unhealthy', async () => {
      mockIsDbHealthy.mockReturnValue(false);
      mockFetch.mockRejectedValue(new Error('Network error'));

      const response = await app.inject({
        method: 'GET',
        url: '/health/ready',
      });

      const body = JSON.parse(response.body);
      expect(body.status).toBe('unhealthy');
      expect(body.checks.database.status).toBe('unhealthy');
      expect(body.checks.portainer.status).toBe('unhealthy');
      expect(body.checks.ollama.status).toBe('unhealthy');
    });
  });
});
