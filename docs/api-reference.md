# API Reference

## Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/login` | Login with username/password |
| `POST` | `/api/auth/logout` | Invalidate session |
| `GET` | `/api/auth/session` | Current session info |
| `POST` | `/api/auth/refresh` | Refresh JWT token |

## Infrastructure

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/dashboard/summary` | KPIs, endpoints, recent containers |
| `GET` | `/api/endpoints` | List Portainer endpoints |
| `GET` | `/api/containers` | List containers (filterable by endpoint) |
| `GET` | `/api/containers/:eid/:cid` | Container details |
| `GET` | `/api/container-logs/:eid/:cid` | Container logs |
| `GET` | `/api/images` | List container images |
| `GET` | `/api/networks` | List Docker networks |
| `GET` | `/api/stacks` | List Docker stacks |

## Monitoring & Metrics

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/metrics/:eid/:cid` | Time-series metrics (cpu, memory) |
| `GET` | `/api/metrics/anomalies` | Detected anomalies |
| `GET` | `/api/monitoring/insights` | Insights with severity filters |
| `POST` | `/api/monitoring/insights/:id/acknowledge` | Acknowledge an insight |

## Remediation

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/remediation/actions` | List actions (filterable by status) |
| `POST` | `/api/remediation/actions/:id/approve` | Approve action |
| `POST` | `/api/remediation/actions/:id/reject` | Reject action |
| `POST` | `/api/remediation/actions/:id/execute` | Execute approved action |

## Operations

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/settings` | Get settings (with optional category) |
| `PUT` | `/api/settings/:key` | Update a setting |
| `DELETE` | `/api/settings/:key` | Delete a setting |
| `GET` | `/api/settings/audit-log` | Audit log entries |
| `GET` | `/api/traces` | Distributed traces |
| `POST` | `/api/backup` | Create database backup |
| `GET` | `/api/search` | Global search across containers, images, stacks, and logs |
| `GET` | `/api/logs/search` | Search Elasticsearch logs |
| `GET` | `/health` | Liveness check |
| `GET` | `/health/ready` | Readiness check (DB + Portainer + Ollama) |

## WebSocket Namespaces

| Namespace | Purpose |
|-----------|---------|
| `/llm` | Real-time LLM chat with streaming responses |
| `/monitoring` | Live insight push with severity subscriptions |
| `/remediation` | Action status updates and execution notifications |
