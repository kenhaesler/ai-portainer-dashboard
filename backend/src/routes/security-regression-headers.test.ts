/**
 * Security Regression — HTTP Security Headers + CORS
 *
 * Guards against:
 *   • Missing/incorrect security headers (X-Frame-Options, X-Content-Type-Options,
 *     X-XSS-Protection, Referrer-Policy, CSP) at the nginx layer
 *   • Server-block add_header silently dropped when location overrides exist
 *   • H2C smuggling via unrestricted Upgrade values
 *   • HSTS preload misconfiguration (#1108)
 *   • CORS allow-list misconfiguration & malformed origins (#1115)
 *   • Socket.IO CORS drifting from REST CORS (single source of truth)
 *
 * @see https://github.com/kenhaesler/ai-portainer-dashboard/issues/1101
 * @see https://github.com/kenhaesler/ai-portainer-dashboard/issues/1105
 * @see https://github.com/kenhaesler/ai-portainer-dashboard/issues/1108
 * @see https://github.com/kenhaesler/ai-portainer-dashboard/issues/1115
 * @see https://github.com/kenhaesler/ai-portainer-dashboard/issues/1188 (split)
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { setConfigForTest, resetConfig } from '@dashboard/core/config/index.js';
import Fastify from 'fastify';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// ─── Mocks ──────────────────────────────────────────────────────────────
// Passthrough mock makes the modules writable for vi.spyOn while keeping
// the real implementations.
vi.mock('@dashboard/core/utils/crypto.js', async (importOriginal) => await importOriginal());
vi.mock('@dashboard/core/services/session-store.js', () => ({
  createSession: vi.fn(() => ({ id: 'sess-1', user_id: 'u1', username: 'admin' })),
  getSession: vi.fn(() => null),
  invalidateSession: vi.fn(),
  refreshSession: vi.fn(() => null),
}));

// =====================================================================
//  NGINX SECURITY HEADER CONSISTENCY (CWE-16)
// =====================================================================
describe('Nginx Security Header Consistency', () => {
  it('should not define add_header at the server block level in nginx.conf', () => {
    const file = path.resolve(process.cwd(), '..', 'frontend', 'nginx.conf');
    const content = readFileSync(file, 'utf8');

    // Extract the server block content (between "server {" and the closing "}")
    const serverMatch = content.match(/server\s*\{([\s\S]*)\}/);
    expect(serverMatch).not.toBeNull();
    const serverBlock = serverMatch![1];

    // Find lines that are at the server level (not inside a location block).
    // Server-level add_header directives get silently dropped when any
    // location block defines its own add_header.
    const lines = serverBlock.split('\n');
    let locationDepth = 0;
    const serverLevelAddHeaders: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('location ') || trimmed.startsWith('location\t')) {
        locationDepth++;
      }
      if (trimmed === '}') {
        if (locationDepth > 0) locationDepth--;
      }
      if (locationDepth === 0 && trimmed.startsWith('add_header ')) {
        serverLevelAddHeaders.push(trimmed);
      }
    }

    expect(serverLevelAddHeaders).toEqual([]);
  });

  it('should include security headers snippet in every location block', () => {
    const file = path.resolve(process.cwd(), '..', 'frontend', 'nginx.conf');
    const content = readFileSync(file, 'utf8');

    // Every location block should include the security headers snippet
    const locationBlocks = content.match(/location\s+[^{]+\{[^}]+\}/g) ?? [];
    expect(locationBlocks.length).toBeGreaterThan(0);

    for (const block of locationBlocks) {
      expect(block).toContain('include /etc/nginx/security-headers.conf');
    }
  });

  it('should define all required security headers in the snippet file', () => {
    const file = path.resolve(process.cwd(), '..', 'frontend', 'nginx-security-headers.conf');
    const content = readFileSync(file, 'utf8');

    expect(content).toContain('X-Frame-Options');
    expect(content).toContain('X-Content-Type-Options');
    expect(content).toContain('X-XSS-Protection');
    expect(content).toContain('Referrer-Policy');
    expect(content).toContain('Content-Security-Policy');
  });

  it('should set X-XSS-Protection to "0" per OWASP guidance (issue #1105)', () => {
    // The deprecated XSS auditor in older browsers can be tricked into
    // removing legitimate script content. Explicitly disable it; CSP
    // script-src 'self' provides superior protection.
    const file = path.resolve(process.cwd(), '..', 'frontend', 'nginx-security-headers.conf');
    const content = readFileSync(file, 'utf8');

    expect(content).toMatch(/add_header\s+X-XSS-Protection\s+"0"\s+always/);
    expect(content).not.toMatch(/add_header\s+X-XSS-Protection\s+"1/);
  });

  it('should NOT set Referrer-Policy from the backend — nginx is the owner (issue #1101)', async () => {
    // Backend duplicating browser-facing headers can produce duplicate /
    // conflicting values. nginx emits Referrer-Policy: strict-origin-when-cross-origin.
    const Fastify = (await import('fastify')).default;
    const securityHeadersPlugin = (await import('@dashboard/core/plugins/security-headers.js'))
      .default;

    const app = Fastify();
    await app.register(securityHeadersPlugin);
    app.get('/ping', async () => ({ ok: true }));
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/ping' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['referrer-policy']).toBeUndefined();

    await app.close();
  });

  it('should use a map to restrict WebSocket upgrade values against H2C smuggling', () => {
    const file = path.resolve(process.cwd(), '..', 'frontend', 'nginx.conf');
    const content = readFileSync(file, 'utf8');

    // The map should only allow "websocket" upgrades
    expect(content).toMatch(/map\s+\$http_upgrade\s+\$connection_upgrade/);
    expect(content).toContain('websocket upgrade');

    // The Socket.IO proxy should use the map variable, not a hardcoded "upgrade"
    const socketBlock = content.match(/location\s+\/socket\.io\/\s*\{[\s\S]*?\}/);
    expect(socketBlock).not.toBeNull();
    expect(socketBlock![0]).toContain('Connection $connection_upgrade');
    expect(socketBlock![0]).not.toContain('Connection "upgrade"');
  });
});

// =====================================================================
//  HSTS preload + CORS_ALLOWED_ORIGINS (issues #1108, #1115)
//
//  Verifies the env-gated configurability of:
//   • Strict-Transport-Security header (HSTS_PRELOAD: false → 1y, true → 2y+preload)
//   • REST CORS allow-list (CORS_ALLOWED_ORIGINS, production)
//   • Socket.IO CORS using the same getAllowedOrigins() helper (single source of truth)
//   • Zod refinement rejecting malformed origins at boot
// =====================================================================
describe('HSTS preload + CORS_ALLOWED_ORIGINS (#1108, #1115)', () => {
  // Each test fully tears down its Fastify instance + resets cached config
  // before mutating env. NODE_ENV is restored after each case.
  const originalNodeEnv = process.env.NODE_ENV;
  const originalCorsAllowedOrigins = process.env.CORS_ALLOWED_ORIGINS;
  const originalHstsPreload = process.env.HSTS_PRELOAD;

  afterEach(async () => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalCorsAllowedOrigins === undefined) {
      delete process.env.CORS_ALLOWED_ORIGINS;
    } else {
      process.env.CORS_ALLOWED_ORIGINS = originalCorsAllowedOrigins;
    }
    if (originalHstsPreload === undefined) {
      delete process.env.HSTS_PRELOAD;
    } else {
      process.env.HSTS_PRELOAD = originalHstsPreload;
    }
    resetConfig();
    // Re-seed a baseline test config so subsequent tests in this file still
    // see the expected values.
    setConfigForTest({
      PORTAINER_API_URL: 'http://localhost:9000',
      OLLAMA_BASE_URL: 'http://localhost:11434',
      OLLAMA_MODEL: 'llama3.2',
      JWT_ALGORITHM: 'HS256',
      HTTP2_ENABLED: false,
    });
  });

  // ── #1108: HSTS preload (response header) ───────────────────────────────
  it('HSTS_PRELOAD=false (default) → max-age=31536000; includeSubDomains (no preload)', async () => {
    setConfigForTest({ HSTS_PRELOAD: false });
    const securityHeadersPlugin = (await import('@dashboard/core/plugins/security-headers.js')).default;

    const app = Fastify({ logger: false });
    await app.register(securityHeadersPlugin);
    app.get('/ping', async () => ({ ok: true }));
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/ping',
      headers: { 'x-forwarded-proto': 'https' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['strict-transport-security']).toBe(
      'max-age=31536000; includeSubDomains',
    );
    expect(res.headers['strict-transport-security']).not.toMatch(/preload/);

    await app.close();
  });

  it('HSTS_PRELOAD=true → max-age=63072000; includeSubDomains; preload', async () => {
    setConfigForTest({ HSTS_PRELOAD: true });
    const securityHeadersPlugin = (await import('@dashboard/core/plugins/security-headers.js')).default;

    const app = Fastify({ logger: false });
    await app.register(securityHeadersPlugin);
    app.get('/ping', async () => ({ ok: true }));
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/ping',
      headers: { 'x-forwarded-proto': 'https' },
    });
    expect(res.statusCode).toBe(200);
    // hstspreload.org submission requires max-age >= 1 year; we use 2 years
    // (OWASP recommended) when preload is enabled.
    expect(res.headers['strict-transport-security']).toBe(
      'max-age=63072000; includeSubDomains; preload',
    );

    await app.close();
  });

  // ── #1115: REST CORS allow-list ─────────────────────────────────────────
  it('CORS_ALLOWED_ORIGINS unset (production) → no Access-Control-Allow-Origin header', async () => {
    setConfigForTest({ CORS_ALLOWED_ORIGINS: undefined });
    process.env.NODE_ENV = 'production';
    const corsPlugin = (await import('@dashboard/core/plugins/cors.js')).default;

    const app = Fastify({ logger: false });
    await app.register(corsPlugin);
    app.get('/ping', async () => ({ ok: true }));
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/ping',
      headers: { origin: 'https://example.com' },
    });
    expect(res.statusCode).toBe(200);
    // Legacy `origin: false` behaviour preserved — no ACAO emitted at all.
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();

    await app.close();
  });

  it('CORS_ALLOWED_ORIGINS list → matched origin allowed, attacker rejected', async () => {
    setConfigForTest({
      CORS_ALLOWED_ORIGINS: 'https://example.com,https://other.com',
    });
    process.env.NODE_ENV = 'production';
    const corsPlugin = (await import('@dashboard/core/plugins/cors.js')).default;

    const app = Fastify({ logger: false });
    await app.register(corsPlugin);
    app.get('/ping', async () => ({ ok: true }));
    await app.ready();

    const allowed = await app.inject({
      method: 'GET',
      url: '/ping',
      headers: { origin: 'https://example.com' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe('https://example.com');
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');

    const blocked = await app.inject({
      method: 'GET',
      url: '/ping',
      headers: { origin: 'https://attacker.com' },
    });
    // Attacker origin must NOT be echoed back in any form.
    expect(blocked.headers['access-control-allow-origin']).not.toBe('https://attacker.com');

    await app.close();
  });

  // ── #1115: Zod boot-time refinement ─────────────────────────────────────
  it('rejects an origin without a protocol at boot (Zod refinement)', async () => {
    resetConfig();
    process.env.CORS_ALLOWED_ORIGINS = 'example.com';
    // Restore baseline required env vars in case this process started with
    // partial env (suite-level setConfigForTest clears those by setting cached
    // config; resetConfig() forces re-parsing from process.env).
    process.env.DASHBOARD_USERNAME = process.env.DASHBOARD_USERNAME ?? 'admin';
    process.env.DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD ?? 'test-password-12345';
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'a'.repeat(64);

    const { getConfig } = await import('@dashboard/core/config/index.js');
    expect(() => getConfig()).toThrowError(/CORS_ALLOWED_ORIGINS.*protocol:\/\/host/i);
  });

  it('rejects an origin with a path component at boot (Zod refinement)', async () => {
    resetConfig();
    process.env.CORS_ALLOWED_ORIGINS = 'https://example.com/path';
    process.env.DASHBOARD_USERNAME = process.env.DASHBOARD_USERNAME ?? 'admin';
    process.env.DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD ?? 'test-password-12345';
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'a'.repeat(64);

    const { getConfig } = await import('@dashboard/core/config/index.js');
    expect(() => getConfig()).toThrowError(/CORS_ALLOWED_ORIGINS.*protocol:\/\/host/i);
  });

  // ── #1115: Socket.IO uses the same allow-list as REST ───────────────────
  it('Socket.IO CORS reads the same getAllowedOrigins() list as REST', async () => {
    setConfigForTest({
      CORS_ALLOWED_ORIGINS: 'https://example.com,https://other.com',
    });
    process.env.NODE_ENV = 'production';

    const { getAllowedOrigins } = await import('@dashboard/core/plugins/allowed-origins.js');
    const restList = getAllowedOrigins();
    expect(restList).toEqual(['https://example.com', 'https://other.com']);

    // Register the socket-io plugin and inspect its configured cors.origin —
    // it must equal the value the REST helper returns (single source of truth).
    const socketIoPlugin = (await import('@dashboard/core/plugins/socket-io.js')).default;
    const app = Fastify({ logger: false });
    await app.register(socketIoPlugin);
    await app.ready();

    const opts = (app.io as unknown as { opts: { cors: { origin: unknown } } }).opts;
    expect(opts.cors.origin).toEqual(restList);

    await app.close();
  });

  it('Socket.IO CORS falls back to false when CORS_ALLOWED_ORIGINS is unset (production)', async () => {
    setConfigForTest({ CORS_ALLOWED_ORIGINS: undefined });
    process.env.NODE_ENV = 'production';

    const socketIoPlugin = (await import('@dashboard/core/plugins/socket-io.js')).default;
    const app = Fastify({ logger: false });
    await app.register(socketIoPlugin);
    await app.ready();

    const opts = (app.io as unknown as { opts: { cors: { origin: unknown } } }).opts;
    // Legacy `origin: false` behaviour preserved when no allow-list is set.
    expect(opts.cors.origin).toBe(false);

    await app.close();
  });
});
