# Dashboard Traefik Labels (Beyla OTLP over 443)

This document provides a label-based Traefik setup for routing Beyla OTLP traffic through HTTPS `443` to the dashboard backend OTLP ingest endpoint.

## Goal

Route:
- `https://dashboard.example.com/api/traces/otlp/v1/traces`
- `https://dashboard.example.com/api/traces/otlp/v1/metrics`

to:
- `http://backend:3051`

without exposing backend port `3051` publicly.

## Docker Compose Label Example

Add these labels to the `backend` service in your compose file (or equivalent labels in your Traefik-managed service definition):

```yaml
services:
  backend:
    # Keep backend private in Traefik mode
    ports: []
    networks:
      - dashboard-net
    labels:
      - traefik.enable=true

      # Service target
      - traefik.http.services.dashboard-backend.loadbalancer.server.port=3051

      # OTLP router (HTTPS 443)
      - traefik.http.routers.dashboard-beyla-otlp.rule=Host(`dashboard.example.com`) && PathPrefix(`/api/traces/otlp`) && Method(`POST`)
      - traefik.http.routers.dashboard-beyla-otlp.entrypoints=websecure
      - traefik.http.routers.dashboard-beyla-otlp.tls=true
      - traefik.http.routers.dashboard-beyla-otlp.priority=500
      - traefik.http.routers.dashboard-beyla-otlp.service=dashboard-backend

      # Security middlewares
      - traefik.http.routers.dashboard-beyla-otlp.middlewares=beyla-ipallow,beyla-ratelimit
      - traefik.http.middlewares.beyla-ipallow.ipallowlist.sourcerange=10.0.0.0/8,172.16.0.0/12,192.168.0.0/16
      - traefik.http.middlewares.beyla-ratelimit.ratelimit.average=100
      - traefik.http.middlewares.beyla-ratelimit.ratelimit.burst=200
```

## Required App Configuration

Set dashboard external URL so generated OTLP defaults use HTTPS host:

```env
DASHBOARD_EXTERNAL_URL=https://dashboard.example.com
TRACES_INGESTION_ENABLED=true
TRACES_INGESTION_API_KEY=your-secret-api-key-here
```

## Beyla Exporter Settings

```env
OTEL_EXPORTER_OTLP_ENDPOINT=https://dashboard.example.com/api/traces/otlp
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_HEADERS=X-API-Key=your-secret-api-key-here
OTEL_METRICS_EXPORTER=none
```

## Verification

```bash
curl -X POST https://dashboard.example.com/api/traces/otlp/v1/traces \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-api-key-here" \
  -d '{"resourceSpans":[]}'
```

Expected response:

```json
{"accepted":0}
```

## Notes

- Replace `dashboard.example.com` with your real domain.
- Restrict `ipallowlist` CIDRs to known Beyla endpoint networks.
- Keep backend API port `3051` private when using this pattern.
