# Configuration

All configuration is done via environment variables. Copy [`.env.example`](../.env.example) for a ready-to-copy template.

## Required

| Variable | Description | Default |
|----------|-------------|---------|
| `PORTAINER_API_URL` | Portainer instance URL | `http://host.docker.internal:9000` |
| `PORTAINER_API_KEY` | Portainer API key | *(required)* |

## Authentication

| Variable | Description | Default |
|----------|-------------|---------|
| `DASHBOARD_USERNAME` | Dashboard login username | `admin` |
| `DASHBOARD_PASSWORD` | Dashboard login password | `changeme123` |
| `JWT_SECRET` | JWT signing secret (32+ chars in production) | *(auto-generated in dev)* |

## AI / LLM

The dashboard targets a single OpenAI-compatible chat-completions API (OpenAI, LM Studio, vLLM, LiteLLM, OpenWebUI, Anthropic via proxy, etc.). The bare base URL is sufficient — `/v1/chat/completions` is appended automatically.

| Variable | Description | Default |
|----------|-------------|---------|
| `LLM_API_URL` | OpenAI-compatible API base URL or full chat-completions URL (e.g. `http://lmstudio:1234`). `/v1/chat/completions` is auto-appended. URLs ending in `/chat/completions` are used as-is | *(unset — LLM features disabled)* |
| `LLM_API_TOKEN` | Auth token (Bearer) or `user:pass` (Basic) for the LLM endpoint | *(optional)* |
| `LLM_AUTH_TYPE` | `bearer` (default) or `basic` | `bearer` |
| `LLM_MODEL` | Default model name used by chat, search, monitoring, incidents | `gpt-4o-mini` |
| `LLM_VERIFY_SSL` | Verify TLS certificates for LLM endpoints. Set to `false` for self-signed or internal CA certificates. When `false`, creates a per-connection undici Agent with `rejectUnauthorized: false` scoped to LLM requests only | `true` |
| `LLM_MAX_TOOL_ITERATIONS` | Maximum MCP tool call iterations per LLM request | `10` |

### Custom CA Certificates (Recommended for Production)

For internal or self-signed certificates, mount a custom CA bundle instead of disabling TLS verification:

