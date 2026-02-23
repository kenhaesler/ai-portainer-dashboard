import { FastifyInstance } from 'fastify';
import { isMetricsDbHealthy, isMetricsDbReady } from '../core/db/timescale.js';
import { isAppDbHealthy, isAppDbReady } from '../core/db/postgres.js';
import { getConfig } from '../core/config/index.js';
import { cache, cachedFetch } from '../core/portainer/portainer-cache.js';
import { checkPortainerReachable } from '../core/portainer/portainer-client.js';
import { HealthResponseSchema, ReadinessResponseSchema } from '../core/models/api-schemas.js';

type DependencyCheck = { status: string; url?: string; error?: string };

async function runChecks(): Promise<{ checks: Record<string, DependencyCheck>; overallStatus: string }> {
  const config = getConfig();
  const checks: Record<string, DependencyCheck> = {};

  // Check App PostgreSQL (sessions, settings, insights, etc.)
  const appPgHealthy = await isAppDbHealthy();
  const appPgReady = isAppDbReady();
  if (appPgHealthy && appPgReady) {
    checks.appDb = { status: 'healthy' };
  } else if (appPgHealthy && !appPgReady) {
    checks.appDb = { status: 'degraded', error: 'App PostgreSQL connected but migrations not applied' };
  } else {
    checks.appDb = { status: 'unhealthy', error: 'App PostgreSQL query failed' };
  }

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

  // Check Portainer (cached 30s — prevents stampede from frequent load-balancer polls)
  checks.portainer = await cachedFetch<DependencyCheck>('health:portainer', 30, async () => {
    const { reachable, ok } = await checkPortainerReachable();
    if (!reachable) return { status: 'unhealthy', url: config.PORTAINER_API_URL, error: 'Connection failed' };
    return { status: ok ? 'healthy' : 'degraded', url: config.PORTAINER_API_URL };
  });

  // Check Ollama (cached 30s — same rationale as Portainer)
  checks.ollama = await cachedFetch<DependencyCheck>('health:ollama', 30, async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${config.OLLAMA_BASE_URL}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return { status: res.ok ? 'healthy' : 'degraded', url: config.OLLAMA_BASE_URL };
    } catch (err) {
      return { status: 'unhealthy', url: config.OLLAMA_BASE_URL, error: err instanceof Error ? err.message : 'Connection failed' };
    }
  });

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
