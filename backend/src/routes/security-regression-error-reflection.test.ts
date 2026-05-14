/**
 * Security Regression — Reflected user input in error responses
 *
 * Validation failures must NOT echo the rejected user-supplied value back
 * into the `error` field of the JSON response. Even though Fastify serves
 * `application/json` (mitigating direct XSS), reflecting raw input creates
 * a defense-in-depth gap: any client that later renders `error` via
 * `innerHTML` / `dangerouslySetInnerHTML` would re-introduce reflected XSS,
 * and the response becomes a content-sniffing oracle.
 *
 * Guards routes flagged by Semgrep rule
 * `javascript.express.web.tainted-direct-response-express` in:
 *   • packages/ai-intelligence/src/routes/llm-feedback.ts:101,240
 *   • packages/foundation/src/routes/settings.ts:313,336
 *   • packages/operations/src/routes/webhooks.ts:80,132
 *
 * @see https://github.com/kenhaesler/ai-portainer-dashboard/issues/1227
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const XSS_VALUE = '<script>alert(1)</script>';

// =====================================================================
//  Static source-level guard
// =====================================================================
describe('Reflected input — source-level guard', () => {
  const ROUTE_FILES = [
    'packages/ai-intelligence/src/routes/llm.ts',
    'packages/ai-intelligence/src/routes/llm-feedback.ts',
    'packages/foundation/src/routes/settings.ts',
    'packages/operations/src/routes/webhooks.ts',
  ];

  for (const rel of ROUTE_FILES) {
    it(`${rel} does not reflect user-controlled "feature"/"event" inputs into "error" strings`, () => {
      const abs = path.resolve(process.cwd(), '..', rel);
      const content = readFileSync(abs, 'utf8');

      // Specifically guard the patterns Semgrep flagged. We don't ban ALL
      // template-literal `error: ` strings (some interpolate trusted
      // constants like rate-limit thresholds); we ban the ones that echo a
      // user-supplied feature/event back unchanged.
      const bannedPrefixes = [
        /error:\s*`Invalid feature:\s*\$\{/g,
        /error:\s*`Unknown feature:\s*\$\{/g,
        /error:\s*`Invalid event type:\s*\$\{/g,
      ];
      const hits = bannedPrefixes.flatMap((re) => content.match(re) ?? []);
      expect(
        hits,
        `Found reflected user input pattern in ${rel}. Use a static error string + a separate \`code\` field.`,
      ).toEqual([]);
    });
  }
});

// =====================================================================
//  Runtime guard — llm-feedback routes
// =====================================================================
vi.mock('@dashboard/core/services/audit-logger.js', () => ({
  writeAuditLog: vi.fn(),
}));

describe('Reflected input — llm-feedback routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const { llmFeedbackRoutes } = await import('@dashboard/ai');

    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.decorate('authenticate', async () => undefined);
    app.decorate('requireRole', () => async () => undefined);
    app.addHook('onRequest', async (request) => {
      request.user = {
        sub: 'user-1',
        username: 'admin',
        role: 'admin',
        sessionId: 'sess-1',
      };
    });
    await app.register(llmFeedbackRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('POST /api/llm/feedback rejects invalid feature without echoing the value', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/llm/feedback',
      payload: {
        feature: XSS_VALUE,
        rating: 'positive',
        comment: '',
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBeTypeOf('string');
    expect(body.error).not.toContain('<script>');
    expect(body.error).not.toContain(XSS_VALUE);
  });

  it('POST /api/llm/feedback/generate-suggestion rejects invalid feature without echoing the value', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/llm/feedback/generate-suggestion',
      payload: { feature: XSS_VALUE },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBeTypeOf('string');
    expect(body.error).not.toContain('<script>');
    expect(body.error).not.toContain(XSS_VALUE);
  });
});

// =====================================================================
//  Runtime guard — webhook routes
// =====================================================================
describe('Reflected input — webhook routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const { webhookRoutes } = await import('@dashboard/operations');

    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.decorate('authenticate', async () => undefined);
    app.decorate('requireRole', () => async () => undefined);
    app.decorateRequest('user', undefined);
    app.addHook('preHandler', async (request) => {
      request.user = {
        sub: 'user-1',
        username: 'admin',
        role: 'admin',
        sessionId: 'sess-1',
      };
    });
    await app.register(webhookRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('POST /api/webhooks rejects invalid event type without echoing the value', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks',
      payload: {
        name: 'Test',
        url: 'https://example.com/hook',
        events: [XSS_VALUE],
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBeTypeOf('string');
    expect(body.error).not.toContain('<script>');
    expect(body.error).not.toContain(XSS_VALUE);
  });

  it('PATCH /api/webhooks/:id rejects invalid event type without echoing the value', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/webhooks/wh-1',
      payload: { events: [XSS_VALUE] },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBeTypeOf('string');
    expect(body.error).not.toContain('<script>');
    expect(body.error).not.toContain(XSS_VALUE);
  });
});
