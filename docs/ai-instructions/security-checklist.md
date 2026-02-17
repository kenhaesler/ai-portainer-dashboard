# Security Checklist

Project-specific security requirements for the AI Portainer Dashboard. Referenced from CLAUDE.md.

## Authentication & Authorization

- JWT via `jose` with 32+ character secrets in production
- Session store in PostgreSQL — tokens validated server-side on every request
- OIDC/SSO via `openid-client` v6 — PKCE required for all authorization code flows
- Rate limiting on login endpoints (configurable via `LOGIN_RATE_LIMIT`)
- Auth decorator: `fastify.authenticate` — all protected `/api/*` routes must use it

## Input Validation

- All API inputs validated with Zod schemas at route level
- Parameterized SQL queries only — never concatenate user input
- Sanitize user content rendered in frontend (no raw `dangerouslySetInnerHTML`)
- CSP headers set in `frontend/nginx.conf` (single source of truth — backend does not set CSP)
  - `script-src 'self'` — no `unsafe-inline` (React app is fully bundled)
  - `style-src 'self' 'unsafe-inline'` — required by Tailwind CSS / Framer Motion runtime styles
  - `connect-src 'self' ws: wss:` — allows both unencrypted and encrypted WebSockets; for TLS-only deployments remove `ws:` and keep `wss:` only

## LLM Prompt Injection Guard

File: `services/prompt-guard.ts`

3-layer defense:
1. **Regex patterns** (25+): system prompt extraction, ignore-instructions, role-play attempts
2. **Heuristic scoring**: role-play detection, base64 encoding, multilingual injection
3. **Output sanitization**: system prompt leaks, sentinel phrases, tool definition exposure

Applied to: REST `/api/llm/query` and WebSocket `chat:message`.
Configurable: `LLM_PROMPT_GUARD_STRICT` env var.

## Secrets & Credentials

- Never commit `.env`, credentials, API keys, or passwords
- Never log secrets, tokens, or passwords — even at debug level
- All sensitive config from environment variables
- Frontend must never contain or expose backend secrets

## Network Security

- External API calls respect `PORTAINER_VERIFY_SSL` setting
- WebSocket connections authenticated via same JWT mechanism as REST
- CORS via `@fastify/cors` — no wildcard origins in production
- **Security header ownership**: nginx is the single source of truth for browser-facing headers (`CSP`, `X-Frame-Options`, `X-XSS-Protection`). The backend sets API-level headers only (`X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security`)
- **WebSocket protocol**: CSP currently allows both `ws:` and `wss:` to support deployments without TLS. For production with TLS, edit `frontend/nginx.conf` and remove `ws:` from `connect-src`

## Security Regression Tests

File: `backend/src/routes/security-regression.test.ts` (36 tests)

- **Auth sweep**: Dynamically discovers all routes, verifies no `/api/*` returns 2xx without auth
- **Prompt injection**: 22 vectors (system prompt extraction, ignore-instructions, case variations)
- **False positives**: 8 tests ensuring benign queries aren't blocked
- **Rate limiting**: Verifies `LOGIN_RATE_LIMIT` enforcement and `retry-after` header
