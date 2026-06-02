# API Reference

REST and real-time (Socket.IO) surface of the AI Portainer Dashboard backend. All HTTP routes are served under the backend (`:3051`, proxied through the frontend at `/api/*` and `/socket.io/*`).

## Conventions

- **Base path:** every REST route below is under `/api` unless noted (`/health*` and `/socket.io` are not).
- **Auth tags:**
  - **[AUTH]** — requires a valid session (`fastify.authenticate`).
  - **[ADMIN]** — requires `authenticate` **and** `fastify.requireRole('admin')`.
  - Untagged — public (no auth).
- **Rule of thumb (per CLAUDE.md):** all mutating endpoints (POST/PUT/PATCH/DELETE) and sensitive reads (Settings, Users, Cache, Backups) require **[ADMIN]**. Personal preferences (e.g. anomaly sensitivity) are **[AUTH]** only.
- **Validation:** every request body/query is validated with Zod; invalid input returns `400`.
- **Streaming:** SSE endpoints stream `text/event-stream`. Browser SSE can't send headers, so they authenticate with a single-use **stream ticket** (`POST /api/auth/stream-ticket`, 30s TTL).

---

## Authentication & SSO

`packages/foundation/src/routes/auth.ts`, `oidc.ts`

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/auth/login` | — | Username/password login (rate-limited) |
| `POST` | `/api/auth/logout` | [AUTH] | Invalidate the current session |
| `GET` | `/api/auth/session` | [AUTH] | Current session + user info |
| `POST` | `/api/auth/refresh` | [AUTH] | Refresh the JWT/session |
| `POST` | `/api/auth/stream-ticket` | [AUTH] | Issue a single-use SSE auth ticket (30s TTL) |
| `GET` | `/api/auth/oidc/status` | — | OIDC enabled flag + authorization URL |
| `POST` | `/api/auth/oidc/callback` | — | Exchange OIDC auth code for a session (rate-limited). Returns `403` when `oidc.allow_unmapped_viewer` is off and the user's groups match no role mapping. |
| `POST` | `/api/auth/oidc/logout` | [AUTH] | Log out of the OIDC session |
| `GET` | `/api/auth/oidc/effective-redirect-uri` | [ADMIN] | Show the env-derived OIDC redirect URI |
| `GET` | `/api/auth/oidc/discovered-groups` | [ADMIN] | OIDC groups observed from past logins |

## Containers, Images, Networks, Stacks

`packages/foundation/src/routes/containers.ts`, `container-logs.ts`, `images.ts`, `networks.ts`, `stacks.ts`

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/containers` | [AUTH] | List containers (filter by `endpointId`, `state`, `search`) |
| `GET` | `/api/containers/count` | [AUTH] | Container counts by state |
| `GET` | `/api/containers/favorites` | [AUTH] | Fetch specific containers by composite IDs |
| `GET` | `/api/containers/:endpointId/:containerId` | [AUTH] | Container details |
| `GET` | `/api/containers/:endpointId/:containerId/logs` | [AUTH] | Container logs (tail) |
| `POST` | `/api/containers/:endpointId/:containerId/logs/collect` | [AUTH] | Start async log collection (Edge Async) |
| `GET` | `/api/containers/:endpointId/:containerId/logs/collect/:jobId` | [AUTH] | Poll/retrieve async log job |
| `GET` | `/api/containers/:endpointId/:containerId/logs/stream` | [AUTH] | **SSE** real-time log stream (supports stream ticket) |
| `GET` | `/api/images` | [AUTH] | List Docker images |
| `GET` | `/api/images/staleness` | [AUTH] | Image staleness results |
| `POST` | `/api/images/staleness/check` | [ADMIN] | Trigger a staleness check |
| `GET` | `/api/networks` | [AUTH] | List Docker networks |
| `GET` | `/api/stacks` | [AUTH] | List stacks |
| `GET` | `/api/stacks/:id` | [AUTH] | Stack details |

## Kubernetes

`packages/foundation/src/routes/kubernetes.ts`

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/kubernetes/pods` | [AUTH] | List pods (filter by `namespace`, `endpointId`) |
| `GET` | `/api/kubernetes/deployments` | [AUTH] | List deployments |
| `GET` | `/api/kubernetes/services` | [AUTH] | List services |
| `GET` | `/api/kubernetes/namespaces` | [AUTH] | List namespaces |
| `GET` | `/api/kubernetes/pods/:endpointId/:namespace/:podName/logs` | [AUTH] | Pod logs (read-only) |
| `GET` | `/api/kubernetes/summary` | [AUTH] | Pod counts by state (dashboard KPIs) |

## Endpoints & Dashboard

`packages/foundation/src/routes/endpoints.ts`, `dashboard.ts`

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/endpoints` | [AUTH] | List Portainer endpoints |
| `GET` | `/api/endpoints/:id` | [AUTH] | Get a specific endpoint |
| `GET` | `/api/endpoints/debug/edge-status` | [AUTH] | Debug raw Edge endpoint data |
| `GET` | `/api/dashboard/summary` | [AUTH] | KPIs, endpoints, security-audit summary |
| `GET` | `/api/dashboard/resources` | [AUTH] | Fleet-wide resource usage + top stacks |
| `GET` | `/api/dashboard/kpi-history` | [AUTH] | KPI snapshots (default last 24h) |
| `GET` | `/api/dashboard/full` | [AUTH] | Combined summary + resources (+ optional KPI history) |

