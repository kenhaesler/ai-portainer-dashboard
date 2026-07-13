# Issue #1545 — Response schemas: containers + insights batch

- **Issue:** #1545 (enhancement, refactoring, technical-debt, frontend, priority/low)
- **Branch:** `feature/1545-schemas-containers-insights` (off `dev`)
- **Date:** 2026-07-13
- **Predecessor:** `2026-07-13-issue-1545-response-schemas-batch-design.md` (the "5 hot routes" batch, merged via #1562). This batch tackles exactly the two routes that one **explicitly excluded** pending column-level audits.

## Problem

`fastify-type-provider-zod`'s `serializerCompiler` is wired globally (`packages/core/src/plugins/swagger.ts:12-14`), so any route declaring a `response:` schema gets validated serialization, unknown-field pruning, and accurate OpenAPI output. Prior batches covered ~15 route files and fixed all three original frontend/backend envelope mismatches. Two hot/large routes were deferred because **their ready-made contract schemas do not match the runtime shape** — attaching them naively makes the zod serializer's `.parse()` either throw a 500 or silently strip fields the frontend reads:

- **`GET /api/containers`** — the only ready-made `NormalizedContainerSchema` is stale (omits `networkIPs`, which the frontend reads in 3 components), and the route is a 3-way polymorphic union.
- **`GET /api/monitoring/insights`** — returns raw `SELECT * FROM insights` rows whose real column types diverge from `InsightSchema` (see audit below).

This batch does those audits and lands **non-breaking, permissive** schemas — locking each envelope and speeding serialization **without changing any wire value**. (Scope decision confirmed with the maintainer: permissive unions, keep the frontend shape-sniffer, do not retire the polymorphic form.)

## Audit findings (the reason these were deferred)

### `NormalizedContainer` schema drift
The live interface (`packages/core/src/portainer/portainer-normalizers.ts:45`) has `networkIPs: Record<string,string>`; the contract `NormalizedContainerSchema` (`packages/contracts/src/schemas/container.ts:9`) **omits it**. The frontend reads `networkIPs` at:
- `frontend/src/features/containers/pages/network-topology.tsx:300`
- `frontend/src/features/containers/components/container/container-overview.tsx:188`
- `frontend/src/features/containers/components/container-comparison-view.tsx:256`

`normalizeContainer` (`portainer-normalizers.ts:254-279`) returns **exactly** the interface fields, so a schema matching the interface prunes nothing. **Fix the contract schema first**, else the serializer drops `networkIPs`.

### `insights` raw-row vs `InsightSchema` mismatch
`insights` table columns (migrations `003`, `030`, `035`, `038`): `id, endpoint_id, endpoint_name, container_id, container_name, severity, category, title, description, suggested_action, is_acknowledged BOOLEAN, created_at, metric_type TEXT, detection_method TEXT, dimensions JSONB, z_score NUMERIC`.

`InsightSchema` (`packages/contracts/src/schemas/insight.ts`) would **500 the serializer** on real rows because:
- `is_acknowledged` is `BOOLEAN` in DB (pg → JS `boolean`), but the schema declares `z.number()`.
- `metric_type` / `detection_method` / `dimensions` come back **present-as-`null`** from `SELECT *`, but the schema marks them `.optional()` (accepts `undefined`, **rejects `null`**); they are also unconstrained `TEXT`/`JSONB` vs the schema's enums.

`InsightSchema` is a *produced-shape contract*, not the raw-row shape. The list route therefore needs a **dedicated passthrough row schema** matching the real row (see below).

## Scope

| # | Route | Handler | Schema approach | Wire change |
|---|-------|---------|-----------------|-------------|
| 0 | — (prereq) | `packages/contracts/src/schemas/container.ts` | Add `networkIPs: z.record(z.string(), z.string())` to `NormalizedContainerSchema` (the only field the live interface has that the schema lacks). `ContainerPortSchema` stays as-is — its all-optional fields already validate the always-present real values without pruning. | none |
| 1 | GET `/api/containers` | `packages/foundation/src/routes/containers.ts:71` | `z.union([ z.array(NormalizedContainerSchema), {data,partial,failedEndpoints}, {data,total,page,pageSize,partial?,failedEndpoints?} ])` | none |
| 2 | GET `/api/containers/count` | `containers.ts:141` | `z.object({ total: z.number(), byState: z.record(z.string(), z.number()) })` | none |
| 3 | GET `/api/containers/favorites` | `containers.ts:163` | `z.array(NormalizedContainerSchema)` | none |
| 4 | GET `/api/monitoring/insights` | `packages/ai-intelligence/src/routes/monitoring.ts:76` | Envelope `{ insights: z.array(InsightRowSchema), total, visibleTotal, sensitivity, limit, offset, nextCursor: z.string().nullable(), hasMore }`, where `InsightRowSchema` is a **`.loose()`** object matching the raw row (`is_acknowledged: z.boolean()`, `metric_type`/`detection_method`: `z.string().nullable()`, `dimensions: z.unknown().nullable()`, `z_score: z.union([z.number(), z.string()]).nullable()`, `endpoint_id: z.number().nullable()`, etc.) | none |
| 5 | GET `/api/monitoring/insights/container/:containerId` | `monitoring.ts:195` | Exact strict `z.object({ explanations: z.array(z.object({ id, severity, category, title, description, aiExplanation: z.string().nullable(), suggestedAction: z.string().nullable(), timestamp })), sensitivity })` — handler builds a fixed object, no drift risk | none |

### Deliberately excluded: `GET /api/containers/:endpointId/:containerId` (detail)
Returns **raw Portainer/Docker inspect JSON** (`containers.ts:251`). A strict schema is infeasible and would 500; a passthrough `z.unknown()` prunes nothing and contracts nothing (pure noise). It also has a **pre-existing** concern — raw inspect leaks filesystem paths (`Mounts[].Source`, `LogPath`, `HostConfig.Binds`), which the "strip sensitive metadata" rule wants normalized away — but that is a **behavior change**, out of this non-breaking scope. **File a separate follow-up issue** for a normalize+strip pass; do not bolt a no-op schema on here.

### Why passthrough for insights rows (not a strict per-field schema)
The issue's primary value is "lock the envelope + speed serialization." Insights rows are our own internal data (no filesystem-path leak risk that per-field pruning defends against). A `.loose()` row schema validates the stable anchor fields, **keeps every field byte-identical on the wire**, and is 500-safe against the `is_acknowledged`/present-null divergences above and any future column. Containers use exact (non-loose) schemas because `normalizeContainer` output is fully controlled by us.

## Established pattern to copy
- Response block + error cast: `monitoring.ts:288-311` and `settings.ts` — `return (reply as any).code(5xx).send({ error, details: errorDetails(err) })` (the zod type-provider narrows `reply` to the 200 shape). Where an error status is already declared in the response map (e.g. `dashboard.ts:223`), prefer that.
- New container response schemas live next to their consumers: extend `packages/contracts/src/schemas/container.ts` (the `networkIPs` fix) and define the union/count/favorites response schemas in `containers.ts` (or `api-schemas.ts` if shared). Insights row + envelope schemas are local to `monitoring.ts`.

## Tests (gotchas from prior batches)
1. **`setSerializerCompiler` in isolated route tests.** `backend/src/routes/containers.test.ts:27` builds a bare `Fastify()` and sets only the *validator* compiler — add `app.setSerializerCompiler(serializerCompiler)` or the routes fail to boot. Grep **every** registrant of `containersRoutes` (incl. `security-regression-*.test.ts`, `container-logs.test.ts`, `packages/server`) and add it where missing. `packages/ai-intelligence/src/__tests__/monitoring-route.test.ts:40,208` already sets it.
2. **Realistic fixtures.** The serializer `.parse()`es the payload; DB-backed tests use real PostgreSQL (`test-db-helper.ts`), so `SELECT *` rows are genuine — the passthrough insights schema handles them. Container tests mock the Portainer boundary only; container fixtures must include `networkIPs`.
3. **Field-presence assertions.** Per route, assert the served 200 payload retains the fields the frontend reads (containers incl. `networkIPs`; insights envelope incl. `visibleTotal`, `nextCursor`, `hasMore`).
4. **Drift guard.** Add a contracts test asserting `NormalizedContainerSchema` keys ⊇ the live `NormalizedContainer` interface field set, so this drift cannot recur.
5. **Rebuild dist before backend/server tests** (gotcha #5): `npm run build -w @dashboard/contracts && -w @dashboard/core && -w @dashboard/foundation && -w @dashboard/ai`. In-package `__tests__` run against `src`.

## Docs
- `docs/architecture.md` — extend the schema-coverage note with these routes.
- No `docker/.env.example` change (no new env).
- CLAUDE/AGENTS/GEMINI trio — no rule change (pure additive), so no edit expected.
- PR comment on #1545 listing routes covered + what remains; issue stays open (bulk of ~150 routes remain).

## Acceptance criteria
- [ ] `NormalizedContainerSchema` gains `networkIPs`; drift guard test added.
- [ ] Response schemas on routes 1–5; container-detail excluded with a filed follow-up issue.
- [ ] Every served payload verified field-by-field vs its frontend consumer; no wire value changes.
- [ ] `setSerializerCompiler` added to all bare-Fastify tests registering `containersRoutes`; full suite green.
- [ ] Docs updated; PR links `#1545` and leaves a progress comment.

## Out of scope
- Retiring the polymorphic `GET /api/containers` shape (maintainer chose to keep it).
- The raw container-detail route (separate normalize+strip follow-up).
- The remaining schema-less routes (future batches).
