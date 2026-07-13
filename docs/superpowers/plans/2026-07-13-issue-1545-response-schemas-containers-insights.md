# Issue #1545 — Containers + Insights Response Schemas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add non-breaking Fastify `response:` schemas to `GET /api/containers` (+ `/count`, `/favorites`) and `GET /api/monitoring/insights` (+ container variant), fixing the `NormalizedContainerSchema` `networkIPs` drift that blocked them.

**Architecture:** Attach permissive Zod response schemas that lock each envelope and speed serialization **without changing any wire value**. Containers reuse the (repaired) `NormalizedContainerSchema`; the polymorphic list route gets an ordered 3-shape union. Insights rows use a `.passthrough()` schema (rows are internal `SELECT *` data with type divergences that would otherwise 500 the serializer); the insights envelope and the container-insights route get exact schemas.

**Tech Stack:** Fastify 5, `fastify-type-provider-zod` (serializerCompiler wired globally via `swagger.ts`), Zod v4.3.6 (`zod/v4`, `.passthrough()` convention), Vitest, real PostgreSQL for DB-backed tests.

## Global Constraints

- **Never push to `main`/`dev`.** Work on `feature/1545-schemas-containers-insights` (already created off `dev`). Commit locally only; do **not** push or open a PR unless the user asks.
- **Tests required for every change.** Never use `--no-verify`.
- **Non-breaking only.** No wire value may change; the frontend `normalizeContainersResponse` shape-sniffer stays; the polymorphic `GET /api/containers` shape is preserved.
- **zod serializer `.parse()`es the payload** — a schema that omits a returned field prunes it; a schema stricter than the real row 500s. Verify every field against the real shape.
- **Isolated route tests must call `app.setSerializerCompiler(serializerCompiler)`** (from `fastify-type-provider-zod`) or routes with a `response` schema fail to boot.
- **Backend/server tests run against compiled `dist/`** of `@dashboard/*`. Rebuild touched packages before running them: `npm run build -w @dashboard/contracts -w @dashboard/core -w @dashboard/foundation`. In-package `__tests__` (contracts, ai-intelligence) run against `src` (no rebuild).
- **Zod import:** `import { z } from 'zod/v4';` (matches every schema file in the repo).

---

### Task 1: Repair `NormalizedContainerSchema` drift (contracts)

The contract schema omits `networkIPs`, which the live `NormalizedContainer` interface has and the frontend reads. Add it (required — the normalizer always produces it, even as `{}`). Update the two raw parse-test fixtures that omit it.

**Files:**
- Modify: `packages/contracts/src/schemas/container.ts:9-22`
- Test: `packages/contracts/src/__tests__/schemas.test.ts:137-152`

**Interfaces:**
- Produces: `NormalizedContainerSchema` now includes `networkIPs: z.record(z.string(), z.string())` (required). `z.infer<typeof NormalizedContainerSchema>` gains `networkIPs: Record<string, string>`.

- [ ] **Step 1: Write the failing test** — add to `packages/contracts/src/__tests__/schemas.test.ts` inside the existing `describe('NormalizedContainerSchema', ...)` block (after line 151):

```typescript
  it('preserves networkIPs (drift guard for the live normalizer field)', () => {
    const raw = { id: 'c1', name: 'nginx', image: 'nginx:latest', state: 'running',
      status: 'Up', endpointId: 1, endpointName: 'local', ports: [], created: 1700000000,
      labels: {}, networks: ['bridge'], networkIPs: { bridge: '172.17.0.2' } };
    expect(NormalizedContainerSchema.parse(raw).networkIPs).toEqual({ bridge: '172.17.0.2' });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/contracts && npx vitest run src/__tests__/schemas.test.ts -t "preserves networkIPs"`
Expected: FAIL — `networkIPs` is `undefined` (schema strips the unknown field).

- [ ] **Step 3: Add the field to the schema** — in `packages/contracts/src/schemas/container.ts`, add `networkIPs` after the `networks` line (line 20):

```typescript
export const NormalizedContainerSchema = z.object({
  id: z.string(),
  name: z.string(),
  image: z.string(),
  state: z.string(),
  status: z.string(),
  endpointId: z.number(),
  endpointName: z.string(),
  ports: z.array(ContainerPortSchema),
  created: z.number(),
  labels: z.record(z.string(), z.string()),
  networks: z.array(z.string()),
  networkIPs: z.record(z.string(), z.string()),
  healthStatus: z.string().optional(),
});
```