```yaml
services:
  backend:
    environment:
      - NODE_EXTRA_CA_CERTS=/certs/ca-bundle.crt
    volumes:
      - ./certs/ca-bundle.crt:/certs/ca-bundle.crt:ro
```

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_EXTRA_CA_CERTS` | Path to a PEM file with additional CA certificates | *(optional)* |

**How it works:**
- Node.js `--use-system-ca` (already set in Docker images) loads the OS trust store
- `NODE_EXTRA_CA_CERTS` adds your internal CA on top — all standard TLS verification remains active
- The backend passes the custom CA cert to undici Agents for both LLM and Portainer connections (undici does not read `NODE_EXTRA_CA_CERTS` by default, so the cert is passed explicitly via `connect.ca`)

**Use cases:**
- Enterprise with a private CA signing certs for internal services (OpenWebUI, Portainer)
- Self-signed reverse proxy (Traefik/Nginx) in front of LLM endpoints
- Mixed environments where some services use public certs and some use internal CA

> **Prefer `NODE_EXTRA_CA_CERTS` over `LLM_VERIFY_SSL=false` in production.** The latter disables TLS verification for LLM connections.

### SSL bypass details (development fallback)

When `LLM_VERIFY_SSL=false`:
- A per-connection `undici.Agent` with `connect: { rejectUnauthorized: false }` is created and scoped to LLM HTTP calls via `llmFetch()` only
- The `--use-system-ca` Node.js flag is set in Docker images to trust system CA certificates
- All other outbound connections (Portainer API, Redis, TimescaleDB) continue to use standard TLS verification

> **Note:** TLS bypass is scoped to LLM connections only. Other services (Portainer, Redis, TimescaleDB) always validate certificates normally.

### Safe exposure defaults (Prometheus + LLM endpoints)

Default posture in this project is internal-only exposure for infrastructure services.

- Prometheus should not be host-published by default in provided workloads.
- Self-hosted LLM servers (LM Studio, vLLM, OpenWebUI) should bind to localhost or a private network and be fronted by an authenticated reverse proxy when remote access is required.
- Do not expose Prometheus/LLM endpoints on `0.0.0.0` without authentication.

Approved external access pattern (when needed):

1. Keep Prometheus/LLM endpoints on an internal network or localhost.
2. Front them with an authenticated reverse proxy (SSO/token/basic auth) or a bastion tunnel.
3. Point dashboard config (`LLM_API_URL`) to the protected endpoint only.

## Monitoring & Metrics

| Variable | Description | Default |
|----------|-------------|---------|
| `MONITORING_ENABLED` | Enable background monitoring | `true` |
| `MONITORING_INTERVAL_MINUTES` | Monitoring cycle interval | `5` |
| `METRICS_COLLECTION_ENABLED` | Enable metrics collection | `true` |
| `METRICS_COLLECTION_INTERVAL_SECONDS` | Collection interval | `60` |
| `METRICS_RETENTION_DAYS` | Days to retain metrics | `7` |

## Anomaly Detection

| Variable | Description | Default |
|----------|-------------|---------|
| `ANOMALY_ZSCORE_THRESHOLD` | Z-score threshold for anomaly flag | `3.5` |
| `ANOMALY_MOVING_AVERAGE_WINDOW` | Moving average window size (samples). Raised 20 → 60 in #1294. | `60` |
| `ANOMALY_MIN_SAMPLES` | Minimum samples before detection | `10` |
| `ISOLATION_FOREST_ENABLED` | Enable Isolation Forest ML anomaly detection | `true` |
| `ISOLATION_FOREST_TREES` | Number of trees in the forest (10-500) | `100` |
| `ISOLATION_FOREST_SAMPLE_SIZE` | Subsample size per tree (32-512) | `256` |
| `ISOLATION_FOREST_CONTAMINATION` | Expected anomaly proportion (0.01-0.5). Lowered 0.15 → 0.05 in #1294. | `0.05` |
| `ISOLATION_FOREST_RETRAIN_HOURS` | Hours between model retraining | `6` |
| `TRACES_ANOMALY_P95_ZSCORE` | Trace-path z-score threshold (p95 vs 24h baseline). Raised 2.5 → 3.0 in #1294. | `3.0` |
| `TRACES_ANOMALY_ERROR_RATE_PCT` | Trace-path absolute error-rate floor (percent) | `5` |
| `TRACES_ANOMALY_PER_SERVICE_MIN` | Per-service rate limit (minutes) layered on top of the 10-min per-key cooldown (#1294). 0 = disabled. | `5` |
| `TRACES_ANOMALY_MIN_SAMPLES` | Minimum recent-sample count required before the trace detector evaluates a service (#1294). Mirrors `ANOMALY_MIN_SAMPLES`. | `10` |

## NLP Log Analysis

| Variable | Description | Default |
|----------|-------------|---------|
| `NLP_LOG_ANALYSIS_ENABLED` | Enable LLM-powered log analysis during monitoring | `true` |
| `NLP_LOG_ANALYSIS_MAX_PER_CYCLE` | Max containers to analyze per cycle (1-20) | `3` |
| `NLP_LOG_ANALYSIS_TAIL_LINES` | Log lines to send to LLM (10-500) | `100` |

## Smart Alert Grouping

| Variable | Description | Default |
|----------|-------------|---------|
| `SMART_GROUPING_ENABLED` | Enable semantic alert grouping via text similarity | `true` |
| `SMART_GROUPING_SIMILARITY_THRESHOLD` | Jaccard similarity threshold for grouping (0.1-1.0) | `0.3` |
| `INCIDENT_SUMMARY_ENABLED` | Enable LLM-generated incident summaries | `true` |

## Infrastructure

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Backend server port | `3051` |
| `LOG_LEVEL` | Pino log level | `info` |
| `SQLITE_PATH` | Database file path | `./data/dashboard.db` |
| `CACHE_ENABLED` | Enable response caching | `true` |
| `CACHE_TTL_SECONDS` | Cache time-to-live | `900` |
| `PORTAINER_VERIFY_SSL` | Verify Portainer SSL certificates | `false` |
| `API_RATE_LIMIT` | Global API requests per minute per IP | `600` (prod) / `1200` (dev) |
| `LOGIN_RATE_LIMIT` | Login attempts per minute | `5` (prod) / `30` (dev) |
| `KIBANA_ENDPOINT` | Elasticsearch/Kibana URL | *(optional)* |
| `KIBANA_API_KEY` | Kibana API key | *(optional)* |
