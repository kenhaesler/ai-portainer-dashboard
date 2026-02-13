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

vi.mock('../db/sqlite.js', () => ({
  getDb: () => ({
    prepare: () => ({
      all: (...args: unknown[]) => mockAll(...args),
      get: (...args: unknown[]) => mockGet(...args),
      run: (...args: unknown[]) => mockRun(...args),
    }),
  }),
}));

const mockGetSetting = vi.fn();
const mockSetSetting = vi.fn();
const mockDeleteSetting = vi.fn();
vi.mock('./settings-store.js', () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
  setSetting: (...args: unknown[]) => mockSetSetting(...args),
  deleteSetting: (...args: unknown[]) => mockDeleteSetting(...args),
}));

vi.mock('../utils/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock crypto.randomUUID
vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid-1234' });

// ── Test Data ──────────────────────────────────────────────────────

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

// ── Tests ──────────────────────────────────────────────────────────

describe('prompt-profile-store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRun.mockReturnValue({ changes: 1 });
  });

  describe('getAllProfiles', () => {
    it('returns all profiles sorted by built-in first', () => {
      mockAll.mockReturnValue([DEFAULT_PROFILE_ROW, SECURITY_PROFILE_ROW, CUSTOM_PROFILE_ROW]);

      const profiles = getAllProfiles();
      expect(profiles).toHaveLength(3);
      expect(profiles[0].id).toBe('default');
      expect(profiles[0].isBuiltIn).toBe(true);
      expect(profiles[2].id).toBe('custom-1');
      expect(profiles[2].isBuiltIn).toBe(false);
    });

    it('returns empty array when no profiles exist', () => {
      mockAll.mockReturnValue([]);
      expect(getAllProfiles()).toEqual([]);
    });

    it('parses prompts_json into structured object', () => {
      mockAll.mockReturnValue([SECURITY_PROFILE_ROW]);

      const [profile] = getAllProfiles();
      expect(profile.prompts).toEqual({
        chat_assistant: { systemPrompt: 'Security-focused assistant' },
        anomaly_explainer: { systemPrompt: 'Security anomaly explainer' },
      });
    });

    it('handles invalid JSON gracefully', () => {
      mockAll.mockReturnValue([{ ...DEFAULT_PROFILE_ROW, prompts_json: 'not-json' }]);

      const profiles = getAllProfiles();
      expect(profiles[0].prompts).toEqual({});
    });
  });

  describe('getProfileById', () => {
    it('returns profile when found', () => {
      mockGet.mockReturnValue(DEFAULT_PROFILE_ROW);

      const profile = getProfileById('default');
      expect(profile).toBeDefined();
      expect(profile!.name).toBe('Default');
    });

    it('returns undefined when not found', () => {
      mockGet.mockReturnValue(undefined);

      expect(getProfileById('nonexistent')).toBeUndefined();
    });
  });

  describe('createProfile', () => {
    it('creates a new profile with given data', () => {
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

      const profile = createProfile('New Profile', 'A new profile', {
        chat_assistant: { systemPrompt: 'Custom prompt' },
      });

      expect(mockRun).toHaveBeenCalled();
      expect(profile.name).toBe('New Profile');
      expect(profile.isBuiltIn).toBe(false);
    });
  });

  describe('updateProfile', () => {
    it('updates profile name and description', () => {
      // First call: getProfileById in updateProfile
      mockGet.mockReturnValueOnce(CUSTOM_PROFILE_ROW);
      // Second call: getProfileById after update
      mockGet.mockReturnValueOnce({ ...CUSTOM_PROFILE_ROW, name: 'Updated Name' });

      const updated = updateProfile('custom-1', { name: 'Updated Name' });
      expect(updated).toBeDefined();
      expect(mockRun).toHaveBeenCalled();
    });

    it('returns undefined for nonexistent profile', () => {
      mockGet.mockReturnValue(undefined);

      expect(updateProfile('nonexistent', { name: 'Test' })).toBeUndefined();
    });

    it('updates prompts_json when prompts provided', () => {
      mockGet.mockReturnValueOnce(CUSTOM_PROFILE_ROW);
      mockGet.mockReturnValueOnce({ ...CUSTOM_PROFILE_ROW, prompts_json: '{"root_cause":{"systemPrompt":"new"}}' });

      updateProfile('custom-1', {
        prompts: { root_cause: { systemPrompt: 'new' } },
      });

      expect(mockRun).toHaveBeenCalled();
    });
  });

  describe('deleteProfile', () => {
    it('deletes a user-created profile', () => {
      mockGet.mockReturnValue(CUSTOM_PROFILE_ROW);
      mockGetSetting.mockReturnValue({ value: 'default' });

      const result = deleteProfile('custom-1');
      expect(result).toBe(true);
    });

    it('refuses to delete built-in profiles', () => {
      mockGet.mockReturnValue(DEFAULT_PROFILE_ROW);

      const result = deleteProfile('default');
      expect(result).toBe(false);
      expect(mockRun).not.toHaveBeenCalled();
    });

    it('returns false for nonexistent profile', () => {
      mockGet.mockReturnValue(undefined);

      expect(deleteProfile('nonexistent')).toBe(false);
    });

    it('switches to default when deleting active profile', () => {
      mockGet.mockReturnValue(CUSTOM_PROFILE_ROW);
      mockGetSetting.mockReturnValue({ value: 'custom-1' });

      deleteProfile('custom-1');

      // switchProfile calls getProfileById then setSetting
      expect(mockSetSetting).toHaveBeenCalled();
    });
  });

  describe('duplicateProfile', () => {
    it('creates a copy of the source profile', () => {
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

      const copy = duplicateProfile('security-audit', 'Security Copy');
      expect(copy).toBeDefined();
      expect(copy!.name).toBe('Security Copy');
      expect(copy!.isBuiltIn).toBe(false);
    });

    it('returns undefined for nonexistent source', () => {
      mockGet.mockReturnValue(undefined);

      expect(duplicateProfile('nonexistent', 'Copy')).toBeUndefined();
    });
  });

  describe('getActiveProfileId', () => {
    it('returns stored active profile ID', () => {
      mockGetSetting.mockReturnValue({ value: 'security-audit' });

      expect(getActiveProfileId()).toBe('security-audit');
    });

    it('defaults to "default" when no setting exists', () => {
      mockGetSetting.mockReturnValue(undefined);

      expect(getActiveProfileId()).toBe('default');
    });

    it('defaults to "default" when setting value is empty', () => {
      mockGetSetting.mockReturnValue({ value: '' });

      expect(getActiveProfileId()).toBe('default');
    });
  });

  describe('getActiveProfile', () => {
    it('returns the active profile', () => {
      mockGetSetting.mockReturnValue({ value: 'security-audit' });
      mockGet.mockReturnValue(SECURITY_PROFILE_ROW);

      const profile = getActiveProfile();
      expect(profile).toBeDefined();
      expect(profile!.id).toBe('security-audit');
    });
  });

  describe('switchProfile', () => {
    it('switches to a valid profile', () => {
      mockGet.mockReturnValue(SECURITY_PROFILE_ROW);

      const result = switchProfile('security-audit');
      expect(result).toBe(true);
      expect(mockSetSetting).toHaveBeenCalledWith('prompts.active_profile', 'security-audit', 'prompts');
    });

    it('returns false for nonexistent profile', () => {
      mockGet.mockReturnValue(undefined);

      expect(switchProfile('nonexistent')).toBe(false);
      expect(mockSetSetting).not.toHaveBeenCalled();
    });

    it('clears per-feature prompt overrides on switch', () => {
      mockGet.mockReturnValue(SECURITY_PROFILE_ROW);

      switchProfile('security-audit');

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
    it('returns prompt config for a feature from active profile', () => {
      mockGetSetting.mockReturnValue({ value: 'security-audit' });
      mockGet.mockReturnValue(SECURITY_PROFILE_ROW);

      const config = getProfilePromptConfig('chat_assistant');
      expect(config).toBeDefined();
      expect(config!.systemPrompt).toBe('Security-focused assistant');
    });

    it('returns undefined when feature not in profile', () => {
      mockGetSetting.mockReturnValue({ value: 'security-audit' });
      mockGet.mockReturnValue(SECURITY_PROFILE_ROW);

      const config = getProfilePromptConfig('capacity_forecast');
      expect(config).toBeUndefined();
    });

    it('returns undefined when active profile has no prompts', () => {
      mockGetSetting.mockReturnValue({ value: 'default' });
      mockGet.mockReturnValue(DEFAULT_PROFILE_ROW);

      const config = getProfilePromptConfig('chat_assistant');
      expect(config).toBeUndefined();
    });

    it('returns config with model and temperature overrides', () => {
      mockGetSetting.mockReturnValue({ value: 'custom-1' });
      mockGet.mockReturnValue(CUSTOM_PROFILE_ROW);

      const config = getProfilePromptConfig('chat_assistant');
      expect(config).toBeDefined();
      expect(config!.systemPrompt).toBe('Custom assistant');
      expect(config!.model).toBe('codellama');
      expect(config!.temperature).toBe(0.5);
    });

    it('returns undefined when profile does not exist', () => {
      mockGetSetting.mockReturnValue({ value: 'nonexistent' });
      mockGet.mockReturnValue(undefined);

      const config = getProfilePromptConfig('chat_assistant');
      expect(config).toBeUndefined();
    });
  });
});
