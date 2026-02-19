import { describe, it, expect, vi, beforeEach } from 'vitest';
import { roleLevel, hasMinRole } from './user-store.js';

vi.mock('../utils/crypto.js', () => ({
  hashPassword: vi.fn(async (p: string) => `hashed:${p}`),
  comparePassword: vi.fn(async (p: string, h: string) => h === `hashed:${p}`),
}));

describe('user-store', () => {
  describe('roleLevel', () => {
    it('should return correct levels', () => {
      expect(roleLevel('viewer')).toBe(0);
      expect(roleLevel('operator')).toBe(1);
      expect(roleLevel('admin')).toBe(2);
    });
  });

  describe('hasMinRole', () => {
    it('should allow admin for all roles', () => {
      expect(hasMinRole('admin', 'viewer')).toBe(true);
      expect(hasMinRole('admin', 'operator')).toBe(true);
      expect(hasMinRole('admin', 'admin')).toBe(true);
    });

    it('should allow operator for viewer and operator', () => {
      expect(hasMinRole('operator', 'viewer')).toBe(true);
      expect(hasMinRole('operator', 'operator')).toBe(true);
      expect(hasMinRole('operator', 'admin')).toBe(false);
    });

    it('should restrict viewer', () => {
      expect(hasMinRole('viewer', 'viewer')).toBe(true);
      expect(hasMinRole('viewer', 'operator')).toBe(false);
      expect(hasMinRole('viewer', 'admin')).toBe(false);
    });
  });
});
