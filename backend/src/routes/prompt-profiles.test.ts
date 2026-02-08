import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';
import { promptProfileRoutes } from './prompt-profiles.js';

// ── Mocks ──────────────────────────────────────────────────────────

const mockGetAllProfiles = vi.fn();
const mockGetProfileById = vi.fn();
const mockCreateProfile = vi.fn();
const mockUpdateProfile = vi.fn();
const mockDeleteProfile = vi.fn();
const mockDuplicateProfile = vi.fn();
const mockGetActiveProfileId = vi.fn();
const mockSwitchProfile = vi.fn();

vi.mock('../services/prompt-profile-store.js', () => ({
  getAllProfiles: (...args: unknown[]) => mockGetAllProfiles(...args),
  getProfileById: (...args: unknown[]) => mockGetProfileById(...args),
  createProfile: (...args: unknown[]) => mockCreateProfile(...args),
  updateProfile: (...args: unknown[]) => mockUpdateProfile(...args),
  deleteProfile: (...args: unknown[]) => mockDeleteProfile(...args),
  duplicateProfile: (...args: unknown[]) => mockDuplicateProfile(...args),
  getActiveProfileId: (...args: unknown[]) => mockGetActiveProfileId(...args),
  switchProfile: (...args: unknown[]) => mockSwitchProfile(...args),
}));

vi.mock('../services/audit-logger.js', () => ({
  writeAuditLog: vi.fn(),
}));

// ── Test Data ──────────────────────────────────────────────────────

const DEFAULT_PROFILE = {
  id: 'default',
  name: 'Default',
  description: 'Standard balanced prompts',
  isBuiltIn: true,
  prompts: {},
  createdAt: '2025-01-01T00:00:00',
  updatedAt: '2025-01-01T00:00:00',
};

const CUSTOM_PROFILE = {
  id: 'custom-1',
  name: 'My Custom',
  description: 'Custom profile',
  isBuiltIn: false,
  prompts: { chat_assistant: { systemPrompt: 'Custom prompt' } },
  createdAt: '2025-01-02T00:00:00',
  updatedAt: '2025-01-02T00:00:00',
};

// ── Tests ──────────────────────────────────────────────────────────

