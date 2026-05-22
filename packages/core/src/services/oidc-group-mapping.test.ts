import { describe, it, expect, vi } from 'vitest';

// Kept: openid-client mock — external dependency
vi.mock('openid-client', () => ({}));

import { resolveRoleFromGroups, extractGroups, stripGroupPrefix } from './oidc.js';

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

  describe('with URI-prefixed group claims', () => {
    it('should match bare mapping key against urn-prefixed group claim', () => {
      const result = resolveRoleFromGroups(
        ['urn:pingidentity.com:groups:G-Admin'],
        { 'G-Admin': 'admin' },
      );
      expect(result).toBe('admin');
    });

    it('should match bare mapping key against multi-segment urn-prefixed group claim', () => {
      const result = resolveRoleFromGroups(
        ['urn:vendor:product:groups:G-Admin'],
        { 'G-Admin': 'admin' },
      );
      expect(result).toBe('admin');
    });

    it('should match bare mapping key against https-prefixed group claim', () => {
      const result = resolveRoleFromGroups(
        ['https://idp.example.com/groups/G-Admin'],
        { 'G-Admin': 'admin' },
      );
      expect(result).toBe('admin');
    });

    it('should match URI-form mapping key against bare group claim (back-compat)', () => {
      const result = resolveRoleFromGroups(
        ['G-Admin'],
        { 'urn:pingidentity.com:groups:G-Admin': 'admin' },
      );
      expect(result).toBe('admin');
    });

    it('should match URI-form mapping key against URI-prefixed group claim (back-compat)', () => {
      const result = resolveRoleFromGroups(
        ['urn:pingidentity.com:groups:G-Admin'],
        { 'urn:pingidentity.com:groups:G-Admin': 'admin' },
      );
      expect(result).toBe('admin');
    });

    it('should preserve wildcard mapping verbatim (no stripping applied)', () => {
      const result = resolveRoleFromGroups(
        ['urn:pingidentity.com:groups:Unknown'],
        { 'G-Admin': 'admin', '*': 'viewer' },
      );
      expect(result).toBe('viewer');
    });

    it('should still pick highest-privilege role across URI-prefixed groups', () => {
      const result = resolveRoleFromGroups(
        [
          'urn:pingidentity.com:groups:G-Viewer',
          'urn:pingidentity.com:groups:G-Admin',
        ],
        { 'G-Viewer': 'viewer', 'G-Admin': 'admin' },
      );
      expect(result).toBe('admin');
    });

    it('should ignore mapping keys whose role is invalid even when key matches', () => {
      const result = resolveRoleFromGroups(
        ['urn:pingidentity.com:groups:G-Bad', 'G-Good'],
        {
          'G-Bad': 'superadmin' as never,
          'G-Good': 'operator',
        },
      );
      expect(result).toBe('operator');
    });
  });
});