- [ ] **Step 4: Update the two existing fixtures** so the now-required field is present. In `packages/contracts/src/__tests__/schemas.test.ts`:

Line 142 — change `labels: { app: 'web' }, networks: ['bridge'] };` to:
```typescript
      created: 1700000000, labels: { app: 'web' }, networks: ['bridge'], networkIPs: {} };
```
Line 149 — change `labels: {}, networks: [], healthStatus: 'healthy' };` to:
```typescript
      labels: {}, networks: [], networkIPs: {}, healthStatus: 'healthy' };
```

- [ ] **Step 5: Run the full contracts suite**

Run: `cd packages/contracts && npx vitest run src/__tests__/schemas.test.ts`
Expected: PASS (all `NormalizedContainerSchema` tests green).

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/schemas/container.ts packages/contracts/src/__tests__/schemas.test.ts
git commit -m "fix(#1545): add networkIPs to NormalizedContainerSchema (contract drift)"
```

---

### Task 2: Runtime drift guard against the live normalizer (core)

A stronger guard than Task 1's literal fixture: parse a real `normalizeContainer` output through the schema and assert **no key is dropped**. This fails if the schema ever falls behind the normalizer again.

**Files:**
- Create: `packages/core/src/portainer/container-schema-drift.test.ts`

**Interfaces:**
- Consumes: `normalizeContainer` (`./portainer-normalizers.js`), `NormalizedContainerSchema` (`@dashboard/contracts`).

- [ ] **Step 1: Rebuild contracts dist** (core resolves `@dashboard/contracts` from dist):

Run: `npm run build -w @dashboard/contracts`
Expected: build succeeds.

- [ ] **Step 2: Write the guard test** — create `packages/core/src/portainer/container-schema-drift.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { NormalizedContainerSchema } from '@dashboard/contracts';
import { normalizeContainer } from './portainer-normalizers.js';

describe('NormalizedContainerSchema ⇄ normalizeContainer drift guard', () => {
  it('the schema keeps every key the live normalizer produces', () => {
    const normalized = normalizeContainer(
      {
        Id: 'abc123', Names: ['/web'], Image: 'nginx:latest', State: 'running',
        Status: 'Up 2 hours (healthy)', Created: 1700000000,
        Ports: [{ PrivatePort: 80, PublicPort: 8080, Type: 'tcp' }],
        Labels: { app: 'web' },
        NetworkSettings: { Networks: { bridge: { IPAddress: '172.17.0.2' } } },
      } as never,
      1,
      'local',
    );
    const parsed = NormalizedContainerSchema.parse(normalized);
    // If the schema omits a field the normalizer emits, parse() strips it and
    // the key sets diverge — catching the exact class of drift as networkIPs.
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(normalized).sort());
    expect(parsed.networkIPs).toEqual({ bridge: '172.17.0.2' });
  });
});
```

- [ ] **Step 3: Run test to verify it passes** (schema already repaired in Task 1):

Run: `cd packages/core && npx vitest run src/portainer/container-schema-drift.test.ts`
Expected: PASS. (If Task 1 were reverted, `Object.keys` would diverge and this FAILs.)

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/portainer/container-schema-drift.test.ts
git commit -m "test(#1545): drift guard asserting NormalizedContainerSchema covers normalizer output"
```

---

### Task 3: Response schemas on the container routes

Add schemas to `GET /api/containers` (ordered 3-shape union), `/count`, `/favorites`. Leave `/:endpointId/:containerId` (raw inspect JSON) untouched.

**Files:**
- Modify: `packages/foundation/src/routes/containers.ts` (imports + 3 route `schema` blocks + error-path casts)
- Test: `backend/src/routes/containers.test.ts` (add serializer compiler + field-presence assertions)

**Interfaces:**
- Consumes: `NormalizedContainerSchema` from `@dashboard/contracts`.
- Produces: no signature change — wire shapes identical to today.

- [ ] **Step 1: Add serializer compiler + a networkIPs assertion to the route test.** In `backend/src/routes/containers.test.ts`:

