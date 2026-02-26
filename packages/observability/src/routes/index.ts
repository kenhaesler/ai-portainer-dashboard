import { FastifyInstance } from 'fastify';
import type { LLMInterface } from '@dashboard/contracts';
import { metricsRoutes } from './metrics.js';
import { tracesRoutes } from './traces.js';
import { tracesIngestRoutes } from './traces-ingest.js';
import { forecastRoutes } from './forecasts.js';
import { prometheusRoutes } from './prometheus.js';
import { statusPageRoutes } from './status-page.js';
import { reportsRoutes } from './reports.js';

type ObservabilityRoutesOpts = { llm?: LLMInterface; getPromptGuardNearMissTotal?: () => number };

export async function observabilityRoutes(fastify: FastifyInstance, opts: ObservabilityRoutesOpts = {}) {
  await fastify.register((f) => metricsRoutes(f, opts));
  await fastify.register(tracesRoutes);
  await fastify.register(tracesIngestRoutes);
  await fastify.register((f) => forecastRoutes(f, opts));
  await fastify.register((f) => prometheusRoutes(f, { getPromptGuardNearMissTotal: opts.getPromptGuardNearMissTotal }));
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
