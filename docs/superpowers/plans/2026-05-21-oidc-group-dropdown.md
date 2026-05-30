# OIDC Group Dropdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface every OIDC-discovered group inside the existing group-to-role mapping editor, with `user_count` and `last_seen_at` metadata, while keeping free-text combobox behavior.

**Architecture:** A new `oidc_user_groups` table persists `(user_sub, group_name)` pairs on every OIDC login. An admin-only `GET /api/auth/oidc/discovered-groups` endpoint aggregates that table into `{ group_name, user_count, last_seen_at }[]`. The frontend `GroupRoleMappingEditor` consumes that list via a TanStack Query hook and renders enriched options in the existing `GroupNameAutocomplete`. Login flow remains unblocked on tracking failures.

**Tech Stack:** PostgreSQL (migration), TypeScript, Fastify 5, Zod, `@dashboard/core` services, React 19, TanStack Query, Vitest, `@testing-library/react`.

**Reference spec:** `docs/superpowers/specs/2026-05-21-oidc-group-dropdown-design.md`

---

## File Inventory

**Create:**
- `packages/core/src/db/postgres-migrations/034_oidc_user_groups.sql` — new table + index
- `packages/core/src/services/oidc-group-tracking.ts` — `syncUserGroups`, `listDiscoveredGroups`
- `packages/core/src/services/oidc-group-tracking.test.ts` — real-DB tests
- `frontend/src/features/core/hooks/use-discovered-oidc-groups.ts` — TanStack Query hook
- `frontend/src/features/core/hooks/use-discovered-oidc-groups.test.ts` — hook test
- `frontend/src/shared/lib/format-relative-time.ts` — small "2d ago" helper
- `frontend/src/shared/lib/format-relative-time.test.ts` — helper tests

**Modify:**
- `packages/core/src/models/api-schemas.ts` — add `DiscoveredOidcGroupsResponseSchema`
- `packages/foundation/src/routes/oidc.ts` — call `syncUserGroups` in callback; register new GET endpoint
- `packages/foundation/src/__tests__/oidc-route.test.ts` — mock + assert tracking and new endpoint
- `frontend/src/features/core/components/settings/group-role-mapping-editor.tsx` — accept `discoveredGroups` prop, enrich `GroupNameAutocomplete`
- `frontend/src/features/core/components/settings/group-role-mapping-editor.test.tsx` — cover enriched rendering and fallback
- `frontend/src/features/core/components/settings/tab-security.tsx` — wire the hook into the editor

---

## Task 1: Migration for `oidc_user_groups`

**Files:**
- Create: `packages/core/src/db/postgres-migrations/034_oidc_user_groups.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Migration 034: oidc_user_groups — tracks (user_sub, group_name) pairs observed
-- via OIDC logins. Backs the admin-facing "discovered groups" dropdown in the
-- Settings → Security group-to-role mapping editor.
--
-- group_name stores the prefix-stripped form (same shape used by
-- packages/core/src/services/oidc.ts::stripGroupPrefix) so the value matches
-- what admins type into the mapping editor.
--
-- Sync semantics (see services/oidc-group-tracking.ts):
--   - INSERT … ON CONFLICT (user_sub, group_name) DO UPDATE SET last_seen_at = NOW()
--   - DELETE rows for the user whose group_name is no longer in the current claim set,
--     so leaving a group is reflected on next login.

CREATE TABLE IF NOT EXISTS oidc_user_groups (
  user_sub      TEXT NOT NULL,
  group_name    TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_sub, group_name)
);

CREATE INDEX IF NOT EXISTS idx_oidc_user_groups_group ON oidc_user_groups(group_name);
```

- [ ] **Step 2: Verify migration is picked up by test DB**

