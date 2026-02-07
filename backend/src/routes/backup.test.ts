import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';

let sqlitePath = '';
const mockPragma = vi.fn();
const mockWriteAuditLog = vi.fn();

vi.mock('../config/index.js', () => ({
  getConfig: () => ({ SQLITE_PATH: sqlitePath }),
}));

vi.mock('../db/sqlite.js', () => ({
  getDb: () => ({
    pragma: (...args: unknown[]) => mockPragma(...args),
  }),
}));

vi.mock('../services/audit-logger.js', () => ({
  writeAuditLog: (...args: unknown[]) => mockWriteAuditLog(...args),
}));

vi.mock('../utils/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { backupRoutes } from './backup.js';

describe('backup routes', () => {
  let app: FastifyInstance;
  let tempDir: string;
  let currentRole: 'viewer' | 'operator' | 'admin';

  beforeEach(async () => {
    currentRole = 'admin';
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-route-test-'));
    sqlitePath = path.join(tempDir, 'dashboard.db');
    fs.writeFileSync(sqlitePath, 'current-db-content');

    const backupDir = path.join(tempDir, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, 'backup-1.db'), 'restored-db-content');

    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.decorate('authenticate', async () => undefined);
    app.decorate('requireRole', (minRole: 'viewer' | 'operator' | 'admin') => async (request, reply) => {
      const rank = { viewer: 0, operator: 1, admin: 2 };
      const userRole = request.user?.role ?? 'viewer';
      if (rank[userRole] < rank[minRole]) {
        reply.code(403).send({ error: 'Insufficient permissions' });
      }
    });
    app.decorateRequest('user', undefined);
    app.addHook('preHandler', async (request) => {
      request.user = {
        sub: 'user-1',
        username: 'operator',
        sessionId: 'session-1',
        role: currentRole,
      };
    });

    await app.register(backupRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('restores the selected backup file', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/backup/backup-1.db/restore',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ success: true });
    expect(fs.readFileSync(sqlitePath, 'utf8')).toBe('restored-db-content');
    expect(mockPragma).toHaveBeenCalledWith('wal_checkpoint(TRUNCATE)');
    expect(mockWriteAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'backup.restore',
      details: { filename: 'backup-1.db' },
    }));
  });

  it('returns 404 when restore backup does not exist', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/backup/missing.db/restore',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'Backup not found' });
  });

  it('rejects traversal attempts on download endpoint', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/backup/..%2F..%2Fetc%2Fpasswd',
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects traversal attempts on restore endpoint', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/backup/..%2F..%2Fetc%2Fpasswd/restore',
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects traversal attempts on delete endpoint', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/backup/..%2F..%2Fetc%2Fpasswd',
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects restore for non-admin users', async () => {
    currentRole = 'viewer';
    const response = await app.inject({
      method: 'POST',
      url: '/api/backup/backup-1.db/restore',
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'Insufficient permissions' });
  });

  it('rejects delete for non-admin users', async () => {
    currentRole = 'viewer';
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/backup/backup-1.db',
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'Insufficient permissions' });
  });
});
