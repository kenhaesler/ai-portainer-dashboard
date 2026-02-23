import { FastifyInstance } from 'fastify';
import { edgeJobsRoutes } from './edge-jobs.js';

export async function infrastructureRoutes(fastify: FastifyInstance) {
  await fastify.register(edgeJobsRoutes);
}
