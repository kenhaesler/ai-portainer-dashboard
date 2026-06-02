# System Information: show key component versions

**Date:** 2026-06-02
**Status:** Approved (design)

## Problem

The General settings tab has a **System Information** section, but its values
are hardcoded and stale (`tab-general.tsx`):

- `Application: Docker Insight`
- `Version: 1.0.0` (the real version is `2.0.0`)
- `Mode: Observer Only`
- plus a live `Theme` and `Redis Cache` card.

There is no backend system-info endpoint, and nothing reads `process.version`.
Operators can't see which runtime/framework versions the dashboard is running.

## Goal

Show key component versions in the System Information panel: **Node.js**, the
**app version**, **Fastify**, and **React**. Scope is runtime + app + framework
only — no live PostgreSQL/TimescaleDB/Redis/Docker queries, no OS/uptime.

## Design

### Authoritative sources

Each version comes from where it is actually known:

| Field | Source | Notes |
|-------|--------|-------|
| `node` | `process.versions.node` (backend) | exact running version |
| `fastify` | the Fastify instance's `.version` (backend) | exact |
| `app` | composition-root `package.json` `version` (backend) | single source of truth (`2.0.0`); fixes the stale `1.0.0` |
| React | `React.version` (frontend, client-side) | exact running version; no backend round-trip |

### Backend — `GET /api/admin/system-info`

New route file `packages/foundation/src/routes/system-info.ts`.

- **Admin-gated:** `preHandler: [fastify.authenticate, fastify.requireRole('admin')]`,
  consistent with `/api/admin/cache/stats` (which the same tab already calls).
  Version strings are mild infrastructure disclosure, so admin-only per the
  security checklist.
- Plugin signature `systemInfoRoutes(fastify, opts: { appVersion: string })`,
  matching the existing options-object pattern (`monitoringRoutes`,
  `correlationRoutes`). The composition root reads its own `package.json`
  version once at startup and passes it in (Approach A — no new env var).
- Returns a Zod-validated body:
  ```ts
  SystemInfoResponseSchema = z.object({
    app: z.string(),
    node: z.string(),
    fastify: z.string(),
  })
  ```
  Values: `{ app: opts.appVersion, node: process.versions.node, fastify: fastify.version }`.

### Frontend — `useSystemInfo()` hook

`frontend/src/features/core/hooks/use-system-info.ts` — React Query against
`/api/admin/system-info`, long `staleTime` (versions don't change mid-session).
Graceful: `—` while loading, `unknown` on error.

### Frontend — `GeneralTab` System Information cards

- Replace hardcoded `Version 1.0.0` → `app` from the hook.
- Add cards: **Node.js**, **Fastify**, **React** (`React.version`, client-side).
- Keep Application / Mode / Theme / Redis Cache.

## Testing

- `packages/foundation/src/__tests__/system-info-route.test.ts`: returns
  `app`/`node`/`fastify`; `app` echoes the injected `appVersion`; `node`/`fastify`
  are non-empty. The existing auth-enforcement sweep already asserts the route
  rejects unauthenticated requests; admin-gating verified there.
- Frontend: `use-system-info` hook test (fetch shape) + `tab-general` renders
  the Node.js / Fastify / React / app-version cards.

## Docs

- `docs/api-reference.md` — add the `/api/admin/system-info` row.
- No `.env.example` change (Approach A reads package.json; no new env var).

## Non-goals

- Live PostgreSQL / TimescaleDB / Redis / Docker / Portainer version queries.
- OS / platform / arch / uptime.
- Per-dependency version inventory beyond the four named components.
