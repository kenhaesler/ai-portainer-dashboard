import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

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
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    return payload;
  });
}

export default fp(securityHeadersPlugin, { name: 'security-headers' });
