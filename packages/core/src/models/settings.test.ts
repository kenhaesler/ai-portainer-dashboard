import { describe, it, expect } from 'vitest';
import { SettingSchema } from './settings.js';

describe('Settings Models', () => {
  describe('SettingSchema', () => {
    it('should validate a complete setting', () => {
      const setting = {
        key: 'theme',
        value: 'dark',
        category: 'appearance',
        updated_at: '2024-01-15T10:30:00.000Z',
      };

      const result = SettingSchema.safeParse(setting);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.key).toBe('theme');
        expect(result.data.value).toBe('dark');
      }
    });

    it('should validate different categories', () => {
      const categories = ['general', 'appearance', 'monitoring', 'alerts', 'backup'];

      for (const category of categories) {
        const setting = {
          key: 'test-key',
          value: 'test-value',
          category,
          updated_at: '2024-01-15T10:30:00.000Z',
        };

        const result = SettingSchema.safeParse(setting);
        expect(result.success).toBe(true);
      }
    });

    it('should accept JSON stringified values', () => {
      const setting = {
        key: 'retention_config',
        value: JSON.stringify({ days: 30, enabled: true }),
        category: 'backup',
        updated_at: '2024-01-15T10:30:00.000Z',
      };

      const result = SettingSchema.safeParse(setting);
      expect(result.success).toBe(true);
      if (result.success) {
        const parsed = JSON.parse(result.data.value);
        expect(parsed.days).toBe(30);
      }
    });

    it('should accept numeric string values', () => {
      const setting = {
        key: 'refresh_interval',
        value: '30',
        category: 'monitoring',
        updated_at: '2024-01-15T10:30:00.000Z',
      };

      const result = SettingSchema.safeParse(setting);
      expect(result.success).toBe(true);
    });

    it('should accept boolean string values', () => {
      const settings = [
        { key: 'enabled', value: 'true', category: 'alerts', updated_at: '2024-01-15T10:30:00.000Z' },
        { key: 'disabled', value: 'false', category: 'alerts', updated_at: '2024-01-15T10:30:00.000Z' },
      ];

      for (const setting of settings) {
        const result = SettingSchema.safeParse(setting);
        expect(result.success).toBe(true);
      }
    });

    it('should accept empty string value', () => {
      const setting = {
        key: 'optional_field',
        value: '',
        category: 'general',
        updated_at: '2024-01-15T10:30:00.000Z',
      };

      const result = SettingSchema.safeParse(setting);
      expect(result.success).toBe(true);
    });

    it('should reject missing key', () => {
      const setting = {
        value: 'test',
        category: 'general',
        updated_at: '2024-01-15T10:30:00.000Z',
      };

      const result = SettingSchema.safeParse(setting);
      expect(result.success).toBe(false);
    });

    it('should reject missing value', () => {
      const setting = {
        key: 'test',
        category: 'general',
        updated_at: '2024-01-15T10:30:00.000Z',
      };

      const result = SettingSchema.safeParse(setting);
      expect(result.success).toBe(false);
    });

    it('should reject missing category', () => {
      const setting = {
        key: 'test',
        value: 'test',
        updated_at: '2024-01-15T10:30:00.000Z',
      };

      const result = SettingSchema.safeParse(setting);
      expect(result.success).toBe(false);
    });

    it('should reject missing updated_at', () => {
      const setting = {
        key: 'test',
        value: 'test',
        category: 'general',
      };

      const result = SettingSchema.safeParse(setting);
      expect(result.success).toBe(false);
    });

    it('should reject non-string key', () => {
      const setting = {
        key: 123,
        value: 'test',
        category: 'general',
        updated_at: '2024-01-15T10:30:00.000Z',
      };

      const result = SettingSchema.safeParse(setting);
      expect(result.success).toBe(false);
    });

    it('should handle special characters in key and value', () => {
      const setting = {
        key: 'api.endpoint.url',
        value: 'https://example.com?foo=bar&baz=qux',
        category: 'general',
        updated_at: '2024-01-15T10:30:00.000Z',
      };

      const result = SettingSchema.safeParse(setting);
      expect(result.success).toBe(true);
    });

    it('should handle unicode in values', () => {
      const setting = {
        key: 'greeting',
        value: 'Hello 世界 🌍',
        category: 'general',
        updated_at: '2024-01-15T10:30:00.000Z',
      };

      const result = SettingSchema.safeParse(setting);
      expect(result.success).toBe(true);
    });

    it('should handle long values', () => {
      const setting = {
        key: 'long_config',
        value: 'a'.repeat(10000),
        category: 'general',
        updated_at: '2024-01-15T10:30:00.000Z',
      };

      const result = SettingSchema.safeParse(setting);
      expect(result.success).toBe(true);
    });
  });
});
