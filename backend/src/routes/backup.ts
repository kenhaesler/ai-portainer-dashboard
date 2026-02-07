import { FastifyInstance } from 'fastify';
import fs from 'fs';
import path from 'path';
import { getConfig } from '../config/index.js';
import { getDb } from '../db/sqlite.js';
import { writeAuditLog } from '../services/audit-logger.js';
import { createChildLogger } from '../utils/logger.js';
import { FilenameParamsSchema } from '../models/api-schemas.js';

const log = createChildLogger('backup-route');

function getBackupDir() {
  const config = getConfig();
  const dir = path.join(path.dirname(config.SQLITE_PATH), 'backups');
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
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const config = getConfig();
    const db = getDb();
    const backupDir = getBackupDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup-${timestamp}.db`;
    const backupPath = path.join(backupDir, filename);

    // Checkpoint WAL before backup
    db.pragma('wal_checkpoint(TRUNCATE)');
    fs.copyFileSync(config.SQLITE_PATH, backupPath);

    writeAuditLog({
      user_id: request.user?.sub,
      username: request.user?.username,
      action: 'backup.create',
      details: { filename },
      request_id: request.requestId,
      ip_address: request.ip,
    });

    log.info({ filename }, 'Backup created');
    return { success: true, filename, size: fs.statSync(backupPath).size };
  });

  // List backups
  fastify.get('/api/backup', {
    schema: {
      tags: ['Backup'],
      summary: 'List available backups',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async () => {
    const backupDir = getBackupDir();
    const files = fs.readdirSync(backupDir)
      .filter((f) => f.endsWith('.db'))
      .map((f) => {
        const stat = fs.statSync(path.join(backupDir, f));
        return { filename: f, size: stat.size, created: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.created.localeCompare(a.created));

    return { backups: files };
  });

  // Download backup
  fastify.get('/api/backup/:filename', {
    schema: {
      tags: ['Backup'],
      summary: 'Download a backup file',
      security: [{ bearerAuth: [] }],
      params: FilenameParamsSchema,
    },
    preHandler: [fastify.authenticate],
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

  // Delete backup
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
    const config = getConfig();
    const db = getDb();
    const backupDir = getBackupDir();
    const filePath = resolveBackupFilePath(backupDir, filename);

    if (!filePath) {
      return reply.code(400).send({ error: 'Invalid backup filename' });
    }

    if (!fs.existsSync(filePath)) {
      return reply.code(404).send({ error: 'Backup not found' });
    }

    // Flush WAL to reduce restore corruption risk.
    db.pragma('wal_checkpoint(TRUNCATE)');
    fs.copyFileSync(filePath, config.SQLITE_PATH);

    writeAuditLog({
      user_id: request.user?.sub,
      username: request.user?.username,
      action: 'backup.restore',
      details: { filename },
      request_id: request.requestId,
      ip_address: request.ip,
    });

    log.warn({ filename }, 'Backup restored. Application restart recommended');
    return { success: true, message: 'Backup restored. Please restart the application.' };
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

    fs.unlinkSync(filePath);

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
