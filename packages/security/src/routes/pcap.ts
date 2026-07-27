import fs from 'fs';
import { FastifyInstance } from 'fastify';
import '@dashboard/core/plugins/auth.js';
import '@dashboard/core/plugins/request-tracing.js';
import '@fastify/swagger';
import type { LLMInterface } from '@dashboard/contracts';
import { StartCaptureRequestSchema, CaptureListQuerySchema } from '../models/pcap.js';
import { ActionIdParamsSchema } from '@dashboard/core/models/api-schemas.js';
import {
  startCapture,
  stopCapture,
  getCaptureById,
  listCaptures,
  deleteCaptureById,
  getCaptureFilePath,
} from '../services/pcap-service.js';
import { analyzeCapture } from '../services/pcap-analysis-service.js';
import { writeAuditLog } from '@dashboard/core/services/audit-logger.js';
import { assertCapability } from '@dashboard/infrastructure';
import { createChildLogger } from '@dashboard/core/utils/logger.js';
import { getErrorStatusCode } from '@dashboard/core/utils/http-error.js';
import { errorDetails } from '@dashboard/core/plugins/error-handler.js';
import { getConfig } from '@dashboard/core/config/index.js';

const log = createChildLogger('pcap-route');

export async function pcapRoutes(fastify: FastifyInstance, opts: { llm: LLMInterface }) {
  /**
   * Whether packet capture is switched on for this deployment.
   *
   * `PCAP_ENABLED` defaults to false, and it was enforced only inside
   * `startCapture` — i.e. after the click. The page's own `startDisabledReason`
   * knew about three preconditions (not admin, no target, Edge Async) and not
   * about the feature flag, so on a stock install an admin filled in the form,
   * got a live "Start Capture" button, clicked it, and ate a server error. The
   * one destructive-ish action on the page was the least guarded.
   *
   * Read-only and cheap; `authenticate` is enough. It reports a flag the
   * operator sets, not anything about the fleet.
   */
  fastify.get('/api/pcap/status', {
    schema: {
      tags: ['Packet Capture'],
      summary: 'Whether packet capture is enabled for this deployment',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async () => {
    const config = getConfig();
    return {
      enabled: config.PCAP_ENABLED,
      // Named so the UI can tell the operator exactly what to change, the way
      // the Elasticsearch empty state already does.
      disabledReason: config.PCAP_ENABLED
        ? null
        : 'Packet capture is turned off for this deployment. Set PCAP_ENABLED=true in the environment and restart the backend.',
    };
  });

  // Start a new capture
  fastify.post('/api/pcap/captures', {
    schema: {
      tags: ['Packet Capture'],
      summary: 'Start a new packet capture',
      security: [{ bearerAuth: [] }],
      body: StartCaptureRequestSchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const parsed = StartCaptureRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.issues });
    }

    try {
      // Edge Async endpoints lack persistent Docker proxy tunnels — the sidecar approach
      // still requires Docker API access (container create/start/stop), which maps to the
      // same 'exec' capability gate (non-async endpoint with live Docker proxy).
      await assertCapability(parsed.data.endpointId, 'exec');

      const capture = await startCapture(parsed.data);

      writeAuditLog({
        user_id: request.user?.sub,
        username: request.user?.username,
        action: 'pcap.start',
        target_type: 'container',
        target_id: parsed.data.containerId,
        details: {
          captureId: capture.id,
          containerId: parsed.data.containerId,
          containerName: parsed.data.containerName,
          filter: parsed.data.filter,
          durationSeconds: parsed.data.durationSeconds,
        },
        request_id: request.requestId,
        ip_address: request.ip,
      });

      return capture;
    } catch (err) {
      // getErrorStatusCode honours both `statusCode` (HttpError, capability
      // guard) and `status` (PortainerError) — previously the `.status`
      // spelling was missed and upstream Portainer failures were misreported
      // as 400 Bad Request (#1511).
      const statusCode = getErrorStatusCode(err) ?? 400;
      const message = err instanceof Error ? err.message : 'Failed to start capture';
      if (statusCode !== 422) {
        log.error({ err }, 'Failed to start capture');
      }
      if (statusCode >= 500) {
        // Mask upstream 5xx messages like the global error handler does —
        // raw PortainerError text can carry internal hostnames (#1518).
        return reply.status(statusCode).send({ error: 'Failed to start capture', details: errorDetails(err) });
      }
      return reply.status(statusCode).send({ error: message });
    }
  });

  // List captures
  fastify.get('/api/pcap/captures', {
    schema: {
      tags: ['Packet Capture'],
      summary: 'List packet captures',
      security: [{ bearerAuth: [] }],
      querystring: CaptureListQuerySchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request) => {
    const query = request.query as Record<string, unknown>;
    const parsed = CaptureListQuerySchema.safeParse(query);
    const options = parsed.success ? parsed.data : { limit: 50, offset: 0 };

    const captures = await listCaptures(options);
    return { captures };
  });

  // Get single capture
  fastify.get('/api/pcap/captures/:id', {
    schema: {
      tags: ['Packet Capture'],
      summary: 'Get capture details',
      security: [{ bearerAuth: [] }],
      params: ActionIdParamsSchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const capture = await getCaptureById(id);

    if (!capture) {
      return reply.status(404).send({ error: 'Capture not found' });
    }

    return capture;
  });

  // Stop capture
  fastify.post('/api/pcap/captures/:id/stop', {
    schema: {
      tags: ['Packet Capture'],
      summary: 'Stop an active capture',
      security: [{ bearerAuth: [] }],
      params: ActionIdParamsSchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const capture = await stopCapture(id);

      writeAuditLog({
        user_id: request.user?.sub,
        username: request.user?.username,
        action: 'pcap.stop',
        target_type: 'capture',
        target_id: id,
        details: {
          containerId: capture.container_id,
          containerName: capture.container_name,
        },
        request_id: request.requestId,
        ip_address: request.ip,
      });

      return capture;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to stop capture';
      return reply.status(400).send({ error: message });
    }
  });

  // Download capture file
  fastify.get('/api/pcap/captures/:id/download', {
    schema: {
      tags: ['Packet Capture'],
      summary: 'Download capture PCAP file',
      security: [{ bearerAuth: [] }],
      params: ActionIdParamsSchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const filePath = await getCaptureFilePath(id);

    if (!filePath) {
      return reply.status(404).send({ error: 'Capture file not found' });
    }

    const capture = await getCaptureById(id);
    const filename = capture?.capture_file || `capture_${id}.pcap`;

    const stream = fs.createReadStream(filePath);
    reply.header('Content-Type', 'application/vnd.tcpdump.pcap');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    return reply.send(stream);
  });

  // Analyze capture with AI
  fastify.post('/api/pcap/captures/:id/analyze', {
    schema: {
      tags: ['Packet Capture'],
      summary: 'Run AI analysis on a completed capture',
      security: [{ bearerAuth: [] }],
      params: ActionIdParamsSchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const result = await analyzeCapture(id, opts.llm);

      writeAuditLog({
        user_id: request.user?.sub,
        username: request.user?.username,
        action: 'pcap.analyze',
        target_type: 'capture',
        target_id: id,
        details: {
          healthStatus: result.health_status,
          findingsCount: result.findings.length,
          confidence: result.confidence_score,
        },
        request_id: request.requestId,
        ip_address: request.ip,
      });

      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to analyze capture';
      log.error({ err, captureId: id }, 'Failed to analyze capture');
      return reply.status(400).send({ error: message });
    }
  });

  // Delete capture
  fastify.delete('/api/pcap/captures/:id', {
    schema: {
      tags: ['Packet Capture'],
      summary: 'Delete a capture and its file',
      security: [{ bearerAuth: [] }],
      params: ActionIdParamsSchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const capture = await getCaptureById(id);
      await deleteCaptureById(id);

      writeAuditLog({
        user_id: request.user?.sub,
        username: request.user?.username,
        action: 'pcap.delete',
        target_type: 'capture',
        target_id: id,
        details: {
          containerId: capture?.container_id,
          containerName: capture?.container_name,
        },
        request_id: request.requestId,
        ip_address: request.ip,
      });

      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete capture';
      return reply.status(400).send({ error: message });
    }
  });
}
