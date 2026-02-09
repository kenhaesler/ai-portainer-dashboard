# eBPF Trace Ingestion (Grafana Beyla)

Auto-instrument applications running on Portainer-managed containers using kernel-level eBPF tracing. Traces flow from monitored applications into the Trace Explorer without any code changes to the applications themselves.

## Overview

```
 ┌─────────────────────────────────────────────────────────┐
 │  Portainer Stack (e.g. web-platform)                    │
 │                                                         │
 │  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
 │  │  nginx   │  │  httpd   │  │ app-gw   │  ...services │
 │  │  :80     │  │  :80     │  │  :80     │              │
 │  └────┬─────┘  └────┬─────┘  └────┬─────┘              │
 │       │              │              │                    │
 │       └──────────────┼──────────────┘                    │
 │                      │  eBPF hooks (kernel)              │
 │              ┌───────┴────────┐                          │
 │              │  Grafana Beyla │                          │
 │              │  (privileged)  │                          │
 │              └───────┬────────┘                          │
 │                      │ OTLP protobuf                     │
 └──────────────────────┼──────────────────────────────────┘
                        │ POST /api/traces/otlp/v1/traces
                        │ X-API-Key: <api-key>
                        ▼
              ┌─────────────────────┐
              │  Dashboard Backend  │
              │                     │
              │  Content-Type?      │
              │  ├─ protobuf → decode (protobufjs)
              │  └─ json     → parse directly
              │         │           │
              │    transform OTLP   │
              │    → SpanInsert[]   │
              │         │           │
              │    batch INSERT     │
              │    into SQLite      │
              │         │           │
              │    queueSpanFor     │
              │    Export() ────────┼──→  ┌─────────────────┐
              │    (if enabled)     │     │ External OTLP   │
              └─────────┬───────────┘     │ Jaeger / Tempo  │
                        │                 │ Datadog / etc.  │
                        ▼                 └─────────────────┘
              ┌─────────────────────┐
              │   Trace Explorer    │
              │   (source: eBPF)    │
              └─────────────────────┘
```

## Prerequisites

| Requirement | Detail |
|---|---|
| Linux kernel | 5.8+ with BTF support |
| Docker privileges | `--privileged` or `SYS_ADMIN` + `SYS_PTRACE` capabilities |
| macOS/Windows | Works inside Docker Desktop's Linux VM but cannot instrument host processes |
| Dashboard env | `TRACES_INGESTION_ENABLED=true` and `TRACES_INGESTION_API_KEY` set |

## Quick Start

### 1. Enable trace ingestion on the dashboard

Add to your `.env`:

```env
TRACES_INGESTION_ENABLED=true
TRACES_INGESTION_API_KEY=your-secret-api-key-here
```

Restart the backend to pick up the new env vars.

### 2. Deploy Beyla in your application stack

Add Beyla as a service in your Docker Compose stack:

```yaml
services:
  # ... your existing services ...

  beyla:
    image: grafana/beyla:latest
    privileged: true
    pid: "host"
    init: true
    environment:
      BEYLA_OPEN_PORT: "80"                    # Ports to instrument
      BEYLA_SERVICE_NAMESPACE: "my-app"        # Namespace label for traces
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://host.docker.internal:3051/api/traces/otlp"
      OTEL_EXPORTER_OTLP_PROTOCOL: "http/json"
      OTEL_METRICS_EXPORTER: "none"
      OTEL_EXPORTER_OTLP_HEADERS: "X-API-Key=your-secret-api-key-here"
      BEYLA_TRACE_PRINTER: "disabled"
    volumes:
      - /sys/fs/cgroup:/sys/fs/cgroup
      - /sys/kernel/security:/sys/kernel/security
    restart: unless-stopped
```

### 3. Generate traffic and check the Trace Explorer

Open the Trace Explorer in the dashboard and select the **eBPF (Apps)** source filter. Traces from your instrumented services will appear automatically as HTTP traffic flows through them.

## Configuration Reference

### Dashboard Environment Variables

| Variable | Default | Description |
|---|---|---|
| `TRACES_INGESTION_ENABLED` | `false` | Master switch for the OTLP ingestion endpoint |
| `TRACES_INGESTION_API_KEY` | `""` | API key for authenticating trace exporters. Required when ingestion is enabled. |

### Beyla Environment Variables

