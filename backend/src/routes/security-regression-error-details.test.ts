/**
 * Security Regression — Raw error messages in explicit 5xx `details` (#1518)
 *
 * The global error handler (packages/core/src/plugins/error-handler.ts)
 * masks 5xx bodies in production — but only for errors that THROW and reach
 * setErrorHandler. Route handlers that catch an error and reply with an
 * explicit `reply.code(5xx).send({ error, details: err.message })` bypassed
 * it, reflecting raw Postgres/undici messages (SQL fragments, table names,
 * internal hostnames, filesystem paths) to any authenticated user even in
 * production.
 *
 * Every such site now routes its `details` through the shared
 * `errorDetails()` helper (same module as the global handler), which
 * surfaces the message in development and omits the field entirely in
 * production. This file guards the conversion two ways:
 *   1. a source-level scan banning the raw-reflection patterns in route files
 *   2. runtime checks on representative converted routes in both env modes
 *
 * @see https://github.com/kenhaesler/ai-portainer-dashboard/issues/1518
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

// ─── Mocks ──────────────────────────────────────────────────────────────
// TimescaleDB is unavailable in CI — the metrics route only needs a
// controllable query() rejection.
const mockMetricsQuery = vi.fn();
vi.mock('@dashboard/core/db/timescale.js', () => ({
  getMetricsDb: vi.fn(async () => ({ query: (...args: unknown[]) => mockMetricsQuery(...args) })),
  isMetricsDbHealthy: vi.fn().mockResolvedValue(true),
}));

// Passthrough mock so vi.spyOn can drive the Portainer boundary (no real HTTP in CI)
vi.mock('@dashboard/core/portainer/portainer-client.js', async (importOriginal) => await importOriginal());
vi.mock('@dashboard/core/portainer/portainer-cache.js', async (importOriginal) => {
  const real = await importOriginal() as typeof import('@dashboard/core/portainer/portainer-cache.js');
  return {
    ...real,
    cachedFetch: <T>(_key: string, _ttl: number, fn: () => Promise<T>) => fn(),
    cachedFetchSWR: <T>(_key: string, _ttl: number, fn: () => Promise<T>) => fn(),
    cachedFetchSnapshot: async <T>(_key: string, _ttl: number, fn: () => Promise<T>) => ({ data: await fn(), fetchedAt: Date.now() }),
    cachedFetchSWRSnapshot: async <T>(_key: string, _ttl: number, fn: () => Promise<T>) => ({ data: await fn(), fetchedAt: Date.now() }),
  };
});

import { metricsRoutes } from '@dashboard/observability/routes/index.js';
import { endpointsRoutes } from '@dashboard/foundation/routes/endpoints.js';
import * as portainerClient from '@dashboard/core/portainer/portainer-client.js';

const SENSITIVE_MESSAGE = 'connect ECONNREFUSED 10.13.37.5:5432 — syntax error at or near "SELECT" in relation "users"';

async function buildApp(register: (app: ReturnType<typeof Fastify>) => Promise<void> | void) {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('authenticate', async () => undefined);
  app.decorate('requireRole', () => async () => undefined);
  await register(app);
  await app.ready();
  return app;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

// =====================================================================
//  Source-level guard — no raw err.message reflection in 5xx details
// =====================================================================
describe('5xx details reflection — source-level guard', () => {
  const ROUTE_DIRS = [
    'packages/ai-intelligence/src/routes',
    'packages/foundation/src/routes',
    'packages/observability/src/routes',
    'packages/operations/src/routes',
    'packages/security/src/routes',
    'packages/infrastructure/src/routes',
  ];

  // The raw-reflection shapes converted in #1518, banned inside 5xx sends.
  // 4xx sends stay allowed (validation messages and admin connection-test
  // diagnostics are deliberate, matching the global error handler which
  // also preserves 4xx details). `details:` with an object literal (audit
  // logs, Zod flatten()) is likewise untouched.
  const BANNED_IN_5XX = [
    /details:\s*msg\b/,
    /details:\s*message\b/,
    /details:\s*errors\b/,
    /details:\s*body\b/,
    /details:\s*err instanceof Error/,
    /details:\s*error instanceof Error/,
  ];

  // Matches `.code(5xx).send(` / `.status(5xx).send(` and captures the text
  // that follows — enough of the send body to catch a raw details field.
  const FIVEXX_SEND = /\.(?:code|status)\(\s*5\d\d\s*\)\s*\.send\(/g;

  for (const dir of ROUTE_DIRS) {
    it(`${dir} routes never reflect raw error content in 5xx details`, () => {
      const abs = path.resolve(process.cwd(), '..', dir);
      const files = readdirSync(abs).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
      const offenders: string[] = [];
      for (const file of files) {
        const content = readFileSync(path.join(abs, file), 'utf8');
        for (const match of content.matchAll(FIVEXX_SEND)) {
          const sendBody = content.slice(match.index, match.index + 400);
          for (const pattern of BANNED_IN_5XX) {
            if (pattern.test(sendBody)) offenders.push(`${file}: ${pattern.source}`);
          }
        }
      }
      expect(
        offenders,
        `Raw error reflection found in a 5xx send — use errorDetails(err) from @dashboard/core/plugins/error-handler.js instead.`,
      ).toEqual([]);
    });
  }
});

// =====================================================================
//  Runtime guard — observability metrics route (explicit 500)
// =====================================================================
describe('5xx details masking — metrics route', () => {
  it('omits details and never echoes the DB error in production', async () => {
    // Register BEFORE stubbing NODE_ENV: route registration parses the env
    // config (which enforces stronger secrets in production), while
    // errorDetails() reads NODE_ENV at request time — the masking decision
    // under test.
    mockMetricsQuery.mockRejectedValue(new Error(SENSITIVE_MESSAGE));
    const app = await buildApp((a) => a.register((f: FastifyInstance) => metricsRoutes(f, {})));
    vi.stubEnv('NODE_ENV', 'production');

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/abc123?metricType=cpu' });

    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error).toBe('Failed to query metrics');
    expect(body.details).toBeUndefined();
    expect(res.payload).not.toContain('ECONNREFUSED');
    expect(res.payload).not.toContain('10.13.37.5');
    expect(res.payload).not.toContain('SELECT');
    await app.close();
  });

  it('keeps details in development for debuggability', async () => {
    mockMetricsQuery.mockRejectedValue(new Error(SENSITIVE_MESSAGE));
    const app = await buildApp((a) => a.register((f: FastifyInstance) => metricsRoutes(f, {})));
    vi.stubEnv('NODE_ENV', 'development');

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/abc123?metricType=cpu' });

    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error).toBe('Failed to query metrics');
    expect(body.details).toContain('ECONNREFUSED');
    await app.close();
  });
});

// =====================================================================
//  Runtime guard — foundation endpoints route (explicit 502)
// =====================================================================
describe('5xx details masking — endpoints route', () => {
  it('omits details and never echoes the upstream error in production', async () => {
    vi.spyOn(portainerClient, 'getEndpoints').mockRejectedValue(new Error(SENSITIVE_MESSAGE));
    const app = await buildApp((a) => a.register(endpointsRoutes));
    vi.stubEnv('NODE_ENV', 'production');

    const res = await app.inject({ method: 'GET', url: '/api/endpoints' });

    expect(res.statusCode).toBe(502);
    const body = res.json();
    expect(body.error).toBe('Unable to connect to Portainer');
    expect(body.details).toBeUndefined();
    expect(res.payload).not.toContain('ECONNREFUSED');
    expect(res.payload).not.toContain('10.13.37.5');
    await app.close();
  });

  it('keeps details in development for debuggability', async () => {
    vi.spyOn(portainerClient, 'getEndpoints').mockRejectedValue(new Error(SENSITIVE_MESSAGE));
    const app = await buildApp((a) => a.register(endpointsRoutes));
    vi.stubEnv('NODE_ENV', 'development');

    const res = await app.inject({ method: 'GET', url: '/api/endpoints' });

    expect(res.statusCode).toBe(502);
    const body = res.json();
    expect(body.details).toContain('ECONNREFUSED');
    await app.close();
  });
});
