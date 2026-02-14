import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

async function securityHeadersPlugin(fastify: FastifyInstance) {
  fastify.addHook('onSend', async (request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
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