Run: `cd packages/core && POSTGRES_TEST_URL=postgresql://app_user:changeme-postgres-app@localhost:5433/portainer_dashboard_test npx vitest run src/db/test-db-helper.test.ts`
Expected: PASS (verifies migrations apply cleanly on the test database; new migration auto-applies through `getTestDb`).

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/db/postgres-migrations/034_oidc_user_groups.sql
git commit -m "feat(oidc): add oidc_user_groups migration for discovered-groups tracking"
```

---

## Task 2: `syncUserGroups` service — failing test first

**Files:**
- Create: `packages/core/src/services/oidc-group-tracking.test.ts`

- [ ] **Step 1: Write the failing tests for `syncUserGroups`**

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getTestDb, truncateTestTables, closeTestDb } from '../db/test-db-helper.js';
import type { AppDb } from '../db/app-db.js';
import { syncUserGroups, listDiscoveredGroups } from './oidc-group-tracking.js';

describe('oidc-group-tracking', () => {
  let db: AppDb;

  beforeAll(async () => {
    db = await getTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await truncateTestTables('oidc_user_groups');
  });

  describe('syncUserGroups', () => {
    it('inserts rows on first login', async () => {
      await syncUserGroups('user-1', ['Admins', 'Devs']);

      const rows = await db.query<{ user_sub: string; group_name: string }>(
        'SELECT user_sub, group_name FROM oidc_user_groups ORDER BY group_name',
      );

      expect(rows).toEqual([
        { user_sub: 'user-1', group_name: 'Admins' },
        { user_sub: 'user-1', group_name: 'Devs' },
      ]);
    });

    it('refreshes last_seen_at on repeat login without duplicating rows', async () => {
      await syncUserGroups('user-1', ['Admins']);

      const [before] = await db.query<{ last_seen_at: string }>(
        'SELECT last_seen_at FROM oidc_user_groups WHERE user_sub = ? AND group_name = ?',
        ['user-1', 'Admins'],
      );

      await new Promise((r) => setTimeout(r, 10));
      await syncUserGroups('user-1', ['Admins']);

      const after = await db.query<{ last_seen_at: string }>(
        'SELECT last_seen_at FROM oidc_user_groups WHERE user_sub = ? AND group_name = ?',
        ['user-1', 'Admins'],
      );

      expect(after).toHaveLength(1);
      expect(new Date(after[0].last_seen_at).getTime()).toBeGreaterThan(
        new Date(before.last_seen_at).getTime(),
      );
    });

    it('removes rows for groups the user no longer claims', async () => {
      await syncUserGroups('user-1', ['Admins', 'Devs']);
      await syncUserGroups('user-1', ['Admins']);

      const rows = await db.query<{ group_name: string }>(
        'SELECT group_name FROM oidc_user_groups WHERE user_sub = ?',
        ['user-1'],
      );

      expect(rows).toEqual([{ group_name: 'Admins' }]);
    });

    it('strips URI prefixes before storage', async () => {
      await syncUserGroups('user-1', [
        'urn:pingidentity.com:groups:G-Admins',
        'https://idp.example.com/groups/G-Devs',
      ]);

      const rows = await db.query<{ group_name: string }>(
        'SELECT group_name FROM oidc_user_groups ORDER BY group_name',
      );

      expect(rows.map((r) => r.group_name)).toEqual(['G-Admins', 'G-Devs']);
    });

    it('deduplicates groups that collapse to the same stripped name', async () => {
      await syncUserGroups('user-1', [
        'urn:pingidentity.com:groups:G-Admins',
        'G-Admins',
      ]);

      const rows = await db.query(
        'SELECT * FROM oidc_user_groups WHERE user_sub = ?',
        ['user-1'],
      );

      expect(rows).toHaveLength(1);
    });

    it('is a no-op for an empty group list and still clears prior rows', async () => {
      await syncUserGroups('user-1', ['Admins']);
      await syncUserGroups('user-1', []);

      const rows = await db.query(
        'SELECT * FROM oidc_user_groups WHERE user_sub = ?',
        ['user-1'],
      );

      expect(rows).toHaveLength(0);
    });
  });

  describe('listDiscoveredGroups', () => {
    it('aggregates distinct user counts and most-recent last_seen_at', async () => {
      await syncUserGroups('user-1', ['Admins', 'Devs']);
      await syncUserGroups('user-2', ['Admins']);
      await syncUserGroups('user-3', ['Devs']);

      const result = await listDiscoveredGroups();

      const admins = result.find((g) => g.group_name === 'Admins')!;
      const devs = result.find((g) => g.group_name === 'Devs')!;

      expect(admins.user_count).toBe(2);
      expect(devs.user_count).toBe(2);
      expect(typeof admins.last_seen_at).toBe('string');
    });

    it('orders by last_seen_at DESC then group_name ASC', async () => {
      await syncUserGroups('user-1', ['Zeta']);
      await new Promise((r) => setTimeout(r, 5));
      await syncUserGroups('user-1', ['Zeta', 'Alpha']);

      const result = await listDiscoveredGroups();

      // Zeta and Alpha both updated in the second call → identical last_seen_at,
      // so alphabetical wins between them. Zeta's first_seen is older but
      // last_seen is the same as Alpha's, meaning the tiebreaker is the name.
      expect(result.map((g) => g.group_name)).toEqual(['Alpha', 'Zeta']);
    });

    it('returns an empty array when no groups have been observed', async () => {
      const result = await listDiscoveredGroups();
      expect(result).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && POSTGRES_TEST_URL=postgresql://app_user:changeme-postgres-app@localhost:5433/portainer_dashboard_test npx vitest run src/services/oidc-group-tracking.test.ts`
Expected: FAIL — `Cannot find module './oidc-group-tracking.js'`.

- [ ] **Step 3: Commit failing test**

```bash
git add packages/core/src/services/oidc-group-tracking.test.ts
git commit -m "test(oidc): add failing tests for oidc-group-tracking service"
```

---

## Task 3: Implement `syncUserGroups` + `listDiscoveredGroups`

**Files:**
- Create: `packages/core/src/services/oidc-group-tracking.ts`

- [ ] **Step 1: Write the implementation**

