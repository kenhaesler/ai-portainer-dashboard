import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  getEndpointCoverage,
  updateCoverageStatus,
  syncEndpointCoverage,
  verifyCoverage,
  getCoverageSummary,
  deployBeyla,
  disableBeyla,
  enableBeyla,
  removeBeylaFromEndpoint,
  deployBeylaBulk,
  removeBeylaBulk,
} from '../services/ebpf-coverage.js';
import { writeAuditLog } from '../services/audit-logger.js';
import { createChildLogger } from '../utils/logger.js';
import { getConfig } from '../config/index.js';

const log = createChildLogger('ebpf-coverage-route');

const EndpointIdParamsSchema = z.object({
  endpointId: z.coerce.number().int().positive(),
});

const UpdateCoverageBodySchema = z.object({
  status: z.enum(['planned', 'deployed', 'excluded', 'failed', 'unknown', 'not_deployed', 'unreachable', 'incompatible']),
  reason: z.string().optional(),
});

const BulkBodySchema = z.object({
  endpointIds: z.array(z.coerce.number().int().positive()).min(1),
});

const RemoveQuerySchema = z.object({
  force: z
    .union([z.boolean(), z.string()])
    .optional()
    .default(false)
    .transform((value) => {
      if (typeof value === 'boolean') return value;
      return value === 'true' || value === '1';
    }),
});

function resolveOtlpEndpoint(request: { headers: Record<string, unknown>; protocol: string }): string {
  const config = getConfig();
  const proto = String(request.headers['x-forwarded-proto'] || request.protocol || 'http').split(',')[0].trim();
  const host = String(request.headers['x-forwarded-host'] || request.headers.host || `localhost:${config.PORT}`).split(',')[0].trim();
  return `${proto}://${host}/api/traces/otlp`;
}

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

  // Deploy Beyla to one endpoint (admin only)
  fastify.post('/api/ebpf/deploy/:endpointId', {
    schema: {
      tags: ['eBPF Coverage'],
      summary: 'Deploy Beyla to an endpoint',
      security: [{ bearerAuth: [] }],
      params: EndpointIdParamsSchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request) => {
    const { endpointId } = request.params as z.infer<typeof EndpointIdParamsSchema>;
    const config = getConfig();
    const result = await deployBeyla(endpointId, {
      otlpEndpoint: resolveOtlpEndpoint({ headers: request.headers as Record<string, unknown>, protocol: request.protocol }),
      tracesApiKey: config.TRACES_INGESTION_API_KEY,
    });

    writeAuditLog({
      user_id: request.user?.sub,
      username: request.user?.username,
      action: 'ebpf.deploy',
      target_type: 'endpoint',
      target_id: String(endpointId),
      details: { ...result },
      request_id: request.requestId,
      ip_address: request.ip,
    });

    return { success: true, result };
  });

  // Deploy Beyla to multiple endpoints (admin only)
  fastify.post('/api/ebpf/deploy/bulk', {
    schema: {
      tags: ['eBPF Coverage'],
      summary: 'Deploy Beyla to multiple endpoints',
      security: [{ bearerAuth: [] }],
      body: BulkBodySchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request) => {
    const { endpointIds } = request.body as z.infer<typeof BulkBodySchema>;
    const config = getConfig();
    const results = await deployBeylaBulk(endpointIds, {
      otlpEndpoint: resolveOtlpEndpoint({ headers: request.headers as Record<string, unknown>, protocol: request.protocol }),
      tracesApiKey: config.TRACES_INGESTION_API_KEY,
    });

    writeAuditLog({
      user_id: request.user?.sub,
      username: request.user?.username,
      action: 'ebpf.deploy.bulk',
      details: { endpointIds, results },
      request_id: request.requestId,
      ip_address: request.ip,
    });

    return { success: true, results };
  });

  // Disable Beyla on an endpoint (admin only)
  fastify.post('/api/ebpf/disable/:endpointId', {
    schema: {
      tags: ['eBPF Coverage'],
      summary: 'Disable Beyla on an endpoint',
      security: [{ bearerAuth: [] }],
      params: EndpointIdParamsSchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request) => {
    const { endpointId } = request.params as z.infer<typeof EndpointIdParamsSchema>;
    const result = await disableBeyla(endpointId);
    writeAuditLog({
      user_id: request.user?.sub,
      username: request.user?.username,
      action: 'ebpf.disable',
      target_type: 'endpoint',
      target_id: String(endpointId),
      details: { ...result },
      request_id: request.requestId,
      ip_address: request.ip,
    });
    return { success: true, result };
  });

  // Enable Beyla on an endpoint (admin only)
  fastify.post('/api/ebpf/enable/:endpointId', {
    schema: {
      tags: ['eBPF Coverage'],
      summary: 'Enable Beyla on an endpoint',
      security: [{ bearerAuth: [] }],
      params: EndpointIdParamsSchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request) => {
    const { endpointId } = request.params as z.infer<typeof EndpointIdParamsSchema>;
    const result = await enableBeyla(endpointId);
    writeAuditLog({
      user_id: request.user?.sub,
      username: request.user?.username,
      action: 'ebpf.enable',
      target_type: 'endpoint',
      target_id: String(endpointId),
      details: { ...result },
      request_id: request.requestId,
      ip_address: request.ip,
    });
    return { success: true, result };
  });

  // Remove Beyla from one endpoint (admin only)
  fastify.delete('/api/ebpf/remove/:endpointId', {
    schema: {
      tags: ['eBPF Coverage'],
      summary: 'Remove Beyla from an endpoint',
      security: [{ bearerAuth: [] }],
      params: EndpointIdParamsSchema,
      querystring: RemoveQuerySchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request) => {
    const { endpointId } = request.params as z.infer<typeof EndpointIdParamsSchema>;
    const { force } = request.query as z.infer<typeof RemoveQuerySchema>;
    const result = await removeBeylaFromEndpoint(endpointId, force);
    writeAuditLog({
      user_id: request.user?.sub,
      username: request.user?.username,
      action: 'ebpf.remove',
      target_type: 'endpoint',
      target_id: String(endpointId),
      details: { force, ...result },
      request_id: request.requestId,
      ip_address: request.ip,
    });
    return { success: true, result };
  });

  // Remove Beyla from multiple endpoints (admin only)
  fastify.delete('/api/ebpf/remove/bulk', {
    schema: {
      tags: ['eBPF Coverage'],
      summary: 'Remove Beyla from multiple endpoints',
      security: [{ bearerAuth: [] }],
      querystring: RemoveQuerySchema,
      body: BulkBodySchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request) => {
    const { force } = request.query as z.infer<typeof RemoveQuerySchema>;
    const { endpointIds } = request.body as z.infer<typeof BulkBodySchema>;
    const results = await removeBeylaBulk(endpointIds, force);
    writeAuditLog({
      user_id: request.user?.sub,
      username: request.user?.username,
      action: 'ebpf.remove.bulk',
      details: { force, endpointIds, results },
      request_id: request.requestId,
      ip_address: request.ip,
    });
    return { success: true, results };
  });
}
