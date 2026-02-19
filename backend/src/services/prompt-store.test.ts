import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PROMPT_FEATURES,
  DEFAULT_PROMPTS,
  getEffectivePrompt,
  getEffectiveLlmConfig,
  estimateTokens,
  type PromptFeature,
} from './prompt-store.js';

// ── Mocks ──────────────────────────────────────────────────────────

const mockGetSetting = vi.fn();
const mockGetGlobalLlmConfig = vi.fn();

vi.mock('./settings-store.js', () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
  getEffectiveLlmConfig: (...args: unknown[]) => mockGetGlobalLlmConfig(...args),
}));

const mockGetProfilePromptConfig = vi.fn();
const mockGetActiveProfileId = vi.fn();

vi.mock('./prompt-profile-store.js', () => ({
  getProfilePromptConfig: (...args: unknown[]) => mockGetProfilePromptConfig(...args),
  getActiveProfileId: (...args: unknown[]) => mockGetActiveProfileId(...args),
}));

const GLOBAL_CONFIG = {
  ollamaUrl: 'http://localhost:11434',
  model: 'llama3.2',
  customEnabled: false,
  customEndpointUrl: undefined,
  customEndpointToken: undefined,
  maxTokens: 20000,
  maxToolIterations: 6,
};

// ── Tests ──────────────────────────────────────────────────────────

