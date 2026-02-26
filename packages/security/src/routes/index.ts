import { FastifyInstance } from 'fastify';
import type { LLMInterface } from '@dashboard/contracts';
import { pcapRoutes } from './pcap.js';
import { ebpfCoverageRoutes } from './ebpf-coverage.js';
import { harborVulnerabilityRoutes } from './harbor-vulnerabilities.js';

/**
 * Register all security-domain routes.
 * Each sub-route owns its own URL prefix internally.
 */
export async function securityRoutes(fastify: FastifyInstance, opts: { llm: LLMInterface }) {
  await fastify.register(ebpfCoverageRoutes);
  await fastify.register(harborVulnerabilityRoutes);
  await fastify.register((f) => pcapRoutes(f, opts));
}
