import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  getEndpointCoverage,
  updateCoverageStatus,
  syncEndpointCoverage,
  verifyCoverage,
  getCoverageSummary,
} from '../services/ebpf-coverage.js';
import { writeAuditLog } from '../services/audit-logger.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('ebpf-coverage-route');

const EndpointIdParamsSchema = z.object({
  endpointId: z.coerce.number().int().positive(),
});

const UpdateCoverageBodySchema = z.object({
  status: z.enum(['planned', 'deployed', 'excluded', 'failed', 'unknown']),
  reason: z.string().optional(),
});

export async function ebpfCoverageRoutes(fastify: FastifyInstance) {
  // List all endpoints with eBPF coverage status
  fastify.get('/api/ebpf/coverage', {
    schema: {
      tags: ['eBPF Coverage'],
      summary: 'List all endpoints with eBPF coverage status',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async () => {
    const coverage = getEndpointCoverage();
    return { coverage };
  });

  // Coverage summary stats
  fastify.get('/api/ebpf/coverage/summary', {
    schema: {
      tags: ['eBPF Coverage'],
      summary: 'Get eBPF coverage summary statistics',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async () => {
    return getCoverageSummary();
  });

  // Update coverage status (admin only)
  fastify.put('/api/ebpf/coverage/:endpointId', {
    schema: {
      tags: ['eBPF Coverage'],
      summary: 'Update eBPF coverage status for an endpoint',
      security: [{ bearerAuth: [] }],
      params: EndpointIdParamsSchema,
      body: UpdateCoverageBodySchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request) => {
    const { endpointId } = request.params as z.infer<typeof EndpointIdParamsSchema>;
    const { status, reason } = request.body as z.infer<typeof UpdateCoverageBodySchema>;

    updateCoverageStatus(endpointId, status, reason);

    writeAuditLog({
      user_id: request.user?.sub,
      username: request.user?.username,
      action: 'ebpf_coverage.update',
      target_type: 'endpoint',
      target_id: String(endpointId),
      details: { status, reason },
      request_id: request.requestId,
      ip_address: request.ip,
    });

    log.info({ endpointId, status }, 'Coverage status updated via API');
    return { success: true };
  });

  // Trigger endpoint sync (admin only)
  fastify.post('/api/ebpf/coverage/sync', {
    schema: {
      tags: ['eBPF Coverage'],
      summary: 'Sync endpoint coverage with Portainer inventory',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request) => {
    const added = await syncEndpointCoverage();

    writeAuditLog({
      user_id: request.user?.sub,
      username: request.user?.username,
      action: 'ebpf_coverage.sync',
      details: { added },
      request_id: request.requestId,
      ip_address: request.ip,
    });

    return { success: true, added };
  });

  // Verify trace ingestion for an endpoint
  fastify.post('/api/ebpf/coverage/:endpointId/verify', {
    schema: {
      tags: ['eBPF Coverage'],
      summary: 'Verify trace ingestion for an endpoint',
      security: [{ bearerAuth: [] }],
      params: EndpointIdParamsSchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { endpointId } = request.params as z.infer<typeof EndpointIdParamsSchema>;
    const result = await verifyCoverage(endpointId);
    return result;
  });
}