| Variable | Example | Description |
|---|---|---|
| `BEYLA_OPEN_PORT` | `"80"` or `"80,443,3000-9999"` | Ports to observe with eBPF. Comma-separated, supports ranges. |
| `BEYLA_SERVICE_NAMESPACE` | `"web-platform"` | Namespace label added to all exported spans |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `"http://host.docker.internal:3051/api/traces/otlp"` | Base OTLP endpoint. Beyla auto-appends `/v1/traces`. |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `"http/json"` | Protocol hint (Beyla may still use protobuf — backend handles both) |
| `OTEL_METRICS_EXPORTER` | `"none"` | Set to `none` to disable metric export (we only ingest traces) |
| `OTEL_EXPORTER_OTLP_HEADERS` | `"X-API-Key=your-key"` | Authentication header. Format: `key=value` (no spaces, no colon). |
| `BEYLA_TRACE_PRINTER` | `"disabled"` | Disable stdout trace logging |

### Docker Requirements for Beyla

```yaml
privileged: true    # Required for eBPF kernel access
pid: "host"         # Required to observe other containers' processes
init: true          # Prevents zombie processes (required on Docker Desktop)
volumes:
  - /sys/fs/cgroup:/sys/fs/cgroup
  - /sys/kernel/security:/sys/kernel/security
```

## API Endpoint

### `POST /api/traces/otlp` (or `/api/traces/otlp/v1/traces`)

Accepts OTLP `ExportTraceServiceRequest` payloads from any OpenTelemetry-compatible exporter.

**Authentication**: API key via `X-API-Key` header or `Authorization: Bearer <key>` (not JWT — this is service-to-service auth).

**Content Types**:
- `application/json` — Standard OTLP JSON format
- `application/x-protobuf` — Binary protobuf (what Beyla actually sends)
- `application/protobuf` — Also accepted

**Request Body** (JSON example):
```json
{
  "resourceSpans": [
    {
      "resource": {
        "attributes": [
          { "key": "service.name", "value": { "stringValue": "my-app" } }
        ]
      },
      "scopeSpans": [
        {
          "spans": [
            {
              "traceId": "abc123...",
              "spanId": "span001",
              "name": "GET /api/users",
              "kind": 2,
              "startTimeUnixNano": "1700000000000000000",
              "endTimeUnixNano": "1700000000150000000",
              "status": { "code": 1 },
              "attributes": [
                { "key": "http.method", "value": { "stringValue": "GET" } }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

**Response**:
```json
{ "accepted": 2 }
```

**Error Responses**:

| Code | Condition |
|---|---|
| `200` | Spans accepted and stored |
| `400` | Invalid payload (missing `resourceSpans`, bad protobuf) |
| `401` | Missing or invalid API key |
| `501` | `TRACES_INGESTION_ENABLED` is `false` |

### Testing with curl

```bash
# JSON format
curl -X POST http://localhost:3051/api/traces/otlp \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "resourceSpans": [{
      "resource": {
        "attributes": [
          {"key": "service.name", "value": {"stringValue": "test-service"}}
        ]
      },
      "scopeSpans": [{
        "spans": [{
          "traceId": "abcdef1234567890abcdef1234567890",
          "spanId": "1234567890abcdef",
          "name": "GET /test",
          "kind": 2,
          "startTimeUnixNano": "1700000000000000000",
          "endTimeUnixNano": "1700000000150000000",
          "status": {"code": 1},
          "attributes": []
        }]
      }]
    }]
  }'