## Monitoring & Insights

`packages/ai-intelligence/src/routes/monitoring.ts`

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/monitoring/insights` | [AUTH] | List insights (filter by severity/acknowledged, cursor-paginated) |
| `GET` | `/api/monitoring/insights/container/:containerId` | [AUTH] | Anomaly explanations for a container |
| `POST` | `/api/monitoring/insights/:id/acknowledge` | [AUTH] | Acknowledge an insight |
| `POST` | `/api/monitoring/anomaly-feedback` | [AUTH] | Record a false-positive disposition (scoped to caller; idempotent) |
| `GET` | `/api/monitoring/anomaly-feedback/rates` | [AUTH] | Per-detector false-positive rates (admins: fleet-wide; `?scope=mine` for caller) |
| `GET` | `/api/monitoring/sensitivity` | [AUTH] | Get the caller's anomaly sensitivity preset |
| `PUT` | `/api/monitoring/sensitivity` | [AUTH] | Update the caller's sensitivity preset (`low`/`default`/`high`) |

See [AI & Anomaly Detection](ai-anomaly-detection.md) for detector semantics and the feedback/sensitivity model.

## Incidents

`packages/ai-intelligence/src/routes/incidents.ts`

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/incidents` | [AUTH] | List incidents (filter by status/severity/signature) |
| `GET` | `/api/incidents/groups` | [AUTH] | Incidents grouped by signature |
| `GET` | `/api/incidents/:id` | [AUTH] | Incident detail with related insights |
| `POST` | `/api/incidents/:id/resolve` | [ADMIN] | Resolve a single incident |
| `POST` | `/api/incidents/resolve` | [ADMIN] | Resolve a batch of incidents (up to 500) |

## Metrics & Observability

`packages/observability/src/routes/metrics.ts`

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/metrics/:endpointId/:containerId` | [AUTH] | Container metrics time-series (LTTB-decimated) |
| `GET` | `/api/metrics/anomalies` | [AUTH] | Recent anomaly detections |
| `GET` | `/api/metrics/network-rates/:endpointId` | [AUTH] | Network I/O rates for an endpoint |
| `GET` | `/api/metrics/network-rates` | [AUTH] | Network I/O rates for all endpoints |
| `GET` | `/api/metrics/:endpointId/:containerId/ai-summary` | [AUTH] | **SSE** AI-generated metrics narrative |

> Distributed tracing also exposes forecasts, OTLP ingest, Prometheus scrape, and status-page routes from `@dashboard/observability`; see [eBPF Trace Ingestion](ebpf-trace-ingestion.md).

## LLM

`packages/ai-intelligence/src/routes/llm.ts`

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/llm/query` | [AUTH] | Natural-language dashboard query (prompt-guarded, rate-limited) |
| `GET` | `/api/llm/models` | [AUTH] | List models from the configured LLM endpoint |
| `POST` | `/api/llm/test-connection` | [AUTH] | Test connectivity to the LLM endpoint |
| `POST` | `/api/llm/test-prompt` | [ADMIN] | Test a system prompt with a sample payload |

## Remediation

`packages/operations/src/routes/remediation.ts` — **all [ADMIN]** (observer-first gate)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/remediation/actions` | [ADMIN] | List remediation actions (filter by status) |
| `POST` | `/api/remediation/actions/:id/approve` | [ADMIN] | Approve a pending action |
| `POST` | `/api/remediation/actions/:id/reject` | [ADMIN] | Reject a pending action |
| `POST` | `/api/remediation/actions/:id/execute` | [ADMIN] | Execute an approved action (container start/stop/restart) |

## Security — Harbor & Audit

`packages/security/src/routes/harbor-vulnerabilities.ts`, monitoring security routes

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/harbor/status` | [AUTH] | Harbor connection + sync status |
| `GET` | `/api/harbor/enabled` | [AUTH] | Whether Harbor integration is enabled |
| `GET` | `/api/harbor/summary` | [AUTH] | Live security summary from Harbor |
| `GET` | `/api/harbor/vulnerabilities` | [AUTH] | List synced vulnerabilities |
| `GET` | `/api/harbor/vulnerabilities/summary` | [AUTH] | Vulnerability summary stats |
| `GET` | `/api/harbor/projects` | [AUTH] | List Harbor projects |
| `POST` | `/api/harbor/sync` | [ADMIN] | Trigger a full vulnerability sync |
| `GET` | `/api/harbor/exceptions` | [ADMIN] | List CVE exceptions |
| `POST` | `/api/harbor/exceptions` | [ADMIN] | Create/update a CVE exception |
| `DELETE` | `/api/harbor/exceptions/:id` | [ADMIN] | Deactivate a CVE exception |
| `GET` | `/api/security/audit` | [ADMIN] | Security-capability audit across endpoints |
| `GET` | `/api/security/audit/:endpointId` | [ADMIN] | Audit for one endpoint |
| `GET` | `/api/security/ignore-list` | [ADMIN] | Security-audit ignore patterns |
| `PUT` | `/api/security/ignore-list` | [ADMIN] | Update ignore patterns |

