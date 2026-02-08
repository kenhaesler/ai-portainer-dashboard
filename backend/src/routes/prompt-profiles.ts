import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  getAllProfiles,
  getProfileById,
  createProfile,
  updateProfile,
  deleteProfile,
  duplicateProfile,
  getActiveProfileId,
  switchProfile,
} from '../services/prompt-profile-store.js';
import { writeAuditLog } from '../services/audit-logger.js';

// ── Zod Schemas ──────────────────────────────────────────────────────

const ProfileIdParamsSchema = z.object({
  id: z.string(),
});

const CreateProfileBodySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).default(''),
  prompts: z.record(z.string(), z.object({
    systemPrompt: z.string(),
    model: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
  })).default({}),
});

const UpdateProfileBodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  prompts: z.record(z.string(), z.object({
    systemPrompt: z.string(),
    model: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
  })).optional(),
});

const DuplicateProfileBodySchema = z.object({
  name: z.string().min(1).max(100),
});

const SwitchProfileBodySchema = z.object({
  id: z.string().min(1),
});

// ── Routes ───────────────────────────────────────────────────────────

export async function promptProfileRoutes(fastify: FastifyInstance) {
  // List all profiles
  fastify.get('/api/prompt-profiles', {
    schema: {
      tags: ['Prompt Profiles'],
      summary: 'List all prompt profiles',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async () => {
    const profiles = getAllProfiles();
    const activeId = getActiveProfileId();
    return { profiles, activeProfileId: activeId };
  });

  // Get single profile
  fastify.get('/api/prompt-profiles/:id', {
    schema: {
      tags: ['Prompt Profiles'],
      summary: 'Get a prompt profile by ID',
      security: [{ bearerAuth: [] }],
      params: ProfileIdParamsSchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const profile = getProfileById(id);
    if (!profile) {
      return reply.code(404).send({ error: 'Profile not found' });
    }
    return profile;
  });

  // Create profile
  fastify.post('/api/prompt-profiles', {
    schema: {
      tags: ['Prompt Profiles'],
      summary: 'Create a new prompt profile',
      security: [{ bearerAuth: [] }],
      body: CreateProfileBodySchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const { name, description, prompts } = request.body as z.infer<typeof CreateProfileBodySchema>;

    try {
      const profile = createProfile(name, description, prompts);

      writeAuditLog({
        user_id: request.user?.sub,
        username: request.user?.username,
        action: 'prompt_profile.create',
        target_type: 'prompt_profile',
        target_id: profile.id,
        details: { name },
        request_id: request.requestId,
        ip_address: request.ip,
      });

      return reply.code(201).send(profile);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message.includes('UNIQUE constraint failed')) {
        return reply.code(409).send({ error: 'A profile with that name already exists' });
      }
      return reply.code(500).send({ error: message });
    }
  });

  // Update profile
  fastify.put('/api/prompt-profiles/:id', {
    schema: {
      tags: ['Prompt Profiles'],
      summary: 'Update a prompt profile',
      security: [{ bearerAuth: [] }],
      params: ProfileIdParamsSchema,
      body: UpdateProfileBodySchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const updates = request.body as z.infer<typeof UpdateProfileBodySchema>;

    try {
      const profile = updateProfile(id, updates);
      if (!profile) {
        return reply.code(404).send({ error: 'Profile not found' });
      }

      writeAuditLog({
        user_id: request.user?.sub,
        username: request.user?.username,
        action: 'prompt_profile.update',
        target_type: 'prompt_profile',
        target_id: id,
        details: { name: profile.name },
        request_id: request.requestId,
        ip_address: request.ip,
      });

      return profile;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message.includes('UNIQUE constraint failed')) {
        return reply.code(409).send({ error: 'A profile with that name already exists' });
      }
      return reply.code(500).send({ error: message });
    }
  });

  // Delete profile
  fastify.delete('/api/prompt-profiles/:id', {
    schema: {
      tags: ['Prompt Profiles'],
      summary: 'Delete a prompt profile',
      security: [{ bearerAuth: [] }],
      params: ProfileIdParamsSchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const profile = getProfileById(id);

    if (!profile) {
      return reply.code(404).send({ error: 'Profile not found' });
    }

    if (profile.isBuiltIn) {
      return reply.code(400).send({ error: 'Cannot delete built-in profiles' });
    }

    const deleted = deleteProfile(id);
    if (!deleted) {
      return reply.code(500).send({ error: 'Failed to delete profile' });
    }

    writeAuditLog({
      user_id: request.user?.sub,
      username: request.user?.username,
      action: 'prompt_profile.delete',
      target_type: 'prompt_profile',
      target_id: id,
      details: { name: profile.name },
      request_id: request.requestId,
      ip_address: request.ip,
    });

    return { success: true };
  });

  // Duplicate profile
  fastify.post('/api/prompt-profiles/:id/duplicate', {
    schema: {
      tags: ['Prompt Profiles'],
      summary: 'Duplicate a prompt profile',
      security: [{ bearerAuth: [] }],
      params: ProfileIdParamsSchema,
      body: DuplicateProfileBodySchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { name } = request.body as { name: string };

    try {
      const profile = duplicateProfile(id, name);
      if (!profile) {
        return reply.code(404).send({ error: 'Source profile not found' });
      }

      writeAuditLog({
        user_id: request.user?.sub,
        username: request.user?.username,
        action: 'prompt_profile.duplicate',
        target_type: 'prompt_profile',
        target_id: profile.id,
        details: { sourceId: id, name },
        request_id: request.requestId,
        ip_address: request.ip,
      });

      return reply.code(201).send(profile);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message.includes('UNIQUE constraint failed')) {
        return reply.code(409).send({ error: 'A profile with that name already exists' });
      }
      return reply.code(500).send({ error: message });
    }
  });

  // Switch active profile
  fastify.post('/api/prompt-profiles/switch', {
    schema: {
      tags: ['Prompt Profiles'],
      summary: 'Switch the active prompt profile',
      security: [{ bearerAuth: [] }],
      body: SwitchProfileBodySchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.body as { id: string };

    const success = switchProfile(id);
    if (!success) {
      return reply.code(404).send({ error: 'Profile not found' });
    }

    const profile = getProfileById(id);

    writeAuditLog({
      user_id: request.user?.sub,
      username: request.user?.username,
      action: 'prompt_profile.switch',
      target_type: 'prompt_profile',
      target_id: id,
      details: { name: profile?.name },
      request_id: request.requestId,
      ip_address: request.ip,
    });

    return { success: true, activeProfileId: id };
  });
}