Add to the imports (near line 2, alongside the existing `validatorCompiler` import):
```typescript
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
```
In `buildApp()` (after `app.setValidatorCompiler(validatorCompiler);`, line 28):
```typescript
  app.setSerializerCompiler(serializerCompiler);
```
Then extend `fakeContainer` so normalized output carries a network IP, and add a field-presence test. Find the `fakeContainer` factory (around line 44) and ensure its returned object includes:
```typescript
    NetworkSettings: { Networks: { bridge: { IPAddress: '172.17.0.2' } } },
```
Add a new test in the list-route `describe` block:
```typescript
  it('serializes networkIPs through the response schema', async () => {
    // (mirror the existing happy-path setup that stubs endpoints + containers)
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/containers', headers: { authorization: 'Bearer t' } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const list = Array.isArray(body) ? body : body.data;
    expect(list[0].networkIPs).toEqual({ bridge: '172.17.0.2' });
  });
```
> Implementer note: copy the exact Portainer stubbing (endpoints + `getContainers`) from the nearest existing passing list-route test in this file; only the assertion above is new.

- [ ] **Step 2: Run test to verify it fails**

First rebuild dist so the backend test sees current code:
`npm run build -w @dashboard/contracts -w @dashboard/core -w @dashboard/foundation`
Run: `cd backend && npx vitest run src/routes/containers.test.ts -t "serializes networkIPs"`
Expected: FAIL — either the route has no schema yet (networkIPs present but test proves nothing) OR, once Step 3's schema lands without networkIPs, it would be pruned. Running now establishes the baseline; the meaningful failure is proven by Task 1/2. Proceed to Step 3.

- [ ] **Step 3: Add the response schemas to `containers.ts`.**

Add the import at the top (after line 6):
```typescript
import { NormalizedContainerSchema } from '@dashboard/contracts';
```
Define response schemas just below the existing query schemas (after line 23):
```typescript
// Ordered union: [bare array, paginated, partial]. `total` is REQUIRED on the
// paginated member so a paginated-with-partial payload (which also carries
// partial/failedEndpoints) cannot false-match the partial member and lose its
// total/page/pageSize to object-stripping. The partial member requires
// partial+failedEndpoints and has no `total`, so it only matches the
// no-pagination partial-failure shape.
const ContainerListResponseSchema = z.union([
  z.array(NormalizedContainerSchema),
  z.object({
    data: z.array(NormalizedContainerSchema),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
    partial: z.boolean().optional(),
    failedEndpoints: z.array(z.string()).optional(),
  }),
  z.object({
    data: z.array(NormalizedContainerSchema),
    partial: z.boolean(),
    failedEndpoints: z.array(z.string()),
  }),
]);

const ContainerCountResponseSchema = z.object({
  total: z.number(),
  byState: z.record(z.string(), z.number()),
});

const ContainerListItemsSchema = z.array(NormalizedContainerSchema);
```
Wire them into the three `schema` blocks:
- `/api/containers` (line 72-77) — add `response: { 200: ContainerListResponseSchema },`
- `/api/containers/count` (line 142-146) — add `response: { 200: ContainerCountResponseSchema },`
- `/api/containers/favorites` (line 164-169) — add `response: { 200: ContainerListItemsSchema },`

Cast every error path on these three routes (the type-provider narrows `reply` to the 200 shape). Change each `return reply.code(502).send({...})` to `return (reply as any).code(502).send({...})` at lines 87, 99, 158, 227.

- [ ] **Step 4: Rebuild dist and run the container route tests**

Run: `npm run build -w @dashboard/contracts -w @dashboard/core -w @dashboard/foundation && cd backend && npx vitest run src/routes/containers.test.ts`
Expected: PASS — all existing tests plus the new networkIPs assertion. (If a 502-path test now type-errors, confirm the `(reply as any)` casts are applied.)

- [ ] **Step 5: Typecheck foundation**

