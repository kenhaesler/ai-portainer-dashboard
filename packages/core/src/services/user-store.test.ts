import { describe, it, expect, vi, beforeEach } from 'vitest';
import { roleLevel, hasMinRole, authenticateUser } from './user-store.js';
import { comparePassword } from '../utils/crypto.js';

// Kept: crypto mock — file I/O and bcrypt dependency
vi.mock('../utils/crypto.js', () => ({
  hashPassword: vi.fn(async (p: string) => `hashed:${p}`),
  comparePassword: vi.fn(async (p: string, h: string) => h === `hashed:${p}`),
}));

// DB mock — authenticateUser looks the user up via getUserByUsername.
const mockQueryOne = vi.fn(async () => null);
vi.mock('../db/app-db-router.js', () => ({
  getDbForDomain: () => ({
    queryOne: (...args: unknown[]) => mockQueryOne(...(args as [])),
    query: vi.fn(async () => []),
    execute: vi.fn(async () => ({ changes: 0 })),
  }),
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

  // SECURITY REGRESSION: username enumeration via login timing. An unknown
  // username must still run a bcrypt comparison so its response time matches a
  // known username's, instead of returning early before any hashing.
  describe('authenticateUser timing equalisation', () => {
    beforeEach(() => {
      vi.mocked(comparePassword).mockClear();
      mockQueryOne.mockResolvedValue(null);
    });

    it('runs a bcrypt comparison even when the username does not exist', async () => {
      const result = await authenticateUser('no-such-user', 'whatever');
      expect(result).toBeNull();
      // The dummy comparison must have run (defeats the early-return timing oracle).
      expect(comparePassword).toHaveBeenCalledTimes(1);
    });
  });
});