## Webhooks, Notifications & Events

`packages/operations/src/routes/webhooks.ts`, `notifications.ts`

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/webhooks` | [ADMIN] | List configured webhooks |
| `POST` | `/api/webhooks` | [ADMIN] | Create a webhook |
| `GET` | `/api/webhooks/:id` | [ADMIN] | Webhook details |
| `PATCH` | `/api/webhooks/:id` | [ADMIN] | Update a webhook |
| `DELETE` | `/api/webhooks/:id` | [ADMIN] | Delete a webhook |
| `GET` | `/api/webhooks/:id/deliveries` | [ADMIN] | Webhook delivery history |
| `POST` | `/api/webhooks/:id/test` | [ADMIN] | Send a test event to a webhook |
| `GET` | `/api/webhooks/event-types` | [ADMIN] | Available webhook event types |
| `GET` | `/api/notifications/history` | [ADMIN] | Notification delivery history |
| `POST` | `/api/notifications/test` | [ADMIN] | Send a test notification (email/Teams/Discord/Telegram) |
| `GET` | `/api/events/stream` | [AUTH] | **SSE** stream of dashboard events |

## Settings, Users & Cache

`packages/foundation/src/routes/settings.ts`, `users.ts`, `cache-admin.ts`

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/settings/preferences` | [AUTH] | Get the caller's UI preferences |
| `PATCH` | `/api/settings/preferences` | [AUTH] | Update the caller's UI preferences |
| `GET` | `/api/settings` | [ADMIN] | Get all settings (sensitive values redacted) |
| `PUT` | `/api/settings/:key` | [ADMIN] | Create/update a setting |
| `DELETE` | `/api/settings/:key` | [ADMIN] | Delete a setting |
| `GET` | `/api/settings/audit-log` | [ADMIN] | Audit-log entries (cursor-paginated) |
| `GET` | `/api/settings/prompt-features` | [ADMIN] | Prompt feature definitions + defaults |
| `GET` | `/api/settings/prompts/:feature/history` | [ADMIN] | Prompt version history |
| `POST` | `/api/settings/prompts/:feature/rollback` | [ADMIN] | Roll a prompt back to a prior version |
| `GET` | `/api/users` | [ADMIN] | List users |
| `POST` | `/api/users` | [ADMIN] | Create a user |
| `PATCH` | `/api/users/:id` | [ADMIN] | Update a user |
| `DELETE` | `/api/users/:id` | [ADMIN] | Delete a user (cannot delete self) |
| `GET` | `/api/admin/cache/stats` | [ADMIN] | Cache statistics + active entries |
| `POST` | `/api/admin/cache/clear` | [ADMIN] | Clear all cache entries |
| `POST` | `/api/admin/cache/invalidate` | [ADMIN] | Invalidate cache by resource pattern |

## Search & Health

`packages/foundation/src/routes/search.ts`, `health.ts`

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/search` | [AUTH] | Global search (containers, images, stacks, optional logs) |
| `GET` | `/health` | — | Liveness check |
| `GET` | `/health/ready` | — | Readiness with redacted dependency status |
| `GET` | `/health/ready/detail` | [AUTH] | Readiness with full diagnostic detail |

---

## WebSocket / Socket.IO

Three authenticated namespaces. The socket handshake carries the session; the `/remediation` namespace additionally rejects non-admin connections.

### `/llm` — chat assistant

`packages/ai-intelligence/src/sockets/llm-chat.ts`

**Client → server:** `chat:message` (`{ text, context?, model? }`), `chat:cancel`, `chat:clear`

**Server → client:** `chat:status` (`{ message, phase }`), `chat:start`, `chat:chunk` (text), `chat:tool_call` (`{ tools, status, results? }`), `chat:tool_response_pending`, `chat:end` (`{ id, content }`), `chat:error` (`{ message }`), `chat:cancelled`, `chat:cleared`, `chat:throttled` (`{ reason, retryAfterMs }`), `chat:blocked` (`{ reason, score }` — prompt-injection guard)

### `/monitoring` — live insights

`packages/ai-intelligence/src/sockets/monitoring.ts`

**Client → server:** `insights:history` (`{ limit?, severity? }`), `investigations:history` (`{ limit? }`), `insights:subscribe` (`{ severity? }`), `insights:unsubscribe`

**Server → client:** `insights:history` (`{ insights }`), `investigations:history` (`{ investigations }`), `insights:new` (insight), `insights:batch` (`{ insights }`), `insights:throttled`, `insights:error` (`{ error, code? }`)

### `/remediation` — action status (admin-only)

`packages/operations/src/sockets/remediation.ts`

**Client → server:** `actions:list` (`{ status? }`)

**Server → client:** `actions:list` (`{ actions }`), `actions:new` (action), `actions:updated` (action), `actions:throttled`, `actions:error`