```ts
import { getDbForDomain } from '../db/app-db-router.js';
import { stripGroupPrefix } from './oidc.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('oidc-group-tracking');

export interface DiscoveredOidcGroup {
  group_name: string;
  user_count: number;
  last_seen_at: string;
}

/**
 * Sync the set of groups currently claimed by an OIDC user.
 *
 * Runs inside a single transaction:
 *  1. Strip URI prefixes from incoming groups (deduping the result).
 *  2. Upsert each (userSub, group) pair, refreshing last_seen_at.
 *  3. Delete rows whose group_name is no longer in the current claim set,
 *     so leaving a group is reflected on the next login.
 *
 * Callers should treat failures as non-fatal — group tracking is a UX
 * affordance, not a security control.
 */
export async function syncUserGroups(userSub: string, rawGroups: string[]): Promise<void> {
  const stripped = Array.from(
    new Set(
      rawGroups
        .map((g) => stripGroupPrefix(g).trim())
        .filter((g) => g.length > 0),
    ),
  );

  const db = getDbForDomain('auth');
  await db.transaction(async (tx) => {
    for (const group of stripped) {
      await tx.execute(
        `INSERT INTO oidc_user_groups (user_sub, group_name)
         VALUES (?, ?)
         ON CONFLICT (user_sub, group_name)
         DO UPDATE SET last_seen_at = NOW()`,
        [userSub, group],
      );
    }

    if (stripped.length === 0) {
      await tx.execute('DELETE FROM oidc_user_groups WHERE user_sub = ?', [userSub]);
    } else {
      // Build the NOT IN clause dynamically because the AppDb adapter expands `?`
      // placeholders positionally and does not support array params natively.
      const placeholders = stripped.map(() => '?').join(', ');
      await tx.execute(
        `DELETE FROM oidc_user_groups
         WHERE user_sub = ?
           AND group_name NOT IN (${placeholders})`,
        [userSub, ...stripped],
      );
    }
  });

  log.debug({ userSub, groupCount: stripped.length }, 'Synced OIDC user groups');
}

/**
 * Aggregate the oidc_user_groups table into the response shape consumed by
 * the Settings → Security group dropdown.
 *
 * Sort: most-recently-seen first, then alphabetical by group name.
 * COUNT(*) is cast to integer per project convention (pg returns bigint as
 * string otherwise).
 */
export async function listDiscoveredGroups(): Promise<DiscoveredOidcGroup[]> {
  const db = getDbForDomain('auth');
  const rows = await db.query<{
    group_name: string;
    user_count: number;
    last_seen_at: string;
  }>(
    `SELECT group_name,
            COUNT(DISTINCT user_sub)::integer AS user_count,
            MAX(last_seen_at)                 AS last_seen_at
     FROM oidc_user_groups
     GROUP BY group_name
     ORDER BY last_seen_at DESC, group_name ASC`,
  );
  return rows;
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd packages/core && POSTGRES_TEST_URL=postgresql://app_user:changeme-postgres-app@localhost:5433/portainer_dashboard_test npx vitest run src/services/oidc-group-tracking.test.ts`
Expected: PASS — all 9 tests green.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck -w @dashboard/core`
Expected: PASS — no type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/services/oidc-group-tracking.ts
git commit -m "feat(oidc): implement syncUserGroups + listDiscoveredGroups"
```

---

## Task 4: Add response schema

**Files:**
- Modify: `packages/core/src/models/api-schemas.ts` (append after `OidcEffectiveRedirectUriResponseSchema`)

- [ ] **Step 1: Add the Zod schema**

After the `OidcEffectiveRedirectUriResponseSchema` definition (currently ends around line 73), insert:

```ts
// Returned by GET /api/auth/oidc/discovered-groups (admin-only).
// Powers the searchable dropdown in the group-to-role mapping editor.
// user_count is COUNT(DISTINCT user_sub) for the group; last_seen_at is the
// max last_seen_at across all rows for that group.
export const DiscoveredOidcGroupsResponseSchema = z.object({
  groups: z.array(
    z.object({
      group_name: z.string(),
      user_count: z.number().int().nonnegative(),
      last_seen_at: z.string(),
    }),
  ),
});
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck -w @dashboard/core`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/models/api-schemas.ts
git commit -m "feat(oidc): add DiscoveredOidcGroupsResponseSchema"
```

---

## Task 5: OIDC callback calls `syncUserGroups` — failing test first

**Files:**
- Modify: `packages/foundation/src/__tests__/oidc-route.test.ts`

- [ ] **Step 1: Add mock + failing test**

Near the existing `vi.mock(...)` block (around line 27), add:

```ts
vi.mock('@dashboard/core/services/oidc-group-tracking.js', () => ({
  syncUserGroups: vi.fn().mockResolvedValue(undefined),
  listDiscoveredGroups: vi.fn().mockResolvedValue([]),
}));
```

Also add the import near the other service imports:

```ts
import * as groupTracking from '@dashboard/core/services/oidc-group-tracking.js';
const mockedSyncUserGroups = vi.mocked(groupTracking.syncUserGroups);
```

In `beforeEach` (around line 73), add:

```ts
mockedSyncUserGroups.mockReset();
mockedSyncUserGroups.mockResolvedValue(undefined);
```

Add a new `describe` block at the bottom of the file (before the final closing `});` of the outer `describe('OIDC Routes')`):

```ts
describe('POST /api/auth/oidc/callback group tracking', () => {
  it('calls syncUserGroups with sub + raw groups from the ID token', async () => {
    mockedGetConfig.mockResolvedValue({ ...baseOidcConfig, group_role_mappings: { Admins: 'admin' } });
    mockedExchangeCode.mockResolvedValue({
      sub: 'user-42',
      email: 'a@b.com',
      name: 'A B',
      groups: ['Admins', 'Devs'],
    } as any);

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/oidc/callback',
      payload: { callbackUrl: 'https://x/callback?code=c&state=s', state: 's' },
    });

    expect(response.statusCode).toBe(200);
    expect(mockedSyncUserGroups).toHaveBeenCalledTimes(1);
    expect(mockedSyncUserGroups).toHaveBeenCalledWith('user-42', ['Admins', 'Devs']);
  });

  it('does NOT fail the login when syncUserGroups rejects', async () => {
    mockedGetConfig.mockResolvedValue({ ...baseOidcConfig });
    mockedExchangeCode.mockResolvedValue({
      sub: 'user-43', email: 'x@y.com', name: 'X', groups: ['Admins'],
    } as any);
    mockedSyncUserGroups.mockRejectedValueOnce(new Error('db down'));

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/oidc/callback',
      payload: { callbackUrl: 'https://x/callback?code=c&state=s', state: 's' },
    });

    expect(response.statusCode).toBe(200);
  });

  it('calls syncUserGroups with empty array when no groups claim is present', async () => {
    mockedGetConfig.mockResolvedValue({ ...baseOidcConfig });
    mockedExchangeCode.mockResolvedValue({
      sub: 'user-44', email: 'e@f.com', name: 'E', groups: [],
    } as any);

    await app.inject({
      method: 'POST',
      url: '/api/auth/oidc/callback',
      payload: { callbackUrl: 'https://x/callback?code=c&state=s', state: 's' },
    });

    expect(mockedSyncUserGroups).toHaveBeenCalledWith('user-44', []);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/foundation && npx vitest run src/__tests__/oidc-route.test.ts`
Expected: FAIL — `mockedSyncUserGroups` was never called because the route doesn't invoke it yet.

- [ ] **Step 3: Commit failing test**

```bash
git add packages/foundation/src/__tests__/oidc-route.test.ts
git commit -m "test(oidc): assert syncUserGroups is called from OIDC callback"
```

---

## Task 6: Wire `syncUserGroups` into the OIDC callback

**Files:**
- Modify: `packages/foundation/src/routes/oidc.ts`

- [ ] **Step 1: Import the service**

At the top of the file (after the existing `getOIDCConfig, ...` import block), add:

```ts
import { syncUserGroups } from '@dashboard/core/services/oidc-group-tracking.js';
```

- [ ] **Step 2: Call it inside the callback handler**

Inside the `POST /api/auth/oidc/callback` handler, immediately after the line:

```ts
const claims = await exchangeCode(callbackUrl, state);
```

add the non-blocking tracking call:

```ts
try {
  await syncUserGroups(claims.sub, claims.groups ?? []);
} catch (err) {
  log.warn({ err, sub: claims.sub }, 'Failed to sync OIDC user groups — login continuing');
}
```

(The local `log` constant already exists at the top of the file via `createChildLogger('oidc-routes')`.)

- [ ] **Step 3: Run the failing test**

Run: `cd packages/foundation && npx vitest run src/__tests__/oidc-route.test.ts`
Expected: PASS — all 3 new tests green plus all pre-existing ones.

- [ ] **Step 4: Commit**

```bash
git add packages/foundation/src/routes/oidc.ts
git commit -m "feat(oidc): call syncUserGroups on every OIDC callback (non-blocking)"
```

---

## Task 7: Discovered-groups endpoint — failing test first

**Files:**
- Modify: `packages/foundation/src/__tests__/oidc-route.test.ts`

- [ ] **Step 1: Add the endpoint test**

Append a new `describe` block (before the outer `describe`'s closing `});`):

```ts
describe('GET /api/auth/oidc/discovered-groups', () => {
  it('returns aggregated groups from listDiscoveredGroups', async () => {
    vi.mocked(groupTracking.listDiscoveredGroups).mockResolvedValueOnce([
      { group_name: 'Admins', user_count: 3, last_seen_at: '2026-05-20T10:00:00.000Z' },
      { group_name: 'Devs',   user_count: 1, last_seen_at: '2026-05-19T09:00:00.000Z' },
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/oidc/discovered-groups',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      groups: [
        { group_name: 'Admins', user_count: 3, last_seen_at: '2026-05-20T10:00:00.000Z' },
        { group_name: 'Devs',   user_count: 1, last_seen_at: '2026-05-19T09:00:00.000Z' },
      ],
    });
  });

  it('returns an empty array when no groups have been observed', async () => {
    vi.mocked(groupTracking.listDiscoveredGroups).mockResolvedValueOnce([]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/oidc/discovered-groups',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ groups: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/foundation && npx vitest run src/__tests__/oidc-route.test.ts`
Expected: FAIL — endpoint returns 404 (route not registered yet).

- [ ] **Step 3: Commit failing test**

```bash
git add packages/foundation/src/__tests__/oidc-route.test.ts
git commit -m "test(oidc): add failing test for GET /discovered-groups endpoint"
```

---

## Task 8: Implement the `GET /api/auth/oidc/discovered-groups` route

**Files:**
- Modify: `packages/foundation/src/routes/oidc.ts`

- [ ] **Step 1: Update imports**

Replace the existing `syncUserGroups` import line with:

```ts
import { syncUserGroups, listDiscoveredGroups } from '@dashboard/core/services/oidc-group-tracking.js';
```

Add to the api-schemas import:

```ts
import {
  OidcStatusResponseSchema,
  OidcCallbackBodySchema,
  OidcEffectiveRedirectUriResponseSchema,
  DiscoveredOidcGroupsResponseSchema,
  LoginResponseSchema,
  ErrorResponseSchema,
  SuccessResponseSchema,
} from '@dashboard/core/models/api-schemas.js';
```

- [ ] **Step 2: Register the route**

Immediately after the existing `/api/auth/oidc/effective-redirect-uri` handler (before the `POST /api/auth/oidc/callback` block), add:

```ts
// Discovered OIDC groups (admin-only) — backs the searchable dropdown in the
// Settings → Security group-to-role mapping editor. Aggregates the
// oidc_user_groups table observed across all past OIDC logins.
fastify.get('/api/auth/oidc/discovered-groups', {
  schema: {
    tags: ['Auth'],
    summary: 'List OIDC groups observed via past logins (admin-only)',
    security: [{ bearerAuth: [] }],
    response: {
      200: DiscoveredOidcGroupsResponseSchema,
    },
  },
  preHandler: [fastify.authenticate, fastify.requireRole('admin')],
}, async () => {
  const groups = await listDiscoveredGroups();
  return { groups };
});
```

- [ ] **Step 3: Run the failing test**

Run: `cd packages/foundation && npx vitest run src/__tests__/oidc-route.test.ts`
Expected: PASS — all `discovered-groups` tests green.

- [ ] **Step 4: Run typecheck for the whole repo**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/foundation/src/routes/oidc.ts
git commit -m "feat(oidc): add GET /api/auth/oidc/discovered-groups endpoint"
```

---

## Task 9: RBAC regression test for the new endpoint

**Files:**
- Modify: `backend/src/routes/security-regression-rbac.test.ts`

- [ ] **Step 1: Locate the existing route-coverage block**

Run: `grep -n "auth/oidc" backend/src/routes/security-regression-rbac.test.ts | head -5`
Expected: shows the existing OIDC-route coverage block (or nothing if not yet covered — proceed to step 2 regardless).

- [ ] **Step 2: Add the new endpoint to the admin-only protected list**

Open the file. Find the `protectedAdminRoutes` (or equivalent) array — the same one used for `GET /api/auth/oidc/effective-redirect-uri` — and add an entry:

```ts
{ method: 'GET', url: '/api/auth/oidc/discovered-groups' },
```

If the file's structure differs and there is no shared array, add a dedicated `it(...)` test mirroring the existing `effective-redirect-uri` test pattern, asserting:

```ts
it('rejects non-admin callers from GET /api/auth/oidc/discovered-groups', async () => {
  const viewerResponse = await app.inject({
    method: 'GET',
    url: '/api/auth/oidc/discovered-groups',
    headers: { authorization: `Bearer ${viewerToken}` },
  });
  expect(viewerResponse.statusCode).toBe(403);

  const anonResponse = await app.inject({
    method: 'GET',
    url: '/api/auth/oidc/discovered-groups',
  });
  expect(anonResponse.statusCode).toBe(401);
});
```

- [ ] **Step 3: Run the regression test**

Run: `cd backend && npx vitest run src/routes/security-regression-rbac.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/security-regression-rbac.test.ts
git commit -m "test(security): RBAC regression for GET /api/auth/oidc/discovered-groups"
```

---

## Task 10: `formatRelativeTime` helper — failing test first

**Files:**
- Create: `frontend/src/shared/lib/format-relative-time.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatRelativeTime } from './format-relative-time';

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-21T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for <30 seconds ago', () => {
    expect(formatRelativeTime('2026-05-21T11:59:50.000Z')).toBe('just now');
  });

  it('returns minutes for <1 hour', () => {
    expect(formatRelativeTime('2026-05-21T11:55:00.000Z')).toBe('5m ago');
  });

  it('returns hours for <1 day', () => {
    expect(formatRelativeTime('2026-05-21T09:00:00.000Z')).toBe('3h ago');
  });

  it('returns days for <30 days', () => {
    expect(formatRelativeTime('2026-05-19T12:00:00.000Z')).toBe('2d ago');
  });

  it('returns weeks for <1 year', () => {
    expect(formatRelativeTime('2026-05-07T12:00:00.000Z')).toBe('2w ago');
  });

  it('returns years for >1 year', () => {
    expect(formatRelativeTime('2024-05-21T12:00:00.000Z')).toBe('2y ago');
  });

  it('returns empty string for invalid input', () => {
    expect(formatRelativeTime('not-a-date')).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/shared/lib/format-relative-time.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Commit failing test**

```bash
git add frontend/src/shared/lib/format-relative-time.test.ts
git commit -m "test(frontend): add failing tests for formatRelativeTime helper"
```

---

## Task 11: Implement `formatRelativeTime`

**Files:**
- Create: `frontend/src/shared/lib/format-relative-time.ts`

- [ ] **Step 1: Write the implementation**

```ts
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';

  const deltaMs = now.getTime() - then.getTime();
  const seconds = Math.max(0, Math.floor(deltaMs / 1000));

  if (seconds < 30) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 52) return `${weeks}w ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}
```

- [ ] **Step 2: Run tests**

Run: `cd frontend && npx vitest run src/shared/lib/format-relative-time.test.ts`
Expected: PASS — all 7 tests green.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/shared/lib/format-relative-time.ts
git commit -m "feat(frontend): add formatRelativeTime helper for last-seen labels"
```

---

## Task 12: `useDiscoveredOidcGroups` hook — failing test first

**Files:**
- Create: `frontend/src/features/core/hooks/use-discovered-oidc-groups.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useDiscoveredOidcGroups } from './use-discovered-oidc-groups';
import { api } from '@/shared/lib/api';
import type { ReactNode } from 'react';

vi.mock('@/shared/lib/api', () => ({
  api: { get: vi.fn() },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useDiscoveredOidcGroups', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
  });

  it('fetches discovered groups when enabled', async () => {
    vi.mocked(api.get).mockResolvedValue({
      groups: [{ group_name: 'Admins', user_count: 2, last_seen_at: '2026-05-20T10:00:00.000Z' }],
    });

    const { result } = renderHook(() => useDiscoveredOidcGroups({ enabled: true }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      { group_name: 'Admins', user_count: 2, last_seen_at: '2026-05-20T10:00:00.000Z' },
    ]);
    expect(api.get).toHaveBeenCalledWith('/api/auth/oidc/discovered-groups');
  });

  it('does not fetch when disabled', async () => {
    const { result } = renderHook(() => useDiscoveredOidcGroups({ enabled: false }), { wrapper });

    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
    expect(api.get).not.toHaveBeenCalled();
    expect(result.current.data).toEqual([]);
  });

  it('returns an empty array on fetch failure (graceful fallback)', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('500'));

    const { result } = renderHook(() => useDiscoveredOidcGroups({ enabled: true }), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});
```

The test file must end with `.tsx` so JSX in the wrapper parses. Rename it:

```bash
mv frontend/src/features/core/hooks/use-discovered-oidc-groups.test.ts \
   frontend/src/features/core/hooks/use-discovered-oidc-groups.test.tsx
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/features/core/hooks/use-discovered-oidc-groups.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Commit failing test**

```bash
git add frontend/src/features/core/hooks/use-discovered-oidc-groups.test.tsx
git commit -m "test(frontend): add failing tests for useDiscoveredOidcGroups"
```

---

## Task 13: Implement `useDiscoveredOidcGroups`

**Files:**
- Create: `frontend/src/features/core/hooks/use-discovered-oidc-groups.ts`

- [ ] **Step 1: Write the implementation**

```ts
import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/lib/api';

export interface DiscoveredOidcGroup {
  group_name: string;
  user_count: number;
  last_seen_at: string;
}

interface DiscoveredOidcGroupsResponse {
  groups: DiscoveredOidcGroup[];
}

interface UseDiscoveredOidcGroupsOptions {
  enabled: boolean;
}

const EMPTY: DiscoveredOidcGroup[] = [];

export function useDiscoveredOidcGroups({ enabled }: UseDiscoveredOidcGroupsOptions) {
  const query = useQuery<DiscoveredOidcGroupsResponse>({
    queryKey: ['oidc', 'discovered-groups'],
    queryFn: () => api.get<DiscoveredOidcGroupsResponse>('/api/auth/oidc/discovered-groups'),
    staleTime: 60 * 1000,
    enabled,
    retry: false,
  });

  return {
    ...query,
    data: query.data?.groups ?? EMPTY,
  };
}
```

- [ ] **Step 2: Run tests**

Run: `cd frontend && npx vitest run src/features/core/hooks/use-discovered-oidc-groups.test.tsx`
Expected: PASS — all 3 tests green.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/features/core/hooks/use-discovered-oidc-groups.ts
git commit -m "feat(frontend): add useDiscoveredOidcGroups hook"
```

---

## Task 14: Editor enriched-options — failing tests first

**Files:**
- Modify: `frontend/src/features/core/components/settings/group-role-mapping-editor.test.tsx`

- [ ] **Step 1: Add new test cases**

Inside the existing `describe('GroupRoleMappingEditor', () => { ... })` block, append:

```tsx
it('renders discovered groups with user count and last-seen metadata', async () => {
  const discoveredGroups = [
    { group_name: 'Dashboard-Admins', user_count: 3, last_seen_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() },
    { group_name: 'Viewers',          user_count: 1, last_seen_at: new Date(Date.now() - 60 * 1000).toISOString() },
  ];

  render(
    <GroupRoleMappingEditor
      value={JSON.stringify({ ExistingGroup: 'admin' })}
      onChange={vi.fn()}
      discoveredGroups={discoveredGroups}
    />,
  );

  // Focus the autocomplete to reveal the dropdown
  fireEvent.focus(screen.getByTestId('mapping-group-0'));

  expect(screen.getByText('Dashboard-Admins')).toBeInTheDocument();
  expect(screen.getByText(/3 users/)).toBeInTheDocument();
  expect(screen.getByText(/2d ago/)).toBeInTheDocument();
  expect(screen.getByText('Viewers')).toBeInTheDocument();
  expect(screen.getByText(/1 user(?!s)/)).toBeInTheDocument(); // singular
});

it('still allows typing a brand-new group name not in discoveredGroups', () => {
  const onChange = vi.fn();
  render(
    <GroupRoleMappingEditor
      value="{}"
      onChange={onChange}
      discoveredGroups={[{ group_name: 'Existing', user_count: 1, last_seen_at: new Date().toISOString() }]}
    />,
  );

  // Need a row first
  fireEvent.click(screen.getByText('Add Mapping'));

  const input = screen.getByTestId('mapping-group-0');
  fireEvent.change(input, { target: { value: 'BrandNewGroup' } });

  expect(onChange).toHaveBeenLastCalledWith(JSON.stringify({ BrandNewGroup: 'viewer' }));
});

it('falls back to existing-rows-only suggestions when discoveredGroups is empty', () => {
  render(
    <GroupRoleMappingEditor
      value={JSON.stringify({ A: 'admin', B: 'viewer' })}
      onChange={vi.fn()}
      discoveredGroups={[]}
    />,
  );

  fireEvent.focus(screen.getByTestId('mapping-group-0'));
  // First row should be able to see "B" as a suggestion from the other row.
  expect(screen.getByText('B')).toBeInTheDocument();
});

it('merges discovered groups with existing rows, deduping by name', () => {
  render(
    <GroupRoleMappingEditor
      value={JSON.stringify({ Admins: 'admin' })}
      onChange={vi.fn()}
      discoveredGroups={[
        { group_name: 'Admins', user_count: 5, last_seen_at: new Date(Date.now() - 60_000).toISOString() },
        { group_name: 'Devs',   user_count: 2, last_seen_at: new Date(Date.now() - 60_000).toISOString() },
      ]}
    />,
  );

  fireEvent.focus(screen.getByTestId('mapping-group-0'));
  // The other row's "Admins" should appear ONCE with discovered metadata,
  // even though it's also in the existing-rows source.
  const adminsLabels = screen.getAllByText('Admins');
  expect(adminsLabels).toHaveLength(2); // one in the row input value, one in the dropdown
  expect(screen.getByText(/5 users/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/core/components/settings/group-role-mapping-editor.test.tsx`
Expected: FAIL — `discoveredGroups` prop does not exist on `GroupRoleMappingEditor`.

- [ ] **Step 3: Commit failing tests**

```bash
git add frontend/src/features/core/components/settings/group-role-mapping-editor.test.tsx
git commit -m "test(frontend): add failing tests for enriched discoveredGroups dropdown"
```

---

## Task 15: Editor accepts `discoveredGroups` and renders enriched options

**Files:**
- Modify: `frontend/src/features/core/components/settings/group-role-mapping-editor.tsx`

- [ ] **Step 1: Extend the imports**

At the top of the file, replace:

```ts
import { cn } from '@/shared/lib/utils';
```

with:

```ts
import { cn } from '@/shared/lib/utils';
import { formatRelativeTime } from '@/shared/lib/format-relative-time';
```

- [ ] **Step 2: Define the enriched item type and update prop interface**

After the `MappingRow` interface, add:

```ts
export interface DiscoveredGroupOption {
  group_name: string;
  user_count: number;
  last_seen_at: string;
}

interface AutocompleteItem {
  name: string;
  user_count?: number;
  last_seen_at?: string;
}
```

Update the props interface:

```ts
interface GroupRoleMappingEditorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  discoveredGroups?: DiscoveredGroupOption[];
}
```

- [ ] **Step 3: Replace the `GroupNameAutocomplete` signature and option-render block**

Replace the `GroupNameAutocomplete` function (currently around lines 58–210) with the version below. The whole function:

```tsx
function GroupNameAutocomplete({
  value,
  onChange,
  disabled,
  items,
  placeholder,
  testId,
}: {
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
  items: AutocompleteItem[];
  placeholder?: string;
  testId?: string;
}) {
  const [show, setShow] = useState(false);
  const [query, setQuery] = useState(value);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listboxId = useId();
  const optionIdPrefix = useId();
  const listboxRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return items;
    return items.filter((item) => item.name.toLowerCase().includes(q));
  }, [query, items]);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    setActiveIndex(-1);
  }, [filtered, show]);

  useEffect(() => {
    if (activeIndex < 0 || !listboxRef.current) return;
    const optionEl = listboxRef.current.querySelector<HTMLElement>(
      `[data-option-index="${activeIndex}"]`,
    );
    optionEl?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const commit = (group: string) => {
    setQuery(group);
    onChange(group);
    setShow(false);
  };

  const handleBlur = () => {
    setShow(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setShow(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      if (filtered.length === 0) return;
      e.preventDefault();
      setShow(true);
      setActiveIndex((i) => (i + 1) % filtered.length);
      return;
    }
    if (e.key === 'ArrowUp') {
      if (filtered.length === 0) return;
      e.preventDefault();
      setShow(true);
      setActiveIndex((i) => (i <= 0 ? filtered.length - 1 : i - 1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (show && activeIndex >= 0 && activeIndex < filtered.length) {
        commit(filtered[activeIndex].name);
      } else {
        onChange(query);
        setShow(false);
      }
    }
  };

  const activeDescendant =
    show && activeIndex >= 0 && activeIndex < filtered.length
      ? `${optionIdPrefix}-${activeIndex}`
      : undefined;

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={show && filtered.length > 0}
          aria-controls={listboxId}
          aria-activedescendant={activeDescendant}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShow(true);
            onChange(e.target.value);
          }}
          onFocus={() => setShow(true)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={placeholder}
          className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          data-testid={testId}
          autoComplete="off"
        />
      </div>
      {show && filtered.length > 0 && (
        <div
          ref={listboxRef}
          id={listboxId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-border bg-popover text-popover-foreground shadow-lg"
        >
          {filtered.map((item, index) => {
            const isActive = index === activeIndex;
            const hasMetadata = typeof item.user_count === 'number';
            return (
              <div
                key={item.name}
                id={`${optionIdPrefix}-${index}`}
                role="option"
                aria-selected={isActive}
                data-option-index={index}
                className={cn(
                  'px-3 py-2 text-sm cursor-pointer hover:bg-accent hover:text-accent-foreground',
                  isActive ? 'bg-accent text-accent-foreground' : '',
                )}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(item.name);
                }}
              >
                <div>{item.name}</div>
                {hasMetadata && (
                  <div className="text-xs text-muted-foreground">
                    {item.user_count} {item.user_count === 1 ? 'user' : 'users'}
                    {item.last_seen_at && ` · last seen ${formatRelativeTime(item.last_seen_at)}`}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Build the merged items list inside `GroupRoleMappingEditor`**

Inside the `GroupRoleMappingEditor` function body, replace the existing rows-only suggestion code at the autocomplete call site. Locate:

```tsx
<GroupNameAutocomplete
  value={row.group}
  onChange={(val) => updateRow(index, 'group', val)}
  disabled={disabled}
  existingGroups={extractExistingGroups(rows, index)}
  placeholder="e.g., Dashboard-Admins or *"
  testId={`mapping-group-${index}`}
/>
```

Replace with a merged-items computation. Just above the `return` of `GroupRoleMappingEditor`, add:

```tsx
const buildItems = (excludeIndex: number): AutocompleteItem[] => {
  const map = new Map<string, AutocompleteItem>();
  // Discovered groups first — they carry metadata.
  for (const g of discoveredGroups ?? []) {
    map.set(g.group_name, {
      name: g.group_name,
      user_count: g.user_count,
      last_seen_at: g.last_seen_at,
    });
  }
  // Fill in any group names from other rows that aren't already in the map.
  for (const existing of extractExistingGroups(rows, excludeIndex)) {
    if (!map.has(existing)) {
      map.set(existing, { name: existing });
    }
  }
  return [...map.values()];
};
```

Then replace the autocomplete call:

```tsx
<GroupNameAutocomplete
  value={row.group}
  onChange={(val) => updateRow(index, 'group', val)}
  disabled={disabled}
  items={buildItems(index)}
  placeholder="e.g., Dashboard-Admins or *"
  testId={`mapping-group-${index}`}
/>
```

Update the `GroupRoleMappingEditor` signature to accept the new prop:

```tsx
export function GroupRoleMappingEditor({ value, onChange, disabled, discoveredGroups }: GroupRoleMappingEditorProps) {
```

- [ ] **Step 5: Run the failing tests**

Run: `cd frontend && npx vitest run src/features/core/components/settings/group-role-mapping-editor.test.tsx`
Expected: PASS — all enriched-dropdown tests green, plus pre-existing tests still pass.

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck -w frontend`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/core/components/settings/group-role-mapping-editor.tsx
git commit -m "feat(frontend): enrich group mapping autocomplete with discovered metadata"
```

---

## Task 16: Wire the hook into the Security tab

**Files:**
- Modify: `frontend/src/features/core/components/settings/tab-security.tsx`

- [ ] **Step 1: Import the hook + auth accessor**

At the top of the file, add:

```ts
import { useAuth } from '@/providers/auth-provider';
import { useDiscoveredOidcGroups } from '@/features/core/hooks/use-discovered-oidc-groups';
```

- [ ] **Step 2: Use the hook and pass its data to the editor**

Inside `SecurityTab`, after the existing `isOIDCEnabled` line, add:

```ts
const { role } = useAuth();
const { data: discoveredGroups } = useDiscoveredOidcGroups({
  enabled: isOIDCEnabled && role === 'admin',
});
```

Update the `GroupRoleMappingEditor` usage:

```tsx
{isOIDCEnabled && (
  <GroupRoleMappingEditor
    value={editedValues['oidc.group_role_mappings'] ?? '{}'}
    onChange={(val) => onChange('oidc.group_role_mappings', val)}
    disabled={isSaving}
    discoveredGroups={discoveredGroups}
  />
)}
```

- [ ] **Step 3: Run frontend tests**

Run: `cd frontend && npx vitest run src/features/core/components/settings/`
Expected: PASS.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck -w frontend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/core/components/settings/tab-security.tsx
git commit -m "feat(frontend): wire useDiscoveredOidcGroups into Security tab"
```

---

## Task 17: Full-suite verification

- [ ] **Step 1: Run backend tests**

Run: `npm run test -w backend`
Expected: PASS.

- [ ] **Step 2: Run packages/core tests**

Run: `POSTGRES_TEST_URL=postgresql://app_user:changeme-postgres-app@localhost:5433/portainer_dashboard_test cd packages/core && npx vitest run`
Expected: PASS.

- [ ] **Step 3: Run packages/foundation tests**

Run: `cd packages/foundation && npx vitest run`
Expected: PASS.

- [ ] **Step 4: Run frontend tests**

Run: `npm run test -w frontend`
Expected: PASS.

- [ ] **Step 5: Run lint and typecheck**

Run: `npm run lint && npm run typecheck`
Expected: PASS, no warnings.

- [ ] **Step 6: Manual UI smoke test**

1. `docker compose -f docker/docker-compose.dev.yml up -d postgres`
2. `npm run dev`
3. Open the dashboard, log in as admin, visit Settings → Security.
4. Confirm: with OIDC disabled the mapping editor is hidden; with OIDC enabled the editor renders and (after at least one OIDC login has occurred) the autocomplete dropdown shows discovered groups with `N users · last seen X ago` metadata.
5. Type a brand-new group name — it should still be accepted into the mapping.

- [ ] **Step 7: Final commit (if any cleanup was needed)**

```bash
git status
# If anything was changed during smoke testing, commit it. Otherwise skip.
```

---

## Rollback

If something is wrong with this feature in production:

1. Revert the route registration (Task 8) — endpoint returns 404, frontend falls back to existing-rows-only behavior.
2. Revert the `syncUserGroups` call in the callback (Task 6) — `oidc_user_groups` stops receiving writes; login flow unaffected.
3. The `034_oidc_user_groups.sql` migration is forward-only and additive; no rollback DDL is required. If a fresh deploy is needed, drop the table manually:
   ```sql
   DROP TABLE IF EXISTS oidc_user_groups;
   DELETE FROM _app_migrations WHERE name = '034_oidc_user_groups.sql';
   ```
