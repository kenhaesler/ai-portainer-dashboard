import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getAllProfiles,
  getProfileById,
  createProfile,
  updateProfile,
  deleteProfile,
  duplicateProfile,
  getActiveProfileId,
  getActiveProfile,
  switchProfile,
  getProfilePromptConfig,
} from './prompt-profile-store.js';

// ── Mocks ──────────────────────────────────────────────────────────

const mockAll = vi.fn();
const mockGet = vi.fn();
const mockRun = vi.fn();

// Kept: tests verify JSONB parsing edge cases via SQL mock assertions
vi.mock('../core/db/app-db-router.js', () => ({
  getDbForDomain: () => ({
    query: (...args: unknown[]) => Promise.resolve(mockAll(...args)),
    queryOne: (...args: unknown[]) => Promise.resolve(mockGet(...args)),
    execute: (...args: unknown[]) => Promise.resolve(mockRun(...args)),
  }),
}));

const mockGetSetting = vi.fn();
const mockSetSetting = vi.fn();
const mockDeleteSetting = vi.fn();
vi.mock('../core/services/settings-store.js', () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
  setSetting: (...args: unknown[]) => mockSetSetting(...args),
  deleteSetting: (...args: unknown[]) => mockDeleteSetting(...args),
}));

// Mock crypto.randomUUID
vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid-1234' });

// ── Test Data ──────────────────────────────────────────────────────

// String-based rows (defensive / legacy format)
const DEFAULT_PROFILE_ROW = {
  id: 'default',
  name: 'Default',
  description: 'Standard balanced prompts for general operations',
  is_built_in: 1,
  prompts_json: '{}',
  created_at: '2025-01-01T00:00:00',
  updated_at: '2025-01-01T00:00:00',
};

const SECURITY_PROFILE_ROW = {
  id: 'security-audit',
  name: 'Security Audit',
  description: 'Focus on CVEs, lateral movement, compliance',
  is_built_in: 1,
  prompts_json: JSON.stringify({
    chat_assistant: { systemPrompt: 'Security-focused assistant' },
    anomaly_explainer: { systemPrompt: 'Security anomaly explainer' },
  }),
  created_at: '2025-01-01T00:00:00',
  updated_at: '2025-01-01T00:00:00',
};

const CUSTOM_PROFILE_ROW = {
  id: 'custom-1',
  name: 'My Custom',
  description: 'Custom profile',
  is_built_in: 0,
  prompts_json: JSON.stringify({
    chat_assistant: { systemPrompt: 'Custom assistant', model: 'codellama', temperature: 0.5 },
  }),
  created_at: '2025-01-02T00:00:00',
  updated_at: '2025-01-02T00:00:00',
};

// JSONB-style rows: pg driver auto-deserializes JSONB into native JS objects.
// These simulate what PostgreSQL actually returns at runtime.
const SECURITY_PROFILE_ROW_JSONB = {
  id: 'security-audit',
  name: 'Security Audit',
  description: 'Focus on CVEs, lateral movement, compliance',
  is_built_in: true,
  prompts_json: {
    chat_assistant: { systemPrompt: 'Security-focused assistant' },
    anomaly_explainer: { systemPrompt: 'Security anomaly explainer' },
  },
  created_at: '2025-01-01T00:00:00',
  updated_at: '2025-01-01T00:00:00',
};

const CUSTOM_PROFILE_ROW_JSONB = {
  id: 'custom-1',
  name: 'My Custom',
  description: 'Custom profile',
  is_built_in: false,
  prompts_json: {
    chat_assistant: { systemPrompt: 'Custom assistant', model: 'codellama', temperature: 0.5 },
  },
  created_at: '2025-01-02T00:00:00',
  updated_at: '2025-01-02T00:00:00',
};

const DEFAULT_PROFILE_ROW_JSONB = {
  id: 'default',
  name: 'Default',
  description: 'Standard balanced prompts for general operations',
  is_built_in: true,
  prompts_json: {},
  created_at: '2025-01-01T00:00:00',
  updated_at: '2025-01-01T00:00:00',
};

// ── Tests ──────────────────────────────────────────────────────────

