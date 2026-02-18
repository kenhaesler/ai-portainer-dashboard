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

| Variable | Description | Default |
|----------|-------------|---------|
| `OLLAMA_BASE_URL` | Ollama server URL (used by native Ollama SDK) | `http://host.docker.internal:11434` |
| `OLLAMA_MODEL` | LLM model name | `llama3.2` |
| `LLM_OPENAI_ENDPOINT` | Custom OpenAI-compatible chat completions endpoint (e.g. OpenWebUI, LiteLLM). When set, bypasses the Ollama SDK and uses direct HTTP requests | *(optional)* |
| `LLM_BEARER_TOKEN` | Auth token or `user:pass` for Basic auth (used for both Ollama and custom endpoints) | *(optional)* |
| `LLM_VERIFY_SSL` | Verify TLS certificates for LLM endpoints. Set to `false` for self-signed or internal CA certificates. When `false`, creates a per-connection undici Agent with `rejectUnauthorized: false` scoped to LLM requests only | `true` |
| `LLM_MAX_TOOL_ITERATIONS` | Maximum MCP tool call iterations per LLM request | `10` |

### Endpoint selection logic

The dashboard supports two LLM connection modes:

1. **Native Ollama SDK** (default) — Used when `LLM_OPENAI_ENDPOINT` is not set and the Settings UI "Custom endpoint" toggle is off. Connects to `OLLAMA_BASE_URL` using the Ollama SDK with model pulling support.
2. **OpenAI-compatible HTTP** — Used when `LLM_OPENAI_ENDPOINT` is set (or the Settings UI toggle is on). Sends standard `/v1/chat/completions` requests via `undici` fetch with SSL and auth handling. Works with OpenWebUI, LiteLLM, vLLM, or any OpenAI-compatible API.

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
- The Ollama SDK is initialized with the custom `llmFetch` function to ensure it also respects SSL settings
- The `--use-system-ca` Node.js flag is set in Docker images to trust system CA certificates
- All other outbound connections (Portainer API, Redis, TimescaleDB) continue to use standard TLS verification

> **Note:** TLS bypass is scoped to LLM connections only. Other services (Portainer, Redis, TimescaleDB) always validate certificates normally.

### Safe exposure defaults (Prometheus + Ollama)

Default posture in this project is internal-only exposure for infrastructure services.

- Prometheus should not be host-published by default in provided workloads.
- Ollama should be localhost-bound by default (`OLLAMA_HOST=127.0.0.1:11434`) when run directly on a host.
- Do not expose Prometheus/Ollama on `0.0.0.0` without authentication.

Approved external access pattern (when needed):

1. Keep Prometheus/Ollama on internal network or localhost.
2. Front them with an authenticated reverse proxy (SSO/token/basic auth) or a bastion tunnel.
3. Point dashboard config (`OLLAMA_BASE_URL`) to the protected endpoint only.

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
| `ANOMALY_ZSCORE_THRESHOLD` | Z-score threshold for anomaly flag | `2.5` |
| `ANOMALY_MOVING_AVERAGE_WINDOW` | Moving average window size | `20` |
| `ANOMALY_MIN_SAMPLES` | Minimum samples before detection | `10` |
| `ISOLATION_FOREST_ENABLED` | Enable Isolation Forest ML anomaly detection | `true` |
| `ISOLATION_FOREST_TREES` | Number of trees in the forest (10-500) | `100` |
| `ISOLATION_FOREST_SAMPLE_SIZE` | Subsample size per tree (32-512) | `256` |
| `ISOLATION_FOREST_CONTAMINATION` | Expected anomaly proportion (0.01-0.5) | `0.1` |
| `ISOLATION_FOREST_RETRAIN_HOURS` | Hours between model retraining | `6` |

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
