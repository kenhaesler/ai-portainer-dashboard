/**
 * Security Regression — SSE Stream Ticket (issue #1112, CWE-598)
 *
 * EventSource cannot set Authorization headers, so the SSE container-logs
 * endpoint previously accepted ?token=<JWT>. That JWT leaked into nginx
 * access logs, browser history, and any SIEM mirror. This regression suite
 * guards the replacement design:
 *   • POST /api/auth/stream-ticket — authenticated, returns a 30s
 *     single-use opaque ticket.
 *   • GET /api/containers/.../logs/stream?ticket=<id> — ticket-only auth,
 *     atomic check-and-burn.
 *   • frontend/nginx.conf — `log_format stream_no_args` omits $args on the
 *     SSE location so the ticket itself is also kept out of access logs.
 *
 * Re-enabled in #1188 — splitting this describe into its own file gives it a
 * clean module state, free of the `vi.resetModules()` interactions that
 * forced these cases to be skipped on the monolithic file.
 *
 * @see https://github.com/kenhaesler/ai-portainer-dashboard/issues/1112
 * @see https://github.com/kenhaesler/ai-portainer-dashboard/issues/1188 (split)
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { setConfigForTest, resetConfig } from '@dashboard/core/config/index.js';
import Fastify, { type FastifyInstance } from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// ─── Service Mocks ─────────────────────────────────────────────────────
vi.mock('@dashboard/core/db/app-db-router.js', () => ({
  getDbForDomain: vi.fn(() => ({
    queryOne: vi.fn(async () => null),
    query: vi.fn(async () => []),
    execute: vi.fn(async () => ({ changes: 0 })),
    transaction: vi.fn(async (fn: (db: Record<string, unknown>) => Promise<unknown>) => fn({
      execute: vi.fn(async () => ({ changes: 0 })),
      queryOne: vi.fn(async () => null),
      query: vi.fn(async () => []),
    })),
    healthCheck: vi.fn(async () => true),
  })),
}));

vi.mock('@dashboard/core/db/timescale.js', () => ({
  getMetricsDb: vi.fn(() => ({
    query: vi.fn().mockResolvedValue({ rows: [] }),
  })),
  isMetricsDbHealthy: vi.fn().mockResolvedValue(true),
}));

vi.mock('@dashboard/core/utils/crypto.js', async (importOriginal) => await importOriginal());

vi.mock('@dashboard/core/services/session-store.js', () => ({
  createSession: vi.fn(() => ({ id: 'sess-1', user_id: 'u1', username: 'admin' })),
  getSession: vi.fn(() => null),
  invalidateSession: vi.fn(),
  refreshSession: vi.fn(() => null),
}));

// Stream tickets — the actual subject of these tests. The route layer is
// exercised; the storage layer (atomic check-and-burn) lives in
// packages/core/src/services/stream-tickets.test.ts against real PG.
vi.mock('@dashboard/core/services/stream-tickets.js', () => ({
  STREAM_TICKET_TTL_MS: 30_000,
  createStreamTicket: vi.fn(),
  consumeStreamTicket: vi.fn(),
  cleanExpiredStreamTickets: vi.fn(),
}));

vi.mock('@dashboard/core/services/audit-logger.js', () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock('@dashboard/core/services/user-store.js', () => ({
  authenticateUser: vi.fn().mockResolvedValue(null),
  ensureDefaultAdmin: vi.fn().mockResolvedValue(undefined),
  getUserDefaultLandingPage: vi.fn(() => '/'),
  setUserDefaultLandingPage: vi.fn(),
  listUsers: vi.fn(() => []),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
  hasMinRole: vi.fn(() => false),
}));

vi.mock('@dashboard/core/services/oidc.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dashboard/core/services/oidc.js')>();
  return {
    ...actual,
    isOIDCEnabled: vi.fn(() => false),
    getOIDCConfig: vi.fn(() => null),
    generateAuthorizationUrl: vi.fn().mockResolvedValue(''),
    exchangeCode: vi.fn().mockResolvedValue(null),
  };
});

vi.mock('@dashboard/core/portainer/portainer-client.js', async (importOriginal) => await importOriginal());
vi.mock('@dashboard/core/portainer/portainer-cache.js', async (importOriginal) => await importOriginal());

// ─── Imports (after mocks) ──────────────────────────────────────────────
import { authRoutes, containerLogsRoutes } from '@dashboard/foundation';
import * as portainerClient from '@dashboard/core/portainer/portainer-client.js';
import { cache } from '@dashboard/core/portainer/portainer-cache.js';
import { flushTestCache, closeTestRedis } from '../test-utils/test-redis-helper.js';

// ─── Suite-wide setup ────────────────────────────────────────────────────
beforeAll(async () => {
  vi.spyOn(portainerClient, 'getEndpoints').mockResolvedValue([]);
  vi.spyOn(portainerClient, 'getContainers').mockResolvedValue([]);
  await cache.clear();
  await flushTestCache();
  setConfigForTest({
    PORTAINER_API_URL: 'http://localhost:9000',
    OLLAMA_BASE_URL: 'http://localhost:11434',
    OLLAMA_MODEL: 'llama3.2',
    JWT_ALGORITHM: 'HS256',
    CACHE_ENABLED: false,
  });
});

afterAll(async () => {
  resetConfig();
  await closeTestRedis();
});

// =====================================================================
//  SSE STREAM TICKET (issue #1112, CWE-598)
// =====================================================================
describe('SSE Stream Ticket (#1112)', () => {
  let app: FastifyInstance;
  let currentUser: { sub: string; username: string; sessionId: string; role: 'viewer' | 'operator' | 'admin' } | null;
  let streamTicketsModule: typeof import('@dashboard/core/services/stream-tickets.js');

  beforeAll(async () => {
    streamTicketsModule = await import('@dashboard/core/services/stream-tickets.js');
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);

    // Stub authenticate to honour `currentUser`, mirroring the real Bearer flow.
    // Returning 401 with the same body shape exercises the route exactly as in
    // production (JSON 401 response).
    app.decorate('authenticate', async (request, reply) => {
      if (!currentUser) {
        return reply.code(401).send({ error: 'Missing or invalid authorization header' });
      }
      request.user = currentUser;
    });
    app.decorate('requireRole', () => async () => undefined);

    await app.register(authRoutes);
    await app.register(containerLogsRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.mocked(streamTicketsModule.createStreamTicket).mockReset();
    vi.mocked(streamTicketsModule.consumeStreamTicket).mockReset();
    currentUser = null;
  });

  it('POST /api/auth/stream-ticket returns 401 without auth', async () => {
    currentUser = null;
    const res = await app.inject({ method: 'POST', url: '/api/auth/stream-ticket' });
    expect(res.statusCode).toBe(401);
    // The ticket creation service must not have been touched.
    expect(streamTicketsModule.createStreamTicket).not.toHaveBeenCalled();
  });

  it('POST /api/auth/stream-ticket returns ticket + expiresAt for an authenticated user', async () => {
    currentUser = { sub: 'u1', username: 'alice', sessionId: 's1', role: 'viewer' };
    const expiresAt = new Date(Date.now() + 30_000).toISOString();
    vi.mocked(streamTicketsModule.createStreamTicket).mockResolvedValueOnce({
      ticket: 'st_aaa_111',
      expiresAt,
    });

    const res = await app.inject({ method: 'POST', url: '/api/auth/stream-ticket' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ticket).toBe('st_aaa_111');
    expect(body.expiresAt).toBe(expiresAt);

    // Service must be called with the authenticated user's identity, never
    // with values from the request body.
    expect(streamTicketsModule.createStreamTicket).toHaveBeenCalledWith('u1', 'alice');
  });

  it('POST /api/auth/stream-ticket expiresAt is roughly 30s in the future', async () => {
    currentUser = { sub: 'u1', username: 'alice', sessionId: 's1', role: 'viewer' };
    const before = Date.now();
    const expiresAt = new Date(before + 30_000).toISOString();
    vi.mocked(streamTicketsModule.createStreamTicket).mockResolvedValueOnce({
      ticket: 'st_aaa_222',
      expiresAt,
    });

    const res = await app.inject({ method: 'POST', url: '/api/auth/stream-ticket' });
    const body = JSON.parse(res.body);
    const ttl = new Date(body.expiresAt).getTime() - before;
    expect(ttl).toBeGreaterThanOrEqual(25_000);
    expect(ttl).toBeLessThanOrEqual(35_000);
  });

  it('GET .../logs/stream rejects requests with no ticket and no Authorization header', async () => {
    currentUser = null;
    vi.mocked(streamTicketsModule.consumeStreamTicket).mockResolvedValue(null);

    const res = await app.inject({
      method: 'GET',
      url: '/api/containers/1/abc/logs/stream',
    });

    expect(res.statusCode).toBe(401);
    // No ticket → consumer must not be called either.
    expect(streamTicketsModule.consumeStreamTicket).not.toHaveBeenCalled();
  });

  it('GET .../logs/stream rejects an unknown/invalid ticket', async () => {
    vi.mocked(streamTicketsModule.consumeStreamTicket).mockResolvedValue(null);

    const res = await app.inject({
      method: 'GET',
      url: '/api/containers/1/abc/logs/stream?ticket=does-not-exist',
    });

    expect(res.statusCode).toBe(401);
    expect(streamTicketsModule.consumeStreamTicket).toHaveBeenCalledWith('does-not-exist');
  });

  it('GET .../logs/stream rejects an expired ticket (consumer returns null)', async () => {
    // The consumer returns null for any non-validating ticket — expired,
    // already-used, or unknown — and the route must respond 401 in all
    // three cases.
    vi.mocked(streamTicketsModule.consumeStreamTicket).mockResolvedValue(null);

    const res = await app.inject({
      method: 'GET',
      url: '/api/containers/1/abc/logs/stream?ticket=expired-ticket',
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error).toMatch(/stream ticket/i);
  });

  it('GET .../logs/stream rejects an already-used ticket (single-use enforcement)', async () => {
    // The atomic check-and-burn lives in `consumeStreamTicket` (covered by
    // packages/core/src/services/stream-tickets.test.ts against real PG).
    // The route-level invariant is: when the consumer reports that a
    // ticket is no longer valid (used or expired), the request gets 401.
    // We simulate the second-attempt path here directly — the consumer
    // returns null, the route rejects.
    vi.mocked(streamTicketsModule.consumeStreamTicket).mockResolvedValueOnce(null);

    const res = await app.inject({
      method: 'GET',
      url: '/api/containers/1/abc/logs/stream?ticket=already-used',
    });

    expect(res.statusCode).toBe(401);
    expect(streamTicketsModule.consumeStreamTicket).toHaveBeenCalledWith('already-used');
  });

  it('nginx.conf defines log_format stream_no_args that omits $args', () => {
    const file = path.resolve(process.cwd(), '..', 'frontend', 'nginx.conf');
    const content = readFileSync(file, 'utf8');

    // The dedicated log format must exist.
    expect(content).toMatch(/log_format\s+stream_no_args/);

    // Extract the format definition (multi-line single-quoted strings).
    const match = content.match(/log_format\s+stream_no_args[^;]*;/);
    expect(match).not.toBeNull();
    const formatBlock = match![0];

    // Critically, $args/$query_string must NOT appear — that is the whole
    // point of this format. Either presence would re-leak the ticket into
    // access logs.
    expect(formatBlock).not.toMatch(/\$args/);
    expect(formatBlock).not.toMatch(/\$query_string/);
    // And the default `$request` (which embeds the query string) must also
    // be absent — the format reconstructs the request line from method+uri.
    expect(formatBlock).not.toMatch(/"\$request"/);
  });

  it('nginx.conf has a stream location that uses stream_no_args access_log', () => {
    const file = path.resolve(process.cwd(), '..', 'frontend', 'nginx.conf');
    const content = readFileSync(file, 'utf8');

    // The regex location for the SSE stream endpoint must exist.
    const locationMatch = content.match(
      /location\s+~\s+\^\/api\/containers\/\.[+*]\/logs\/stream\s*\{[\s\S]*?\n\s*\}/,
    );
    expect(locationMatch).not.toBeNull();

    const block = locationMatch![0];
    // The block must use the scrubbed log format. Without this, even with
    // tickets, the URL still hits nginx access logs verbatim — defeating
    // the whole #1112 mitigation.
    expect(block).toMatch(/access_log\s+\/dev\/stdout\s+stream_no_args/);

    // And it must proxy to the backend — otherwise SSE would 404.
    expect(block).toContain('proxy_pass http://backend:3051');
  });

  it('container-logs route source uses ticket-from-query, not JWT-from-query', () => {
    const file = path.resolve(
      process.cwd(),
      '..',
      'packages',
      'foundation',
      'src',
      'routes',
      'container-logs.ts',
    );
    const content = readFileSync(file, 'utf8');

    // Defence-in-depth source assertion: the SSE preHandler must consume
    // a stream ticket and must NOT decode a `token` query parameter.
    expect(content).toContain('consumeStreamTicket');
    expect(content).not.toMatch(/const\s*\{\s*token\s*\}\s*=\s*request\.query/);
    expect(content).not.toMatch(/authenticateBearerHeader\(`Bearer \$\{token\}`\)/);
  });
});
