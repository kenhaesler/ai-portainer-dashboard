import { FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import { networkInterfaces } from 'node:os';
import '@dashboard/core/plugins/auth.js';
import '@dashboard/core/plugins/request-tracing.js';
import '@fastify/swagger';
import {
  getEndpointCoverage,
  updateCoverageStatus,
  deleteCoverageRecord,
  syncEndpointCoverage,
  verifyCoverage,
  getCoverageSummary,
  deployBeyla,
  disableBeyla,
  enableBeyla,
  removeBeylaFromEndpoint,
  deployBeylaBulk,
  removeBeylaBulk,
  getEndpointOtlpOverride,
  setEndpointOtlpOverride,
} from '../services/ebpf-coverage.js';
import { writeAuditLog } from '@dashboard/core/services/audit-logger.js';
import { createChildLogger } from '@dashboard/core/utils/logger.js';
import { getConfig } from '@dashboard/core/config/index.js';
import { isEdgeTunnelNotActive } from '@dashboard/core/portainer/portainer-client.js';

const log = createChildLogger('ebpf-coverage-route');

const EndpointIdParamsSchema = z.object({
  endpointId: z.coerce.number().int().positive(),
});

const UpdateCoverageBodySchema = z.object({
  status: z.enum(['planned', 'deployed', 'excluded', 'failed', 'unknown', 'not_deployed', 'unreachable', 'incompatible']),
  reason: z.string().optional(),
});

const UpdateOtlpOverrideBodySchema = z.object({
  otlpEndpointOverride: z.string().url().nullable(),
});
const DeployBodySchema = z.object({
  otlpEndpoint: z.string().optional(),
}).default({});

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

/**
 * Sentinel thrown when the default OTLP endpoint cannot be auto-resolved to an
 * address that a remote agent could actually reach. The deploy route catches
 * this and returns a 400 with an actionable message — the caller can either
 * configure DASHBOARD_EXTERNAL_URL or supply an explicit override in the
 * Deploy dialog.
 */
class OtlpResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OtlpResolutionError';
  }
}

function resolveOtlpEndpoint(request: { headers: Record<string, unknown>; protocol: string }): string {
  const config = getConfig();
  if (config.DASHBOARD_EXTERNAL_URL) {
    const base = config.DASHBOARD_EXTERNAL_URL.replace(/\/+$/, '');
    return `${base}/api/traces/otlp`;
  }
  const proto = String(request.headers['x-forwarded-proto'] || request.protocol || 'http').split(',')[0].trim();
  const rawHost = String(request.headers['x-forwarded-host'] || request.headers.host || `localhost:${config.PORT}`).split(',')[0].trim();
  const host = resolveReachableHost(rawHost, config.PORT);
  const { hostname: resolvedHostname } = parseHostAndPort(host);
  if (isLoopbackHost(resolvedHostname)) {
    throw new OtlpResolutionError(
      'Could not resolve a remotely-reachable OTLP endpoint: the dashboard is being addressed via loopback and no usable LAN IP was detected (only Docker bridge addresses are visible from inside the backend container). Set DASHBOARD_EXTERNAL_URL to the URL Beyla should use (e.g. http://dashboard.example.com:3051), or supply an explicit OTLP endpoint in the Deploy dialog.',
    );
  }
  return `${proto}://${host}/api/traces/otlp`;
}

function parseHostAndPort(host: string): { hostname: string; port: string | null } {
  const normalized = host.replace(/^\[|\]$/g, '');
  const lastColon = normalized.lastIndexOf(':');
  if (lastColon > -1 && normalized.indexOf(':') === lastColon) {
    return { hostname: normalized.slice(0, lastColon), port: normalized.slice(lastColon + 1) };
  }
  return { hostname: normalized, port: null };
}

function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

function isPrivateIpv4(ip: string): boolean {
  return ip.startsWith('10.') || ip.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip);
}