```

## Architecture

### Data Flow

1. **Beyla** uses eBPF kernel hooks to observe HTTP/gRPC traffic on configured ports
2. Every ~16 seconds, Beyla batches observed spans and sends them as **OTLP protobuf** to the dashboard backend
3. The **traces-ingest route** detects the content type:
   - `application/x-protobuf` → decoded using `protobufjs` with an inline OTLP proto schema
   - `application/json` → parsed directly
4. The **OTLP transformer** converts the OTLP format to our internal `SpanInsert` format:
   - Extracts `service.name` from resource attributes
   - Converts nanosecond timestamps to ISO 8601
   - Maps OTLP `kind` (1=internal, 2=server, 3=client) and `status.code` (0=unset, 1=ok, 2=error)
   - Flattens nested OTLP attributes to a JSON object
   - Tags all spans with `trace_source: 'ebpf'`
5. Spans are **batch-inserted** into SQLite within a single transaction for performance
6. If the **OTLP exporter** is enabled (`OTEL_EXPORTER_ENABLED=true`), spans are also queued for export to an external collector (Jaeger, Tempo, Datadog) via OTLP/HTTP JSON. See [Span Export to External Collectors](#span-export-to-external-collectors)
7. The **Trace Explorer** UI can filter by source: HTTP Requests, Background Jobs, or eBPF (Apps)

### File Map

| File | Purpose |
|---|---|
| `backend/src/routes/traces-ingest.ts` | OTLP ingestion endpoint with protobuf/JSON content negotiation, API key auth, feature flag |
| `backend/src/services/otlp-transformer.ts` | Converts OTLP JSON → `SpanInsert[]`. Handles timestamp conversion, attribute flattening, kind/status mapping |
| `backend/src/services/otlp-protobuf.ts` | Decodes OTLP protobuf binary → OTLP JSON using inline proto schema (no external `.proto` files) |
| `backend/src/services/trace-store.ts` | `insertSpans()` batch insert, `getTraces()` with `source` filter |
| `backend/src/services/otel-exporter.ts` | OTLP/HTTP JSON batch exporter — `queueSpanForExport()`, retry with backoff, graceful shutdown |
| `backend/src/services/trace-context.ts` | `withSpan()` hooks into `queueSpanForExport()` after SQLite insert |
| `backend/src/db/migrations/017_trace_source.sql` | Adds `trace_source` column and index to `spans` table |
| `backend/src/config/env.schema.ts` | `TRACES_INGESTION_ENABLED` and `TRACES_INGESTION_API_KEY` env vars |
| `docker/beyla/beyla.yml` | Standalone Beyla Compose fragment for instrumenting dashboard-adjacent services |
| `workloads/web-platform.yml` | Example workload stack with Beyla integrated |
| `frontend/src/pages/trace-explorer.tsx` | Source filter dropdown in the Trace Explorer UI |
| `frontend/src/hooks/use-traces.ts` | `source` parameter in `TracesOptions` |

### Database Schema Change

Migration `017_trace_source.sql`:
```sql
ALTER TABLE spans ADD COLUMN trace_source TEXT DEFAULT 'http';
CREATE INDEX idx_spans_source ON spans(trace_source);
```

Values: `'http'` (dashboard's own request tracing), `'scheduler'` (background jobs), `'ebpf'` (Beyla/external).

## Deployment Options

### Option A: Beyla inside the application stack (recommended)

Add Beyla directly to your application's Docker Compose file. This is the recommended approach because Beyla runs in the same PID namespace as your application containers.

See the `workloads/web-platform.yml` file for a complete example.

### Option B: Beyla as a dashboard sidecar

Use the provided `docker/beyla/beyla.yml` Compose fragment:

```bash
docker compose -f docker/docker-compose.dev.yml -f docker/beyla/beyla.yml up
# Or with profile:
docker compose --profile ebpf up
```

This instruments services visible from the dashboard's Docker network.

## Multi-Endpoint Deployment

In production environments with multiple Portainer endpoints (e.g., `prod-eu-1`, `prod-us-2`, `staging`), Beyla must be deployed on **every endpoint** where you want eBPF trace visibility. Without this, the Trace Explorer and eBPF Coverage page will have blind spots.

### Deployment Architecture

```
                        ┌──────────────────────┐
                        │  Dashboard Backend   │
                        │  (single instance)   │
                        │                      │
                        │  POST /api/traces/   │
                        │  otlp/v1/traces      │
                        └──────────┬───────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    │              │              │
            ┌───────▼──────┐ ┌────▼───────┐ ┌────▼───────┐
            │ Endpoint A   │ │ Endpoint B │ │ Endpoint C │
            │ prod-eu-1    │ │ prod-us-2  │ │ staging    │
            │              │ │            │ │            │
            │ ┌──────────┐ │ │ ┌────────┐ │ │ ┌────────┐ │
            │ │  Beyla   │ │ │ │ Beyla  │ │ │ │ Beyla  │ │
            │ │(per stack)│ │ │ │        │ │ │ │        │ │
            │ └──────────┘ │ │ └────────┘ │ │ └────────┘ │
            │ ┌──────────┐ │ │ ┌────────┐ │ │ ┌────────┐ │
            │ │  App     │ │ │ │  App   │ │ │ │  App   │ │
            │ │ Services │ │ │ │Services│ │ │ │Services│ │
            │ └──────────┘ │ │ └────────┘ │ │ └────────┘ │
            └──────────────┘ └────────────┘ └────────────┘