Run: `npm run typecheck -w @dashboard/foundation`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/foundation/src/routes/containers.ts backend/src/routes/containers.test.ts
git commit -m "feat(#1545): response schemas for GET /api/containers, /count, /favorites"
```

---

### Task 4: Response schemas on the monitoring insights routes

`GET /api/monitoring/insights` returns raw `SELECT *` rows whose types diverge from `InsightSchema` (boolean `is_acknowledged`; present-null `metric_type`/`detection_method`/`dimensions`). Use a `.passthrough()` row schema (anchors universal fields, prunes nothing, 500-safe, and passes the existing minimal test fixtures that assert `dimensions` survives). The container-insights route builds a fixed object → exact strict schema.

**Files:**
- Modify: `packages/ai-intelligence/src/routes/monitoring.ts` (schemas at the top of the file's scope + 2 route `schema` blocks + error casts)
- Test: `packages/ai-intelligence/src/__tests__/monitoring-route.test.ts` (field-presence assertions)

**Interfaces:**
- Produces: no wire change. `InsightRowSchema` (passthrough), `InsightsListResponseSchema`, `ContainerInsightsResponseSchema` (all local to `monitoring.ts`).

- [ ] **Step 1: Add field-presence assertions to the existing tests.** `monitoring-route.test.ts` already sets `serializerCompiler`. In the `'returns hasMore and nextCursor'` test (after line 80), assert the envelope survives:
```typescript
    expect(body.visibleTotal).toBe(2);
    expect(body.sensitivity).toBe('default');
    expect(typeof body.hasMore).toBe('boolean');
```
In the container-insights `'returns anomaly explanations for a container'` test, the existing assertions (id/description/aiExplanation/suggestedAction/timestamp) already cover field presence — no change needed.

- [ ] **Step 2: Run tests to confirm current green baseline**

Run: `cd packages/ai-intelligence && npx vitest run src/__tests__/monitoring-route.test.ts`
Expected: PASS (assertions added reference fields the route already returns).

- [ ] **Step 3: Add the schemas to `monitoring.ts`.** After the existing local schemas (after line 47, near `AnomalyFeedbackRatesQuerySchema`), add:
```typescript
// Raw `SELECT * FROM insights` rows: is_acknowledged is BOOLEAN, and
// metric_type/detection_method/dimensions come back present-as-null, so
// InsightSchema (a produced-shape contract) would 500 the serializer.
// Passthrough keeps every column byte-identical and 500-safe; the anchor
// fields below are the ones present on every row (and the test fixtures).
const InsightRowSchema = z.object({
  id: z.string(),
  severity: z.string(),
  created_at: z.string(),
}).passthrough();