/**
 * 172.16.0.0/12 is the private range Docker uses for its default bridge
 * networks (typically 172.17/16, 172.18/16, …). When the dashboard runs in a
 * container, these are the only "non-internal" interfaces it sees — but they
 * are completely unreachable from any remote host (e.g. an Edge Agent on a
 * separate machine). Treat them as useless for OTLP endpoint resolution.
 */
function isDockerBridgeIpv4(ip: string): boolean {
  return /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip);
}

export function detectLocalIpv4(): string | null {
  const interfaces = networkInterfaces();
  const candidates: string[] = [];

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        candidates.push(entry.address);
      }
    }
  }

  // Prefer real LAN IPs (192.168/16, 10/8); never advertise a Docker bridge IP
  // because remote callers can't reach it. If everything we have is a Docker
  // bridge, return null so the caller falls back to the configured host or to
  // the rawHost (which at least produces an obvious failure).
  const lan = candidates.find((ip) => isPrivateIpv4(ip) && !isDockerBridgeIpv4(ip));
  if (lan) return lan;
  const publicCandidate = candidates.find((ip) => !isPrivateIpv4(ip) && !isDockerBridgeIpv4(ip));
  return publicCandidate || null;
}

function resolveReachableHost(rawHost: string, fallbackPort: number): string {
  const { hostname, port } = parseHostAndPort(rawHost);
  if (!isLoopbackHost(hostname)) {
    return rawHost;
  }

  const detectedIp = detectLocalIpv4();
  if (!detectedIp) {
    return rawHost;
  }

  return `${detectedIp}:${port || fallbackPort}`;
}

function resolveDefaultOtlpEndpoint(request: { headers: Record<string, unknown>; protocol: string }): string {
  return resolveOtlpEndpoint(request);
}

function ensureOtlpPath(url: URL): string {
  const normalizedPath = url.pathname.replace(/\/+$/, '');
  if (!normalizedPath || normalizedPath === '') {
    url.pathname = '/api/traces/otlp';
  } else if (normalizedPath !== '/api/traces/otlp') {
    url.pathname = '/api/traces/otlp';
  }
  return `${url.origin}${url.pathname}`;
}

function normalizeManualOtlpEndpoint(
  rawValue: string,
  request: { headers: Record<string, unknown>; protocol: string },
): string {
  const value = rawValue.trim();

  // Full URL: use it as-is, no need to consult the default.
  if (value.includes('://')) {
    const parsed = new URL(value);
    return ensureOtlpPath(parsed);
  }

  const hostPart = value.split('/')[0].trim();
  if (!hostPart) {
    throw new Error('Invalid OTLP endpoint override');
  }

  // Host-only override: build a URL from scratch. We default to http:// because
  // requiring the operator to pre-configure DASHBOARD_EXTERNAL_URL just so they
  // can type a single hostname in the Deploy dialog defeats the point of the
  // override. If they want TLS they can type the full URL.
  const config = getConfig();
  const fallbackPort = String(config.PORT);
  const base = new URL(`http://placeholder:${fallbackPort}/api/traces/otlp`);
  if (hostPart.includes(':')) {
    base.host = hostPart;
  } else {
    base.hostname = hostPart;
  }
  return ensureOtlpPath(base);
}

