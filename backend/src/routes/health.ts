import { FastifyInstance } from 'fastify';
import { isDbHealthy } from '../db/sqlite.js';
import { isMetricsDbHealthy } from '../db/timescale.js';
import { getConfig } from '../config/index.js';
import { HealthResponseSchema, ReadinessResponseSchema, ReadinessDetailResponseSchema } from '../models/api-schemas.js';

function redactCheck(check: { status: string; url?: string; error?: string }): { status: string } {
  return { status: check.status };
}

async function runChecks(): Promise<{ status: string; checks: Record<string, { status: string; url?: string; error?: string }>; timestamp: string }> {
  const config = getConfig();
  const checks: Record<string, { status: string; url?: string; error?: string }> = {};
  checks.database = isDbHealthy() ? { status: 'healthy' } : { status: 'unhealthy', error: 'Database query failed' };
  const tsHealthy = await isMetricsDbHealthy();
  checks.metricsDb = tsHealthy ? { status: 'healthy' } : { status: 'unhealthy', error: 'TimescaleDB query failed' };
  try {
    const c1 = new AbortController();
    const t1 = setTimeout(() => c1.abort(), 5000);
    const r1 = await fetch(`${config.PORTAINER_API_URL}/api/status`, { signal: c1.signal, headers: config.PORTAINER_API_KEY ? { 'X-API-Key': config.PORTAINER_API_KEY } : {} });
    clearTimeout(t1);
    checks.portainer = { status: r1.ok ? 'healthy' : 'degraded', url: config.PORTAINER_API_URL };
  } catch (err) {
    checks.portainer = { status: 'unhealthy', url: config.PORTAINER_API_URL, error: err instanceof Error ? err.message : 'Connection failed' };
  }
  try {
    const c2 = new AbortController();
    const t2 = setTimeout(() => c2.abort(), 5000);
    const r2 = await fetch(`${config.OLLAMA_BASE_URL}/api/tags`, { signal: c2.signal });
    clearTimeout(t2);
    checks.ollama = { status: r2.ok ? 'healthy' : 'degraded', url: config.OLLAMA_BASE_URL };
  } catch (err) {
    checks.ollama = { status: 'unhealthy', url: config.OLLAMA_BASE_URL, error: err instanceof Error ? err.message : 'Connection failed' };
  }
  const overallStatus = Object.values(checks).every((c) => c.status === 'healthy') ? 'healthy' : Object.values(checks).some((c) => c.status === 'unhealthy') ? 'unhealthy' : 'degraded';
  return { status: overallStatus, checks, timestamp: new Date().toISOString() };
}

export async function healthRoutes(fastify: FastifyInstance) {
  fastify.get('/health', { schema: { tags: ['Health'], summary: 'Liveness check', response: { 200: HealthResponseSchema } } }, async () => ({ status: 'ok', timestamp: new Date().toISOString() }));
  fastify.get('/health/ready', { schema: { tags: ['Health'], summary: 'Readiness check (public)', response: { 200: ReadinessResponseSchema } } }, async () => {
    const result = await runChecks();
    const redacted: Record<string, { status: string }> = {};
    for (const [n, ch] of Object.entries(result.checks)) { redacted[n] = redactCheck(ch); }
    return { status: result.status, checks: redacted, timestamp: result.timestamp };
  });
  fastify.get('/health/ready/detail', { schema: { tags: ['Health'], summary: 'Detailed readiness check (authenticated)', response: { 200: ReadinessDetailResponseSchema } }, preHandler: [fastify.authenticate] }, async () => await runChecks());
}
