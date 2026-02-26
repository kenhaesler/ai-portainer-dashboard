import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testAdminOnly } from '../../../test-utils/rbac-test-helper.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';

const mockWriteAuditLog = vi.fn();

// Kept: audit-logger mock — side-effect isolation
vi.mock('@dashboard/core/services/audit-logger.js', () => ({
  writeAuditLog: (...args: unknown[]) => mockWriteAuditLog(...args),
}));

// Mock the portainer-backup service
const mockCreatePortainerBackup = vi.fn();
const mockListPortainerBackups = vi.fn();
const mockGetPortainerBackupPath = vi.fn();
const mockDeletePortainerBackup = vi.fn();

// Kept: portainer-backup mock — no Portainer API in CI
vi.mock('../services/portainer-backup.js', () => ({
  createPortainerBackup: (...args: unknown[]) => mockCreatePortainerBackup(...args),
  listPortainerBackups: (...args: unknown[]) => mockListPortainerBackups(...args),
  getPortainerBackupPath: (...args: unknown[]) => mockGetPortainerBackupPath(...args),
  deletePortainerBackup: (...args: unknown[]) => mockDeletePortainerBackup(...args),
}));

import { portainerBackupRoutes } from '../routes/portainer-backup.js';

describe('portainer-backup routes', () => {
  let app: FastifyInstance;
  let tempDir: string;
  let currentRole: 'viewer' | 'operator' | 'admin';

  beforeEach(async () => {
    currentRole = 'admin';
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'portainer-backup-test-'));
    // Create a test backup file for download tests
    const backupDir = path.join(tempDir, 'portainer-backups');
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, 'test-backup.tar.gz'), 'fake-backup-content');

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

    await app.register(portainerBackupRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  describe('POST /api/portainer-backup', () => {
    it('creates a backup successfully', async () => {
      mockCreatePortainerBackup.mockResolvedValueOnce({
        filename: 'portainer-backup-2024.tar.gz',
        size: 12345,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/portainer-backup',
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        success: true,
        filename: 'portainer-backup-2024.tar.gz',
        size: 12345,
      });
      expect(mockCreatePortainerBackup).toHaveBeenCalledWith(undefined);
      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'portainer_backup.create',
          details: { filename: 'portainer-backup-2024.tar.gz' },
        }),
      );
    });

    it('passes password to service when provided', async () => {
      mockCreatePortainerBackup.mockResolvedValueOnce({
        filename: 'portainer-backup-encrypted.tar.gz',
        size: 54321,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/portainer-backup',
        payload: { password: 'my-secret' },
      });

      expect(response.statusCode).toBe(200);
      expect(mockCreatePortainerBackup).toHaveBeenCalledWith('my-secret');
    });

    it('returns 502 when Portainer API fails', async () => {
      mockCreatePortainerBackup.mockRejectedValueOnce(
        new Error('Portainer backup failed: HTTP 500'),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/portainer-backup',
        payload: {},
      });

      expect(response.statusCode).toBe(502);
      expect(response.json()).toEqual({
        error: expect.stringContaining('Failed to create Portainer backup'),
      });
    });

    testAdminOnly(() => app, (r) => { currentRole = r; }, 'POST', '/api/portainer-backup', {});
  });

  describe('GET /api/portainer-backup', () => {
    it('lists backups', async () => {
      mockListPortainerBackups.mockReturnValueOnce([
        { filename: 'backup-1.tar.gz', size: 1000, createdAt: '2024-01-01T00:00:00.000Z' },
        { filename: 'backup-2.tar.gz', size: 2000, createdAt: '2024-01-02T00:00:00.000Z' },
      ]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/portainer-backup',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        backups: [
          { filename: 'backup-1.tar.gz', size: 1000, createdAt: '2024-01-01T00:00:00.000Z' },
          { filename: 'backup-2.tar.gz', size: 2000, createdAt: '2024-01-02T00:00:00.000Z' },
        ],
      });
    });

    it('returns empty list when no backups', async () => {
      mockListPortainerBackups.mockReturnValueOnce([]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/portainer-backup',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ backups: [] });
    });

    testAdminOnly(() => app, (r) => { currentRole = r; }, 'GET', '/api/portainer-backup');
  });

  describe('GET /api/portainer-backup/:filename', () => {
    it('streams backup file for download', async () => {
      const filePath = path.join(tempDir, 'portainer-backups', 'test-backup.tar.gz');
      mockGetPortainerBackupPath.mockReturnValueOnce(filePath);

      const response = await app.inject({
        method: 'GET',
        url: '/api/portainer-backup/test-backup.tar.gz',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('application/gzip');
      expect(response.headers['content-disposition']).toBe('attachment; filename="test-backup.tar.gz"');
      expect(response.body).toBe('fake-backup-content');
    });

    it('returns 404 when file not found', async () => {
      mockGetPortainerBackupPath.mockImplementationOnce(() => {
        throw new Error('Portainer backup not found: missing.tar.gz');
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/portainer-backup/missing.tar.gz',
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'Portainer backup not found' });
    });

    it('returns 400 for path traversal attempt', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/portainer-backup/..%2F..%2Fetc%2Fpasswd',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: 'Bad Request',
        message: expect.stringContaining('filename must be a .tar.gz file'),
      });
    });

    testAdminOnly(() => app, (r) => { currentRole = r; }, 'GET', '/api/portainer-backup/test-backup.tar.gz');
  });

  describe('DELETE /api/portainer-backup/:filename', () => {
    it('deletes backup successfully', async () => {
      mockDeletePortainerBackup.mockReturnValueOnce(undefined);

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/portainer-backup/test-backup.tar.gz',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ success: true });
      expect(mockDeletePortainerBackup).toHaveBeenCalledWith('test-backup.tar.gz');
      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'portainer_backup.delete',
          details: { filename: 'test-backup.tar.gz' },
        }),
      );
    });

    it('returns 404 when backup not found', async () => {
      mockDeletePortainerBackup.mockImplementationOnce(() => {
        throw new Error('Portainer backup not found: missing.tar.gz');
      });

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/portainer-backup/missing.tar.gz',
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'Portainer backup not found' });
    });

    testAdminOnly(() => app, (r) => { currentRole = r; }, 'DELETE', '/api/portainer-backup/test-backup.tar.gz');
  });
});