describe('prompt-profiles routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.decorate('authenticate', async () => undefined);
    app.decorate('requireRole', () => async () => undefined);
    app.decorateRequest('user', undefined);
    app.addHook('preHandler', async (request) => {
      request.user = { sub: 'u1', username: 'admin', sessionId: 's1', role: 'admin' as const };
    });
    await app.register(promptProfileRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetActiveProfileId.mockReturnValue('default');
  });

  describe('GET /api/prompt-profiles', () => {
    it('returns all profiles with active profile ID', async () => {
      mockGetAllProfiles.mockReturnValue([DEFAULT_PROFILE, CUSTOM_PROFILE]);
      mockGetActiveProfileId.mockReturnValue('default');

      const response = await app.inject({
        method: 'GET',
        url: '/api/prompt-profiles',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.profiles).toHaveLength(2);
      expect(body.activeProfileId).toBe('default');
    });
  });

  describe('GET /api/prompt-profiles/:id', () => {
    it('returns a single profile', async () => {
      mockGetProfileById.mockReturnValue(DEFAULT_PROFILE);

      const response = await app.inject({
        method: 'GET',
        url: '/api/prompt-profiles/default',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().name).toBe('Default');
    });

    it('returns 404 for nonexistent profile', async () => {
      mockGetProfileById.mockReturnValue(undefined);

      const response = await app.inject({
        method: 'GET',
        url: '/api/prompt-profiles/nonexistent',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /api/prompt-profiles', () => {
    it('creates a new profile', async () => {
      mockCreateProfile.mockReturnValue({
        id: 'new-1',
        name: 'New Profile',
        description: 'Test',
        isBuiltIn: false,
        prompts: {},
        createdAt: '2025-01-01T00:00:00',
        updatedAt: '2025-01-01T00:00:00',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/prompt-profiles',
        headers: { authorization: 'Bearer test' },
        payload: { name: 'New Profile', description: 'Test' },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().name).toBe('New Profile');
    });

    it('returns 409 for duplicate name', async () => {
      mockCreateProfile.mockImplementation(() => {
        throw new Error('UNIQUE constraint failed: prompt_profiles.name');
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/prompt-profiles',
        headers: { authorization: 'Bearer test' },
        payload: { name: 'Default', description: 'Duplicate' },
      });

      expect(response.statusCode).toBe(409);
    });

    it('validates name is required', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/prompt-profiles',
        headers: { authorization: 'Bearer test' },
        payload: { description: 'No name' },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('PUT /api/prompt-profiles/:id', () => {
    it('updates an existing profile', async () => {
      mockUpdateProfile.mockReturnValue({ ...CUSTOM_PROFILE, name: 'Updated' });

      const response = await app.inject({
        method: 'PUT',
        url: '/api/prompt-profiles/custom-1',
        headers: { authorization: 'Bearer test' },
        payload: { name: 'Updated' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().name).toBe('Updated');
    });

    it('returns 404 for nonexistent profile', async () => {
      mockUpdateProfile.mockReturnValue(undefined);

      const response = await app.inject({
        method: 'PUT',
        url: '/api/prompt-profiles/nonexistent',
        headers: { authorization: 'Bearer test' },
        payload: { name: 'Updated' },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('DELETE /api/prompt-profiles/:id', () => {
    it('deletes a user-created profile', async () => {
      mockGetProfileById.mockReturnValue(CUSTOM_PROFILE);
      mockDeleteProfile.mockReturnValue(true);

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/prompt-profiles/custom-1',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().success).toBe(true);
    });

    it('rejects deletion of built-in profiles', async () => {
      mockGetProfileById.mockReturnValue(DEFAULT_PROFILE);

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/prompt-profiles/default',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('built-in');
    });

    it('returns 404 for nonexistent profile', async () => {
      mockGetProfileById.mockReturnValue(undefined);

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/prompt-profiles/nonexistent',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /api/prompt-profiles/:id/duplicate', () => {
    it('duplicates an existing profile', async () => {
      mockDuplicateProfile.mockReturnValue({
        id: 'dup-1',
        name: 'Default Copy',
        description: DEFAULT_PROFILE.description,
        isBuiltIn: false,
        prompts: {},
        createdAt: '2025-01-01T00:00:00',
        updatedAt: '2025-01-01T00:00:00',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/prompt-profiles/default/duplicate',
        headers: { authorization: 'Bearer test' },
        payload: { name: 'Default Copy' },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().name).toBe('Default Copy');
    });

    it('returns 404 for nonexistent source', async () => {
      mockDuplicateProfile.mockReturnValue(undefined);

      const response = await app.inject({
        method: 'POST',
        url: '/api/prompt-profiles/nonexistent/duplicate',
        headers: { authorization: 'Bearer test' },
        payload: { name: 'Copy' },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /api/prompt-profiles/switch', () => {
    it('switches the active profile', async () => {
      mockSwitchProfile.mockReturnValue(true);
      mockGetProfileById.mockReturnValue(CUSTOM_PROFILE);

      const response = await app.inject({
        method: 'POST',
        url: '/api/prompt-profiles/switch',
        headers: { authorization: 'Bearer test' },
        payload: { id: 'custom-1' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().success).toBe(true);
      expect(response.json().activeProfileId).toBe('custom-1');
    });

    it('returns 404 for nonexistent profile', async () => {
      mockSwitchProfile.mockReturnValue(false);

      const response = await app.inject({
        method: 'POST',
        url: '/api/prompt-profiles/switch',
        headers: { authorization: 'Bearer test' },
        payload: { id: 'nonexistent' },
      });

      expect(response.statusCode).toBe(404);
    });
  });
});

describe('prompt-profiles access control', () => {
  it('blocks non-admin users', async () => {
    const app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.decorate('authenticate', async () => undefined);
    app.decorate('requireRole', (minRole: 'viewer' | 'operator' | 'admin') => async (request: FastifyRequest, reply: FastifyReply) => {
      const rank = { viewer: 0, operator: 1, admin: 2 };
      const userRole = request.user?.role ?? 'viewer';
      if (rank[userRole as keyof typeof rank] < rank[minRole]) {
        reply.code(403).send({ error: 'Insufficient permissions' });
      }
    });
    app.decorateRequest('user', undefined);
    app.addHook('preHandler', async (request) => {
      request.user = { sub: 'u2', username: 'viewer', sessionId: 's2', role: 'viewer' as const };
    });
    await app.register(promptProfileRoutes);
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/api/prompt-profiles',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });
});
