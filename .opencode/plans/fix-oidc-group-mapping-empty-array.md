# Plan: Fix OIDC User Mapping for G-Konzern-Docker-Portainer-Admin

## Problem

User `simon.lutz@a1.lu.ch` is in the group `G-Konzern-Docker-Portainer-Admin` but does not get the Admin role after the recent fix (commit `4a44e65e`) that added nested OIDC group claim path support.

## Root Cause

In `packages/core/src/services/oidc.ts`, the `extractGroups` function (lines 376-379) has a bug in the realm_access.roles fallback logic:

```typescript
const raw = claims[groupsClaim];
if (Array.isArray(raw)) {
  return raw.filter((item): item is string => typeof item === 'string');
}
```

When the OIDC identity provider returns a `groups` claim as an **empty array** (`[]`) alongside `realm_access.roles` containing the actual group membership:

```json
{
  "groups": [],
  "realm_access": {
    "roles": ["G-Konzern-Docker-Portainer-Admin", "..."]
  }
}
```

The condition `Array.isArray([])` is `true`, so the function returns `[]` immediately — **never reaching** the `realm_access.roles` fallback (lines 383-391). This means the groups from `realm_access.roles` are silently dropped.

The recent fix (commit `4a44e65e`) added this fallback but didn't handle the case where `groups` is an empty array — it only checked `Array.isArray()` without verifying the array has content.

**Affected scenario**: Keycloak and similar IdPs that send both `groups: []` (empty) and `realm_access.roles: [...]` (with actual groups).

## Fix

Change the condition from "is array" to "is non-empty array" so that empty arrays fall through to the `realm_access.roles` fallback:

### File: `packages/core/src/services/oidc.ts` (lines 375-379)

**Before:**
```typescript
  // Flat lookup for simple claim names
  const raw = claims[groupsClaim];
  if (Array.isArray(raw)) {
    return raw.filter((item): item is string => typeof item === 'string');
  }
```

**After:**
```typescript
  // Flat lookup for simple claim names
  const raw = claims[groupsClaim];
  const flatGroups = Array.isArray(raw)
    ? raw.filter((item): item is string => typeof item === 'string')
    : undefined;

  // If the flat claim resolved to a non-empty array, use it directly.
  // Otherwise fall through to the realm_access.roles fallback (when
  // groupsClaim is 'groups') so that IdPs that return an empty groups
  // array alongside realm_access.roles still get their groups mapped.
  if (flatGroups.length) {
    return flatGroups;
  }
```

## Tests to Add

Add a test in `packages/core/src/services/oidc-group-mapping.test.ts` under the `extractGroups - nested claim paths` describe block:

```typescript
it('should fall back to realm_access.roles when groups is an empty array', () => {
  const claims = { groups: [], realm_access: { roles: ['G-Konzern-Docker-Portainer-Admin'] } };
  expect(extractGroups(claims, 'groups')).toEqual(['G-Konzern-Docker-Portainer-Admin']);
});
```

Update the existing test at line 882-886 in `backend/src/routes/security-regression-auth.test.ts` that asserts empty array returns `[]` — this test is **incorrect** and needs to be updated to reflect the corrected behavior (empty array should trigger the fallback when `groupsClaim === 'groups'`).

## Files Changed

1. `packages/core/src/services/oidc.ts` — fix `extractGroups` function
2. `packages/core/src/services/oidc-group-mapping.test.ts` — add test for empty groups array fallback
3. `backend/src/routes/security-regression-auth.test.ts` — fix incorrect regression test

## Why This Works

With the fix, when `claims.groups = []`:
1. `flatGroups` becomes `[]` (empty filtered array)
2. `flatGroups.length` is `0` (falsy)
3. Skips the early return, falls through to the `realm_access.roles` fallback
4. Extracts `['G-Konzern-Docker-Portainer-Admin']` from `realm_access.roles`
5. `resolveRoleFromGroups` matches against the configured mapping
6. User gets the Admin role
