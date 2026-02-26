import { FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import { createChildLogger } from '@dashboard/core/utils/logger.js';
import { writeAuditLog } from '@dashboard/core/services/audit-logger.js';
import * as harborClient from '../services/harbor-client.js';
import { getEffectiveHarborConfig } from '@dashboard/core/services/settings-store.js';
import * as vulnStore from '../services/harbor-vulnerability-store.js';
import { runFullSync } from '../services/harbor-sync.js';

const log = createChildLogger('route:harbor-vulnerabilities');

export async function harborVulnerabilityRoutes(fastify: FastifyInstance) {
  // ---------------------------------------------------------------------------
  // Connection & Status
  // ---------------------------------------------------------------------------

  fastify.get('/api/harbor/status', {
    schema: {
      tags: ['Harbor'],
      summary: 'Check Harbor connection status and sync info',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async () => {
    const configured = await harborClient.isHarborConfiguredAsync();
    if (!configured) {
      return { configured: false, connected: false, lastSync: null };
    }

    const [connectionTest, lastSync] = await Promise.all([
      harborClient.testConnection(),
      vulnStore.getLatestSyncStatus(),
    ]);

    return {
      configured: true,
      connected: connectionTest.ok,
      connectionError: connectionTest.error,
      lastSync,
    };
  });

  /** Lightweight config check for the Settings page (no connection test). */
  fastify.get('/api/harbor/enabled', {
    schema: {
      tags: ['Harbor'],
      summary: 'Check if Harbor integration is enabled (for sidebar visibility)',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async () => {
    const cfg = await getEffectiveHarborConfig();
    return {
      enabled: cfg.enabled && !!(cfg.apiUrl && cfg.robotName && cfg.robotSecret),
    };
  });

  // ---------------------------------------------------------------------------
  // Security Summary (from Harbor, live)
  // ---------------------------------------------------------------------------

  fastify.get('/api/harbor/summary', {
    schema: {
      tags: ['Harbor'],
      summary: 'Get Harbor security summary (live from Harbor API)',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async (_request, reply) => {
    if (!await harborClient.isHarborConfiguredAsync()) {
      return reply.code(503).send({ error: 'Harbor is not configured' });
    }

    try {
      return await harborClient.getSecuritySummary();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      log.error({ err }, 'Failed to fetch Harbor security summary');
      return reply.code(502).send({ error: 'Failed to connect to Harbor', details: msg });
    }
  });

  // ---------------------------------------------------------------------------
  // Vulnerabilities (from local DB, synced)
  // ---------------------------------------------------------------------------

  fastify.get('/api/harbor/vulnerabilities', {
    schema: {
      tags: ['Harbor'],
      summary: 'List vulnerabilities (from synced local data)',
      security: [{ bearerAuth: [] }],
      querystring: z.object({
        severity: z.string().optional(),
        inUse: z.coerce.boolean().optional(),
        cveId: z.string().optional(),
        repositoryName: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(1000).default(200),
        offset: z.coerce.number().int().min(0).default(0),
      }),
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const query = request.query as {
      severity?: string;
      inUse?: boolean;
      cveId?: string;
      repositoryName?: string;
      limit: number;
      offset: number;
    };

    const [vulnerabilities, summary] = await Promise.all([
      vulnStore.getVulnerabilities(query),
      vulnStore.getVulnerabilitySummary(),
    ]);

    return { vulnerabilities, summary };
  });

  fastify.get('/api/harbor/vulnerabilities/summary', {
    schema: {
      tags: ['Harbor'],
      summary: 'Get vulnerability summary statistics (from synced local data)',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async () => {
    return vulnStore.getVulnerabilitySummary();
  });

  // ---------------------------------------------------------------------------
  // Projects (from Harbor, live)
  // ---------------------------------------------------------------------------

  fastify.get('/api/harbor/projects', {
    schema: {
      tags: ['Harbor'],
      summary: 'List Harbor projects',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async (_request, reply) => {
    if (!await harborClient.isHarborConfiguredAsync()) {
      return reply.code(503).send({ error: 'Harbor is not configured' });
    }

    try {
      return await harborClient.getProjects();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      log.error({ err }, 'Failed to fetch Harbor projects');
      return reply.code(502).send({ error: 'Failed to connect to Harbor', details: msg });
    }
  });

  // ---------------------------------------------------------------------------
  // Sync Management
  // ---------------------------------------------------------------------------

  fastify.post('/api/harbor/sync', {
    schema: {
      tags: ['Harbor'],
      summary: 'Trigger a full vulnerability sync from Harbor',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    if (!await harborClient.isHarborConfiguredAsync()) {
      return reply.code(503).send({ error: 'Harbor is not configured' });
    }

    writeAuditLog({
      user_id: request.user?.sub,
      username: request.user?.username,
      action: 'harbor.sync_triggered',
      target_type: 'harbor',
      target_id: 'full-sync',
      request_id: request.requestId,
      ip_address: request.ip,
    });

    // Run sync in the background to avoid request timeout
    const syncPromise = runFullSync();
    syncPromise.catch((err) => {
      log.error({ err }, 'Background Harbor sync failed');
    });

    return { message: 'Sync started', status: 'running' };
  });

  // ---------------------------------------------------------------------------
  // Exceptions
  // ---------------------------------------------------------------------------

  fastify.get('/api/harbor/exceptions', {
    schema: {
      tags: ['Harbor'],
      summary: 'List CVE exceptions',
      security: [{ bearerAuth: [] }],
      querystring: z.object({
        activeOnly: z.coerce.boolean().default(true),
      }),
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { activeOnly } = request.query as { activeOnly: boolean };
    return vulnStore.getExceptions(activeOnly);
  });

  fastify.post('/api/harbor/exceptions', {
    schema: {
      tags: ['Harbor'],
      summary: 'Create or update a CVE exception',
      security: [{ bearerAuth: [] }],
      body: z.object({
        cve_id: z.string().min(1),
        scope: z.enum(['global', 'project', 'repository']).default('global'),
        scope_ref: z.string().optional(),
        justification: z.string().min(10),
        expires_at: z.string().optional(),
      }),
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request) => {
    const body = request.body as {
      cve_id: string;
      scope: string;
      scope_ref?: string;
      justification: string;
      expires_at?: string;
    };

    const createdBy = request.user?.username ?? 'unknown';

    const exception = await vulnStore.createException({
      ...body,
      created_by: createdBy,
    });

    writeAuditLog({
      user_id: request.user?.sub,
      username: request.user?.username,
      action: 'harbor.exception_created',
      target_type: 'cve_exception',
      target_id: body.cve_id,
      details: { scope: body.scope, justification: body.justification },
      request_id: request.requestId,
      ip_address: request.ip,
    });

    return exception;
  });

  fastify.delete('/api/harbor/exceptions/:id', {
    schema: {
      tags: ['Harbor'],
      summary: 'Deactivate a CVE exception',
      security: [{ bearerAuth: [] }],
      params: z.object({
        id: z.coerce.number().int(),
      }),
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: number };
    const success = await vulnStore.deactivateException(id);

    if (!success) {
      return reply.code(404).send({ error: 'Exception not found' });
    }

    writeAuditLog({
      user_id: request.user?.sub,
      username: request.user?.username,
      action: 'harbor.exception_deactivated',
      target_type: 'cve_exception',
      target_id: String(id),
      request_id: request.requestId,
      ip_address: request.ip,
    });

    return { success: true };
  });
}
