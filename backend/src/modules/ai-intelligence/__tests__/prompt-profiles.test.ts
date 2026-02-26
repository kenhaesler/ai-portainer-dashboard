import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';
import { testAdminOnly } from '../../../test-utils/rbac-test-helper.js';
import { promptProfileRoutes } from '../routes/prompt-profiles.js';

// ── Mocks ──────────────────────────────────────────────────────────

const mockGetAllProfiles = vi.fn();
const mockGetProfileById = vi.fn();
const mockCreateProfile = vi.fn();
const mockUpdateProfile = vi.fn();
const mockDeleteProfile = vi.fn();
const mockDuplicateProfile = vi.fn();
const mockGetActiveProfileId = vi.fn();
const mockSwitchProfile = vi.fn();

// Kept: prompt-profile-store mock — no PostgreSQL in CI
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

// Kept: prompt-store mock — no PostgreSQL in CI
vi.mock('../services/prompt-store.js', () => ({
  PROMPT_FEATURES: [
    { key: 'chat_assistant', label: 'Chat Assistant', description: 'Main AI chat' },
    { key: 'anomaly_explainer', label: 'Anomaly Explainer', description: 'Explains anomalies' },
    { key: 'log_analyzer', label: 'Log Analyzer', description: 'Analyzes logs' },
  ],
  estimateTokens: (text: string) => Math.ceil(text.length / 4),
}));

