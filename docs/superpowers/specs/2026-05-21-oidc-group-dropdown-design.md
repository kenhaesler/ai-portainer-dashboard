# OIDC Group-to-Role Mapping: Searchable Dropdown of Discovered Groups

**Status:** Approved — ready for implementation plan
**Date:** 2026-05-21
**Branch:** `feature/1281-oidc-group-prefix-stripping`
**Related:** Builds on the existing `GroupRoleMappingEditor` (commits `f5961e44`, `dbcb39d8`)

## Problem

The OIDC group-to-role mapping editor in Settings → Security currently provides an
autocomplete, but it only suggests group names the admin has *already typed into
other rows of the same table*. There is no way to see which groups actually exist
on the IdP. Administrators have to know group names ahead of time, paste them in
manually, and risk typos that silently downgrade every user in the affected group
to `viewer`.

We want the dropdown to surface **every group the dashboard has ever observed
through OIDC logins** — with enough context (user count, last-seen date) for the
admin to distinguish active from stale groups — while still allowing them to type
in a brand-new group that nobody has logged in with yet.

## Scope

In scope:

- Persist groups observed on each OIDC login.
- Expose a single admin-only endpoint that returns the aggregated list.
- Render that list inside the existing autocomplete in `GroupRoleMappingEditor`,
  enriched with `user_count` and `last_seen_at`.

Out of scope (explicitly deferred):

- Direct IdP queries (Microsoft Graph, Okta SCIM, etc.).
- Bulk "import all groups → create mapping" actions.
- Per-user group membership UI (the schema enables it, but no view is built in
  this spec).

## Architecture

### 1. Data model

A single new table tracks the (user, group) pairs currently claimed via OIDC.
This is the source of truth for both the group list and the per-group user
counts.

```sql
CREATE TABLE oidc_user_groups (
  user_sub      TEXT NOT NULL,
  group_name    TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_sub, group_name)
);

CREATE INDEX idx_oidc_user_groups_group ON oidc_user_groups(group_name);
```

- `group_name` stores the **prefix-stripped** form. The same
  `stripGroupPrefix()` helper already exported from
  `packages/core/src/services/oidc.ts` is used both when writing rows and when
  matching them against mapping keys, so the dropdown values always look like
  what an admin types into the mapping editor.
- Migration file: `packages/core/src/db/postgres-migrations/034_oidc_user_groups.sql`.

### 2. Sync on OIDC login

A new service `syncUserGroups(userSub, rawGroups)` is added in
`packages/core/src/services/oidc-group-tracking.ts`. It runs inside one
transaction and:

1. Maps each `rawGroups` entry through `stripGroupPrefix()` (deduping the
   resulting list).
2. Upserts every `(userSub, group)` pair:
   `INSERT … ON CONFLICT (user_sub, group_name) DO UPDATE SET last_seen_at = NOW()`.
3. Deletes any rows for that `userSub` whose `group_name` is no longer in the
   current claim set, so the table reflects the user *leaving* a group on their
   next login.

The OIDC callback handler in `packages/foundation/src/routes/oidc.ts` calls this
service immediately after `exchangeCode()` resolves and before the audit log is
written. **Failures are caught, logged at `warn`, and swallowed** — group
tracking is a UX nicety, never a reason to block authentication.

### 3. API endpoint

```
GET /api/auth/oidc/discovered-groups
```

- Registered alongside the existing OIDC routes in
  `packages/foundation/src/routes/oidc.ts`.
- Auth: `fastify.authenticate` **and** `fastify.requireRole('admin')`
  (CLAUDE.md mandates explicit admin role for sensitive reads).
- No request body / query parameters.
- Response (Zod-validated):

```ts
{
  groups: Array<{
    group_name: string;
    user_count: number;     // distinct users currently claiming this group
    last_seen_at: string;   // ISO timestamp
  }>;
}
```

- Aggregation query:

```sql
SELECT group_name,
       COUNT(DISTINCT user_sub)::integer AS user_count,
       MAX(last_seen_at)                 AS last_seen_at
FROM oidc_user_groups
GROUP BY group_name
ORDER BY last_seen_at DESC, group_name ASC;
```

- `COUNT(*)` is cast to `integer` per the project's PostgreSQL-driver memory
  rule. No server-side caching — the table is small and the endpoint is rarely
  hit; the frontend caches via TanStack Query (`staleTime: 60_000`).

### 4. Frontend data hook

A new hook `useDiscoveredOidcGroups()` lives at
`frontend/src/features/core/hooks/use-discovered-oidc-groups.ts`:

```ts
useQuery({
  queryKey: ['oidc', 'discovered-groups'],
  queryFn: () => api.get('/api/auth/oidc/discovered-groups'),
  staleTime: 60_000,
  enabled: isAdmin && oidcEnabled,
});
```

`isAdmin` and `oidcEnabled` are passed in by the Settings → Security tab so the
query is gated where the data is actually needed. On error the hook returns an
empty array, and the editor degrades gracefully to its current "suggest from
existing rows only" behavior.

### 5. Editor changes

`GroupRoleMappingEditor` gains an optional prop:

```ts
discoveredGroups?: Array<{
  group_name: string;
  user_count: number;
  last_seen_at: string;
}>;
```

The Security tab feeds the hook's result into this prop. Internally the editor
merges discovered groups with `extractExistingGroups(rows, index)` (dedup,
discovered metadata wins) and hands a richer list to
`GroupNameAutocomplete`.

`GroupNameAutocomplete` is extended to accept items of the shape
`{ name: string; user_count?: number; last_seen_at?: string }`. Combobox
semantics stay exactly as today — the user can still type any new value (this
is required for bootstrapping mappings before anyone has logged in). Each
dropdown row renders:

```
Dashboard-Admins
3 users · last seen 2d ago
```

- Group name on the first line, muted metadata line beneath, indented to align.
- Rows that have no metadata (i.e., came only from existing mapping rows)
  render just the name — preserving the current look for non-OIDC scenarios.
- Sort order matches the API: most-recently-seen first, then alphabetical.
- A small helper `formatRelativeTime(iso)` produces strings like
  `just now`, `5m ago`, `2d ago`, `3w ago`.

Keyboard navigation, focus/blur logic, and the existing `aria-*` attributes are
unchanged.

## Data flow

```
OIDC login
  └─► packages/foundation/src/routes/oidc.ts
        ├─► exchangeCode()                        (existing)
        ├─► syncUserGroups(sub, claims.groups)    (NEW, non-blocking)
        ├─► resolveRoleFromGroups(...)            (existing)
        └─► upsertOIDCUser + createSession + JWT  (existing)

Settings → Security tab
  └─► useDiscoveredOidcGroups()
        └─► GET /api/auth/oidc/discovered-groups (admin only)
              └─► aggregate query over oidc_user_groups
        └─► GroupRoleMappingEditor
              └─► GroupNameAutocomplete (enriched list)
```

## Error handling

| Failure | Behavior |
| --- | --- |
| `syncUserGroups` throws | `warn`-level log, login continues, audit log still written |
| `GET /discovered-groups` returns 5xx | Hook returns empty array; editor falls back to existing-rows-only suggestions |
| Non-admin calls the endpoint | `403`, exercised by RBAC regression test |
| `oidc_user_groups` row count growing very large | Not a practical concern (1 row per user-group pair); no purge job in this spec |

## Testing

- `packages/core/src/services/oidc-group-tracking.test.ts` (real PostgreSQL via
  `test-db-helper.ts`):
  - First-time login inserts rows.
  - Repeat login refreshes `last_seen_at`.
  - Dropped group is removed on next login.
  - URI-prefixed groups are stripped before storage.
  - `syncUserGroups` failure does not throw out of the caller.
- `packages/foundation/src/__tests__/oidc-route.test.ts`:
  - Successful OIDC callback triggers `syncUserGroups` exactly once with the
    stripped group list.
  - `syncUserGroups` rejection does not break the callback response.
- New route test for `GET /api/auth/oidc/discovered-groups`:
  - Aggregates `user_count` and `last_seen_at` correctly across fixture rows.
  - Sort order matches the spec.
- `backend/src/routes/security-regression-rbac.test.ts` (or matching domain
  file): anonymous, viewer, and operator callers all get `401`/`403`.
- `frontend/src/features/core/components/settings/group-role-mapping-editor.test.tsx`:
  - Discovered groups render in the dropdown with their metadata.
  - Typing a brand-new name still commits a mapping (combobox, not select).
  - Keyboard navigation still works over the enriched list.
  - Empty / failing `discoveredGroups` falls back to existing-rows-only
    behavior.

## Rollout

- Single PR off `feature/1281-oidc-group-prefix-stripping` (or a follow-up
  branch off `dev` — to be decided at plan time).
- Migration is forward-only and additive; no flag required.
- No reversible feature toggle: if we need to disable, simply remove the
  `syncUserGroups` call — the endpoint will return an empty list but the editor
  still works.

## Open questions

None — all requirements clarified during brainstorming.
