import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import cors from '@fastify/cors';

async function corsPlugin(fastify: FastifyInstance) {
  const allowedOrigins = ['http://localhost:5173', 'http://localhost:5273', 'http://localhost:8080'];

  await fastify.register(cors, {
    origin: process.env.NODE_ENV === 'production'
      ? false
      : (origin, callback) => {
          if (!origin) {
            callback(null, false);
            return;
          }
          callback(null, allowedOrigins.includes(origin));
        },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  });
}

export default fp(corsPlugin, { name: 'cors' });
