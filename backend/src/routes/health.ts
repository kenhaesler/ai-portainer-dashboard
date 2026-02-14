import { FastifyInstance } from 'fastify';
import { isDbHealthy } from '../db/sqlite.js';
import { isMetricsDbHealthy, isMetricsDbReady } from '../db/timescale.js';
import { getConfig } from '../config/index.js';
import { cache } from '../services/portainer-cache.js';
import { HealthResponseSchema, ReadinessResponseSchema } from '../models/api-schemas.js';

type DependencyCheck = { status: string; url?: string; error?: string };

async function runChecks(): Promise<{ checks: Record<string, DependencyCheck>; overallStatus: string }> {
  const config = getConfig();
  const checks: Record<string, DependencyCheck> = {};

  // Check SQLite database (users, sessions, settings, etc.)
  checks.database = isDbHealthy()
    ? { status: 'healthy' }
    : { status: 'unhealthy', error: 'Database query failed' };

  // Check TimescaleDB (metrics, KPI snapshots)
  const tsHealthy = await isMetricsDbHealthy();
  const migrationsReady = isMetricsDbReady();
  if (tsHealthy && migrationsReady) {
    checks.metricsDb = { status: 'healthy' };
  } else if (tsHealthy && !migrationsReady) {
    checks.metricsDb = { status: 'degraded', error: 'TimescaleDB connected but migrations not applied — metrics table may be missing' };
  } else {
    checks.metricsDb = { status: 'unhealthy', error: 'TimescaleDB query failed' };
  }

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

  // Check Redis (only when configured -- degraded not unhealthy because L1 fallback works)
  const backoff = cache.getBackoffState();
  if (backoff.configured) {
    const pingOk = await cache.ping();
    checks.redis = pingOk
      ? { status: 'healthy' }
      : { status: 'degraded', error: 'Redis ping failed (L1 fallback active)' };
  }

  const overallStatus = Object.values(checks).every((c) => c.status === 'healthy')
    ? 'healthy'
    : Object.values(checks).some((c) => c.status === 'unhealthy')
      ? 'unhealthy'
      : 'degraded';

  return { checks, overallStatus };
}

function redactCheck(check: DependencyCheck): { status: string } {
  return { status: check.status };
}

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

  // Readiness probe (public, redacted -- no URLs or error details)
  fastify.get('/health/ready', {
    schema: {
      tags: ['Health'],
      summary: 'Readiness check (public) - redacted dependency status',
      response: { 200: ReadinessResponseSchema },
    },
  }, async () => {
    const { checks, overallStatus } = await runChecks();

    const redacted: Record<string, { status: string }> = {};
    for (const [name, check] of Object.entries(checks)) {
      redacted[name] = redactCheck(check);
    }

    return {
      status: overallStatus,
      checks: redacted,
      timestamp: new Date().toISOString(),
    };
  });

  // Readiness probe (authenticated, full detail)
  fastify.get('/health/ready/detail', {
    preHandler: fastify.authenticate,
    schema: {
      tags: ['Health'],
      summary: 'Readiness check (authenticated) - full diagnostic info',
    },
  }, async () => {
    const { checks, overallStatus } = await runChecks();

    return {
      status: overallStatus,
      checks,
      timestamp: new Date().toISOString(),
    };
  });
}