```

### Step-by-Step: Deploy Beyla Across All Endpoints

#### 1. Enable trace ingestion on the dashboard (once)

```env
TRACES_INGESTION_ENABLED=true
TRACES_INGESTION_API_KEY=your-secret-api-key-here
```

The dashboard backend must be reachable from all endpoints. If endpoints are on different networks, ensure the dashboard URL is accessible (e.g., via public DNS or VPN).

#### 2. Determine the dashboard URL for each endpoint

Each Beyla instance needs to reach the dashboard's OTLP endpoint. The URL depends on the endpoint's network topology:

| Endpoint location | `OTEL_EXPORTER_OTLP_ENDPOINT` value |
|---|---|
| Same Docker host as dashboard | `http://backend:3051/api/traces/otlp` (use Docker network) |
| Same machine, different compose stack | `http://host.docker.internal:3051/api/traces/otlp` |
| Remote server (LAN/VPN) | `http://<dashboard-ip>:3051/api/traces/otlp` |
| Remote server (internet) | `https://dashboard.example.com/api/traces/otlp` (use HTTPS + reverse proxy) |

#### 3. Deploy Beyla on each endpoint

For each Portainer endpoint, deploy Beyla as a stack via Portainer's Stacks UI or CLI. Use this template and adjust `OTEL_EXPORTER_OTLP_ENDPOINT` per endpoint:

```yaml
# beyla-tracer stack — deploy one per Portainer endpoint
services:
  beyla:
    image: grafana/beyla:latest
    privileged: true
    pid: "host"
    init: true
    environment:
      BEYLA_OPEN_PORT: "80,443,3000-9999"
      BEYLA_SERVICE_NAMESPACE: "${ENDPOINT_NAME:-unknown}"
      OTEL_EXPORTER_OTLP_ENDPOINT: "${DASHBOARD_OTLP_URL}"
      OTEL_EXPORTER_OTLP_PROTOCOL: "http/json"
      OTEL_METRICS_EXPORTER: "none"
      OTEL_EXPORTER_OTLP_HEADERS: "X-API-Key=${TRACES_INGESTION_API_KEY}"
      BEYLA_TRACE_PRINTER: "disabled"
    volumes:
      - /sys/fs/cgroup:/sys/fs/cgroup
      - /sys/kernel/security:/sys/kernel/security
    restart: unless-stopped
```

**Deploy via Portainer Stacks UI:**

1. Open Portainer → select the target endpoint
2. Go to **Stacks** → **Add Stack**
3. Name it `beyla-tracer`
4. Paste the template above
5. Set environment variables:
   - `ENDPOINT_NAME` = the endpoint name (e.g., `prod-eu-1`)
   - `DASHBOARD_OTLP_URL` = the dashboard URL from step 2
   - `TRACES_INGESTION_API_KEY` = same key from step 1
6. Deploy
7. Repeat for each endpoint

**Deploy via CLI (for scripted rollouts):**

```bash
# Deploy to all endpoints using Portainer API
for ENDPOINT_ID in 1 2 3; do
  curl -X POST "https://portainer.example.com/api/stacks/create/standalone/string?endpointId=${ENDPOINT_ID}" \
    -H "X-API-Key: ${PORTAINER_API_KEY}" \
    -H "Content-Type: application/json" \
    -d '{
      "name": "beyla-tracer",
      "stackFileContent": "<compose-yaml-here>",
      "env": [
        {"name": "ENDPOINT_NAME", "value": "endpoint-'${ENDPOINT_ID}'"},
        {"name": "DASHBOARD_OTLP_URL", "value": "http://dashboard.example.com:3051/api/traces/otlp"},
        {"name": "TRACES_INGESTION_API_KEY", "value": "your-secret-api-key-here"}
      ]
    }'
done
```

#### 4. Verify trace ingestion

After deploying, verify each endpoint is sending traces:

1. Generate HTTP traffic on the endpoint (e.g., `curl http://app-on-endpoint/`)
2. Open **eBPF Coverage** page in the dashboard sidebar → click **Verify** for each endpoint
3. Open **Trace Explorer** → filter by **eBPF (Apps)** source → confirm spans arrive with the correct `service.namespace` matching the endpoint name

