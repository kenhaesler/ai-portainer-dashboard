import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import cors from '@fastify/cors';
import { DEV_ALLOWED_ORIGINS } from './dev-origins.js';
import { getAllowedOrigins } from './allowed-origins.js';

async function corsPlugin(fastify: FastifyInstance) {
  // Production: honour CORS_ALLOWED_ORIGINS (parsed + validated by env schema).
  // When unset, getAllowedOrigins() returns false — preserves the legacy
  // "no cross-origin in production" default. Same source of truth as
  // packages/core/src/plugins/socket-io.ts so REST and WebSocket CORS
  // never drift apart.
  const prodOrigins = getAllowedOrigins();
  await fastify.register(cors, {
    origin: process.env.NODE_ENV === 'production'
      ? prodOrigins
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
