import { FastifyInstance } from 'fastify';
import { VersionResponseSchema } from '../models/api-schemas.js';

export async function versionRoutes(fastify: FastifyInstance) {
  fastify.get('/api/version', {
    schema: {
      tags: ['System'],
      summary: 'Build version info',
      response: { 200: VersionResponseSchema },
    },
  }, async () => {
    return {
      commit: process.env.GIT_COMMIT
        || process.env.VITE_GIT_COMMIT
        || process.env.APP_COMMIT
        || 'dev',
    };
  });
}