#### 5. Track coverage status

Use the **eBPF Coverage** page (`/ebpf-coverage`) to track deployment progress:

1. Click **Sync Endpoints** to pull the latest endpoint list from Portainer
2. For each endpoint, update the status:
   - `deployed` — Beyla is running and sending traces
   - `planned` — Beyla deployment is scheduled but not yet done
   - `excluded` — Endpoint intentionally excluded (e.g., edge agent with no kernel access)
   - `failed` — Deployment attempted but Beyla is not sending traces
3. The summary bar shows overall coverage percentage

### Endpoint Exclusion Criteria

Not all endpoints can run Beyla. Mark these as `excluded` with a reason:

| Reason | Example |
|---|---|
| **No kernel access** | Edge agents, Windows endpoints, Kubernetes without privileged DaemonSets |
| **ARM architecture** | Beyla requires x86_64 (ARM support is experimental) |
| **Compliance restriction** | Endpoints in regulated environments that prohibit privileged containers |
| **No HTTP workloads** | Endpoints running only databases or message brokers with no HTTP traffic |

### Troubleshooting Multi-Endpoint Deployment

| Symptom | Cause | Fix |
|---|---|---|
| No traces from a remote endpoint | Dashboard not reachable | Check firewall, verify URL with `curl` from the endpoint host |
| Traces arrive but no `service.namespace` | `BEYLA_SERVICE_NAMESPACE` not set | Add the env var and restart the Beyla stack |
| Beyla container keeps restarting | Missing kernel BTF support | Check `ls /sys/kernel/btf/vmlinux` on the host — if missing, kernel is too old |
| Beyla running but no spans | No HTTP traffic on configured ports | Verify `BEYLA_OPEN_PORT` matches your application ports |
| 401 errors in Beyla logs | Wrong API key | Verify `TRACES_INGESTION_API_KEY` matches the dashboard `.env` |
| Coverage page shows `unknown` | Endpoints not synced | Click **Sync Endpoints** on the eBPF Coverage page |

## Known Behaviors

### Beyla sends protobuf despite `OTEL_EXPORTER_OTLP_PROTOCOL=http/json`

Beyla v2.8.5 ignores this setting and always sends `application/x-protobuf`. The backend handles both formats transparently via content-type detection and the `protobufjs` decoder.

### Beyla sends metrics even with `OTEL_METRICS_EXPORTER=none`

Beyla v2.8.5 continues sending metrics to `/v1/metrics` despite this setting. The backend includes a silent sink endpoint (`POST /api/traces/otlp/v1/metrics`) that accepts and discards these requests to prevent 404 log noise.

### Sub-millisecond durations show as 0ms

Beyla traces from fast responses (e.g., nginx serving static files) may show `duration_ms: 0` because the start and end timestamps are identical at millisecond precision. This is expected — the actual sub-millisecond duration is in the nanosecond fields.

### `init: true` is required on Docker Desktop

Without `init: true`, Beyla with `pid: "host"` can create zombie processes that prevent the container from being stopped. The init process (tini) handles proper signal forwarding and reaping.

### Beyla URL auto-appending

Beyla automatically appends `/v1/traces` to the `OTEL_EXPORTER_OTLP_ENDPOINT` value. If you set the endpoint to `http://backend:3051/api/traces/otlp`, Beyla will POST to `http://backend:3051/api/traces/otlp/v1/traces`. The backend registers handlers on both paths.

## Trace Explorer Source Filter

The Trace Explorer provides a source filter dropdown with these options:

| Filter | `source` param | Description |
|---|---|---|
| All sources | (empty) | Shows all traces regardless of source |
| HTTP Requests | `http` | Dashboard's own request tracing |
| Background Jobs | `scheduler` | Traces from scheduled background tasks |
| eBPF (Apps) | `ebpf` | Traces from Beyla-instrumented applications |

## Span Attributes from Beyla

Beyla enriches spans with resource and span-level attributes:

**Resource attributes** (all spans from a service):
- `service.name` — Auto-detected service name (e.g., `nginx`, `httpd`)
- `service.namespace` — From `BEYLA_SERVICE_NAMESPACE`
- `service.instance.id` — Container hostname + PID
- `host.name`, `host.id` — Container hostname
- `os.type` — Always `linux`
- `telemetry.sdk.name` — `beyla`
- `telemetry.sdk.version` — e.g., `v2.8.5`

