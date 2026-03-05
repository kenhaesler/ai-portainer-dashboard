import { FastifyInstance } from 'fastify';
import { listUsers, createUser, updateUser, deleteUser, type Role } from '@dashboard/core/services/user-store.js';
import { writeAuditLog } from '@dashboard/core/services/audit-logger.js';
import { UserCreateBodySchema, UserIdParamsSchema, UserUpdateBodySchema } from '@dashboard/core/models/api-schemas.js';

export async function userRoutes(fastify: FastifyInstance) {
  // List all users (admin only)
  fastify.get('/api/users', {
    schema: {
      tags: ['Users'],
      summary: 'List all users',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async () => {
    return await listUsers();
  });

  // Create a user (admin only)
  fastify.post('/api/users', {
    schema: {
      tags: ['Users'],
      summary: 'Create a new user',
      security: [{ bearerAuth: [] }],
      body: UserCreateBodySchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const { username, password, role } = request.body as { username: string; password: string; role: Role };

    try {
      const user = await createUser(username, password, role);
      writeAuditLog({
        user_id: request.user!.sub,
        username: request.user!.username,
        action: 'user.create',
        target_type: 'user',
        target_id: user.id,
        details: { newUsername: username, role },
        request_id: request.requestId,
        ip_address: request.ip,
      });
      return reply.status(201).send(user);
    } catch (err) {
      // PostgreSQL unique violation (23505); also handles legacy SQLite 'UNIQUE constraint' messages
      if ((err as { code?: string }).code === '23505' || (err instanceof Error && err.message.includes('UNIQUE constraint'))) {
        return reply.status(409).send({ error: 'Username already exists' });
      }
      throw err;
    }
  });

  // Update a user (admin only)
  fastify.patch('/api/users/:id', {
    schema: {
      tags: ['Users'],
      summary: 'Update a user',
      security: [{ bearerAuth: [] }],
      params: UserIdParamsSchema,
      body: UserUpdateBodySchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { username?: string; password?: string; role?: Role };

    let user;
    try {
      user = await updateUser(id, body);
    } catch (err) {
      // PostgreSQL unique violation (23505); also handles legacy SQLite 'UNIQUE constraint' messages
      if ((err as { code?: string }).code === '23505' || (err instanceof Error && err.message.includes('UNIQUE constraint'))) {
        return reply.status(409).send({ error: 'Username already exists' });
      }
      throw err;
    }
    if (!user) return reply.status(404).send({ error: 'User not found' });

    writeAuditLog({
      user_id: request.user!.sub,
      username: request.user!.username,
      action: 'user.update',
      target_type: 'user',
      target_id: id,
      details: { updatedFields: Object.keys(body) },
      request_id: request.requestId,
      ip_address: request.ip,
    });

    return user;
  });

  // Delete a user (admin only, cannot delete self)
  fastify.delete('/api/users/:id', {
    schema: {
      tags: ['Users'],
      summary: 'Delete a user',
      security: [{ bearerAuth: [] }],
      params: UserIdParamsSchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    if (request.user!.sub === id) {
      return reply.status(400).send({ error: 'Cannot delete your own account' });
    }

    const deleted = await deleteUser(id);
    if (!deleted) return reply.status(404).send({ error: 'User not found' });

    writeAuditLog({
      user_id: request.user!.sub,
      username: request.user!.username,
      action: 'user.delete',
      target_type: 'user',
      target_id: id,
      request_id: request.requestId,
      ip_address: request.ip,
    });

    return { success: true };
  });
}
