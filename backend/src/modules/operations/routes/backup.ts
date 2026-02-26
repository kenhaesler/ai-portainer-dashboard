import { FastifyInstance } from 'fastify';
import fs from 'fs';
import path from 'path';
import { writeAuditLog } from '@dashboard/core/services/audit-logger.js';
import { createBackup, listBackups, restoreBackup, deleteBackup } from '../services/backup-service.js';
import { createChildLogger } from '@dashboard/core/utils/logger.js';
import { FilenameParamsSchema } from '@dashboard/core/models/api-schemas.js';

const log = createChildLogger('backup-route');

function getBackupDir() {
  const dir = path.join(process.cwd(), 'data', 'backups');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function resolveBackupFilePath(backupDir: string, filename: string): string | null {
  const resolvedBackupDir = path.resolve(backupDir);
  const filePath = path.resolve(backupDir, filename);

  if (!filePath.startsWith(`${resolvedBackupDir}${path.sep}`)) {
    return null;
  }

  return filePath;
}

export async function backupRoutes(fastify: FastifyInstance) {
  // Create backup
  fastify.post('/api/backup', {
    schema: {
      tags: ['Backup'],
      summary: 'Create a database backup',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request) => {
    const filename = await createBackup();
    const backupDir = getBackupDir();
    const backupPath = path.join(backupDir, filename);
    const size = fs.statSync(backupPath).size;

    writeAuditLog({
      user_id: request.user?.sub,
      username: request.user?.username,
      action: 'backup.create',
      details: { filename },
      request_id: request.requestId,
      ip_address: request.ip,
    });

    log.info({ filename }, 'Backup created');
    return { success: true, filename, size };
  });

  // List backups
  fastify.get('/api/backup', {
    schema: {
      tags: ['Backup'],
      summary: 'List available backups',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async () => {
    const backups = listBackups().map((b) => ({
      filename: b.filename,
      size: b.size,
      created: b.createdAt,
    }));

    return { backups };
  });

  // Download backup
  fastify.get('/api/backup/:filename', {
    schema: {
      tags: ['Backup'],
      summary: 'Download a backup file',
      security: [{ bearerAuth: [] }],
      params: FilenameParamsSchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const { filename } = request.params as { filename: string };
    const backupDir = getBackupDir();
    const filePath = resolveBackupFilePath(backupDir, filename);

    if (!filePath) {
      return reply.code(400).send({ error: 'Invalid backup filename' });
    }

    if (!fs.existsSync(filePath)) {
      return reply.code(404).send({ error: 'Backup not found' });
    }

    const stream = fs.createReadStream(filePath);
    reply.header('Content-Type', 'application/octet-stream');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    return reply.send(stream);
  });

  // Restore backup
  fastify.post('/api/backup/:filename/restore', {
    schema: {
      tags: ['Backup'],
      summary: 'Restore database from backup file',
      security: [{ bearerAuth: [] }],
      params: FilenameParamsSchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const { filename } = request.params as { filename: string };
    const backupDir = getBackupDir();
    const filePath = resolveBackupFilePath(backupDir, filename);

    if (!filePath) {
      return reply.code(400).send({ error: 'Invalid backup filename' });
    }

    if (!fs.existsSync(filePath)) {
      return reply.code(404).send({ error: 'Backup not found' });
    }

    await restoreBackup(filename);

    writeAuditLog({
      user_id: request.user?.sub,
      username: request.user?.username,
      action: 'backup.restore',
      details: { filename },
      request_id: request.requestId,
      ip_address: request.ip,
    });

    log.warn({ filename }, 'Backup restored');
    return { success: true, message: 'Backup restored successfully.' };
  });

  // Delete backup
  fastify.delete('/api/backup/:filename', {
    schema: {
      tags: ['Backup'],
      summary: 'Delete a backup file',
      security: [{ bearerAuth: [] }],
      params: FilenameParamsSchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const { filename } = request.params as { filename: string };
    const backupDir = getBackupDir();
    const filePath = resolveBackupFilePath(backupDir, filename);

    if (!filePath) {
      return reply.code(400).send({ error: 'Invalid backup filename' });
    }

    if (!fs.existsSync(filePath)) {
      return reply.code(404).send({ error: 'Backup not found' });
    }

    deleteBackup(filename);

    writeAuditLog({
      user_id: request.user?.sub,
      username: request.user?.username,
      action: 'backup.delete',
      details: { filename },
      request_id: request.requestId,
      ip_address: request.ip,
    });

    return { success: true };
  });
}