**Span attributes** (per-request):
- `http.request.method` — GET, POST, etc.
- `http.response.status_code` — 200, 404, 500, etc.
- `url.path` — Request path
- `http.route` — Matched route pattern
- `client.address` — Client IP
- `server.address`, `server.port` — Server details
- `http.request.body.size`, `http.response.body.size` — Payload sizes

## Span Export to External Collectors

Optionally forward spans to external observability platforms (Jaeger, Grafana Tempo, Datadog) via OTLP/HTTP JSON. When enabled, spans are stored locally in SQLite **and** batched to an external collector — the dashboard remains fully functional even if the collector is unreachable.

### Quick Start

Add to your `.env`:

```env
OTEL_EXPORTER_ENABLED=true
OTEL_EXPORTER_ENDPOINT=http://jaeger:4318/v1/traces
```

Restart the backend. Spans will start flowing to the external collector within 5 seconds.

### Configuration

| Variable | Default | Description |
|---|---|---|
| `OTEL_EXPORTER_ENABLED` | `false` | Enable span export to external collector |
| `OTEL_EXPORTER_ENDPOINT` | — | OTLP/HTTP JSON endpoint (e.g., `http://jaeger:4318/v1/traces`) |
| `OTEL_EXPORTER_HEADERS` | — | Optional auth headers as JSON string (e.g., `{"Authorization":"Bearer token"}`) |
| `OTEL_EXPORTER_BATCH_SIZE` | `100` | Max spans per batch before flush |
| `OTEL_EXPORTER_FLUSH_INTERVAL_MS` | `5000` | Flush interval in milliseconds |

### How It Works

1. After each span is inserted into SQLite, `queueSpanForExport()` adds it to an in-memory buffer
2. The buffer flushes when it reaches `OTEL_EXPORTER_BATCH_SIZE` **or** `OTEL_EXPORTER_FLUSH_INTERVAL_MS` elapses (whichever comes first)
3. Spans are converted from the internal `SpanInsert` format to standard OTLP/HTTP JSON (`resourceSpans` structure)
4. On flush failure: exponential backoff retry (1s, 2s, 4s — max 3 attempts), then the batch is dropped with a warning log
5. Non-retryable 4xx errors (except 429) are dropped immediately without retry
6. Buffer overflow protection: max 1000 pending spans; oldest are dropped when full
7. On shutdown: remaining spans are flushed before the process exits

### Collector Examples

**Jaeger** (all-in-one):
```yaml
services:
  jaeger:
    image: jaegertracing/all-in-one:latest
    ports:
      - "4318:4318"   # OTLP HTTP
      - "16686:16686" # Jaeger UI
    networks:
      - dashboard-net
```

```env
OTEL_EXPORTER_ENABLED=true
OTEL_EXPORTER_ENDPOINT=http://jaeger:4318/v1/traces
```

**Grafana Tempo**:
```env
OTEL_EXPORTER_ENABLED=true
OTEL_EXPORTER_ENDPOINT=http://tempo:4318/v1/traces
```

**Datadog**:
```env
OTEL_EXPORTER_ENABLED=true
OTEL_EXPORTER_ENDPOINT=https://trace.agent.datadoghq.com/v1/traces
OTEL_EXPORTER_HEADERS={"DD-API-KEY":"your-datadog-api-key"}
```

### Zero Overhead When Disabled

When `OTEL_EXPORTER_ENABLED=false` (the default), the exporter singleton is never initialized. `queueSpanForExport()` is a no-op — no buffer allocation, no timers, no network calls.

## Test Coverage

| Test File | Tests | Description |
|---|---|---|
| `traces-ingest.test.ts` | 10 | Route tests: JSON + protobuf ingestion, API key auth, feature flag, error handling |
| `otlp-transformer.test.ts` | 11 | Transformer tests: OTLP conversion, timestamp math, kind/status mapping, attribute flattening |
| `otel-exporter.test.ts` | 17 | Exporter tests: batching, interval flush, exponential backoff retry, 4xx drop, graceful shutdown, OTLP format, singleton lifecycle |

Run tests:
```bash
cd backend
npx vitest run src/routes/traces-ingest.test.ts
npx vitest run src/services/otlp-transformer.test.ts
npx vitest run src/services/otel-exporter.test.ts
```
