# Plan: Fix Airlock IDP Group-to-Role Mapping (Empty `groups` Array Bypasses Fallback)

## Problem

User `simon.lutz@a1.lu.ch` is in group `G-Konzern-Docker-Portainer-Admin` but does not get the Admin role after the recent fix (commit `4a44e65e` on branch `feature/fix-oidc-nested-group-claims`) that added nested OIDC group claim path support.

## Root Cause

In `packages/core/src/services/oidc.ts`, the `extractGroups` function (lines 375-379) has a bug in the `realm_access.roles` fallback logic:

**Airlock IDP returns tokens like this:**
```json
{
  "groups": [],
  "realm_access": {
    "roles": ["G-Konzern-Docker-Portainer-Admin", "..."]
  },
  ...
}
```

The code at line 377 checks `if (Array.isArray(raw))` — since `[]` is an array, it returns `[]` immediately, **never reaching** the `realm_access.roles` fallback on lines 383-391. The groups from `realm_access.roles` are silently dropped, so `resolveRoleFromGroups` receives an empty array and returns `undefined`, causing the user to default to `viewer`.

The recent fix (commit `4a44e65e`) added the fallback but only checked `Array.isArray()` without verifying the array is non-empty. Empty arrays still short-circuit the fallback.

## Fix

**File: `packages/core/src/services/oidc.ts` (lines 375-379)**

Replace:
```typescript
  // Flat lookup for simple claim names
  const raw = claims[groupsClaim];
  if (Array.isArray(raw)) {
    return raw.filter((item): item is string => typeof item === 'string');
  }
```

With:
```typescript
  // Flat lookup for simple claim names
  const raw = claims[groupsClaim];
  const flatGroups = Array.isArray(raw)
    ? raw.filter((item): item is string => typeof item === 'string')
    : undefined;

  // If the flat claim resolved to a non-empty array, use it directly.
  // Otherwise fall through to the realm_access.roles fallback (when
  // groupsClaim is 'groups') so that IdPs (e.g. Airlock, Keycloak) that
  // return an empty groups array alongside realm_access.roles still get
  // their groups extracted and mapped to roles.
  if (flatGroups.length) {
    return flatGroups;
  }
```

## Test Changes

### 1. Fix incorrect regression test

**File: `backend/src/routes/security-regression-auth.test.ts` (lines 882-886)**

The test at line 882 asserts that empty `groups: []` should NOT trigger the `realm_access.roles` fallback. This is the **bug** — it needs to be updated to reflect the correct behavior:

Replace the test description and assertion:
```typescript
  it('should fall back to realm_access.roles when flat groups claim is an empty array', () => {
    const claims = { groups: [], realm_access: { roles: ['SomeGroup'] } };
    const groups = extractGroups(claims, 'groups');
    expect(groups).toEqual(['SomeGroup']);
  });
```

### 2. Add Airlock-specific regression test

**File: `backend/src/routes/security-regression-auth.test.ts`** — add after line 886:

```typescript
  it('should extract G-Konzern-Docker-Portainer-Admin from realm_access.roles when groups is empty (Airlock IDP)', () => {
    const claims = {
      groups: [],
      realm_access: { roles: ['G-Konzern-Docker-Portainer-Admin'] },
    };
    const groups = extractGroups(claims, 'groups');
    expect(groups).toEqual(['G-Konzern-Docker-Portainer-Admin']);
    expect(resolveRoleFromGroups(groups, { 'G-Konzern-Docker-Portainer-Admin': 'admin' })).toBe('admin');
  });
```

### 3. Add unit test in core package

**File: `packages/core/src/services/oidc-group-mapping.test.ts`** — add in the `extractGroups - nested claim paths` describe block:

```typescript
  it('should fall back to realm_access.roles when groups is an empty array', () => {
    const claims = { groups: [], realm_access: { roles: ['G-Konzern-Docker-Portainer-Admin'] } };
    expect(extractGroups(claims, 'groups')).toEqual(['G-Konzern-Docker-Portainer-Admin']);
  });
```

## Execution Steps

1. Create branch `feature/fix-oidc-empty-groups-fallback` from `feature/fix-oidc-nested-group-claims`
2. Apply fix to `packages/core/src/services/oidc.ts`
3. Fix incorrect test in `backend/src/routes/security-regression-auth.test.ts`
4. Add new regression test in `backend/src/routes/security-regression-auth.test.ts`
5. Add new unit test in `packages/core/src/services/oidc-group-mapping.test.ts`
6. Run `pnpm test` to verify all tests pass
7. Commit: `fix: handle empty groups array in OIDC extractGroups fallback`
8. Push and create PR targeting `origin/dev`

## Why This Works

With the fix, when Airlock returns `groups: []`:
1. `flatGroups` is computed as `[]` (filtered empty array)
2. `flatGroups.length` is `0` (falsy) → skips early return
3. Falls through to `realm_access.roles` fallback (line 383-391)
4. Extracts `['G-Konzern-Docker-Portainer-Admin']` from `realm_access.roles`
5. `resolveRoleFromGroups()` matches against configured mapping → `'admin'`
6. User gets the Admin role
