import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import cors from '@fastify/cors';
import { DEV_ALLOWED_ORIGINS } from './dev-origins.js';

async function corsPlugin(fastify: FastifyInstance) {
  await fastify.register(cors, {
    origin: process.env.NODE_ENV === 'production'
      ? false
      : (origin, callback) => {
          if (!origin) {
            callback(null, false);
            return;
          }
          callback(null, DEV_ALLOWED_ORIGINS.includes(origin));
        },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  });
}

export default fp(corsPlugin, { name: 'cors' });
