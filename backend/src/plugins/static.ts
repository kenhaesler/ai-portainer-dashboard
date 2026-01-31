import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function staticPlugin(fastify: FastifyInstance) {
  if (process.env.NODE_ENV === 'production') {
    const frontendPath = path.join(__dirname, '../../public');
    await fastify.register(fastifyStatic, {
      root: frontendPath,
      prefix: '/',
      wildcard: false,
    });

    // SPA fallback
    fastify.setNotFoundHandler(async (_request, reply) => {
      return reply.sendFile('index.html');
    });
  }
}

export default fp(staticPlugin, { name: 'static' });
