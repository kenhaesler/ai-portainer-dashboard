# Issue #1545 — Response-schema batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:test-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add Fastify `response: { 200: ... }` Zod schemas to 5 hot GET routes so they get fast-json-stringify serialization + field pruning, each verified field-by-field against its frontend consumer.

**Architecture:** The global `serializerCompiler` (fastify-type-provider-zod v6, zod v4) is already wired (`packages/core/src/plugins/swagger.ts:13-14`). Each route gains a `response` schema built from an existing exact-match Zod model (settings/investigations/incidents) or a new domain-local schema (harbor). Field-presence tests live in each route's own package `__tests__` (run against `src`, sibling stores mocked) to prove no consumer-read field is stripped.

**Tech Stack:** Fastify 5, zod 4.3.6, fastify-type-provider-zod 6.1.0, Vitest.

## Global Constraints

- zod v4 only; date/timestamp fields are ISO strings (pg type parsers at `postgres.ts:12-13` return `TIMESTAMPTZ`/`TIMESTAMP` as `toISOString()`), so `z.string()` is correct for them.
- Error paths on a route that declares a `200` schema must cast: `return (reply as any).code(4xx|5xx).send(...)` (Zod type-provider narrows `reply` to the 200 shape). Pattern: `monitoring.ts:308`.
- Do NOT touch excluded routes: `GET /api/containers` (stale `NormalizedContainerSchema` drops `networkIPs`; 3-way union) and `GET /api/monitoring/insights` (`SELECT *` superset of `InsightSchema`).
- Tests: mock the sibling store (the boundary), not the DB driver; register `setValidatorCompiler`+`setSerializerCompiler` so pruning is actually exercised; decorate `authenticate` (and `requireRole` for admin routes).

## Verified schema facts (columns audited against migrations)

- `settings` table = exactly `key,value,category,updated_at` (002; no later ALTER) = `SettingSchema` (`packages/core/src/models/settings.ts:3`).
- `incidents` table = `IncidentSchema`'s 16 fields + `signature` (added 029). `getIncidents` = `SELECT *` → `Incident[]`; frontend `Incident` type omits `signature`, so pruning it is safe.
- `investigations` table = exactly `InvestigationSchema`'s 18 fields (007; ai_summary added 023; no other ALTER). `getInvestigations` = `SELECT i.*, ins.title AS insight_title, ins.severity AS insight_severity, ins.category AS insight_category` → `InvestigationWithInsight[]`. Frontend type is `InvestigationWithInsight`, so preserve the 3 join fields via an extended schema.
- Harbor `VulnerabilityRecord` (17 fields) / `VulnerabilitySummary` (9 fields) mirror the frontend interfaces 1:1 (`use-harbor-vulnerabilities.ts:8-49`).

---

### Task 1: Harbor vulnerabilities list + summary schemas

**Files:**
- Modify: `packages/security/src/routes/harbor-vulnerabilities.ts` (imports `z` from `zod/v4` already at line 2)
- Test: `packages/security/src/__tests__/harbor-vulnerabilities-response-schema.test.ts`

**Schemas (module scope, after imports):**

```ts
const HarborVulnerabilityRecordSchema = z.object({
  id: z.number(),
  cve_id: z.string(),
  severity: z.string(),
  cvss_v3_score: z.number().nullable(),
  package: z.string(),
  version: z.string(),
  fixed_version: z.string().nullable(),
  status: z.string().nullable(),
  description: z.string().nullable(),
  links: z.string().nullable(),
  project_id: z.number(),
  repository_name: z.string(),
  digest: z.string(),
  tags: z.string().nullable(),
  in_use: z.boolean(),
  matching_containers: z.string().nullable(),
  synced_at: z.string(),
});

const HarborVulnerabilitySummarySchema = z.object({
  total: z.number(),
  critical: z.number(),
  high: z.number(),
  medium: z.number(),
  low: z.number(),
  in_use_total: z.number(),
  in_use_critical: z.number(),
  fixable: z.number(),
  excepted: z.number(),
});

const HarborVulnerabilityListResponseSchema = z.object({
  vulnerabilities: z.array(HarborVulnerabilityRecordSchema),
  summary: HarborVulnerabilitySummarySchema,
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});
```

**Wiring:** add `response: { 200: HarborVulnerabilityListResponseSchema }` to the `/api/harbor/vulnerabilities` route schema (line ~98-110) and `response: { 200: HarborVulnerabilitySummarySchema }` to `/api/harbor/vulnerabilities/summary` (line ~135-140). Neither handler has an error reply, so no cast needed.

