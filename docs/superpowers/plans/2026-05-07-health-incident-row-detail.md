# Health Incidents — Per-Row Detail & Dedupe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user expands an incident group on the Health & Monitoring page, they should see (a) one row per affected container — never the same container twice, and (b) a short description of *what* fired (e.g. "CPU 94% — baseline 22%, ML high confidence"), not just the container name and severity.

**Architecture:** Backend extends `getIncidentGroups()` so each per-container row is collapsed to one entry. The SQL dedupes by `(signature, container_name)`, keeping the latest/highest-severity incident as the representative, and `LEFT JOIN`s `insights` on the representative's `root_cause_insight_id` to surface `description` (the human-readable text with metric values). Each row gains `incident_count`, `incident_ids`, `latest_summary`, `latest_description`, and `latest_at` fields. Existing `incident_id`/`severity`/`created_at` fields stay (typed as "the representative incident") so existing tests/UI keep working. Frontend extends the `IncidentGroup` type, renders the description on a second line per row, and shows an "N alerts" badge when `incident_count > 1`. The long-tail `showAll()` path performs the same client-side dedupe so the second-page fetch is consistent.

**Tech Stack:** PostgreSQL (real-DB tests via `test-db-helper`), Fastify 5, TypeScript, Zod, npm workspaces (`packages/ai-intelligence`, `packages/core`), Vitest, React 19 + Vite + TanStack Query, Radix UI, jsdom + `@testing-library/react`.

**Reference plan:** Builds on `docs/superpowers/plans/2026-05-06-active-incidents-rollup.md` (already shipped — groups infrastructure exists).

---

## Conventions for this plan

- **Working dir:** repo root unless noted. Commands are zsh.
- **Backend tests:** `cd packages/ai-intelligence && npx vitest run src/__tests__/<file>.test.ts`. DB-backed tests need `POSTGRES_TEST_URL=postgresql://app_user:changeme-postgres-app@localhost:5433/portainer_dashboard_test`.
- **Frontend tests:** `cd frontend && npx vitest run src/features/ai-intelligence/components/<file>.test.tsx` (must run from `frontend/`).
- **Branch:** keep on `feature/dev-stack-monorepo-fix` unless the engineer is told otherwise. One commit per task.
- **TDD:** every task writes the failing test first, runs it to confirm failure, implements, runs again to confirm pass, commits.
- **No `--no-verify`.** Hooks must pass.

---

## File Structure

**Will modify:**
- `packages/ai-intelligence/src/services/incident-store.ts` — extend `IncidentGroup['top_containers']` interface; rewrite `rawTop` SQL to dedupe + join `insights`.
- `packages/ai-intelligence/src/__tests__/incidents-groups.test.ts` — extend existing test fixtures with multi-incident-per-container case + assert new fields.
- `frontend/src/features/ai-intelligence/hooks/use-incident-groups.ts` — mirror new fields in the TS type.
- `frontend/src/features/ai-intelligence/components/incident-groups-view.tsx` — render `latest_description` line + `incident_count` badge; dedupe long-tail rows by `container_name`.
- `frontend/src/features/ai-intelligence/components/incident-groups-view.show-all.test.tsx` — assert dedupe + new content.

**Will create:**
- `frontend/src/features/ai-intelligence/components/incident-groups-view.row-detail.test.tsx` — new focused test file for the per-row rendering.

No new SQL migration. No new endpoint. The `/api/incidents/groups` payload gains optional fields; the existing fields keep their meaning.

---

### Task 1: Backend — extend `IncidentGroup['top_containers']` interface (compile-only, no behaviour yet)

**Files:**
- Modify: `packages/ai-intelligence/src/services/incident-store.ts:198-217`

**Why:** Locking the new contract first lets the SQL changes in Task 2 be verified against a stable type. New fields are optional initially so existing callers (frontend, tests) keep compiling.

- [ ] **Step 1: Read the current `IncidentGroup` interface**

Run: `sed -n '198,217p' packages/ai-intelligence/src/services/incident-store.ts`
Expected: `top_containers` array entries shaped `{ incident_id, container_name, endpoint_id, endpoint_name, severity, created_at }`.

- [ ] **Step 2: Edit the interface to add the new fields**

Replace the `top_containers` array item shape in `packages/ai-intelligence/src/services/incident-store.ts` so the interface reads:

```ts
export interface IncidentGroup {
  signature: string;
  label: string;
  severity: 'critical' | 'warning' | 'info';
  incident_count: number;
  container_count: number;
  alert_count: number;
  earliest_at: string;
  latest_update_at: string;
  top_containers: Array<{
    /** Representative incident (highest-severity, then most-recent) for this container in this group. */
    incident_id: string;
    container_name: string;
    endpoint_id: number | null;
    endpoint_name: string | null;
    /** Severity of the representative incident. */
    severity: 'critical' | 'warning' | 'info';
    /** created_at of the representative incident. */
    created_at: string;
    /** All active incident ids for (signature, container_name). Length == incident_count. */
    incident_ids: string[];
    /** How many active incidents this container has under this signature. */
    incident_count: number;
    /** updated_at of the most recently updated incident among incident_ids. */
    latest_at: string;
    /** incidents.summary of the representative incident (LLM-derived, may be null). */
    latest_summary: string | null;
    /** insights.description of the representative incident's root-cause insight (contains metric values, may be null). */
    latest_description: string | null;
  }>;
  all_container_names: string[];
  names_truncated: boolean;
}
```

- [ ] **Step 3: Confirm the package still typechecks**

Run from repo root: `npx tsc -b packages/ai-intelligence`
Expected: PASS (no errors). If errors appear they are downstream consumers; fix by adding the new fields with placeholder values in any in-package call sites that construct this shape (none expected outside `getIncidentGroups`).

- [ ] **Step 4: Commit**

```bash
git add packages/ai-intelligence/src/services/incident-store.ts
git commit -m "refactor(incidents): extend IncidentGroup row shape for per-container dedupe"
```

---

### Task 2: Backend — failing test for dedupe + new row fields

**Files:**
- Modify: `packages/ai-intelligence/src/__tests__/incidents-groups.test.ts`

**Why:** Locks expected behaviour before changing the SQL. Adds a fixture where one container has multiple active incidents under the same signature, plus a fixture incident with a `summary` and a linked `insights` row (so we can assert `latest_description` is sourced from the insight).

- [ ] **Step 1: Open the existing test file and locate the `beforeEach` block**

Run: `sed -n '13,40p' packages/ai-intelligence/src/__tests__/incidents-groups.test.ts`
Expected: existing inserts for `a1`, `a2`, `a3`, `m1`, `r1`.

- [ ] **Step 2: Extend `beforeEach` to create an `insights` row and a duplicate-container incident**

Add to `beforeEach`, after the existing inserts and before the closing `});` of `beforeEach`:

```ts
    // Insight that will be referenced as root_cause for one of the CPU incidents.
    // The description carries the metric values we want to surface in the UI.
    await db.execute(`
      INSERT INTO insights (id, endpoint_id, endpoint_name, container_id, container_name,
                            severity, category, title, description, suggested_action,
                            is_acknowledged, created_at, metric_type, detection_method)
      VALUES ('ins-a1', 1, 'eA', 'cid-c1', 'c1',
              'critical', 'anomaly',
              'Anomalous cpu usage on "c1" (ML-detected)',
              'CPU 94% on c1 — baseline 22%, ML high confidence', NULL,
              0, NOW(), 'cpu', 'ml-anomaly')
    `);

    // Backfill incident a1 to point at that insight + carry a summary string.
    await db.execute(`
      UPDATE incidents
      SET root_cause_insight_id = 'ins-a1',
          summary = 'CPU spike on c1 — investigate'
      WHERE id = 'a1'
    `);

    // Second active CPU anomaly on the SAME container c1 — this is the duplicate
    // case the UI must collapse to a single row.
    await db.execute(ins, ['a1b', 'cpu', 'warning', '["c1"]', 1, 'eA', 1, 'anomaly:ml-anomaly:cpu']);
```

- [ ] **Step 3: Add three new `it(...)` blocks at the end of the `describe` (before the closing `});`)**

```ts
  it('dedupes top_containers to one row per (signature, container)', async () => {
    const result = await getIncidentGroups({ status: 'active' });
    const cpu = result.groups.find((g) => g.signature === 'anomaly:ml-anomaly:cpu')!;
    const names = cpu.top_containers.map((tc) => tc.container_name);
    // c1 appears in incidents a1 and a1b; expect a single row.
    expect(names).toEqual(Array.from(new Set(names)));
    const c1Row = cpu.top_containers.find((tc) => tc.container_name === 'c1')!;
    expect(c1Row.incident_count).toBe(2);
    expect(c1Row.incident_ids.sort()).toEqual(['a1', 'a1b']);
    // Representative must be the highest-severity incident (a1 = critical).
    expect(c1Row.severity).toBe('critical');
    expect(c1Row.incident_id).toBe('a1');
  });

  it('container_count is unchanged by dedupe (still distinct containers)', async () => {
    const result = await getIncidentGroups({ status: 'active' });
    const cpu = result.groups.find((g) => g.signature === 'anomaly:ml-anomaly:cpu')!;
    // c1, c2, c3 — three distinct containers despite four CPU incidents (a1, a1b, a2, a3).
    expect(cpu.container_count).toBe(3);
    expect(cpu.incident_count).toBe(4);
  });

  it('surfaces latest_description from the root-cause insight and latest_summary from the incident', async () => {
    const result = await getIncidentGroups({ status: 'active' });
    const cpu = result.groups.find((g) => g.signature === 'anomaly:ml-anomaly:cpu')!;
    const c1Row = cpu.top_containers.find((tc) => tc.container_name === 'c1')!;
    expect(c1Row.latest_description).toBe('CPU 94% on c1 — baseline 22%, ML high confidence');
    expect(c1Row.latest_summary).toBe('CPU spike on c1 — investigate');
    // c2 had no insight wired up; description should be null and not crash.
    const c2Row = cpu.top_containers.find((tc) => tc.container_name === 'c2')!;
    expect(c2Row.latest_description).toBeNull();
  });
```