// Kept: audit-logger mock — side-effect isolation
vi.mock('@dashboard/core/services/audit-logger.js', () => ({
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

const SECURITY_PROFILE = {
  id: 'security-1',
  name: 'Security Audit',
  description: 'Security-focused prompts',
  isBuiltIn: true,
  prompts: {
    chat_assistant: { systemPrompt: 'Security-focused assistant', model: 'llama3.2:70b', temperature: 0.3 },
    anomaly_explainer: { systemPrompt: 'Security anomaly analysis' },
  },
  createdAt: '2025-01-01T00:00:00',
  updatedAt: '2025-01-01T00:00:00',
};

const VALID_IMPORT_DATA = {
  version: 1,
  exportedAt: '2026-02-08T14:30:00Z',
  exportedFrom: 'dashboard-prod-01',
  profile: 'Security Audit',
  features: {
    chat_assistant: { systemPrompt: 'Imported security prompt', model: 'llama3.2:70b', temperature: 0.3 },
    anomaly_explainer: { systemPrompt: 'Imported anomaly prompt', model: null, temperature: null },
  },
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

  // ── Export Tests ──────────────────────────────────────────────────

  describe('GET /api/prompt-profiles/export', () => {
    it('exports the active profile as JSON', async () => {
      mockGetActiveProfileId.mockReturnValue('security-1');
      mockGetProfileById.mockReturnValue(SECURITY_PROFILE);

      const response = await app.inject({
        method: 'GET',
        url: '/api/prompt-profiles/export',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.headers['content-disposition']).toContain('attachment');
      expect(response.headers['content-disposition']).toContain('security-audit');

      const body = JSON.parse(response.body);
      expect(body.version).toBe(1);
      expect(body.exportedAt).toBeDefined();
      expect(body.exportedFrom).toBeDefined();
      expect(body.profile).toBe('Security Audit');
      expect(body.features.chat_assistant.systemPrompt).toBe('Security-focused assistant');
      expect(body.features.chat_assistant.model).toBe('llama3.2:70b');
    });

    it('exports a specific profile by ID', async () => {
      mockGetProfileById.mockReturnValue(CUSTOM_PROFILE);

      const response = await app.inject({
        method: 'GET',
        url: '/api/prompt-profiles/export?profileId=custom-1',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.profile).toBe('My Custom');
    });

    it('returns 404 for nonexistent profile', async () => {
      mockGetProfileById.mockReturnValue(undefined);

      const response = await app.inject({
        method: 'GET',
        url: '/api/prompt-profiles/export?profileId=nonexistent',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // ── Import Preview Tests ──────────────────────────────────────────

  describe('POST /api/prompt-profiles/import/preview', () => {
    it('returns a diff preview for valid import data', async () => {
      mockGetActiveProfileId.mockReturnValue('custom-1');
      mockGetProfileById.mockReturnValue(CUSTOM_PROFILE);

      const response = await app.inject({
        method: 'POST',
        url: '/api/prompt-profiles/import/preview',
        headers: { authorization: 'Bearer test' },
        payload: VALID_IMPORT_DATA,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.valid).toBe(true);
      expect(body.profile).toBe('Security Audit');
      expect(body.featureCount).toBe(2);
      expect(body.summary.modified).toBe(1); // chat_assistant is modified
      expect(body.summary.added).toBe(1); // anomaly_explainer is new
      expect(body.summary.unchanged).toBe(0);
      expect(body.changes.chat_assistant.status).toBe('modified');
      expect(body.changes.anomaly_explainer.status).toBe('added');
    });

    it('detects unchanged features', async () => {
      mockGetActiveProfileId.mockReturnValue('security-1');
      mockGetProfileById.mockReturnValue(SECURITY_PROFILE);

      const sameData = {
        ...VALID_IMPORT_DATA,
        features: {
          chat_assistant: { systemPrompt: 'Security-focused assistant', model: 'llama3.2:70b', temperature: 0.3 },
        },
      };

      const response = await app.inject({
        method: 'POST',
        url: '/api/prompt-profiles/import/preview',
        headers: { authorization: 'Bearer test' },
        payload: sameData,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.summary.unchanged).toBe(1);
      expect(body.changes.chat_assistant.status).toBe('unchanged');
    });

    it('rejects invalid version number', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/prompt-profiles/import/preview',
        headers: { authorization: 'Bearer test' },
        payload: { ...VALID_IMPORT_DATA, version: 2 },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('Invalid');
    });

    it('rejects invalid feature keys', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/prompt-profiles/import/preview',
        headers: { authorization: 'Bearer test' },
        payload: {
          ...VALID_IMPORT_DATA,
          features: { not_a_real_feature: { systemPrompt: 'test' } },
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('Invalid');
    });

    it('rejects missing required fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/prompt-profiles/import/preview',
        headers: { authorization: 'Bearer test' },
        payload: { version: 1 },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // ── Import Apply Tests ────────────────────────────────────────────

  describe('POST /api/prompt-profiles/import', () => {
    it('applies valid import to the active profile', async () => {
      mockGetActiveProfileId.mockReturnValue('custom-1');
      mockGetProfileById.mockReturnValue(CUSTOM_PROFILE);
      const updatedProfile = {
        ...CUSTOM_PROFILE,
        prompts: {
          chat_assistant: { systemPrompt: 'Imported security prompt', model: 'llama3.2:70b', temperature: 0.3 },
          anomaly_explainer: { systemPrompt: 'Imported anomaly prompt' },
        },
      };
      mockUpdateProfile.mockReturnValue(updatedProfile);

      const response = await app.inject({
        method: 'POST',
        url: '/api/prompt-profiles/import',
        headers: { authorization: 'Bearer test' },
        payload: VALID_IMPORT_DATA,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().success).toBe(true);
      expect(mockUpdateProfile).toHaveBeenCalledWith('custom-1', {
        prompts: expect.objectContaining({
          chat_assistant: { systemPrompt: 'Imported security prompt', model: 'llama3.2:70b', temperature: 0.3 },
          anomaly_explainer: { systemPrompt: 'Imported anomaly prompt' },
        }),
      });
    });

    it('rejects invalid import data', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/prompt-profiles/import',
        headers: { authorization: 'Bearer test' },
        payload: { version: 99, features: {} },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 404 when active profile not found', async () => {
      mockGetActiveProfileId.mockReturnValue('deleted-profile');
      mockGetProfileById.mockReturnValue(undefined);

      const response = await app.inject({
        method: 'POST',
        url: '/api/prompt-profiles/import',
        headers: { authorization: 'Bearer test' },
        payload: VALID_IMPORT_DATA,
      });

      expect(response.statusCode).toBe(404);
    });
  });
});

describe('prompt-profiles access control', () => {
  let rbacApp: FastifyInstance;
  let currentRole: 'viewer' | 'operator' | 'admin';

  beforeAll(async () => {
    currentRole = 'admin';
    rbacApp = Fastify({ logger: false });
    rbacApp.setValidatorCompiler(validatorCompiler);
    rbacApp.decorate('authenticate', async () => undefined);
    rbacApp.decorate('requireRole', (minRole: 'viewer' | 'operator' | 'admin') => async (request: FastifyRequest, reply: FastifyReply) => {
      const rank = { viewer: 0, operator: 1, admin: 2 };
      const userRole = request.user?.role ?? 'viewer';
      if (rank[userRole as keyof typeof rank] < rank[minRole]) {
        reply.code(403).send({ error: 'Insufficient permissions' });
      }
    });
    rbacApp.decorateRequest('user', undefined);
    rbacApp.addHook('preHandler', async (request) => {
      request.user = { sub: 'u2', username: 'viewer', sessionId: 's2', role: currentRole };
    });
    await rbacApp.register(promptProfileRoutes);
    await rbacApp.ready();
  });

  afterAll(async () => {
    await rbacApp.close();
  });

  beforeEach(() => {
    currentRole = 'admin';
  });

  testAdminOnly(() => rbacApp, (r) => { currentRole = r; }, 'GET', '/api/prompt-profiles');
});