- [ ] **Step 1: Write the failing test** — `harbor-vulnerabilities-response-schema.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';

vi.mock('../services/harbor-vulnerability-store.js', () => ({
  getVulnerabilities: vi.fn(),
  getVulnerabilitySummary: vi.fn(),
  getVulnerabilitiesCount: vi.fn(),
  classifySyncStatus: vi.fn(),
  getLatestSyncStatus: vi.fn(),
}));
vi.mock('../services/harbor-client.js', () => ({
  isHarborConfiguredAsync: vi.fn().mockResolvedValue(true),
  testConnection: vi.fn(), getSecuritySummary: vi.fn(),
}));
vi.mock('@dashboard/core/services/settings-store.js', () => ({
  getEffectiveHarborConfig: vi.fn().mockResolvedValue({ enabled: false }),
}));
vi.mock('../services/harbor-sync.js', () => ({ runFullSync: vi.fn(), getIsSyncing: vi.fn() }));

import * as vulnStore from '../services/harbor-vulnerability-store.js';
import { harborVulnerabilityRoutes } from '../routes/harbor-vulnerabilities.js';

const RECORD = {
  id: 1, cve_id: 'CVE-2024-1', severity: 'Critical', cvss_v3_score: 9.8,
  package: 'openssl', version: '1.1', fixed_version: null, status: null,
  description: null, links: null, project_id: 2, repository_name: 'lib/app',
  digest: 'sha256:x', tags: null, in_use: true, matching_containers: null,
  synced_at: '2026-07-13T00:00:00.000Z',
};
const SUMMARY = { total: 1, critical: 1, high: 0, medium: 0, low: 0, in_use_total: 1, in_use_critical: 1, fixable: 0, excepted: 0 };

function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('authenticate', async () => undefined);
  app.decorate('requireRole', () => async () => undefined);
  return app;
}

describe('GET /api/harbor/vulnerabilities response schema', () => {
  beforeEach(() => vi.clearAllMocks());

  it('preserves every VulnerabilityRecord + summary field the frontend reads', async () => {
    vi.mocked(vulnStore.getVulnerabilities).mockResolvedValue([RECORD] as never);
    vi.mocked(vulnStore.getVulnerabilitySummary).mockResolvedValue(SUMMARY as never);
    vi.mocked(vulnStore.getVulnerabilitiesCount).mockResolvedValue(1 as never);
    const app = buildApp();
    await app.register(harborVulnerabilityRoutes);
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/harbor/vulnerabilities' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ total: 1, limit: 200, offset: 0, summary: SUMMARY });
    expect(body.vulnerabilities[0]).toEqual(RECORD);
    await app.close();
  });

  it('summary route returns all 9 counters', async () => {
    vi.mocked(vulnStore.getVulnerabilitySummary).mockResolvedValue(SUMMARY as never);
    const app = buildApp();
    await app.register(harborVulnerabilityRoutes);
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/harbor/vulnerabilities/summary' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(SUMMARY);
    await app.close();
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (fields still present without schema, but the test also asserts `res.json().vulnerabilities[0]` equals RECORD exactly; before the schema, extra internal fields could differ). Run: `cd packages/security && npx vitest run src/__tests__/harbor-vulnerabilities-response-schema.test.ts`
- [ ] **Step 3: Add the 3 schemas + `response` blocks** to `harbor-vulnerabilities.ts`.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `feat(#1545): response schema for harbor vulnerabilities list + summary`.

---

### Task 2: Settings list schema

**Files:**
- Modify: `packages/foundation/src/routes/settings.ts` — add `import { SettingSchema } from '@dashboard/core/models/settings.js';` and `import { z } from 'zod/v4';`
- Test: `packages/foundation/src/__tests__/settings-response-schema.test.ts`

**Wiring:** `GET /api/settings` (line 141) → add `response: { 200: z.array(SettingSchema) }`.

- [ ] **Step 1: Write failing test** — mock the DB router so the route returns a controlled row incl. an extra internal column, and assert the response prunes to the 4 SettingSchema fields:

```ts
vi.mock('@dashboard/core/db/app-db-router.js', () => ({
  getDbForDomain: () => ({ query: async () => [
    { key: 'llm.model', value: 'gpt-4o-mini', category: 'ai', updated_at: '2026-07-13T00:00:00.000Z', internal_only: 'x' },
  ] }),
}));
```
Register `settingsRoutes`, inject `GET /api/settings`, assert `body[0]` `toEqual({ key, value, category, updated_at })` (internal_only pruned).

- [ ] **Step 2: Run — expect FAIL** (`internal_only` leaks without the schema).
- [ ] **Step 3: Add the `response` block.**
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `feat(#1545): response schema for GET /api/settings`.

---

### Task 3: Investigations list schema (+ contracts schema)

**Files:**
- Modify: `packages/contracts/src/schemas/investigation.ts` — add `InvestigationWithInsightSchema`
- Modify: `packages/ai-intelligence/src/routes/investigations.ts` — add `import { z } from 'zod/v4';` and `import { InvestigationWithInsightSchema } from '@dashboard/contracts';`
- Test: `packages/ai-intelligence/src/__tests__/investigations-response-schema.test.ts`

**Contracts schema (mirror the existing `InvestigationWithInsight` interface):**

```ts
export const InvestigationWithInsightSchema = InvestigationSchema.extend({
  insight_title: z.string().nullable().optional(),
  insight_severity: z.string().nullable().optional(),
  insight_category: z.string().nullable().optional(),
});
```

**Wiring:** `GET /api/investigations` (line 14) → `response: { 200: z.object({ investigations: z.array(InvestigationWithInsightSchema) }) }`.

- [ ] **Step 1: Write failing test** — `vi.mock('../services/investigation-store.js', () => ({ getInvestigations: vi.fn(), getInvestigation: vi.fn(), getInvestigationByInsightId: vi.fn() }))`; return one `InvestigationWithInsight` fixture (all 18 fields + insight_title/severity/category). Assert `body.investigations[0]` retains `id`, `insight_id`, `status`, `ai_summary`, AND `insight_title` (proves the join fields survive).
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Add contracts schema + route `response` block.**
- [ ] **Step 4: Run — expect PASS.** Also run contracts + ai-intelligence typecheck.
- [ ] **Step 5: Commit** — `feat(#1545): response schema for GET /api/investigations`.

---

### Task 4: Incidents list schema

**Files:**
- Modify: `packages/ai-intelligence/src/routes/incidents.ts` — add `import { IncidentSchema } from '@dashboard/contracts';`
- Test: `packages/ai-intelligence/src/__tests__/incidents-response-schema.test.ts`

**Schema (module scope, uses the route's existing `z`):**

```ts
const IncidentsListResponseSchema = z.object({
  incidents: z.array(IncidentSchema),
  counts: z.object({ active: z.number(), resolved: z.number(), total: z.number() }),
  limit: z.number(),
  offset: z.number(),
});
```

**Wiring:** `GET /api/incidents` (line 23) → `response: { 200: IncidentsListResponseSchema }`. The 400 invalid-query reply (line 35) must become `return (reply as any).code(400).send({ error: 'invalid query', details: parsed.error.flatten() })`.

- [ ] **Step 1: Write failing test** — `vi.mock('../services/incident-store.js', () => ({ getIncidents: vi.fn(), getIncident: vi.fn(), resolveIncident: vi.fn(), getIncidentCount: vi.fn(), getIncidentGroups: vi.fn(), resolveIncidentsBatch: vi.fn() }))`. Return one incident fixture that INCLUDES an extra `signature: 'sig-1'` field; `getIncidentCount → { active:1, resolved:0, total:1 }`. Assert: `body.counts` equals `{active:1,resolved:0,total:1}`; `body.incidents[0]` has all IncidentSchema fields (`related_insight_ids` array, `affected_containers` array, etc.); and `body.incidents[0].signature` is `undefined` (pruned).
- [ ] **Step 2: Run — expect FAIL** (`signature` leaks; counts/limit/offset present already).
- [ ] **Step 3: Add schema + `response` block + cast the 400 path.**
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `feat(#1545): response schema for GET /api/incidents`.

---

### Task 5: Full verification + docs + PR note

- [ ] Run each touched package's full test + typecheck: `npx vitest run` in `packages/security`, `packages/foundation`, `packages/ai-intelligence`, `packages/contracts`; `npm run typecheck`.
- [ ] Run frontend consumer tests to confirm no shape regression: `cd frontend && npx vitest run src/features/security src/features/core/hooks/use-settings.test.ts src/features/ai-intelligence` (whichever exist).
- [ ] Update `docs/architecture.md` if it enumerates schema coverage (add the 5 routes).
- [ ] No `docker/.env.example` change (no new env). No CLAUDE/AGENTS/GEMINI change (pure additive batch).
- [ ] Leave a PR comment on #1545 listing the 5 routes covered + that the bulk remains (issue stays open).

## Self-Review

- **Spec coverage:** all 5 spec routes have a task (settings T2, harbor list+summary T1, investigations T3, incidents T4). Excluded routes untouched. ✓
- **Placeholders:** none — every schema and test skeleton is concrete. ✓
- **Type consistency:** `InvestigationWithInsightSchema` defined in T3 and consumed in the same task; `IncidentSchema`/`SettingSchema` are existing exports; harbor schemas are self-contained in T1. Date fields `z.string()` per Global Constraints. ✓
- **Incidents caveat resolved:** served shape is `{incidents,counts,limit,offset}` (confirmed at `incidents.ts:42-47`); `signature` prune is safe (frontend `Incident` omits it). Not deferred. ✓