async function resolveEndpointOtlpEndpoint(
  endpointId: number,
  request: { headers: Record<string, unknown>; protocol: string },
): Promise<string> {
  const override = await getEndpointOtlpOverride(endpointId);
  if (override) return override;
  return resolveDefaultOtlpEndpoint(request);
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
    const coverage = await getEndpointCoverage();
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

    await updateCoverageStatus(endpointId, status, reason);

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

  // Delete stale coverage record (admin only)
  fastify.delete('/api/ebpf/coverage/:endpointId', {
    schema: {
      tags: ['eBPF Coverage'],
      summary: 'Delete a stale eBPF coverage record for an endpoint',
      security: [{ bearerAuth: [] }],
      params: EndpointIdParamsSchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const { endpointId } = request.params as z.infer<typeof EndpointIdParamsSchema>;
    const deleted = await deleteCoverageRecord(endpointId);

    if (!deleted) {
      return reply.code(404).send({ error: 'Coverage record not found' });
    }

    writeAuditLog({
      user_id: request.user?.sub,
      username: request.user?.username,
      action: 'ebpf_coverage.delete',
      target_type: 'endpoint',
      target_id: String(endpointId),
      details: { deleted: true },
      request_id: request.requestId,
      ip_address: request.ip,
    });

    return { success: true };
  });

  // Update endpoint-specific OTLP override URL (admin only)
  fastify.put('/api/ebpf/coverage/:endpointId/otlp-endpoint', {
    schema: {
      tags: ['eBPF Coverage'],
      summary: 'Set or clear endpoint-specific OTLP endpoint override',
      security: [{ bearerAuth: [] }],
      params: EndpointIdParamsSchema,
      body: UpdateOtlpOverrideBodySchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request) => {
    const { endpointId } = request.params as z.infer<typeof EndpointIdParamsSchema>;
    const { otlpEndpointOverride } = request.body as z.infer<typeof UpdateOtlpOverrideBodySchema>;
    await setEndpointOtlpOverride(endpointId, otlpEndpointOverride);

    writeAuditLog({
      user_id: request.user?.sub,
      username: request.user?.username,
      action: 'ebpf_coverage.otlp_override.update',
      target_type: 'endpoint',
      target_id: String(endpointId),
      details: { otlpEndpointOverride },
      request_id: request.requestId,
      ip_address: request.ip,
    });

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
      body: DeployBodySchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const { endpointId } = request.params as z.infer<typeof EndpointIdParamsSchema>;
    const body = request.body as z.infer<typeof DeployBodySchema>;
    const config = getConfig();
    const requestedOtlpEndpointRaw = body?.otlpEndpoint?.trim();
    const requestedOtlpEndpoint = requestedOtlpEndpointRaw
      ? normalizeManualOtlpEndpoint(requestedOtlpEndpointRaw, {
        headers: request.headers as Record<string, unknown>,
        protocol: request.protocol,
      })
      : undefined;
    let resolvedOtlpEndpoint: string;
    try {
      resolvedOtlpEndpoint = requestedOtlpEndpoint || await resolveEndpointOtlpEndpoint(endpointId, {
        headers: request.headers as Record<string, unknown>,
        protocol: request.protocol,
      });
    } catch (err) {
      if (err instanceof OtlpResolutionError) {
        log.warn({ endpointId, err: err.message }, 'Deploy rejected: OTLP endpoint cannot be auto-resolved');
        return reply.code(400).send({ error: err.message });
      }
      throw err;
    }

    if (requestedOtlpEndpoint) {
      await setEndpointOtlpOverride(endpointId, requestedOtlpEndpoint);
    }

    let result;
    try {
      result = await deployBeyla(endpointId, {
        otlpEndpoint: resolvedOtlpEndpoint,
        tracesApiKey: config.TRACES_INGESTION_API_KEY,
        recreateExisting: Boolean(requestedOtlpEndpoint),
      });
    } catch (err) {
      // Portainer signals the Edge Agent on its next poll to open the tunnel; the request
      // itself fails until that happens. Return 503 with a clear, retryable message.
      if (isEdgeTunnelNotActive(err)) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn({ endpointId, err: msg }, 'Beyla deploy failed: Edge Agent tunnel not active');
        return reply.code(503).send({
          error: 'Edge Agent tunnel is not active. Portainer has signalled the agent to open it; retry in 30–60 seconds (or shorten the Edge check-in interval on the agent).',
        });
      }
      throw err;
    }

    writeAuditLog({
      user_id: request.user?.sub,
      username: request.user?.username,
      action: 'ebpf.deploy',
      target_type: 'endpoint',
      target_id: String(endpointId),
      details: { otlpEndpoint: resolvedOtlpEndpoint, ...result },
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
      tracesApiKey: config.TRACES_INGESTION_API_KEY,
      resolveOtlpEndpoint: async (endpointId: number) => resolveEndpointOtlpEndpoint(endpointId, {
        headers: request.headers as Record<string, unknown>,
        protocol: request.protocol,
      }),
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