const InsightsListResponseSchema = z.object({
  insights: z.array(InsightRowSchema),
  total: z.number(),
  visibleTotal: z.number(),
  sensitivity: z.string(),
  limit: z.number(),
  offset: z.number(),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

const ContainerInsightsResponseSchema = z.object({
  explanations: z.array(z.object({
    id: z.string(),
    severity: z.string(),
    category: z.string(),
    title: z.string(),
    description: z.string(),
    aiExplanation: z.string().nullable(),
    suggestedAction: z.string().nullable(),
    timestamp: z.string(),
  })),
  sensitivity: z.string(),
});
```
Wire them in:
- `/api/monitoring/insights` (schema block line 76-82) — add `response: { 200: InsightsListResponseSchema },`
- `/api/monitoring/insights/container/:containerId` (schema block line 195-199) — add `response: { 200: ContainerInsightsResponseSchema },`

Cast the error paths (lines 191, 284): `return (reply as any).code(500).send({ error: '...', details: errorDetails(err) });`

- [ ] **Step 4: Run the monitoring route tests**

Run: `cd packages/ai-intelligence && npx vitest run src/__tests__/monitoring-route.test.ts`
Expected: PASS — including `'counts a correlated multi-dimension record as ONE insight'` (asserts `insights[0].dimensions` has length 2, which passthrough preserves) and the two 500-path tests.

- [ ] **Step 5: Typecheck ai-intelligence**

Run: `npm run typecheck -w @dashboard/ai`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/ai-intelligence/src/routes/monitoring.ts packages/ai-intelligence/src/__tests__/monitoring-route.test.ts
git commit -m "feat(#1545): response schemas for GET /api/monitoring/insights (+ container)"
```

---

### Task 5: Docs, follow-up issue, full verification

**Files:**
- Modify: `docs/architecture.md` (schema-coverage note, if it enumerates coverage)

- [ ] **Step 1: Update `docs/architecture.md`.** Grep for where response-schema coverage is described (`grep -n "response schema\|serializerCompiler\|response:" docs/architecture.md`). Add a line noting the containers (list/count/favorites) and monitoring-insights routes now declare response schemas, and that `GET /api/containers/:endpointId/:containerId` is intentionally excluded (raw Portainer inspect JSON). If no such section exists, add a short "Response schema coverage (#1545)" note near the API/routes section. No `docker/.env.example` change (no new env); no CLAUDE/AGENTS/GEMINI change (no rule change).

- [ ] **Step 2: File the container-detail follow-up issue** (the deliberate exclusion). Use the project issue template style:

```bash
gh issue create --title "GET /api/containers/:endpointId/:containerId returns raw Docker inspect JSON (no schema; leaks filesystem paths)" \
  --body $'## Problem\nThe container-detail route (`packages/foundation/src/routes/containers.ts:232`) returns the raw Portainer/Docker inspect object verbatim. It carries no Fastify response schema and exposes host filesystem paths (Mounts[].Source, LogPath, HostConfig.Binds), which the "strip sensitive metadata before sending to frontend" rule (CLAUDE.md Security §5) wants normalized away.\n\nDeferred from #1545 (response-schema batch) because a fix is a **behavior change** (normalize + strip), out of that batch\'s non-breaking scope.\n\n## Proposed Solution\nAdd a normalized detail projection (strip filesystem paths, keep fields the detail UI reads) and attach a response schema. Audit the frontend container-detail consumers first.\n\n## Acceptance Criteria\n- [ ] Detail route returns a normalized, path-stripped shape with a Zod response schema\n- [ ] Frontend container-detail view verified against the new shape\n- [ ] Security regression test for path stripping\n\n_Follow-up from #1545._'
```
Record the new issue number in the PR comment (Step 5).

- [ ] **Step 3: Full build + suite (backend/server see dist).**

Run:
```bash
npm run build -w @dashboard/contracts -w @dashboard/core -w @dashboard/foundation -w @dashboard/ai
npm run typecheck
npm run lint
npm test
```
Expected: all green. If DB-backed tests need the real password / run outside the sandbox, run them per the project's test-infra notes.

- [ ] **Step 4: Commit docs.**

```bash
git add docs/architecture.md
git commit -m "docs(#1545): note containers/insights response-schema coverage"
```

- [ ] **Step 5: Stop and hand back to the user.** Do **not** push or open a PR unless asked. Summarize: routes covered, the drift fix, the filed follow-up issue number, and suggested PR text:
  - Title: `feat(#1545): response schemas for containers + insights routes`
  - Body: link `#1545` (progress, not `Closes` — bulk of routes remain), list covered routes, note the `networkIPs` drift fix + drift guard, and reference the container-detail follow-up issue.

---

## Self-Review

**Spec coverage:**
- Prereq `networkIPs` fix → Task 1; drift guard → Task 2. ✓
- Routes 1–3 (containers list/count/favorites) → Task 3. ✓
- Routes 4–5 (insights list/container) → Task 4. ✓
- Container-detail exclusion + follow-up → Task 5 Step 2. ✓
- `setSerializerCompiler` in bare-Fastify tests → Task 3 Step 1 (`containers.test.ts`; `monitoring-route.test.ts` and `security-regression-auth.test.ts` already have it; those are the only other registrants). ✓
- Field-presence tests → Task 3 Step 1, Task 4 Step 1. ✓
- dist rebuild before backend tests → Tasks 2/3/5. ✓
- Docs → Task 5. ✓

**Placeholder scan:** No TBD/TODO. The one "copy the exact stubbing from the nearest passing test" note points to concrete existing tests in the same file rather than inventing Portainer mock internals the implementer must not guess — acceptable and explicit.

**Type consistency:** `NormalizedContainerSchema` (required `networkIPs`) used consistently in Tasks 1–3. Union member field names (`data`/`total`/`page`/`pageSize`/`partial`/`failedEndpoints`) match `containers.ts` handler returns (lines 119, 131-137). `InsightsListResponseSchema` fields match the handler's returned object (`monitoring.ts:165-188`). `ContainerInsightsResponseSchema` fields match the mapped object (`monitoring.ts:270-279`).
