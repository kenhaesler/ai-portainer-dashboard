import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';
import { userRoutes } from './users.js';

// Kept: user-store mock — no PostgreSQL in CI
vi.mock('@dashboard/core/services/user-store.js', () => ({
  listUsers: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
  getUserById: vi.fn(),
  hasMinRole: vi.fn(() => true),
  roleLevel: vi.fn((r: string) => r === 'admin' ? 2 : r === 'operator' ? 1 : 0),
}));

// Kept: audit-logger mock — side-effect isolation
vi.mock('@dashboard/core/services/audit-logger.js', () => ({
  writeAuditLog: vi.fn(),
}));

import { listUsers, createUser, updateUser, deleteUser } from '@dashboard/core/services/user-store.js';

const mockListUsers = vi.mocked(listUsers);
const mockCreateUser = vi.mocked(createUser);
const mockUpdateUser = vi.mocked(updateUser);
const mockDeleteUser = vi.mocked(deleteUser);

async function buildTestApp() {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.decorate('authenticate', async () => undefined);
  app.decorate('requireRole', () => async () => undefined);
  app.decorateRequest('user', undefined);
  app.addHook('preHandler', async (request) => {
    request.user = { sub: 'admin-id', username: 'admin', sessionId: 'sess-1', role: 'admin' as const };
  });
  await app.register(userRoutes);
  return app;
}

describe('userRoutes', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /api/users', () => {
    it('should list users', async () => {
      mockListUsers.mockResolvedValue([
        { id: 'u1', username: 'admin', role: 'admin', default_landing_page: '/', created_at: '', updated_at: '' },
      ]);

      const res = await app.inject({ method: 'GET', url: '/api/users' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(1);
    });
  });

  describe('POST /api/users', () => {
    it('should create a user', async () => {
      mockCreateUser.mockResolvedValue({
        id: 'u2', username: 'newuser', role: 'viewer', default_landing_page: '/', created_at: '', updated_at: '',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/users',
        payload: { username: 'newuser', password: 'password123', role: 'viewer' },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().username).toBe('newuser');
    });

    it('should return 409 when username already exists (PostgreSQL error code 23505)', async () => {
      const pgUniqueError = Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
      mockCreateUser.mockRejectedValue(pgUniqueError);

      const res = await app.inject({
        method: 'POST',
        url: '/api/users',
        payload: { username: 'existing', password: 'password123', role: 'viewer' },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe('Username already exists');
    });

    it('should return 409 when username already exists (legacy SQLite UNIQUE constraint message)', async () => {
      mockCreateUser.mockRejectedValue(new Error('UNIQUE constraint failed: users.username'));

      const res = await app.inject({
        method: 'POST',
        url: '/api/users',
        payload: { username: 'existing', password: 'password123', role: 'viewer' },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe('Username already exists');
    });
  });

  describe('PATCH /api/users/:id', () => {
    it('should update a user', async () => {
      mockUpdateUser.mockResolvedValue({
        id: 'u1', username: 'admin', role: 'operator', default_landing_page: '/', created_at: '', updated_at: '',
      });

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/users/u1',
        payload: { role: 'operator' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().role).toBe('operator');
    });

    it('should return 404 for non-existent user', async () => {
      mockUpdateUser.mockResolvedValue(undefined);

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/users/nonexist',
        payload: { role: 'viewer' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('should return 409 when new username already exists (PostgreSQL error code 23505)', async () => {
      const pgUniqueError = Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
      mockUpdateUser.mockRejectedValue(pgUniqueError);

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/users/u1',
        payload: { username: 'existing-user' },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe('Username already exists');
    });

    it('should return 409 when new username already exists (legacy SQLite UNIQUE constraint message)', async () => {
      mockUpdateUser.mockRejectedValue(new Error('UNIQUE constraint failed: users.username'));

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/users/u1',
        payload: { username: 'existing-user' },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe('Username already exists');
    });
  });

  describe('DELETE /api/users/:id', () => {
    it('should delete a user', async () => {
      mockDeleteUser.mockResolvedValue(true);

      const res = await app.inject({ method: 'DELETE', url: '/api/users/u2' });
      expect(res.statusCode).toBe(200);
    });

    it('should prevent deleting own account', async () => {
      const res = await app.inject({ method: 'DELETE', url: '/api/users/admin-id' });
      expect(res.statusCode).toBe(400);
    });

    it('should return 404 for non-existent user', async () => {
      mockDeleteUser.mockResolvedValue(false);

      const res = await app.inject({ method: 'DELETE', url: '/api/users/nonexist' });
      expect(res.statusCode).toBe(404);
    });
  });
});
