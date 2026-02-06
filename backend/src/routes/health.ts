import { FastifyInstance } from 'fastify';
import { isDbHealthy } from '../db/sqlite.js';
import { getConfig } from '../config/index.js';
import { HealthResponseSchema, ReadinessResponseSchema } from '../models/api-schemas.js';

export async function healthRoutes(fastify: FastifyInstance) {
  // Liveness probe
  fastify.get('/health', {
    schema: {
      tags: ['Health'],
      summary: 'Liveness check',
      response: { 200: HealthResponseSchema },
    },
  }, async () => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  });

  // Readiness probe - checks all dependencies
  fastify.get('/health/ready', {
    schema: {
      tags: ['Health'],
      summary: 'Readiness check - validates DB, Portainer, and Ollama connectivity',
      response: { 200: ReadinessResponseSchema },
    },
  }, async () => {
    const config = getConfig();
    const checks: Record<string, { status: string; url?: string; error?: string }> = {};

    // Check database
    checks.database = isDbHealthy()
      ? { status: 'healthy' }
      : { status: 'unhealthy', error: 'Database query failed' };

    // Check Portainer
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${config.PORTAINER_API_URL}/api/status`, {
        signal: controller.signal,
        headers: config.PORTAINER_API_KEY
          ? { 'X-API-Key': config.PORTAINER_API_KEY }
          : {},
      });
      clearTimeout(timeout);
      checks.portainer = {
        status: res.ok ? 'healthy' : 'degraded',
        url: config.PORTAINER_API_URL,
      };
    } catch (err) {
      checks.portainer = {
        status: 'unhealthy',
        url: config.PORTAINER_API_URL,
        error: err instanceof Error ? err.message : 'Connection failed',
      };
    }

    // Check Ollama
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${config.OLLAMA_BASE_URL}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      checks.ollama = {
        status: res.ok ? 'healthy' : 'degraded',
        url: config.OLLAMA_BASE_URL,
      };
    } catch (err) {
      checks.ollama = {
        status: 'unhealthy',
        url: config.OLLAMA_BASE_URL,
        error: err instanceof Error ? err.message : 'Connection failed',
      };
    }

    const overallStatus = Object.values(checks).every((c) => c.status === 'healthy')
      ? 'healthy'
      : Object.values(checks).some((c) => c.status === 'unhealthy')
        ? 'unhealthy'
        : 'degraded';

    return {
      status: overallStatus,
      checks,
      timestamp: new Date().toISOString(),
    };
  });
}
