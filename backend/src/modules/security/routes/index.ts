import { FastifyInstance } from 'fastify';
import { pcapRoutes } from './pcap.js';
import { ebpfCoverageRoutes } from './ebpf-coverage.js';
import { harborVulnerabilityRoutes } from './harbor-vulnerabilities.js';

/**
 * Register all security-domain routes.
 * Each sub-route owns its own URL prefix internally.
 */
export async function securityRoutes(fastify: FastifyInstance) {
  await fastify.register(pcapRoutes);
  await fastify.register(ebpfCoverageRoutes);
  await fastify.register(harborVulnerabilityRoutes);
}
