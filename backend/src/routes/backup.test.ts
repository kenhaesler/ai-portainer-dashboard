import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';

const mockWriteAuditLog = vi.fn();
const mockCreateBackup = vi.fn();
const mockListBackups = vi.fn();
const mockRestoreBackup = vi.fn();
const mockDeleteBackup = vi.fn();

let cwdValue = '';

vi.mock('../services/audit-logger.js', () => ({
  writeAuditLog: (...args: unknown[]) => mockWriteAuditLog(...args),
}));

vi.mock('../services/backup-service.js', () => ({
  createBackup: (...args: unknown[]) => mockCreateBackup(...args),
  listBackups: (...args: unknown[]) => mockListBackups(...args),
  restoreBackup: (...args: unknown[]) => mockRestoreBackup(...args),
  deleteBackup: (...args: unknown[]) => mockDeleteBackup(...args),
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
    cwdValue = tempDir;

    // Create the data/backups directory that getBackupDir() will use
    const backupDir = path.join(tempDir, 'data', 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, 'backup-1.dump'), 'pg-dump-content');

    // Mock process.cwd() so getBackupDir() resolves to our temp dir
    vi.spyOn(process, 'cwd').mockReturnValue(cwdValue);

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
    vi.restoreAllMocks();
  });

  it('creates a backup via pg_dump', async () => {
    const backupDir = path.join(tempDir, 'data', 'backups');
    const dumpFile = path.join(backupDir, 'dashboard-backup-test.dump');
    fs.writeFileSync(dumpFile, 'fake-pg-dump-data');

    mockCreateBackup.mockResolvedValue('dashboard-backup-test.dump');

    const response = await app.inject({
      method: 'POST',
      url: '/api/backup',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.filename).toBe('dashboard-backup-test.dump');
    expect(body.size).toBeGreaterThan(0);
    expect(mockCreateBackup).toHaveBeenCalled();
    expect(mockWriteAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'backup.create',
      details: { filename: 'dashboard-backup-test.dump' },
    }));
  });

  it('lists backups', async () => {
    mockListBackups.mockReturnValue([
      { filename: 'backup-1.dump', size: 1024, createdAt: '2026-01-01T00:00:00.000Z' },
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/backup',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.backups).toHaveLength(1);
    expect(body.backups[0].filename).toBe('backup-1.dump');
  });

  it('restores a backup via pg_restore', async () => {
    mockRestoreBackup.mockResolvedValue(undefined);

    const response = await app.inject({
      method: 'POST',
      url: '/api/backup/backup-1.dump/restore',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ success: true });
    expect(mockRestoreBackup).toHaveBeenCalledWith('backup-1.dump');
    expect(mockWriteAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'backup.restore',
      details: { filename: 'backup-1.dump' },
    }));
  });

  it('returns 404 when restore backup does not exist', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/backup/missing.dump/restore',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'Backup not found' });
  });

  it('deletes a backup', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/backup/backup-1.dump',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true });
    expect(mockDeleteBackup).toHaveBeenCalledWith('backup-1.dump');
    expect(mockWriteAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'backup.delete',
      details: { filename: 'backup-1.dump' },
    }));
  });

  it('rejects create for non-admin users', async () => {
    currentRole = 'viewer';
    const response = await app.inject({
      method: 'POST',
      url: '/api/backup',
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'Insufficient permissions' });
  });

  it('rejects list for non-admin users', async () => {
    currentRole = 'viewer';
    const response = await app.inject({
      method: 'GET',
      url: '/api/backup',
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'Insufficient permissions' });
  });

  it('rejects download for non-admin users', async () => {
    currentRole = 'viewer';
    const response = await app.inject({
      method: 'GET',
      url: '/api/backup/backup-1.dump',
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'Insufficient permissions' });
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
      url: '/api/backup/backup-1.dump/restore',
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'Insufficient permissions' });
  });

  it('rejects delete for non-admin users', async () => {
    currentRole = 'viewer';
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/backup/backup-1.dump',
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'Insufficient permissions' });
  });
});