- [ ] **Step 4: Run the tests and confirm the new ones fail**

```bash
cd packages/ai-intelligence && \
  POSTGRES_TEST_URL=postgresql://app_user:changeme-postgres-app@localhost:5433/portainer_dashboard_test \
  npx vitest run src/__tests__/incidents-groups.test.ts
```

Expected: the three new tests FAIL (existing fields like `incident_count`, `incident_ids`, `latest_description` are missing on rows; c1 likely appears once because `top_containers` is partitioned by signature only and c1's two incidents both make rn≤10). The pre-existing six tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ai-intelligence/src/__tests__/incidents-groups.test.ts
git commit -m "test(incidents): expect dedupe + per-row description on incident groups"
```

---

### Task 3: Backend — implement dedupe + insight join in `rawTop` SQL

**Files:**
- Modify: `packages/ai-intelligence/src/services/incident-store.ts:302-365`

**Why:** Make the failing tests from Task 2 pass. Same input shape, richer per-row output: one row per `(signature, container_name)`, plus the joined description.

- [ ] **Step 1: Read the existing `rawTop` query block + stitch loop**

Run: `sed -n '302,365p' packages/ai-intelligence/src/services/incident-store.ts`
Expected: the existing `WITH base / expanded / ranked` CTE + the `topBySig` for-loop.

- [ ] **Step 2: Replace the `rawTop` query and stitch loop with a deduped version**

Replace the block from `// 2. Top-N containers per signature, ordered by severity then recency` through the closing `topBySig.set(...)` line with:

```ts
  // 2. One representative row per (signature, container_name), ordered by severity then recency.
  //    `representative` = highest-severity incident on that container; ties broken by most-recent created_at.
  //    `incident_ids` = ALL active incidents on that (signature, container) pair so the UI can render counts
  //    and the resolve action can act on the whole pair.
  //    `latest_description` is sourced from the representative incident's root-cause insight when present.
  const rawTop = await db.query<{
    signature: string;
    incident_id: string;
    container_name: string;
    endpoint_id: number | null;
    endpoint_name: string | null;
    severity: 'critical' | 'warning' | 'info';
    created_at: string;
    incident_ids: string[];
    incident_count: number;
    latest_at: string;
    latest_summary: string | null;
    latest_description: string | null;
    rn: number;
  }>(`
    WITH base AS (
      SELECT id, signature, severity, endpoint_id, endpoint_name,
             created_at, updated_at, affected_containers,
             root_cause_insight_id, summary
      FROM incidents ${whereSQL}
    ),
    expanded AS (
      SELECT b.id AS incident_id, b.signature, b.severity, b.endpoint_id, b.endpoint_name,
             b.created_at, b.updated_at, b.root_cause_insight_id, b.summary,
             e.container_name
      FROM base b
      CROSS JOIN LATERAL jsonb_array_elements_text(b.affected_containers) AS e(container_name)
    ),
    ranked AS (
      SELECT *,
             ROW_NUMBER() OVER (
               PARTITION BY signature, container_name
               ORDER BY (CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END),
                        created_at DESC
             ) AS rn_in_container
      FROM expanded
    ),
    representatives AS (
      SELECT signature, container_name,
             incident_id AS rep_incident_id,
             severity AS rep_severity,
             endpoint_id, endpoint_name,
             created_at AS rep_created_at,
             root_cause_insight_id AS rep_root_cause_insight_id,
             summary AS rep_summary
      FROM ranked
      WHERE rn_in_container = 1
    ),
    grouped AS (
      SELECT signature, container_name,
             ARRAY_AGG(incident_id ORDER BY created_at DESC) AS incident_ids,
             COUNT(*)::int AS incident_count,
             MAX(updated_at)::text AS latest_at
      FROM expanded
      GROUP BY signature, container_name
    ),
    joined AS (
      SELECT r.signature, r.container_name,
             r.rep_incident_id AS incident_id,
             r.rep_severity AS severity,
             r.endpoint_id, r.endpoint_name,
             r.rep_created_at::text AS created_at,
             g.incident_ids, g.incident_count, g.latest_at,
             r.rep_summary AS latest_summary,
             ins.description AS latest_description,
             ROW_NUMBER() OVER (
               PARTITION BY r.signature
               ORDER BY (CASE r.rep_severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END),
                        r.rep_created_at DESC
             ) AS rn
      FROM representatives r
      JOIN grouped g
        ON g.signature = r.signature AND g.container_name = r.container_name
      LEFT JOIN insights ins
        ON ins.id = r.rep_root_cause_insight_id
    )
    SELECT signature, incident_id, container_name, endpoint_id, endpoint_name,
           severity, created_at, incident_ids, incident_count, latest_at,
           latest_summary, latest_description, rn
    FROM joined
    WHERE rn <= ${TOP_CONTAINERS_PER_GROUP}
  `, params);
```

Then replace the stitch loop (`for (const r of rawTop) { ... }`) with:

```ts
  // 4. Stitch top_containers per signature
  const topBySig = new Map<string, IncidentGroup['top_containers']>();
  for (const r of rawTop) {
    const arr = topBySig.get(r.signature) ?? [];
    arr.push({
      incident_id: r.incident_id,
      container_name: r.container_name,
      endpoint_id: r.endpoint_id,
      endpoint_name: r.endpoint_name,
      severity: r.severity,
      created_at: r.created_at,
      incident_ids: r.incident_ids,
      incident_count: r.incident_count,
      latest_at: r.latest_at,
      latest_summary: r.latest_summary,
      latest_description: r.latest_description,
    });
    topBySig.set(r.signature, arr);
  }
```

- [ ] **Step 3: Run the test file**

```bash
cd packages/ai-intelligence && \
  POSTGRES_TEST_URL=postgresql://app_user:changeme-postgres-app@localhost:5433/portainer_dashboard_test \
  npx vitest run src/__tests__/incidents-groups.test.ts
```

Expected: all nine tests PASS (six pre-existing + three from Task 2).

- [ ] **Step 4: Run the full ai-intelligence test suite to catch regressions**

```bash
cd packages/ai-intelligence && \
  POSTGRES_TEST_URL=postgresql://app_user:changeme-postgres-app@localhost:5433/portainer_dashboard_test \
  npx vitest run
```

Expected: PASS overall. If `incidents-list.test.ts` or `incidents.test.ts` start failing, those tests likely consumed the old `top_containers` shape — inspect failures and adapt assertions; do NOT loosen the new behaviour.

- [ ] **Step 5: Commit**

```bash
git add packages/ai-intelligence/src/services/incident-store.ts
git commit -m "feat(incidents): dedupe group rows by container, attach insight description"
```

---

### Task 4: Backend — verify the API still typechecks and the route serializes the new fields

**Files:**
- Read: `packages/ai-intelligence/src/routes/incidents.ts`
- Modify (only if needed): same file

**Why:** Make sure the Fastify route is not stripping the new fields via a response schema or typed reply. The current `/api/incidents/groups` handler at `routes/incidents.ts:47-65` does not declare a `response` schema (verified during plan), so Fastify will pass the new fields through unchanged. This task is a guarded no-op.

- [ ] **Step 1: Confirm no response schema is set on the groups route**

Run: `grep -n "incidents/groups" -A 25 packages/ai-intelligence/src/routes/incidents.ts`
Expected: the `schema` block has `tags`, `summary`, `security` only. No `response` key. If a `response` schema IS present (e.g. someone added one between plan-time and execution), extend it to include the five new fields (`incident_ids: { type: 'array', items: { type: 'string' } }`, `incident_count: { type: 'integer' }`, `latest_at: { type: 'string' }`, `latest_summary: { type: ['string','null'] }`, `latest_description: { type: ['string','null'] }`). Otherwise no edit needed.

- [ ] **Step 2: Typecheck the package**

Run: `npx tsc -b packages/ai-intelligence`
Expected: PASS.

- [ ] **Step 3: Smoke-test the live endpoint (optional but recommended)**

Run from another terminal, with backend started via `npm run dev`:
```bash
curl -s http://localhost:3051/api/incidents/groups -H "Authorization: Bearer $JWT" | jq '.groups[0].top_containers[0]'
```
Expected: object includes `incident_count`, `incident_ids`, `latest_at`, `latest_summary`, `latest_description`. If the user is not running the backend locally, skip this step.

- [ ] **Step 4: Commit only if Step 1 required an edit**

If no edit was needed, no commit. Otherwise:

```bash
git add packages/ai-intelligence/src/routes/incidents.ts
git commit -m "fix(incidents): extend groups response schema for per-row detail"
```

---

### Task 5: Frontend — extend the `IncidentGroup` type in the hook

**Files:**
- Modify: `frontend/src/features/ai-intelligence/hooks/use-incident-groups.ts:14-24`

**Why:** Mirror the backend contract so consuming components have type access to the new fields. No runtime behaviour change.

- [ ] **Step 1: Read the current type**

Run: `sed -n '1,35p' frontend/src/features/ai-intelligence/hooks/use-incident-groups.ts`
Expected: existing `top_containers` array shape with six fields.

- [ ] **Step 2: Edit the type**

In `frontend/src/features/ai-intelligence/hooks/use-incident-groups.ts`, replace the `top_containers` array shape so the interface reads:

```ts
  top_containers: Array<{
    incident_id: string;
    container_name: string;
    endpoint_id: number | null;
    endpoint_name: string | null;
    severity: 'critical' | 'warning' | 'info';
    created_at: string;
    incident_ids: string[];
    incident_count: number;
    latest_at: string;
    latest_summary: string | null;
    latest_description: string | null;
  }>;
```

- [ ] **Step 3: Typecheck the frontend**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS. Existing consumers don't read the new fields yet, so no error.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/features/ai-intelligence/hooks/use-incident-groups.ts
git commit -m "refactor(incidents): mirror backend per-row detail fields in hook type"
```

---

### Task 6: Frontend — failing test for the new row rendering

**Files:**
- Create: `frontend/src/features/ai-intelligence/components/incident-groups-view.row-detail.test.tsx`

**Why:** Lock the visual behaviour: each row shows the description on its own line and shows an "N alerts" badge when `incident_count > 1`. Use the existing test file's mock pattern.

- [ ] **Step 1: Read an existing test to copy the wiring**

Run: `cat frontend/src/features/ai-intelligence/components/incident-groups-view.show-all.test.tsx`
Expected: see the `vi.mock('../hooks/use-incident-groups', ...)` + `wrap(...)` pattern. Reuse it.

- [ ] **Step 2: Create the new test file**

Write `frontend/src/features/ai-intelligence/components/incident-groups-view.row-detail.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IncidentGroupsView } from './incident-groups-view';

