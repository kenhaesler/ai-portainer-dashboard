import { FastifyInstance } from 'fastify';
import fs from 'fs';
import { z } from 'zod';
import { writeAuditLog } from '../services/audit-logger.js';
import { createChildLogger } from '../utils/logger.js';
import {
  createPortainerBackup,
  listPortainerBackups,
  getPortainerBackupPath,
  deletePortainerBackup,
} from '../services/portainer-backup.js';
import { FilenameParamsSchema } from '../models/api-schemas.js';

const log = createChildLogger('portainer-backup-route');

const CreateBackupBodySchema = z.object({
  password: z.string().optional(),
});

export async function portainerBackupRoutes(fastify: FastifyInstance) {
  // Create Portainer backup
  fastify.post('/api/portainer-backup', {
    schema: {
      tags: ['Portainer Backup'],
      summary: 'Create a Portainer server backup',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    try {
      const body = CreateBackupBodySchema.parse(request.body ?? {});
      const result = await createPortainerBackup(body.password);

      writeAuditLog({
        user_id: request.user?.sub,
        username: request.user?.username,
        action: 'portainer_backup.create',
        details: { filename: result.filename },
        request_id: request.requestId,
        ip_address: request.ip,
      });

      log.info({ filename: result.filename }, 'Portainer backup created');
      return { success: true, filename: result.filename, size: result.size };
    } catch (err) {
      log.error({ err }, 'Failed to create Portainer backup');
      return reply.code(502).send({
        error: `Failed to create Portainer backup: ${err instanceof Error ? err.message : 'Unknown error'}`,
      });
    }
  });

  // List Portainer backups
  fastify.get('/api/portainer-backup', {
    schema: {
      tags: ['Portainer Backup'],
      summary: 'List available Portainer backups',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async () => {
    const backups = listPortainerBackups();
    return { backups };
  });

  // Download Portainer backup
  fastify.get('/api/portainer-backup/:filename', {
    schema: {
      tags: ['Portainer Backup'],
      summary: 'Download a Portainer backup file',
      security: [{ bearerAuth: [] }],
      params: FilenameParamsSchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { filename } = request.params as { filename: string };

    try {
      const filePath = getPortainerBackupPath(filename);
      const stream = fs.createReadStream(filePath);
      reply.header('Content-Type', 'application/gzip');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      return reply.send(stream);
    } catch (err) {
      if (err instanceof Error && err.message.includes('not found')) {
        return reply.code(404).send({ error: 'Portainer backup not found' });
      }
      if (err instanceof Error && err.message.includes('path traversal')) {
        return reply.code(400).send({ error: 'Invalid filename' });
      }
      throw err;
    }
  });

  // Delete Portainer backup
  fastify.delete('/api/portainer-backup/:filename', {
    schema: {
      tags: ['Portainer Backup'],
      summary: 'Delete a Portainer backup file',
      security: [{ bearerAuth: [] }],
      params: FilenameParamsSchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { filename } = request.params as { filename: string };

    try {
      deletePortainerBackup(filename);

      writeAuditLog({
        user_id: request.user?.sub,
        username: request.user?.username,
        action: 'portainer_backup.delete',
        details: { filename },
        request_id: request.requestId,
        ip_address: request.ip,
      });

      return { success: true };
    } catch (err) {
      if (err instanceof Error && err.message.includes('not found')) {
        return reply.code(404).send({ error: 'Portainer backup not found' });
      }
      if (err instanceof Error && err.message.includes('path traversal')) {
        return reply.code(400).send({ error: 'Invalid filename' });
      }
      throw err;
    }
  });
}
