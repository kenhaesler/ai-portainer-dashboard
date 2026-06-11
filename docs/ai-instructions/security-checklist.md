# Security Checklist

Project-specific security requirements for the AI Portainer Dashboard. Referenced from CLAUDE.md.

## Authentication & Authorization

- JWT via `jose` with 32+ character secrets in production
- Session store in PostgreSQL — tokens validated server-side on every request
- OIDC/SSO via `openid-client` v6 — PKCE required for all authorization code flows
- Rate limiting on login endpoints (configurable via `LOGIN_RATE_LIMIT`)
- Auth decorator: `fastify.authenticate` — all protected `/api/*` routes must use it
- Token & session lifetime configurable via `JWT_TOKEN_EXPIRY_MINUTES` (default 60, bounds 5–1440). The same value drives both the JWT `exp` claim and the PostgreSQL session row's `expires_at` — single source of truth (#1106). Frontend re-arms its refresh timer from the JWT `exp` claim, so changing the env var requires no client code changes.
- **Session revocation on privilege change**: role changes, password resets, user deletions (`packages/foundation/src/routes/users.ts`), and OIDC group-mapping downgrades (`packages/foundation/src/routes/oidc.ts`) call `invalidateAllUserSessions` immediately — the role is frozen into the signed JWT and never re-read, so without revocation a demotion/deletion only takes effect at token expiry. Best-effort: a revocation failure is logged, not turned into a 5xx.
- **Live socket re-validation**: Socket.IO connections re-check their session every 60s (and the `admin` role on the remediation namespace) and are disconnected on revocation/demotion — handshake-time auth alone would let a revoked session keep its socket until JWT expiry (`packages/core/src/plugins/socket-io.ts`).
- **Login timing equalisation**: `authenticateUser` runs a dummy bcrypt comparison when the username does not exist, so valid and invalid usernames are not distinguishable by response latency.
- `/health/ready/detail` is admin-only (exposes internal service URLs and raw connection errors); insight acknowledgement requires at least `operator`.

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

Applied to: enforced centrally in `chatStream()` (`packages/ai-intelligence/src/services/llm-client.ts`) — every user-role message is guarded before the LLM call and the returned response is sanitized. This covers all internal flows (log analysis, anomaly explanation, incident summaries, investigations, remediation, PCAP analysis, forecasts, correlations) plus REST `/api/llm/query` and WebSocket `chat:message`, which additionally apply their own user-facing block messages and per-session canary checks. Callers must use `chatStream`'s return value rather than re-accumulating raw `onChunk` chunks.
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
- **Security header ownership**: nginx is the single source of truth for browser-facing headers (`CSP`, `X-Frame-Options`, `X-XSS-Protection: 0` per OWASP, `Referrer-Policy`). The backend sets API-level headers only (`X-Content-Type-Options`, `Permissions-Policy`, `Strict-Transport-Security`). Issue #1101 removed the duplicate `Referrer-Policy` from the backend; issue #1105 changed `X-XSS-Protection` from the deprecated `1; mode=block` to `0`.
- **WebSocket protocol**: CSP currently allows both `ws:` and `wss:` to support deployments without TLS. For production with TLS, edit `frontend/nginx.conf` and remove `ws:` from `connect-src`

## SSRF & Outbound Requests

- **Outbound URL validation**: admin-supplied destinations (webhooks) are validated by `packages/core/src/utils/network-security.ts` against localhost names and private/loopback/link-local/metadata IP literals — including `0.0.0.0/8`, CGNAT, bracketed IPv6, and IPv4-mapped IPv6 forms.
- **Delivery-time re-validation**: webhook delivery re-validates the stored URL before every fetch (covers rows persisted before the guard hardened) and issues the request with `redirect: 'error'` so a 3xx from a public host cannot pivot the signed POST into an internal target.
- **Known residual**: DNS-based SSRF (a public hostname resolving to a private IP) is not blocked — closing it requires resolve-then-pin.
- **LLM probe endpoints**: `POST /api/llm/test-connection` is admin-only; the `?host=` override on `GET /api/llm/models` is honoured only for admins. The stored provider token is only ever attached when the destination matches the configured endpoint's origin — never forwarded to a caller-supplied host.
- **Machine-ingestion auth**: Prometheus bearer token and OTLP trace-ingest API key are compared in constant time (`constantTimeEqual`, fails closed on unset keys). Production refuses to start when trace ingestion is enabled with a `TRACES_INGESTION_API_KEY` shorter than 16 chars.
- **Error hygiene**: the global error handler (`packages/core/src/plugins/error-handler.ts`) returns generic 5xx bodies in production (4xx/validation preserved); `/api/users` and `/api/backup` responses are `no-store`.

## Security Regression Tests

Files: `backend/src/routes/security-regression-*.test.ts` — one file per domain (auth, rbac, headers, prompt-guard, sockets, stream-tickets, jwt, infra). Add new security-fix tests to the file matching your domain, or create a new per-domain file if none fits.

- **Auth sweep**: Dynamically discovers all routes, verifies no `/api/*` returns 2xx without auth
- **Prompt injection**: 22 vectors (system prompt extraction, ignore-instructions, case variations)
- **False positives**: 8 tests ensuring benign queries aren't blocked
- **Rate limiting**: Verifies `LOGIN_RATE_LIMIT` enforcement and `retry-after` header
