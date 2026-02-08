import fs from 'fs';
import { FastifyInstance } from 'fastify';
import { StartCaptureRequestSchema, CaptureListQuerySchema } from '../models/pcap.js';
import { ActionIdParamsSchema } from '../models/api-schemas.js';
import {
  startCapture,
  stopCapture,
  getCaptureById,
  listCaptures,
  deleteCaptureById,
  getCaptureFilePath,
} from '../services/pcap-service.js';
import { analyzeCapture } from '../services/pcap-analysis-service.js';
import { writeAuditLog } from '../services/audit-logger.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('pcap-route');

export async function pcapRoutes(fastify: FastifyInstance) {
  // Start a new capture
  fastify.post('/api/pcap/captures', {
    schema: {
      tags: ['Packet Capture'],
      summary: 'Start a new packet capture',
      security: [{ bearerAuth: [] }],
      body: StartCaptureRequestSchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const parsed = StartCaptureRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.issues });
    }

    try {
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
      const message = err instanceof Error ? err.message : 'Failed to start capture';
      log.error({ err }, 'Failed to start capture');
      return reply.status(400).send({ error: message });
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
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const query = request.query as Record<string, unknown>;
    const parsed = CaptureListQuerySchema.safeParse(query);
    const options = parsed.success ? parsed.data : { limit: 50, offset: 0 };

    const captures = listCaptures(options);
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
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const capture = getCaptureById(id);

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
    preHandler: [fastify.authenticate],
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
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const filePath = getCaptureFilePath(id);

    if (!filePath) {
      return reply.status(404).send({ error: 'Capture file not found' });
    }

    const capture = getCaptureById(id);
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
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const result = await analyzeCapture(id);

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
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const capture = getCaptureById(id);
      deleteCaptureById(id);

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
