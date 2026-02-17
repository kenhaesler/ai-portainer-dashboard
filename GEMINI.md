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
