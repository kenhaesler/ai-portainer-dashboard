# Issue #1545 — Fastify response-schema adoption: one focused batch

- **Issue:** #1545 (enhancement, refactoring, technical-debt, frontend, priority/low)
- **Branch:** `feature/1545-response-schemas-batch` (off `dev`)
- **Date:** 2026-07-13

## Problem

The app wires `fastify-type-provider-zod`'s `serializerCompiler` globally (`packages/core/src/plugins/swagger.ts:12-14`), so any route that declares a `response:` schema gets fast-json-stringify serialization, unknown-field pruning (defense against accidental sensitive-field leaks), and accurate OpenAPI output. But only ~20 of ~197 route registrations across `packages/*/src/routes` declare one (≈14 route files). The three original frontend/backend envelope mismatches were already fixed (#1553), and several route families gained schemas (#1557, #1559). What remains is the bulk of the schema-less routes, which the maintainers are adopting **incrementally** — because a `200`-only response schema **silently strips any field not enumerated**, so each batch must be verified against its frontend consumers and covered by a field-presence test.

This spec is **one focused, low-risk batch**, not the whole sweep.

## Scope: the batch

Five hot/large GET routes, each backed by an existing exact-match Zod model or a trivially-mirrored one, each with a clearly identifiable frontend consumer:

| # | Route | Handler | Schema source | Frontend consumer | Risk |
|---|-------|---------|---------------|-------------------|------|
| 1 | GET `/api/settings` | `packages/foundation/src/routes/settings.ts:141` | existing `SettingSchema` (`packages/core/src/models/settings.ts:3`) — exact 4-column DB match | `frontend/src/features/core/hooks/use-settings.ts:47` (reads key/value/category) | low |
| 2 | GET `/api/harbor/vulnerabilities` | `packages/security/src/routes/harbor-vulnerabilities.ts:97` | new schema (1:1 mirror of frontend `VulnerabilityListResponse`) | `frontend/src/features/security/hooks/use-harbor-vulnerabilities.ts:40-49,105-131` | low |
| 3 | GET `/api/harbor/vulnerabilities/summary` | `harbor-vulnerabilities.ts:135` | reuse the summary sub-schema from #2 | `use-harbor-vulnerabilities.ts:133-139` | low |
| 4 | GET `/api/investigations` | `packages/ai-intelligence/src/routes/investigations.ts:14` | existing `InvestigationSchema` (`packages/contracts/src/schemas/investigation.ts`), wrapped `{ investigations: z.array(...) }` | `frontend/src/features/.../use-investigations.ts:29` | low |
| 5 | GET `/api/incidents` | `packages/ai-intelligence/src/routes/incidents.ts:23` | existing `IncidentSchema` (`packages/contracts/src/schemas/incident.ts`) | `use-incidents.ts:31`, `incident-groups-view.tsx:140` | low-med |

### Established pattern to copy
- Response schema block: `packages/ai-intelligence/src/routes/monitoring.ts:288-311` (`response: { 200: SuccessResponseSchema }`).
- Error-path cast: `return (reply as any).code(5xx).send({ error, details: errorDetails(err) })` (`monitoring.ts:308`, `settings.ts:320`). Required because the Zod type-provider narrows `reply` to the 200 shape. The alternative — declaring the error status in the response map like `dashboard.ts:223` (`response: { 200: ..., 502: ErrorWithDetailsSchema }`) — is acceptable where an error status is already returned.
- New shared schemas go in `packages/core/src/models/api-schemas.ts` (or a dedicated `harbor` schema module) to match the import convention.

## Non-negotiable verification per route

For each route, before finalizing its schema:
1. Read the exact object the handler returns (all top-level fields; for arrays, every field of the element).
2. Read the frontend consumer's declared type and, critically, **which fields it actually reads** in the component tree.
3. Confirm the Zod schema enumerates **every field the frontend reads** (superset-on-the-client fields that are already `undefined` today are fine to omit — they aren't sent).
4. Add a field-presence test asserting the served payload still contains those fields after the schema prunes.

Route-specific notes:
- **#1 settings** — `SELECT *` over a 4-column table (`key,value,category,updated_at`); `SettingSchema` matches exactly. The frontend `Setting` type is a superset (`label/description/type/updatedBy/updatedAt`) but those are not sent today, so no regression.
- **#4 investigations** — confirm the handler returns `{ investigations: [...] }` (not a bare array) and that `InvestigationSchema` covers all served fields; adjust the wrapper to match reality.
- **#5 incidents** — confirm the list wrapper shape (bare `Incident[]` vs `{ incidents: [...] }`) against `incidents.ts:23` and the consumer before choosing `z.array(IncidentSchema)` vs a wrapper. This is the one route flagged low-med; if the served shape diverges from `IncidentSchema`, either extend the schema or defer this route from the batch rather than strip a field.

## Explicitly excluded (need column-level audits first)

- **GET `/api/containers`** (`packages/foundation/src/routes/containers.ts:71`) — a 3-way polymorphic union, and the only ready-made `NormalizedContainerSchema` is stale (omits `networkIPs`, which the frontend reads). High risk. Maintainers intend to leave the polymorphic shape unchanged.
- **GET `/api/monitoring/insights`** (`monitoring.ts:76`) — returns raw `SELECT *` insight rows (superset of `InsightSchema`); a strict schema would strip extra DB columns. Needs a column audit first.

## Tests

- Backend: one field-presence test per route (in the route's existing test file, or a new `*.test.ts` alongside it), asserting the served 200 payload retains each field the frontend consumer reads. Follow the project pattern: real PostgreSQL via `test-db-helper.ts` where the route hits the DB, mock only external boundaries.
- Keep existing route tests green (schema pruning must not break them).

## Docs

- `docs/architecture.md` — note the newly schema-covered routes if the doc enumerates coverage.
- No `docker/.env.example` change (no new env).
- CLAUDE/AGENTS/GEMINI trio — only if a rule/pattern changes (not expected for a pure additive batch).
- PR comment on #1545 listing which routes this batch covered and what remains (mirroring the existing progress comments).

## Acceptance criteria

- [ ] Response schemas added to the 5 routes (or 4, if incidents is deferred after verification).
- [ ] Each route's served payload verified field-by-field against its frontend consumer.
- [ ] A field-presence test added/updated per route; full suite green.
- [ ] Docs updated where relevant; PR links the issue and leaves the progress comment. Issue stays open (bulk remains).

## Out of scope

- The remaining ~150 schema-less routes (future batches).
- Retiring the polymorphic `GET /api/containers` shape.