describe('prompt-profile-store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRun.mockReturnValue({ changes: 1 });
  });

  describe('getAllProfiles', () => {
    it('returns all profiles sorted by built-in first', async () => {
      mockAll.mockReturnValue([DEFAULT_PROFILE_ROW, SECURITY_PROFILE_ROW, CUSTOM_PROFILE_ROW]);

      const profiles = await getAllProfiles();
      expect(profiles).toHaveLength(3);
      expect(profiles[0].id).toBe('default');
      expect(profiles[0].isBuiltIn).toBe(true);
      expect(profiles[2].id).toBe('custom-1');
      expect(profiles[2].isBuiltIn).toBe(false);
    });

    it('returns empty array when no profiles exist', async () => {
      mockAll.mockReturnValue([]);
      expect(await getAllProfiles()).toEqual([]);
    });

    it('parses prompts_json into structured object', async () => {
      mockAll.mockReturnValue([SECURITY_PROFILE_ROW]);

      const [profile] = await getAllProfiles();
      expect(profile.prompts).toEqual({
        chat_assistant: { systemPrompt: 'Security-focused assistant' },
        anomaly_explainer: { systemPrompt: 'Security anomaly explainer' },
      });
    });

    it('handles invalid JSON gracefully', async () => {
      mockAll.mockReturnValue([{ ...DEFAULT_PROFILE_ROW, prompts_json: 'not-json' }]);

      const profiles = await getAllProfiles();
      expect(profiles[0].prompts).toEqual({});
    });
  });

  describe('getProfileById', () => {
    it('returns profile when found', async () => {
      mockGet.mockReturnValue(DEFAULT_PROFILE_ROW);

      const profile = await getProfileById('default');
      expect(profile).toBeDefined();
      expect(profile!.name).toBe('Default');
    });

    it('returns undefined when not found', async () => {
      mockGet.mockReturnValue(undefined);

      expect(await getProfileById('nonexistent')).toBeUndefined();
    });
  });

  describe('createProfile', () => {
    it('creates a new profile with given data', async () => {
      // For the subsequent getProfileById call
      mockGet.mockReturnValue({
        id: 'test-uuid-1234',
        name: 'New Profile',
        description: 'A new profile',
        is_built_in: 0,
        prompts_json: '{"chat_assistant":{"systemPrompt":"Custom prompt"}}',
        created_at: '2025-01-01T00:00:00',
        updated_at: '2025-01-01T00:00:00',
      });

      const profile = await createProfile('New Profile', 'A new profile', {
        chat_assistant: { systemPrompt: 'Custom prompt' },
      });

      expect(mockRun).toHaveBeenCalled();
      expect(profile.name).toBe('New Profile');
      expect(profile.isBuiltIn).toBe(false);
    });
  });

  describe('updateProfile', () => {
    it('updates profile name and description', async () => {
      // First call: getProfileById in updateProfile
      mockGet.mockReturnValueOnce(CUSTOM_PROFILE_ROW);
      // Second call: getProfileById after update
      mockGet.mockReturnValueOnce({ ...CUSTOM_PROFILE_ROW, name: 'Updated Name' });

      const updated = await updateProfile('custom-1', { name: 'Updated Name' });
      expect(updated).toBeDefined();
      expect(mockRun).toHaveBeenCalled();
    });

    it('returns undefined for nonexistent profile', async () => {
      mockGet.mockReturnValue(undefined);

      expect(await updateProfile('nonexistent', { name: 'Test' })).toBeUndefined();
    });

    it('updates prompts_json when prompts provided', async () => {
      mockGet.mockReturnValueOnce(CUSTOM_PROFILE_ROW);
      mockGet.mockReturnValueOnce({ ...CUSTOM_PROFILE_ROW, prompts_json: '{"root_cause":{"systemPrompt":"new"}}' });

      await updateProfile('custom-1', {
        prompts: { root_cause: { systemPrompt: 'new' } },
      });

      expect(mockRun).toHaveBeenCalled();
    });
  });

  describe('deleteProfile', () => {
    it('deletes a user-created profile', async () => {
      mockGet.mockReturnValue(CUSTOM_PROFILE_ROW);
      mockGetSetting.mockReturnValue({ value: 'default' });

      const result = await deleteProfile('custom-1');
      expect(result).toBe(true);
    });

    it('refuses to delete built-in profiles', async () => {
      mockGet.mockReturnValue(DEFAULT_PROFILE_ROW);

      const result = await deleteProfile('default');
      expect(result).toBe(false);
      expect(mockRun).not.toHaveBeenCalled();
    });

    it('returns false for nonexistent profile', async () => {
      mockGet.mockReturnValue(undefined);

      expect(await deleteProfile('nonexistent')).toBe(false);
    });

    it('switches to default when deleting active profile', async () => {
      mockGet.mockReturnValue(CUSTOM_PROFILE_ROW);
      mockGetSetting.mockReturnValue({ value: 'custom-1' });

      await deleteProfile('custom-1');

      // switchProfile calls getProfileById then setSetting
      expect(mockSetSetting).toHaveBeenCalled();
    });
  });

  describe('duplicateProfile', () => {
    it('creates a copy of the source profile', async () => {
      mockGet.mockReturnValueOnce(SECURITY_PROFILE_ROW);
      mockGet.mockReturnValueOnce({
        id: 'test-uuid-1234',
        name: 'Security Copy',
        description: SECURITY_PROFILE_ROW.description,
        is_built_in: 0,
        prompts_json: SECURITY_PROFILE_ROW.prompts_json,
        created_at: '2025-01-01T00:00:00',
        updated_at: '2025-01-01T00:00:00',
      });

      const copy = await duplicateProfile('security-audit', 'Security Copy');
      expect(copy).toBeDefined();
      expect(copy!.name).toBe('Security Copy');
      expect(copy!.isBuiltIn).toBe(false);
    });

    it('returns undefined for nonexistent source', async () => {
      mockGet.mockReturnValue(undefined);

      expect(await duplicateProfile('nonexistent', 'Copy')).toBeUndefined();
    });
  });

  describe('getActiveProfileId', () => {
    it('returns stored active profile ID', async () => {
      mockGetSetting.mockReturnValue({ value: 'security-audit' });

      expect(await getActiveProfileId()).toBe('security-audit');
    });

    it('defaults to "default" when no setting exists', async () => {
      mockGetSetting.mockReturnValue(undefined);

      expect(await getActiveProfileId()).toBe('default');
    });

    it('defaults to "default" when setting value is empty', async () => {
      mockGetSetting.mockReturnValue({ value: '' });

      expect(await getActiveProfileId()).toBe('default');
    });
  });

  describe('getActiveProfile', () => {
    it('returns the active profile', async () => {
      mockGetSetting.mockReturnValue({ value: 'security-audit' });
      mockGet.mockReturnValue(SECURITY_PROFILE_ROW);

      const profile = await getActiveProfile();
      expect(profile).toBeDefined();
      expect(profile!.id).toBe('security-audit');
    });
  });

  describe('switchProfile', () => {
    it('switches to a valid profile', async () => {
      mockGet.mockReturnValue(SECURITY_PROFILE_ROW);

      const result = await switchProfile('security-audit');
      expect(result).toBe(true);
      expect(mockSetSetting).toHaveBeenCalledWith('prompts.active_profile', 'security-audit', 'prompts');
    });

    it('returns false for nonexistent profile', async () => {
      mockGet.mockReturnValue(undefined);

      expect(await switchProfile('nonexistent')).toBe(false);
      expect(mockSetSetting).not.toHaveBeenCalled();
    });

    it('clears per-feature prompt overrides on switch', async () => {
      mockGet.mockReturnValue(SECURITY_PROFILE_ROW);

      await switchProfile('security-audit');

      // Should delete per-feature overrides for all features (system_prompt, model, temperature)
      const deleteCalls = mockDeleteSetting.mock.calls.map((args: unknown[]) => args[0] as string);
      expect(deleteCalls).toContain('prompts.chat_assistant.system_prompt');
      expect(deleteCalls).toContain('prompts.chat_assistant.model');
      expect(deleteCalls).toContain('prompts.chat_assistant.temperature');
      expect(deleteCalls).toContain('prompts.monitoring_analysis.system_prompt');
      // 12 features × 3 keys each = 36 delete calls
      expect(mockDeleteSetting).toHaveBeenCalledTimes(36);
    });
  });

  describe('getProfilePromptConfig', () => {
    it('returns prompt config for a feature from active profile', async () => {
      mockGetSetting.mockReturnValue({ value: 'security-audit' });
      mockGet.mockReturnValue(SECURITY_PROFILE_ROW);

      const config = await getProfilePromptConfig('chat_assistant');
      expect(config).toBeDefined();
      expect(config!.systemPrompt).toBe('Security-focused assistant');
    });

    it('returns undefined when feature not in profile', async () => {
      mockGetSetting.mockReturnValue({ value: 'security-audit' });
      mockGet.mockReturnValue(SECURITY_PROFILE_ROW);

      const config = await getProfilePromptConfig('capacity_forecast');
      expect(config).toBeUndefined();
    });

    it('returns undefined when active profile has no prompts', async () => {
      mockGetSetting.mockReturnValue({ value: 'default' });
      mockGet.mockReturnValue(DEFAULT_PROFILE_ROW);

      const config = await getProfilePromptConfig('chat_assistant');
      expect(config).toBeUndefined();
    });

    it('returns config with model and temperature overrides', async () => {
      mockGetSetting.mockReturnValue({ value: 'custom-1' });
      mockGet.mockReturnValue(CUSTOM_PROFILE_ROW);

      const config = await getProfilePromptConfig('chat_assistant');
      expect(config).toBeDefined();
      expect(config!.systemPrompt).toBe('Custom assistant');
      expect(config!.model).toBe('codellama');
      expect(config!.temperature).toBe(0.5);
    });

    it('returns undefined when profile does not exist', async () => {
      mockGetSetting.mockReturnValue({ value: 'nonexistent' });
      mockGet.mockReturnValue(undefined);

      const config = await getProfilePromptConfig('chat_assistant');
      expect(config).toBeUndefined();
    });
  });

  // ── JSONB Regression Tests (Issue #757) ─────────────────────────────
  // The pg driver auto-deserializes JSONB columns into native JS objects.
  // The old code called JSON.parse() on these objects, which coerced them
  // to "[object Object]" and failed, falling back to empty {}.

  describe('JSONB regression: prompts_json as pre-parsed object', () => {
    it('handles prompts_json as a native object (pg driver JSONB behavior)', async () => {
      mockAll.mockReturnValue([SECURITY_PROFILE_ROW_JSONB]);

      const [profile] = await getAllProfiles();
      expect(profile.prompts).toEqual({
        chat_assistant: { systemPrompt: 'Security-focused assistant' },
        anomaly_explainer: { systemPrompt: 'Security anomaly explainer' },
      });
    });

    it('handles prompts_json as an empty object', async () => {
      mockAll.mockReturnValue([DEFAULT_PROFILE_ROW_JSONB]);

      const [profile] = await getAllProfiles();
      expect(profile.prompts).toEqual({});
    });

    it('preserves model and temperature from JSONB objects', async () => {
      mockGetSetting.mockReturnValue({ value: 'custom-1' });
      mockGet.mockReturnValue(CUSTOM_PROFILE_ROW_JSONB);

      const config = await getProfilePromptConfig('chat_assistant');
      expect(config).toBeDefined();
      expect(config!.systemPrompt).toBe('Custom assistant');
      expect(config!.model).toBe('codellama');
      expect(config!.temperature).toBe(0.5);
    });

    it('getProfileById works with JSONB pre-parsed row', async () => {
      mockGet.mockReturnValue(SECURITY_PROFILE_ROW_JSONB);

      const profile = await getProfileById('security-audit');
      expect(profile).toBeDefined();
      expect(profile!.prompts.chat_assistant.systemPrompt).toBe('Security-focused assistant');
      expect(profile!.prompts.anomaly_explainer.systemPrompt).toBe('Security anomaly explainer');
    });

    it('does not double-parse: object input is used directly, not stringified then parsed', async () => {
      // This is the exact bug from #757: passing an object to JSON.parse()
      // coerces it to "[object Object]" which fails. Verify the fix works.
      const rowWithObject = {
        ...DEFAULT_PROFILE_ROW_JSONB,
        id: 'test-object',
        prompts_json: { chat_assistant: { systemPrompt: 'Direct object' } },
      };
      mockGet.mockReturnValue(rowWithObject);

      const profile = await getProfileById('test-object');
      expect(profile).toBeDefined();
      expect(profile!.prompts).toEqual({ chat_assistant: { systemPrompt: 'Direct object' } });
      // Key assertion: prompts should NOT be empty (which was the bug behavior)
      expect(Object.keys(profile!.prompts).length).toBeGreaterThan(0);
    });

    it('still handles string prompts_json for backward compatibility', async () => {
      // Ensure string input still works (defensive, in case of edge cases)
      mockAll.mockReturnValue([SECURITY_PROFILE_ROW]);

      const [profile] = await getAllProfiles();
      expect(profile.prompts).toEqual({
        chat_assistant: { systemPrompt: 'Security-focused assistant' },
        anomaly_explainer: { systemPrompt: 'Security anomaly explainer' },
      });
    });

    it('handles null prompts_json gracefully', async () => {
      const rowWithNull = { ...DEFAULT_PROFILE_ROW_JSONB, prompts_json: null as unknown };
      mockAll.mockReturnValue([rowWithNull]);

      const [profile] = await getAllProfiles();
      expect(profile.prompts).toEqual({});
    });

    it('mixed string and object rows are both parsed correctly', async () => {
      // Simulate a scenario where some rows come as strings, others as objects
      mockAll.mockReturnValue([
        SECURITY_PROFILE_ROW,      // string prompts_json
        CUSTOM_PROFILE_ROW_JSONB,  // object prompts_json (pg JSONB)
      ]);

      const profiles = await getAllProfiles();
      expect(profiles).toHaveLength(2);

      // String row parsed correctly
      expect(profiles[0].prompts.chat_assistant.systemPrompt).toBe('Security-focused assistant');

      // Object row used directly
      expect(profiles[1].prompts.chat_assistant.systemPrompt).toBe('Custom assistant');
      expect(profiles[1].prompts.chat_assistant.model).toBe('codellama');
    });
  });
});
