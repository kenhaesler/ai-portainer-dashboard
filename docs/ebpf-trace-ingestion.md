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
              └─────────┬───────────┘
                        │
                        ▼
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
6. The **Trace Explorer** UI can filter by source: HTTP Requests, Background Jobs, or eBPF (Apps)

### File Map

| File | Purpose |
|---|---|
| `backend/src/routes/traces-ingest.ts` | OTLP ingestion endpoint with protobuf/JSON content negotiation, API key auth, feature flag |
| `backend/src/services/otlp-transformer.ts` | Converts OTLP JSON → `SpanInsert[]`. Handles timestamp conversion, attribute flattening, kind/status mapping |
| `backend/src/services/otlp-protobuf.ts` | Decodes OTLP protobuf binary → OTLP JSON using inline proto schema (no external `.proto` files) |
| `backend/src/services/trace-store.ts` | `insertSpans()` batch insert, `getTraces()` with `source` filter |
| `backend/src/db/migrations/017_trace_source.sql` | Adds `trace_source` column and index to `spans` table |
| `backend/src/config/env.schema.ts` | `TRACES_INGESTION_ENABLED` and `TRACES_INGESTION_API_KEY` env vars |
| `docker/beyla.yml` | Standalone Beyla Compose fragment for instrumenting dashboard-adjacent services |
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

Use the provided `docker/beyla.yml` Compose fragment:

```bash
docker compose -f docker-compose.dev.yml -f docker/beyla.yml up
# Or with profile:
docker compose --profile ebpf up
```

This instruments services visible from the dashboard's Docker network.

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

## Test Coverage

| Test File | Tests | Description |
|---|---|---|
| `traces-ingest.test.ts` | 10 | Route tests: JSON + protobuf ingestion, API key auth, feature flag, error handling |
| `otlp-transformer.test.ts` | 11 | Transformer tests: OTLP conversion, timestamp math, kind/status mapping, attribute flattening |

Run tests:
```bash
cd backend
npx vitest run src/routes/traces-ingest.test.ts
npx vitest run src/services/otlp-transformer.test.ts
```
