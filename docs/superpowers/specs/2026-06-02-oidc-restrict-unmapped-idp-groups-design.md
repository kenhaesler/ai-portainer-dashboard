# OIDC: restrict access to defined groups only

**Date:** 2026-06-02
**Status:** Approved (design)

## Problem

Today every user who authenticates via OIDC/SSO gets at least `viewer`
access, even when their IDP groups match none of the configured
group→role mappings. The relevant line in the callback route
(`packages/foundation/src/routes/oidc.ts`) is:

```typescript
const effectiveRole = resolvedRole || existingUser?.role || 'viewer';
```

There is a `*` wildcard mapping mechanism, but no way to *deny* access to
users whose groups are not explicitly mapped — the hardcoded `|| 'viewer'`
fallback always grants a session. Operators who want "only defined groups
may sign in" cannot express that.

## Goal

Add a Settings → Security switch that controls whether the implicit
`viewer` fallback applies. When off, an OIDC login that resolves to no
mapped role is **denied outright** — only users in a defined group (or a
`*` wildcard mapping) may sign in.

## Decisions (from brainstorming)

1. **Deny behavior:** block login entirely (HTTP 403, no session created),
   not "log in with no role".
2. **Scope:** enforce for **everyone** on every login — role is derived
   only from current group membership. An *existing* user whose groups no
   longer match any mapping is blocked too (IDP group removal revokes
   access at next login).
3. **Default:** ships **restrictive** (switch off / key absent ⇒ deny).
   This is a behavior change on upgrade: existing OIDC deployments that
   relied on the implicit viewer fallback will block unmatched users until
   an admin defines mappings, adds a `*` wildcard, or turns the switch on.
   **Local auth is unaffected**, so the local admin account cannot be
   locked out.

## Design

### Setting

- **Key:** `oidc.allow_unmapped_viewer` (category `authentication`),
  stored in the `settings` table alongside the other `oidc.*` keys.
- **Label:** "Grant viewer role to all IDP users"
- **Help text:** "When on, any IDP user whose groups match no mapping is
  granted **viewer** access. When off, only users in a defined group (or a
  `*` wildcard mapping) can sign in — everyone else is denied."
- **Default:** `false`. Parsed as `=== 'true'`, so an absent key (existing
  deployments) is restrictive.

### Backend — `packages/core/src/services/oidc.ts`

- Add `allow_unmapped_viewer: boolean` to the `OIDCConfig` interface.
- Parse it in `getOIDCConfig()`:
  `allow_unmapped_viewer: settings['oidc.allow_unmapped_viewer'] === 'true'`.

### Backend — `packages/foundation/src/routes/oidc.ts` (the gate)

Insert a denial guard before the `effectiveRole` computation:

```typescript
const resolvedRole = resolveRoleFromGroups(
  claims.groups || [],
  oidcConfig.group_role_mappings,
);

// Restrictive mode: no matching group mapping (and no '*' wildcard) → deny.
// Applies to new AND existing users — role derives only from current groups.
if (!resolvedRole && !oidcConfig.allow_unmapped_viewer) {
  writeAuditLog({
    user_id: claims.sub,
    username,
    action: 'oidc_login_denied',
    target_type: 'user',
    target_id: claims.sub,
    details: { reason: 'no_matching_group', groups: claims.groups },
    request_id: request.requestId,
    ip_address: request.ip,
  });
  log.warn(
    { sub: claims.sub, groups: claims.groups },
    'OIDC login denied: no matching group mapping (restrictive mode)',
  );
  return reply.code(403).send({
    error: 'Access denied: your account is not in a group authorized for this dashboard.',
  });
}

const existingUser = await getUserById(claims.sub);
const effectiveRole = resolvedRole || existingUser?.role || 'viewer';
```

- No session is created on denial (we return before `createSession`).
- Add `403: ErrorResponseSchema` to the route's response schema.
- The `syncUserGroups` tracking call stays as-is (fires before the gate),
  so admins can still discover the group names of denied users to map.

### Frontend — `frontend/src/features/core/components/settings/shared.tsx`

Add one entry to the `authentication` settings array:

```typescript
{ key: 'oidc.allow_unmapped_viewer', label: 'Grant viewer role to all IDP users', type: 'boolean', defaultValue: 'false' },
```

It auto-renders as the existing boolean toggle in
Settings → Security → Authentication. No new component required.

## Testing

- `packages/foundation/src/__tests__/oidc-route.test.ts`:
  - restrictive + unmatched groups → 403, no session, `oidc_login_denied`
    audit entry;
  - restrictive + matched group → succeeds with mapped role;
  - restrictive + existing user now unmatched → 403 (enforce-for-everyone);
  - restrictive + `*` wildcard mapping → succeeds;
  - permissive (switch on) → preserves today's `viewer` fallback.
- `packages/core/src/services/oidc-group-mapping.test.ts` (or a config
  test): `getOIDCConfig()` parses `allow_unmapped_viewer`, default `false`.
- `backend/src/routes/security-regression-auth.test.ts`: regression
  asserting restrictive mode blocks an unmapped IDP login (security rule 6).

## Wildcard applies to zero-group users (review follow-up)

`resolveRoleFromGroups` previously short-circuited `return undefined` whenever
`groups` was empty — *before* the `*` wildcard check — so a `*` mapping did not
admit a user whose IdP sends an empty/absent groups claim. Under restrictive
mode that became a hard lockout despite an explicit wildcard, contradicting the
help text. Fixed by short-circuiting only on empty *mappings*; an empty groups
list now falls through to the wildcard fallback. Benefits permissive mode too
(such users get the wildcard role instead of the implicit viewer fallback).

## Docs

- `CLAUDE.md` — Security / OIDC behavior note.
- No new `.env.example` variable: this is a DB-stored Settings-UI value
  like the rest of `oidc.*`. (`docs/architecture.md` has no OIDC section, so
  the behavior note lives in `CLAUDE.md` and `docs/api-reference.md`.)

## Session revocation on denial (follow-up, implemented)

When a login is denied, the route also calls
`invalidateAllUserSessions(claims.sub)` (new in
`packages/core/src/services/session-store.ts`) to invalidate any lingering
server-side session for that user, so a prior login cannot outlive the
revocation. It is best-effort: a failure to revoke is logged but never turns
the `403` denial into a `400`/`500`.

**Remaining limitation:** revocation fires on the *next denied login*. A user
who was removed from their IDP group but never re-authenticates keeps their
existing session until it expires — closing that gap fully would require
re-validating group membership on every request (out of scope).