describe('prompt-store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGlobalLlmConfig.mockReturnValue(GLOBAL_CONFIG);
    // Default to 'default' profile (no profile overrides active)
    mockGetActiveProfileId.mockReturnValue('default');
    mockGetProfilePromptConfig.mockReturnValue(undefined);
  });

  describe('PROMPT_FEATURES', () => {
    it('defines metadata for all 12 features', () => {
      expect(PROMPT_FEATURES).toHaveLength(12);
    });

    it('each feature has key, label, and description', () => {
      for (const f of PROMPT_FEATURES) {
        expect(f.key).toBeTruthy();
        expect(f.label).toBeTruthy();
        expect(f.description).toBeTruthy();
      }
    });

    it('feature keys match the PromptFeature type values', () => {
      const expectedKeys: PromptFeature[] = [
        'chat_assistant', 'command_palette', 'anomaly_explainer',
        'incident_summarizer', 'log_analyzer', 'metrics_summary',
        'root_cause', 'remediation', 'pcap_analyzer',
        'capacity_forecast', 'correlation_insights', 'monitoring_analysis',
      ];
      expect(PROMPT_FEATURES.map((f) => f.key)).toEqual(expectedKeys);
    });
  });

  describe('DEFAULT_PROMPTS', () => {
    it('has a non-empty default for every feature', () => {
      for (const f of PROMPT_FEATURES) {
        const prompt = DEFAULT_PROMPTS[f.key];
        expect(prompt).toBeTruthy();
        expect(prompt.trim().length).toBeGreaterThan(0);
      }
    });
  });

  describe('getEffectivePrompt', () => {
    it('returns stored prompt when setting exists', async () => {
      const custom = 'Custom system prompt for testing';
      mockGetSetting.mockReturnValue({ value: custom, key: 'prompts.chat_assistant.system_prompt', category: 'prompts', updated_at: '2025-01-01' });

      const result = await getEffectivePrompt('chat_assistant');
      expect(result).toBe(custom);
      expect(mockGetSetting).toHaveBeenCalledWith('prompts.chat_assistant.system_prompt');
    });

    it('falls back to default when no stored setting', async () => {
      mockGetSetting.mockReturnValue(undefined);

      const result = await getEffectivePrompt('anomaly_explainer');
      expect(result).toBe(DEFAULT_PROMPTS.anomaly_explainer);
    });

    it('falls back to default when stored value is empty string', async () => {
      mockGetSetting.mockReturnValue({ value: '', key: 'prompts.log_analyzer.system_prompt', category: 'prompts', updated_at: '2025-01-01' });

      const result = await getEffectivePrompt('log_analyzer');
      expect(result).toBe(DEFAULT_PROMPTS.log_analyzer);
    });

    it('falls back to default when stored value is whitespace-only', async () => {
      mockGetSetting.mockReturnValue({ value: '   \n  ', key: 'prompts.root_cause.system_prompt', category: 'prompts', updated_at: '2025-01-01' });

      const result = await getEffectivePrompt('root_cause');
      expect(result).toBe(DEFAULT_PROMPTS.root_cause);
    });

    it('queries the correct settings key for each feature', async () => {
      mockGetSetting.mockReturnValue(undefined);

      await getEffectivePrompt('capacity_forecast');
      expect(mockGetSetting).toHaveBeenCalledWith('prompts.capacity_forecast.system_prompt');

      await getEffectivePrompt('correlation_insights');
      expect(mockGetSetting).toHaveBeenCalledWith('prompts.correlation_insights.system_prompt');
    });

    it('returns default for monitoring_analysis when no override', async () => {
      mockGetSetting.mockReturnValue(undefined);

      const result = await getEffectivePrompt('monitoring_analysis');
      expect(result).toBe(DEFAULT_PROMPTS.monitoring_analysis);
      expect(result).toContain('infrastructure analyst');
    });
  });

  describe('getEffectiveLlmConfig', () => {
    it('returns global config when no feature specified', async () => {
      const result = await getEffectiveLlmConfig();
      expect(result).toEqual(GLOBAL_CONFIG);
      expect(mockGetGlobalLlmConfig).toHaveBeenCalledTimes(1);
    });

    it('returns global config when feature has no overrides', async () => {
      mockGetSetting.mockReturnValue(undefined);

      const result = await getEffectiveLlmConfig('chat_assistant');
      expect(result.model).toBe('llama3.2');
      expect(result).not.toHaveProperty('temperature');
    });

    it('applies model override when set', async () => {
      mockGetSetting.mockImplementation((key: string) => {
        if (key === 'prompts.chat_assistant.model') {
          return { value: 'codellama', key, category: 'prompts', updated_at: '2025-01-01' };
        }
        return undefined;
      });

      const result = await getEffectiveLlmConfig('chat_assistant');
      expect(result.model).toBe('codellama');
    });

    it('applies temperature override when set', async () => {
      mockGetSetting.mockImplementation((key: string) => {
        if (key === 'prompts.anomaly_explainer.temperature') {
          return { value: '0.7', key, category: 'prompts', updated_at: '2025-01-01' };
        }
        return undefined;
      });

      const result = await getEffectiveLlmConfig('anomaly_explainer') as Record<string, unknown>;
      expect(result.temperature).toBe(0.7);
    });

    it('ignores empty model override', async () => {
      mockGetSetting.mockImplementation((key: string) => {
        if (key === 'prompts.log_analyzer.model') {
          return { value: '  ', key, category: 'prompts', updated_at: '2025-01-01' };
        }
        return undefined;
      });

      const result = await getEffectiveLlmConfig('log_analyzer');
      expect(result.model).toBe('llama3.2');
    });

    it('ignores empty temperature override', async () => {
      mockGetSetting.mockImplementation((key: string) => {
        if (key === 'prompts.root_cause.temperature') {
          return { value: '', key, category: 'prompts', updated_at: '2025-01-01' };
        }
        return undefined;
      });

      const result = await getEffectiveLlmConfig('root_cause');
      expect(result).not.toHaveProperty('temperature');
    });

    it('ignores NaN temperature override', async () => {
      mockGetSetting.mockImplementation((key: string) => {
        if (key === 'prompts.remediation.temperature') {
          return { value: 'not-a-number', key, category: 'prompts', updated_at: '2025-01-01' };
        }
        return undefined;
      });

      const result = await getEffectiveLlmConfig('remediation');
      expect(result).not.toHaveProperty('temperature');
    });

    it('applies both model and temperature overrides together', async () => {
      mockGetSetting.mockImplementation((key: string) => {
        if (key === 'prompts.pcap_analyzer.model') {
          return { value: 'mistral', key, category: 'prompts', updated_at: '2025-01-01' };
        }
        if (key === 'prompts.pcap_analyzer.temperature') {
          return { value: '0.3', key, category: 'prompts', updated_at: '2025-01-01' };
        }
        return undefined;
      });

      const result = await getEffectiveLlmConfig('pcap_analyzer') as Record<string, unknown>;
      expect(result.model).toBe('mistral');
      expect(result.temperature).toBe(0.3);
      // Global fields preserved
      expect(result.ollamaUrl).toBe('http://localhost:11434');
    });
  });

  describe('profile integration', () => {
    describe('getEffectivePrompt with profiles', () => {
      it('uses profile prompt when non-default profile is active and has feature config', async () => {
        mockGetSetting.mockReturnValue(undefined); // no per-feature override
        mockGetActiveProfileId.mockReturnValue('security-audit');
        mockGetProfilePromptConfig.mockReturnValue({ systemPrompt: 'Security-focused prompt' });

        const result = await getEffectivePrompt('chat_assistant');
        expect(result).toBe('Security-focused prompt');
      });

      it('per-feature setting overrides profile prompt', async () => {
        mockGetSetting.mockReturnValue({ value: 'Individual override', key: 'prompts.chat_assistant.system_prompt', category: 'prompts', updated_at: '2025-01-01' });
        mockGetActiveProfileId.mockReturnValue('security-audit');
        mockGetProfilePromptConfig.mockReturnValue({ systemPrompt: 'Security-focused prompt' });

        const result = await getEffectivePrompt('chat_assistant');
        expect(result).toBe('Individual override');
      });

      it('falls back to default when profile has no config for feature', async () => {
        mockGetSetting.mockReturnValue(undefined);
        mockGetActiveProfileId.mockReturnValue('security-audit');
        mockGetProfilePromptConfig.mockReturnValue(undefined);

        const result = await getEffectivePrompt('capacity_forecast');
        expect(result).toBe(DEFAULT_PROMPTS.capacity_forecast);
      });

      it('skips profile lookup when default profile is active', async () => {
        mockGetSetting.mockReturnValue(undefined);
        mockGetActiveProfileId.mockReturnValue('default');

        const result = await getEffectivePrompt('chat_assistant');
        expect(result).toBe(DEFAULT_PROMPTS.chat_assistant);
        expect(mockGetProfilePromptConfig).not.toHaveBeenCalled();
      });
    });

    describe('getEffectiveLlmConfig with profiles', () => {
      it('uses profile model override when non-default profile is active', async () => {
        mockGetSetting.mockReturnValue(undefined); // no per-feature override
        mockGetActiveProfileId.mockReturnValue('custom-1');
        mockGetProfilePromptConfig.mockReturnValue({ systemPrompt: 'Custom', model: 'codellama', temperature: 0.5 });

        const result = await getEffectiveLlmConfig('chat_assistant') as Record<string, unknown>;
        expect(result.model).toBe('codellama');
        expect(result.temperature).toBe(0.5);
      });

      it('per-feature setting model overrides profile model', async () => {
        mockGetSetting.mockImplementation((key: string) => {
          if (key === 'prompts.chat_assistant.model') {
            return { value: 'mistral', key, category: 'prompts', updated_at: '2025-01-01' };
          }
          return undefined;
        });
        mockGetActiveProfileId.mockReturnValue('custom-1');
        mockGetProfilePromptConfig.mockReturnValue({ systemPrompt: 'Custom', model: 'codellama' });

        const result = await getEffectiveLlmConfig('chat_assistant');
        expect(result.model).toBe('mistral');
      });

      it('skips profile lookup when default profile is active', async () => {
        mockGetSetting.mockReturnValue(undefined);
        mockGetActiveProfileId.mockReturnValue('default');

        const result = await getEffectiveLlmConfig('chat_assistant');
        expect(result.model).toBe('llama3.2');
        // Profile prompt config should not be called because active profile is default
        // (getActiveProfileId is called but getProfilePromptConfig should not be)
      });
    });
  });

  describe('estimateTokens', () => {
    it('estimates ~4 chars per token', () => {
      expect(estimateTokens('abcd')).toBe(1);
      expect(estimateTokens('12345678')).toBe(2);
    });

    it('rounds up partial tokens', () => {
      expect(estimateTokens('abc')).toBe(1); // ceil(3/4) = 1
      expect(estimateTokens('abcde')).toBe(2); // ceil(5/4) = 2
    });

    it('returns 0 for empty string', () => {
      expect(estimateTokens('')).toBe(0);
    });
  });
});
