import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { getConfig } from '../config/index.js';

async function securityHeadersPlugin(fastify: FastifyInstance) {
  fastify.addHook('onSend', async (request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    // Referrer-Policy is intentionally NOT set here. nginx is the canonical
    // owner of browser-facing headers (per docs/ai-instructions/security-checklist.md)
    // and emits `Referrer-Policy: strict-origin-when-cross-origin` (OWASP-recommended).
    // Setting it here would conflict with the nginx value (only the first survives some
    // proxy configurations). See issue #1101.
    reply.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

    const forwardedProto = request.headers['x-forwarded-proto'];
    const isHttps = request.protocol === 'https' || forwardedProto === 'https';
    if (isHttps) {
      // HSTS preload submission requires max-age >= 1 year (we use 2 years per
      // OWASP recommendation when preload is enabled). When preload is off, we
      // keep the legacy 1-year max-age. Submission to hstspreload.org is
      // effectively irrevocable for ~6 months — operators must opt in via
      // HSTS_PRELOAD=true and only on HTTPS-only deployments.
      const preload = getConfig().HSTS_PRELOAD;
      const maxAge = preload ? 63072000 : 31536000;
      reply.header(
        'Strict-Transport-Security',
        `max-age=${maxAge}; includeSubDomains${preload ? '; preload' : ''}`,
      );
    }

    return payload;
  });
}

export default fp(securityHeadersPlugin, { name: 'security-headers' });
