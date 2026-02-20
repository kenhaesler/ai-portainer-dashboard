# GEMINI.md

This file provides guidance to Google Gemini and Gemini-based coding tools working with this repository.

**All project rules, architecture, and conventions are defined in `CLAUDE.md`.** This file exists as a pointer — the rules are identical across all AI tools. Read and follow `CLAUDE.md` completely.

## Security First (Mandatory)

1. **RBAC by Default** — All mutating endpoints (POST/PUT/DELETE) and sensitive read endpoints (Backups, Settings, Cache, User Management) MUST require `fastify.requireRole('admin')`. Never assume `fastify.authenticate` is sufficient for administrative actions.
2. **Zero Default Secrets** — Production deployments (`NODE_ENV=production`) MUST fail to start if `JWT_SECRET` is the default value or less than 32 characters. Never hardcode credentials.
3. **LLM Safety** — All LLM interactions must pass through the Prompt Injection Guard. Output must be sanitized to prevent system prompt leakage or infrastructure detail exposure to unauthorized users.
4. **Infrastructure Isolation** — Internal services (Prometheus, Ollama, Redis) must not be exposed on `0.0.0.0`. Use internal Docker networks. Authenticate all cross-service communication.
5. **Input & Data Safety** — Use Zod for all API boundaries. Use parameterized SQL only (no concatenation). Strip sensitive metadata (like filesystem paths in container labels) before sending to frontend.
6. **Regression Testing** — Every security fix must include a corresponding test in `backend/src/routes/security-regression.test.ts`.
7. **Observer-First Integrity** — Mutating actions (restart/stop containers) are strictly opt-in and must be gated by both an 'Admin' role and a 'Remediation Approval' workflow.

## Testing & Mocks

**Mocks are for CI only.** External services (Portainer API, Ollama, Redis) are unavailable in CI, so tests must mock those calls. But mocks should be minimal — only mock what CI cannot reach. Prefer real integrations wherever possible:

- **Backend DB tests**: Use real PostgreSQL via `test-db-helper.ts` (port 5433). Never mock the database.
- **Backend route tests**: Mock only external API calls (Portainer, Ollama) and auth (`app.decorate('authenticate', ...)`). Use `vi.spyOn()` with passthrough mocks (`vi.mock('module', async (importOriginal) => await importOriginal())`) so real logic runs but individual functions can be stubbed.
- **Frontend tests**: Mock API responses (`vi.spyOn(globalThis, 'fetch')` or MSW), not internal components.
- **Never mock pure utility functions** — test them directly with real inputs.
- **Keep mocks close to the boundary** — mock the HTTP call, not the service function that wraps it.
