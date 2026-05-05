# Security Checklist

Project-specific security requirements for the AI Portainer Dashboard. Referenced from CLAUDE.md.

## Authentication & Authorization

- JWT via `jose` with 32+ character secrets in production
- Session store in PostgreSQL — tokens validated server-side on every request
- OIDC/SSO via `openid-client` v6 — PKCE required for all authorization code flows
- Rate limiting on login endpoints (configurable via `LOGIN_RATE_LIMIT`)
- Auth decorator: `fastify.authenticate` — all protected `/api/*` routes must use it
- Token & session lifetime configurable via `JWT_TOKEN_EXPIRY_MINUTES` (default 60, bounds 5–1440). The same value drives both the JWT `exp` claim and the PostgreSQL session row's `expires_at` — single source of truth (#1106). Frontend re-arms its refresh timer from the JWT `exp` claim, so changing the env var requires no client code changes.

## Input Validation

- All API inputs validated with Zod schemas at route level
- Parameterized SQL queries only — never concatenate user input
- Sanitize user content rendered in frontend (no raw `dangerouslySetInnerHTML`)
- CSP headers set in `frontend/nginx.conf` (single source of truth — backend does not set CSP)
  - `script-src 'self'` — no `unsafe-inline` (React app is fully bundled)
  - `style-src 'self' 'unsafe-inline'` — required by Tailwind CSS / Framer Motion runtime styles
  - `connect-src 'self' ws: wss:` — allows both unencrypted and encrypted WebSockets; for TLS-only deployments remove `ws:` and keep `wss:` only

## LLM Prompt Injection Guard

File: `packages/ai-intelligence/src/services/prompt-guard.ts`

3-layer defense:
1. **Regex patterns** (25+): system prompt extraction, ignore-instructions, role-play attempts
2. **Heuristic scoring**: role-play detection, base64 encoding, multilingual injection
3. **Output sanitization**: system prompt leaks, sentinel phrases, tool definition exposure

Applied to: REST `/api/llm/query` and WebSocket `chat:message`.
Configurable: `LLM_PROMPT_GUARD_STRICT` env var.

## Secrets & Credentials

- Never commit `.env`, credentials, API keys, or passwords
- Never log secrets, tokens, or passwords — even at debug level
- Frontend must never contain or expose backend secrets

### Secrets management — Docker Secrets vs. environment variables (#1121)

The four sensitive values — `JWT_SECRET`, `POSTGRES_APP_PASSWORD`,
`TIMESCALE_PASSWORD`, `REDIS_PASSWORD` — are sourced from Docker Secrets
(file-backed) in production and fall back to environment variables for local
dev. Docker Secrets are preferred because env vars are visible via
`docker inspect <container>` and `/proc/<pid>/environ`; secret files are
mounted at `/run/secrets/<name>` with mode 0400 and are accessible only to
the container process.

**Resolution order** (implemented in `packages/core/src/config/secrets.ts`):
1. `/run/secrets/<name>` — read and trimmed if the file exists
2. `process.env[<NAME>]` — fallback when no secret file is present

**Operator setup** (one-time):

```sh
mkdir -p docker/secrets && chmod 700 docker/secrets
cd docker
for s in jwt_secret postgres_app_password timescale_password redis_password; do
  openssl rand -hex 32 > secrets/$s.txt
done
chmod 600 secrets/*.txt
```

**Per-service notes**:
- **postgres-app / timescaledb**: the official `postgres` image natively
  honours `POSTGRES_PASSWORD_FILE`. Compose sets it to
  `/run/secrets/postgres_app_password` (or `timescale_password`).
- **redis**: the official Redis image does NOT honour `REDIS_PASSWORD_FILE`.
  Compose uses a shell wrapper (`sh -c "REDIS_PASS=$(cat /run/secrets/redis_password); exec redis-server --requirepass \"$REDIS_PASS\""`) so the password never appears in argv-visible form.
- **backend (Fastify)**: `readSecret()` is called inside the env-schema
  preprocessor for `JWT_SECRET` and `REDIS_PASSWORD` before Zod validation.
  The min-length / weak-default guards still fire on the resolved value.

**Validation invariants**:
- `JWT_SECRET` must be ≥ 32 characters after resolution. Production
  (`NODE_ENV=production`) additionally rejects known weak values (`changeme`,
  `dev-secret-…`, etc.).
- The `secrets/` directory MUST be in `.gitignore`. The compose file is the
  only artifact that references the secrets paths.

See `packages/core/src/config/secrets.ts`, `packages/core/src/config/secrets.test.ts`,
and `docker/.env.example` for the full operator guide.

## Network Security

- External API calls respect `PORTAINER_VERIFY_SSL` setting
- WebSocket connections authenticated via same JWT mechanism as REST
- CORS via `@fastify/cors` — no wildcard origins in production
- **Security header ownership**: nginx is the single source of truth for browser-facing headers (`CSP`, `X-Frame-Options`, `X-XSS-Protection: 0` per OWASP, `Referrer-Policy`). The backend sets API-level headers only (`X-Content-Type-Options`, `Permissions-Policy`, `Strict-Transport-Security`). Issue #1101 removed the duplicate `Referrer-Policy` from the backend; issue #1105 changed `X-XSS-Protection` from the deprecated `1; mode=block` to `0`.
- **WebSocket protocol**: CSP currently allows both `ws:` and `wss:` to support deployments without TLS. For production with TLS, edit `frontend/nginx.conf` and remove `ws:` from `connect-src`

## Security Regression Tests

File: `backend/src/routes/security-regression.test.ts` (68 tests)

- **Auth sweep**: Dynamically discovers all routes, verifies no `/api/*` returns 2xx without auth
- **Prompt injection**: 22 vectors (system prompt extraction, ignore-instructions, case variations)
- **False positives**: 8 tests ensuring benign queries aren't blocked
- **Rate limiting**: Verifies `LOGIN_RATE_LIMIT` enforcement and `retry-after` header