describe('stripGroupPrefix', () => {
  it('strips urn:vendor:groups: prefix', () => {
    expect(stripGroupPrefix('urn:pingidentity.com:groups:G-Foo')).toBe('G-Foo');
  });

  it('strips multi-segment urn:vendor:product:groups: prefix', () => {
    expect(stripGroupPrefix('urn:vendor:product:groups:G-Foo')).toBe('G-Foo');
  });

  it('strips https://host/groups/ prefix', () => {
    expect(stripGroupPrefix('https://idp.example.com/groups/G-Foo')).toBe('G-Foo');
  });

  it('strips http://host/groups/ prefix', () => {
    expect(stripGroupPrefix('http://idp.example.com/groups/G-Foo')).toBe('G-Foo');
  });

  it('returns bare names unchanged', () => {
    expect(stripGroupPrefix('G-Foo')).toBe('G-Foo');
  });

  it('trims surrounding whitespace', () => {
    expect(stripGroupPrefix('  G-Foo  ')).toBe('G-Foo');
    expect(stripGroupPrefix('  urn:pingidentity.com:groups:G-Foo  ')).toBe('G-Foo');
  });

  it('returns empty string for empty / whitespace-only input', () => {
    expect(stripGroupPrefix('')).toBe('');
    expect(stripGroupPrefix('   ')).toBe('');
  });

  it('leaves prefix-only inputs untouched (no group name after prefix)', () => {
    expect(stripGroupPrefix('urn:pingidentity.com:groups:')).toBe(
      'urn:pingidentity.com:groups:',
    );
    expect(stripGroupPrefix('https://idp.example.com/groups/')).toBe(
      'https://idp.example.com/groups/',
    );
  });

  it('does not strip URLs that point at sub-paths other than /groups/', () => {
    expect(stripGroupPrefix('https://idp.example.com/users/Alice')).toBe(
      'https://idp.example.com/users/Alice',
    );
  });

  it('does not strip arbitrary colon-separated identifiers that are not group URNs', () => {
    expect(stripGroupPrefix('CN=Admins,OU=Groups,DC=corp,DC=local')).toBe(
      'CN=Admins,OU=Groups,DC=corp,DC=local',
    );
  });

  it('preserves wildcard sentinel verbatim', () => {
    expect(stripGroupPrefix('*')).toBe('*');
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

describe('extractGroups - nested claim paths', () => {
  it('should extract groups from realm_access.roles when groupsClaim is realm_access.roles', () => {
    const claims = { realm_access: { roles: ['Admins', 'Users'] } };
    expect(extractGroups(claims as Record<string, unknown>, 'realm_access.roles')).toEqual(['Admins', 'Users']);
  });

  it('should extract groups from realm_access.roles as groups_claim fallback', () => {
    const claims = { realm_access: { roles: ['Admins'] } };
    expect(extractGroups(claims, 'groups')).toEqual(['Admins']);
  });

  it('should NOT use realm_access.roles fallback when groups_claim is something else', () => {
    const claims = { roles: ['Admins'], realm_access: { roles: ['Users'] } };
    expect(extractGroups(claims as Record<string, unknown>, 'roles')).toEqual(['Admins']);
  });

  it('should handle deep nested paths', () => {
    const claims = { a: { b: { c: ['G1', 'G2'] } } };
    expect(extractGroups(claims as Record<string, unknown>, 'a.b.c')).toEqual(['G1', 'G2']);
  });

  it('should return empty when nested path does not exist', () => {
    const claims = { realm_access: {} };
    expect(extractGroups(claims as Record<string, unknown>, 'realm_access.roles')).toEqual([]);
  });

  it('should return empty when nested path points to non-array', () => {
    const claims = { realm_access: { roles: 'not-an-array' } };
    expect(extractGroups(claims as Record<string, unknown>, 'realm_access.roles')).toEqual([]);
  });

  it('should filter non-string values from nested claim', () => {
    const claims = { realm_access: { roles: ['Admins', 42, null, 'Users'] } };
    expect(extractGroups(claims as Record<string, unknown>, 'realm_access.roles')).toEqual(['Admins', 'Users']);
  });

  it('should handle flat groups claim alongside nested realm_access.roles (flat takes priority)', () => {
    const claims = { groups: ['FlatGroup'], realm_access: { roles: ['NestedGroup'] } };
    expect(extractGroups(claims, 'groups')).toEqual(['FlatGroup']);
  });

  it('should handle undefined nested path gracefully', () => {
    const claims = { sub: 'user1' };
    expect(extractGroups(claims as Record<string, unknown>, 'realm_access.roles')).toEqual([]);
  });

  it('should handle nested path where intermediate value is not an object', () => {
    const claims = { realm_access: 'string-not-object' };
    expect(extractGroups(claims as Record<string, unknown>, 'realm_access.roles')).toEqual([]);
  });

  it('should fall back to realm_access.roles only when flat groups is not an array', () => {
    const claims = { groups: 'not-an-array', realm_access: { roles: ['FallbackGroup'] } };
    expect(extractGroups(claims, 'groups')).toEqual(['FallbackGroup']);
  });

  it('should fall back to realm_access.roles when flat groups is an empty array', () => {
    const claims = { groups: [], realm_access: { roles: ['G-Konzern-Docker-Portainer-Admin'] } };
    expect(extractGroups(claims, 'groups')).toEqual(['G-Konzern-Docker-Portainer-Admin']);
  });
});
