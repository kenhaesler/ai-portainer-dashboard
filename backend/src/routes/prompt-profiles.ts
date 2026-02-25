import { FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import os from 'node:os';
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
import { PROMPT_FEATURES, estimateTokens } from '../services/prompt-store.js';
import { writeAuditLog } from '../core/services/audit-logger.js';

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

const ExportQuerySchema = z.object({
  profileId: z.string().optional(),
});

const VALID_FEATURE_KEYS = new Set<string>(PROMPT_FEATURES.map((f) => f.key));

const ImportFeatureConfigSchema = z.object({
  systemPrompt: z.string(),
  model: z.string().nullable().optional(),
  temperature: z.number().min(0).max(2).nullable().optional(),
});

const ImportFileSchema = z.object({
  version: z.number().int().min(1).max(1),
  exportedAt: z.string(),
  exportedFrom: z.string(),
  profile: z.string(),
  features: z.record(z.string(), ImportFeatureConfigSchema),
}).refine(
  (data) => Object.keys(data.features).every((k) => VALID_FEATURE_KEYS.has(k)),
  { message: 'Import contains invalid feature keys' },
);

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
    const profiles = await getAllProfiles();
    const activeId = await getActiveProfileId();
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
    const profile = await getProfileById(id);
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
      const profile = await createProfile(name, description, prompts);

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
      const profile = await updateProfile(id, updates);
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
    const profile = await getProfileById(id);

    if (!profile) {
      return reply.code(404).send({ error: 'Profile not found' });
    }

    if (profile.isBuiltIn) {
      return reply.code(400).send({ error: 'Cannot delete built-in profiles' });
    }

    const deleted = await deleteProfile(id);
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
      const profile = await duplicateProfile(id, name);
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

    const success = await switchProfile(id);
    if (!success) {
      return reply.code(404).send({ error: 'Profile not found' });
    }

    const profile = await getProfileById(id);

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

  // ── Export profile ──────────────────────────────────────────────────

  fastify.get('/api/prompt-profiles/export', {
    schema: {
      tags: ['Prompt Profiles'],
      summary: 'Export a prompt profile as JSON',
      security: [{ bearerAuth: [] }],
      querystring: ExportQuerySchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const { profileId } = request.query as z.infer<typeof ExportQuerySchema>;
    const targetId = profileId ?? await getActiveProfileId();
    const profile = await getProfileById(targetId);

    if (!profile) {
      return reply.code(404).send({ error: 'Profile not found' });
    }

    const exportData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      exportedFrom: os.hostname(),
      profile: profile.name,
      features: profile.prompts,
    };

    const filename = `prompts-${profile.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;

    writeAuditLog({
      user_id: request.user?.sub,
      username: request.user?.username,
      action: 'prompt_profile.export',
      target_type: 'prompt_profile',
      target_id: targetId,
      details: { name: profile.name },
      request_id: request.requestId,
      ip_address: request.ip,
    });

    return reply
      .header('Content-Type', 'application/json')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(JSON.stringify(exportData, null, 2));
  });

  // ── Import preview ────────────────────────────────────────────────

  fastify.post('/api/prompt-profiles/import/preview', {
    schema: {
      tags: ['Prompt Profiles'],
      summary: 'Validate an import file and return a diff preview',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const parseResult = ImportFileSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'Invalid import file format',
        details: parseResult.error.issues.map((i) => i.message),
      });
    }

    const importData = parseResult.data;
    const activeId = await getActiveProfileId();
    const currentProfile = await getProfileById(activeId);
    const currentPrompts = currentProfile?.prompts ?? {};

    const changes: Record<string, {
      status: 'added' | 'modified' | 'unchanged';
      before?: { systemPrompt: string; model?: string | null; temperature?: number | null };
      after: { systemPrompt: string; model?: string | null; temperature?: number | null };
      tokenDelta?: number;
    }> = {};

    let added = 0;
    let modified = 0;
    let unchanged = 0;

    for (const [featureKey, importedConfig] of Object.entries(importData.features)) {
      const existing = currentPrompts[featureKey];
      const afterTokens = estimateTokens(importedConfig.systemPrompt);

      if (!existing) {
        changes[featureKey] = {
          status: 'added',
          after: importedConfig,
          tokenDelta: afterTokens,
        };
        added++;
      } else {
        const samePrompt = existing.systemPrompt === importedConfig.systemPrompt;
        const sameModel = (existing.model ?? null) === (importedConfig.model ?? null);
        const sameTemp = (existing.temperature ?? null) === (importedConfig.temperature ?? null);

        if (samePrompt && sameModel && sameTemp) {
          changes[featureKey] = { status: 'unchanged', after: importedConfig };
          unchanged++;
        } else {
          const beforeTokens = estimateTokens(existing.systemPrompt);
          changes[featureKey] = {
            status: 'modified',
            before: existing,
            after: importedConfig,
            tokenDelta: afterTokens - beforeTokens,
          };
          modified++;
        }
      }
    }

    return {
      valid: true,
      profile: importData.profile,
      exportedAt: importData.exportedAt,
      exportedFrom: importData.exportedFrom,
      summary: { added, modified, unchanged },
      featureCount: Object.keys(importData.features).length,
      changes,
    };
  });

  // ── Import apply ──────────────────────────────────────────────────

  fastify.post('/api/prompt-profiles/import', {
    schema: {
      tags: ['Prompt Profiles'],
      summary: 'Import prompt configurations into the active profile',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const parseResult = ImportFileSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'Invalid import file format',
        details: parseResult.error.issues.map((i) => i.message),
      });
    }

    const importData = parseResult.data;
    const activeId = await getActiveProfileId();
    const currentProfile = await getProfileById(activeId);

    if (!currentProfile) {
      return reply.code(404).send({ error: 'Active profile not found' });
    }

    // Merge imported features into the active profile
    const mergedPrompts = { ...currentProfile.prompts };
    for (const [featureKey, config] of Object.entries(importData.features)) {
      mergedPrompts[featureKey] = {
        systemPrompt: config.systemPrompt,
        ...(config.model != null ? { model: config.model } : {}),
        ...(config.temperature != null ? { temperature: config.temperature } : {}),
      };
    }

    const updated = await updateProfile(activeId, { prompts: mergedPrompts });
    if (!updated) {
      return reply.code(500).send({ error: 'Failed to apply import' });
    }

    writeAuditLog({
      user_id: request.user?.sub,
      username: request.user?.username,
      action: 'prompt_profile.import',
      target_type: 'prompt_profile',
      target_id: activeId,
      details: {
        name: currentProfile.name,
        importedFrom: importData.exportedFrom,
        featuresImported: Object.keys(importData.features).length,
      },
      request_id: request.requestId,
      ip_address: request.ip,
    });

    return { success: true, profile: updated };
  });
}
