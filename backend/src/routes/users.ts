import { FastifyInstance } from 'fastify';
import { listUsers, createUser, updateUser, deleteUser, getUserById, type Role } from '../services/user-store.js';
import { writeAuditLog } from '../services/audit-logger.js';

const VALID_ROLES: Role[] = ['viewer', 'operator', 'admin'];

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
    return listUsers();
  });

  // Create a user (admin only)
  fastify.post('/api/users', {
    schema: {
      tags: ['Users'],
      summary: 'Create a new user',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['username', 'password', 'role'],
        properties: {
          username: { type: 'string', minLength: 1, maxLength: 50 },
          password: { type: 'string', minLength: 8, maxLength: 128 },
          role: { type: 'string', enum: VALID_ROLES },
        },
      },
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
      if (err instanceof Error && err.message.includes('UNIQUE constraint')) {
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
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      body: {
        type: 'object',
        properties: {
          username: { type: 'string', minLength: 1, maxLength: 50 },
          password: { type: 'string', minLength: 8, maxLength: 128 },
          role: { type: 'string', enum: VALID_ROLES },
        },
      },
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { username?: string; password?: string; role?: Role };

    const user = await updateUser(id, body);
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
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    if (request.user!.sub === id) {
      return reply.status(400).send({ error: 'Cannot delete your own account' });
    }

    const deleted = deleteUser(id);
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
