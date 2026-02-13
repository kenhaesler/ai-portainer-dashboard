import { describe, it, expect, vi } from 'vitest';

vi.mock('../db/sqlite.js', () => ({ getDb: vi.fn() }));
vi.mock('openid-client', () => ({}));
vi.mock('../utils/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { resolveRoleFromGroups, extractGroups } from './oidc.js';

describe('resolveRoleFromGroups', () => {
  it('should return undefined when groups array is empty', () => {
    const result = resolveRoleFromGroups([], { 'Admins': 'admin' });
    expect(result).toBeUndefined();
  });

  it('should return undefined when mappings are empty', () => {
    const result = resolveRoleFromGroups(['Admins'], {});
    expect(result).toBeUndefined();
  });

  it('should return the mapped role for a single matching group', () => {
    const result = resolveRoleFromGroups(
      ['Dashboard-Admins'],
      { 'Dashboard-Admins': 'admin' },
    );
    expect(result).toBe('admin');
  });

  it('should return the highest-privilege role when user has multiple matching groups', () => {
    const result = resolveRoleFromGroups(
      ['Viewers', 'Operators', 'Admins'],
      {
        'Viewers': 'viewer',
        'Operators': 'operator',
        'Admins': 'admin',
      },
    );
    expect(result).toBe('admin');
  });

  it('should use highest-privilege-wins regardless of group order', () => {
    const result = resolveRoleFromGroups(
      ['Admins', 'Viewers'],
      {
        'Admins': 'admin',
        'Viewers': 'viewer',
      },
    );
    expect(result).toBe('admin');
  });

  it('should use wildcard fallback when no explicit match', () => {
    const result = resolveRoleFromGroups(
      ['Unknown-Group'],
      {
        'Admins': 'admin',
        '*': 'viewer',
      },
    );
    expect(result).toBe('viewer');
  });

  it('should prefer explicit match over wildcard', () => {
    const result = resolveRoleFromGroups(
      ['Operators'],
      {
        'Operators': 'operator',
        '*': 'viewer',
      },
    );
    expect(result).toBe('operator');
  });

  it('should ignore groups with empty or whitespace-only names', () => {
    const result = resolveRoleFromGroups(
      ['', '  ', 'Admins'],
      { 'Admins': 'admin' },
    );
    expect(result).toBe('admin');
  });

  it('should return undefined when no groups match and no wildcard', () => {
    const result = resolveRoleFromGroups(
      ['Unknown-Group'],
      { 'Admins': 'admin' },
    );
    expect(result).toBeUndefined();
  });

  it('should ignore invalid role values in mappings', () => {
    const result = resolveRoleFromGroups(
      ['BadGroup', 'GoodGroup'],
      {
        'BadGroup': 'superadmin' as never,
        'GoodGroup': 'operator',
      },
    );
    expect(result).toBe('operator');
  });

  it('should handle wildcard as the only mapping', () => {
    const result = resolveRoleFromGroups(
      ['AnyGroup'],
      { '*': 'operator' },
    );
    expect(result).toBe('operator');
  });

  it('should return operator when one group is operator and another is viewer', () => {
    const result = resolveRoleFromGroups(
      ['Team-A', 'Team-B'],
      {
        'Team-A': 'viewer',
        'Team-B': 'operator',
      },
    );
    expect(result).toBe('operator');
  });
});

describe('extractGroups', () => {
  it('should extract groups from the specified claim', () => {
    const claims = { groups: ['Admin', 'Users'] };
    expect(extractGroups(claims, 'groups')).toEqual(['Admin', 'Users']);
  });

  it('should return empty array when claim is missing', () => {
    const claims = { sub: 'user1' };
    expect(extractGroups(claims, 'groups')).toEqual([]);
  });

  it('should return empty array when claim is not an array', () => {
    const claims = { groups: 'Admin' };
    expect(extractGroups(claims, 'groups')).toEqual([]);
  });

  it('should filter out non-string values from the array', () => {
    const claims = { groups: ['Admin', 42, null, 'Users', true] };
    expect(extractGroups(claims, 'groups')).toEqual(['Admin', 'Users']);
  });

  it('should work with custom claim names', () => {
    const claims = { 'realm_access': { roles: ['admin'] }, 'custom-groups': ['Group1'] };
    expect(extractGroups(claims, 'custom-groups')).toEqual(['Group1']);
  });

  it('should return empty array when claim is null', () => {
    const claims = { groups: null };
    expect(extractGroups(claims, 'groups')).toEqual([]);
  });

  it('should return empty array when claim is an empty array', () => {
    const claims = { groups: [] };
    expect(extractGroups(claims, 'groups')).toEqual([]);
  });

  it('should handle nested claim paths (flat lookup only)', () => {
    const claims = { 'roles': ['viewer'] };
    expect(extractGroups(claims, 'roles')).toEqual(['viewer']);
  });
});
