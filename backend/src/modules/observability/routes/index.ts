import { FastifyInstance } from 'fastify';
import { metricsRoutes } from './metrics.js';
import { tracesRoutes } from './traces.js';
import { tracesIngestRoutes } from './traces-ingest.js';
import { forecastRoutes } from './forecasts.js';
import { prometheusRoutes } from './prometheus.js';
import { statusPageRoutes } from './status-page.js';
import { reportsRoutes } from './reports.js';

export async function observabilityRoutes(fastify: FastifyInstance) {
  await fastify.register(metricsRoutes);
  await fastify.register(tracesRoutes);
  await fastify.register(tracesIngestRoutes);
  await fastify.register(forecastRoutes);
  await fastify.register(prometheusRoutes);
  await fastify.register(statusPageRoutes);
  await fastify.register(reportsRoutes);
}

export {
  metricsRoutes,
  tracesRoutes,
  tracesIngestRoutes,
  forecastRoutes,
  prometheusRoutes,
  statusPageRoutes,
  reportsRoutes,
};