vi.mock('../hooks/use-incident-groups', () => ({ useIncidentGroups: vi.fn() }));
vi.mock('@/shared/lib/api', () => ({ api: { get: vi.fn() } }));
import { useIncidentGroups } from '../hooks/use-incident-groups';

const wrap = (children: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter>{children}</MemoryRouter>
  </QueryClientProvider>
);

describe('IncidentGroupsView — per-row detail', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders the latest_description on each row', () => {
    (useIncidentGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        total_active: 1, endpoint_facets: [],
        groups: [{
          signature: 'anomaly:ml-anomaly:cpu',
          label: 'Anomalous CPU usage (ML)',
          severity: 'critical',
          incident_count: 1, container_count: 1, alert_count: 1,
          earliest_at: '', latest_update_at: '',
          top_containers: [{
            incident_id: 'a1', container_name: 'c1',
            endpoint_id: 1, endpoint_name: 'eA',
            severity: 'critical', created_at: '',
            incident_ids: ['a1'], incident_count: 1,
            latest_at: '', latest_summary: 'CPU spike on c1 — investigate',
            latest_description: 'CPU 94% on c1 — baseline 22%, ML high confidence',
          }],
          all_container_names: ['c1'], names_truncated: false,
        }],
      },
      isLoading: false,
    });

    render(wrap(<IncidentGroupsView />));
    expect(screen.getByText('CPU 94% on c1 — baseline 22%, ML high confidence')).toBeInTheDocument();
  });

  it('falls back to latest_summary when latest_description is null', () => {
    (useIncidentGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        total_active: 1, endpoint_facets: [],
        groups: [{
          signature: 's', label: 'Sig', severity: 'critical',
          incident_count: 1, container_count: 1, alert_count: 1,
          earliest_at: '', latest_update_at: '',
          top_containers: [{
            incident_id: 'a1', container_name: 'c1',
            endpoint_id: 1, endpoint_name: 'eA',
            severity: 'critical', created_at: '',
            incident_ids: ['a1'], incident_count: 1,
            latest_at: '', latest_summary: 'fallback summary',
            latest_description: null,
          }],
          all_container_names: ['c1'], names_truncated: false,
        }],
      },
      isLoading: false,
    });

    render(wrap(<IncidentGroupsView />));
    expect(screen.getByText('fallback summary')).toBeInTheDocument();
  });

  it('renders an "N alerts" badge when incident_count > 1', () => {
    (useIncidentGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        total_active: 3, endpoint_facets: [],
        groups: [{
          signature: 's', label: 'Sig', severity: 'critical',
          incident_count: 3, container_count: 1, alert_count: 3,
          earliest_at: '', latest_update_at: '',
          top_containers: [{
            incident_id: 'a1', container_name: 'c1',
            endpoint_id: 1, endpoint_name: 'eA',
            severity: 'critical', created_at: '',
            incident_ids: ['a1', 'a2', 'a3'], incident_count: 3,
            latest_at: '', latest_summary: null,
            latest_description: 'CPU 91% on c1',
          }],
          all_container_names: ['c1'], names_truncated: false,
        }],
      },
      isLoading: false,
    });

    render(wrap(<IncidentGroupsView />));
    expect(screen.getByText('3 alerts')).toBeInTheDocument();
  });

  it('omits the badge when incident_count === 1', () => {
    (useIncidentGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        total_active: 1, endpoint_facets: [],
        groups: [{
          signature: 's', label: 'Sig', severity: 'critical',
          incident_count: 1, container_count: 1, alert_count: 1,
          earliest_at: '', latest_update_at: '',
          top_containers: [{
            incident_id: 'a1', container_name: 'c1',
            endpoint_id: 1, endpoint_name: 'eA',
            severity: 'critical', created_at: '',
            incident_ids: ['a1'], incident_count: 1,
            latest_at: '', latest_summary: null,
            latest_description: 'CPU 91% on c1',
          }],
          all_container_names: ['c1'], names_truncated: false,
        }],
      },
      isLoading: false,
    });

    render(wrap(<IncidentGroupsView />));
    expect(screen.queryByText(/\d+ alerts?$/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the new test file and confirm all four tests fail**

```bash
cd frontend && npx vitest run src/features/ai-intelligence/components/incident-groups-view.row-detail.test.tsx
```

Expected: FOUR FAILS. Description text and "3 alerts" text are not in the DOM (the renderer only shows container name + severity · endpoint).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/features/ai-intelligence/components/incident-groups-view.row-detail.test.tsx
git commit -m "test(incidents): expect description + alert count badge on group rows"
```

---

### Task 7: Frontend — implement the new row rendering

**Files:**
- Modify: `frontend/src/features/ai-intelligence/components/incident-groups-view.tsx:230-244`

**Why:** Make the four tests from Task 6 pass. Render the description (or summary fallback) on a second line, and a small badge when `incident_count > 1`.

- [ ] **Step 1: Read the current row markup**

Run: `sed -n '230,244p' frontend/src/features/ai-intelligence/components/incident-groups-view.tsx`
Expected: a flex row with the container `<Link>` and a single span showing severity + endpoint.

- [ ] **Step 2: Replace the row markup**

Replace the contents of the `<ul className="divide-y">{rows.map(...)}</ul>` so each list item reads:

```tsx
                  {rows.map((row) => {
                    const detail = ('latest_description' in row ? row.latest_description : null)
                      ?? ('latest_summary' in row ? row.latest_summary : null);
                    const count = ('incident_count' in row ? row.incident_count : 1) ?? 1;
                    return (
                      <li
                        key={`${row.incident_id}:${row.container_name}`}
                        className="flex flex-col gap-1 px-4 py-2 text-sm"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <Link
                              to={`/containers/${row.endpoint_id}/${row.container_name}`}
                              className="font-mono text-sm hover:underline truncate"
                            >
                              {row.container_name}
                            </Link>
                            {count > 1 && (
                              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                                {count} alerts
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {row.severity} · {row.endpoint_name ?? 'unknown'}
                          </span>
                        </div>
                        {detail && (
                          <p className="pl-1 text-xs text-muted-foreground">
                            {detail}
                          </p>
                        )}
                      </li>
                    );
                  })}
```

The `'latest_description' in row` guard keeps the file resilient to the long-tail rows path (Task 8) where these fields may not be present yet.

- [ ] **Step 3: Run the row-detail tests**

```bash
cd frontend && npx vitest run src/features/ai-intelligence/components/incident-groups-view.row-detail.test.tsx
```

Expected: 4/4 PASS.

- [ ] **Step 4: Run all `incident-groups-view` tests to catch regressions**

```bash
cd frontend && npx vitest run src/features/ai-intelligence/components/incident-groups-view
```

Expected: all suites PASS. The `show-all` test at line 63-64 asserts `getByText('cn-10')` — still works because the container name is still in the DOM.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/ai-intelligence/components/incident-groups-view.tsx
git commit -m "feat(incidents): show metric description + alert count on group rows"
```

---

### Task 8: Frontend — dedupe the long-tail (Show all) path

**Files:**
- Modify: `frontend/src/features/ai-intelligence/components/incident-groups-view.tsx` — `LongTailRow` interface (lines 19-26) and `showAll` callback (lines 134-154); the matching block in the search effect (lines 70-89)

**Why:** When the user clicks "Show all 12", the second-page fetch goes through `/api/incidents` (not `/api/incidents/groups`) and rebuilds rows by flat-mapping `affected_containers`. Without dedupe here, expanding the long tail re-introduces the very duplication we just removed. We dedupe client-side: one row per `container_name`, keeping the highest-severity / most-recent incident, and synthesising the same shape as the deduped backend rows.

- [ ] **Step 1: Update the `LongTailRow` interface**

Replace `interface LongTailRow { ... }` (currently lines 19-26) with:

```ts
interface LongTailRow {
  incident_id: string;
  container_name: string;
  endpoint_id: number | null;
  endpoint_name: string | null;
  severity: 'critical' | 'warning' | 'info';
  created_at: string;
  incident_ids: string[];
  incident_count: number;
  latest_at: string;
  latest_summary: string | null;
  latest_description: string | null;
}
```

- [ ] **Step 2: Add a dedupe helper just below the interface**

Insert immediately after the `LongTailRow` interface:

```ts
const SEV_RANK: Record<LongTailRow['severity'], number> = { critical: 0, warning: 1, info: 2 };

function dedupeByContainer(
  incidents: Array<{
    id: string; affected_containers: string[];
    endpoint_id: number | null; endpoint_name: string | null;
    severity: 'critical' | 'warning' | 'info'; created_at: string;
    updated_at?: string; summary?: string | null;
  }>,
): LongTailRow[] {
  const byContainer = new Map<string, LongTailRow>();
  for (const inc of incidents) {
    for (const name of inc.affected_containers ?? []) {
      const existing = byContainer.get(name);
      const incLatest = inc.updated_at ?? inc.created_at;
      if (!existing) {
        byContainer.set(name, {
          incident_id: inc.id, container_name: name,
          endpoint_id: inc.endpoint_id, endpoint_name: inc.endpoint_name,
          severity: inc.severity, created_at: inc.created_at,
          incident_ids: [inc.id], incident_count: 1,
          latest_at: incLatest,
          latest_summary: inc.summary ?? null,
          latest_description: null, // long-tail fetch doesn't carry the joined insight description
        });
        continue;
      }
      existing.incident_ids.push(inc.id);
      existing.incident_count = existing.incident_ids.length;
      if (incLatest > existing.latest_at) existing.latest_at = incLatest;
      // Promote representative if this incident is more severe, or same severity but more recent.
      const sevCmp = SEV_RANK[inc.severity] - SEV_RANK[existing.severity];
      const isMoreRecent = inc.created_at > existing.created_at;
      if (sevCmp < 0 || (sevCmp === 0 && isMoreRecent)) {
        existing.incident_id = inc.id;
        existing.severity = inc.severity;
        existing.created_at = inc.created_at;
        existing.endpoint_id = inc.endpoint_id;
        existing.endpoint_name = inc.endpoint_name;
        existing.latest_summary = inc.summary ?? existing.latest_summary;
      }
    }
  }
  return Array.from(byContainer.values());
}
```

- [ ] **Step 3: Use the helper in `showAll`**

Replace the body of `showAll` so it reads:

```tsx
  const showAll = useCallback(async (group: IncidentGroup) => {
    const controller = new AbortController();
    const r = await api.get<{
      incidents: Array<{
        id: string;
        affected_containers: string[];
        endpoint_id: number | null;
        endpoint_name: string | null;
        severity: 'critical' | 'warning' | 'info';
        created_at: string;
        updated_at?: string;
        summary?: string | null;
      }>;
    }>('/api/incidents', { params: { status: 'active', signature: group.signature, limit: '500' }, signal: controller.signal });
    const rows = dedupeByContainer(r.incidents);
    setLongTailBySig((prev) => ({ ...prev, [group.signature]: rows }));
  }, []);
```

- [ ] **Step 4: Use the helper in the search-driven long-tail effect**

Replace the `.then(...)` body inside the `useEffect` at lines 70-89 so the API call collapses through `dedupeByContainer`:

```tsx
      api.get<{ incidents: Array<{ id: string; affected_containers: string[]; endpoint_id: number | null; endpoint_name: string | null; severity: 'critical' | 'warning' | 'info'; created_at: string; updated_at?: string; summary?: string | null }> }>(
        '/api/incidents',
        { params: { status: 'active', signature: sig, q: debouncedSearch }, signal: controller.signal },
      ).then((r) => {
        const rows = dedupeByContainer(r.incidents);
        setLongTailBySig((prev) => ({ ...prev, [sig]: rows }));
      }).catch(() => undefined);
```

- [ ] **Step 5: Update the existing show-all test fixture so it remains accurate**

Edit `frontend/src/features/ai-intelligence/components/incident-groups-view.show-all.test.tsx` mocked response — the existing fixture has each container appearing once, which is fine. Add one more incident to the mock that re-uses `cn-10` to assert dedupe. After the existing two incidents in the `incidents:` array (line 42-48), insert:

```ts
        { id: 'i10b', title: 't', signature: 'a:b:c', severity: 'critical', status: 'active',
          affected_containers: ['cn-10'], endpoint_id: 1, endpoint_name: 'e',
          created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
          summary: null },
```

Then add an assertion at the end of the `await waitFor` block:

```ts
    // cn-10 appears in two incidents (i10, i10b). Long-tail must dedupe to a single row.
    expect(screen.getAllByText('cn-10')).toHaveLength(1);
    // Badge shows 2 alerts for that container.
    expect(screen.getByText('2 alerts')).toBeInTheDocument();
```

- [ ] **Step 6: Run the show-all + row-detail tests**

```bash
cd frontend && npx vitest run \
  src/features/ai-intelligence/components/incident-groups-view.show-all.test.tsx \
  src/features/ai-intelligence/components/incident-groups-view.row-detail.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Run the full ai-intelligence frontend suite**

```bash
cd frontend && npx vitest run src/features/ai-intelligence
```

Expected: PASS. If `incident-groups-view.search.test.tsx` or `.url.test.tsx` break, inspect — they should not, because they assert on container names and headers, not on row inner detail.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/features/ai-intelligence/components/incident-groups-view.tsx \
        frontend/src/features/ai-intelligence/components/incident-groups-view.show-all.test.tsx
git commit -m "feat(incidents): dedupe long-tail rows by container client-side"
```

---

### Task 9: Manual verification in the browser

**Files:** none

**Why:** TS + unit tests confirm shape; only a real run shows the actual screen the user complained about.

- [ ] **Step 1: Boot the dev stack**

Run: `npm run dev`
Expected: backend on `:3051`, frontend on `:5173`, no startup errors. If the user has a local Postgres + seeded incidents, proceed; otherwise let the user verify.

- [ ] **Step 2: Open the Health page and expand a group**

Navigate to `http://localhost:5173/health`. Expand "Anomalous CPU usage (ML)" or any other group with multiple containers.

Expected:
- Each container appears at most once.
- Below each container, a second smaller line shows the metric description (e.g. "CPU 94% on portainer-portainer-1 — baseline 22%, ML high confidence"). When no description exists, the row may show only the container name + severity · endpoint, with no second line.
- Containers with multiple active incidents show a small "`N alerts`" badge next to the name.

- [ ] **Step 3: Compare against the screenshot the user flagged**

Open `health-incidents.png` from the repo root. Confirm the same group is now shorter (no per-container duplicates) and shows the description line.

- [ ] **Step 4: Take a screenshot for the PR**

Save under repo root as `health-incidents-after-row-detail.png`.

- [ ] **Step 5: No commit needed.** This task documents the manual check; the screenshot is uncommitted noise.

---

## Self-Review

**Spec coverage:**
- Item 1 (dedupe to one row per container per group): Tasks 2-3 (backend SQL dedupe with `incident_ids` + `incident_count`), Task 6-7 (frontend assert/render badge), Task 8 (long-tail dedupe). Covered.
- Item 2 (show "what" on every row): Tasks 1-3 (backend join `insights` for `latest_description`, surface `latest_summary`), Tasks 6-7 (frontend renders fallback chain). Covered.

**Placeholder scan:**
- No "TBD", "implement later", or "add error handling" steps.
- All code blocks contain executable code.
- All `Run` steps include the exact command.

**Type consistency:**
- `IncidentGroup['top_containers'][]` shape matches across `packages/ai-intelligence/.../incident-store.ts` (Task 1) and `frontend/.../use-incident-groups.ts` (Task 5).
- The frontend `LongTailRow` (Task 8) carries the same fields as the backend per-row shape, so both `top_containers` and the long-tail rows render through the same code path in Task 7.
- `latest_description` is `string | null` everywhere it appears.
- `incident_count` is integer everywhere; `incident_ids` is `string[]` everywhere.
- `dedupeByContainer` (Task 8) sets `latest_description: null` because the `/api/incidents` payload does not include the joined insight description — the row-detail fallback chain in Task 7 (`latest_description ?? latest_summary`) gracefully degrades to `latest_summary`. Documented in code.

**Out of scope (deliberately deferred):**
- Sparklines on each row (item 3 from the recommendation list).
- Group-header subline summary (item 5).
- "View history" drill-in (item 6).
- Sort within group by severity / value (item 4) — backend already sorts by severity then created_at; that's good enough for v1.
- New endpoint or migration. The change is contained to one SQL query + one TS file on the frontend.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-07-health-incident-row-detail.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
