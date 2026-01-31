# AI Portainer Dashboard v2 - Continuation Plan

## Current State (as of commit 921162d)

### What's Done
- **Backend**: Fully functional Fastify v5 API with 13 route modules, 14 services, 3 Socket.IO namespaces, SQLite + 7 migrations, JWT auth, Portainer API integration
- **Frontend scaffolding**: React 19 + Vite + Tailwind v4, providers (auth/query/socket/theme), Zustand stores, 14 TanStack Query hooks, shared components (data-table, kpi-card, status-badge, charts), layout (sidebar/header/command-palette)
- **Infrastructure**: Docker multi-stage builds, nginx reverse proxy, docker-compose running
- **Verified working**: Login flow, `/api/dashboard/summary`, `/api/containers`, `/api/endpoints`, health checks, Portainer CE integration, Ollama on host

### What's NOT Done
All 14 page files (`frontend/src/pages/*.tsx`) are **stubs** showing "Coming soon". They need real UI implementations that use the existing hooks and components.

---

## Pages to Implement (priority order)

### Tier 1 - Core Pages (implement first)

#### 1. Home Dashboard (`home.tsx`)
- **Hook**: `use-dashboard.ts` → `GET /api/dashboard/summary`
- **Components to use**: `KpiCard` (endpoints, running, stopped, stacks), `ContainerStatePie`, `EndpointStatusBar`, `WorkloadDistribution`
- **Layout**: 4 KPI cards top row, 3 chart cards below, recent containers table at bottom
- **Data shape**: `{ kpis: { endpoints, endpointsUp, endpointsDown, running, stopped, healthy, unhealthy, total, stacks }, endpoints: NormalizedEndpoint[], recentContainers: NormalizedContainer[] }`

#### 2. Workload Explorer (`workload-explorer.tsx`)
- **Hook**: `use-containers.ts` → `GET /api/containers?endpointId=X`
- **Components**: `DataTable` with columns: name, image, state (StatusBadge), status, endpoint, created
- **Features**: Endpoint selector dropdown, search/filter, start/stop/restart actions (use mutations from hook), auto-refresh toggle
- **Actions**: ConfirmDialog for stop/restart, toast on success/error

#### 3. Fleet Overview (`fleet-overview.tsx`)
- **Hook**: `use-endpoints.ts` → `GET /api/endpoints`
- **Components**: Cards grid or table showing each endpoint with status, container counts, CPU/memory
- **Features**: Endpoint status indicators, click to drill into containers

#### 4. Container Health (`container-health.tsx`)
- **Hook**: `use-containers.ts` (filter for running), `use-metrics.ts` for per-container stats
- **Components**: `MetricsLineChart`, `StatusBadge`
- **Features**: Container detail panel with CPU/memory charts, health status

#### 5. Container Logs (`container-logs.tsx`)
- **Hook**: `use-container-logs.ts` → `GET /api/containers/:endpointId/:containerId/logs`
- **Layout**: Endpoint + container selector at top, log viewer with monospace text below
- **Features**: Tail count selector, search within logs, auto-scroll, timestamp toggle

### Tier 2 - Intelligence Pages

#### 6. LLM Assistant (`llm-assistant.tsx`)
- **Hook**: `use-llm-chat.ts` (Socket.IO based streaming)
- **Layout**: Chat interface with message history, input at bottom, markdown rendering
- **Components**: `react-markdown` + `rehype-highlight` for code blocks
- **Features**: Send message, streaming response display, cancel button, context about infrastructure

#### 7. AI Monitor (`ai-monitor.tsx`)
- **Hook**: `use-monitoring.ts` → REST + Socket.IO `/monitoring` namespace
- **Layout**: Live insight feed with severity badges, expandable cards
- **Features**: Severity filter (critical/warning/info), real-time updates via socket, insight details

#### 8. Metrics Dashboard (`metrics-dashboard.tsx`)
- **Hook**: `use-metrics.ts` → `GET /api/metrics/:containerId`
- **Components**: `MetricsLineChart`, `AnomalySparkline`
- **Layout**: Container selector, time range picker, multiple metric charts (CPU, memory, network)
- **Features**: Anomaly highlighting, zoom, export CSV

#### 9. Remediation (`remediation.tsx`)
- **Hook**: `use-remediation.ts` → CRUD actions with approve/reject/execute
- **Layout**: Table of remediation actions with status workflow
- **Features**: Approve/reject buttons, execute with ConfirmDialog, status badges, real-time updates via socket

### Tier 3 - Infrastructure Pages

#### 10. Network Topology (`network-topology.tsx`)
- **Hook**: `use-containers.ts` + dedicated API for networks
- **Components**: `TopologyGraph` (React Flow), `ContainerNode`, `NetworkNode`
- **Features**: Interactive node graph, zoom/pan, container details on click

#### 11. Image Footprint (`image-footprint.tsx`)
- **Hook**: Needs API for images (already in portainer-client: `getImages`)
- **Components**: `ImageTreemap`, `ImageSunburst`
- **Features**: Image size breakdown, layer analysis, tag listing

#### 12. Trace Explorer (`trace-explorer.tsx`)
- **Hook**: `use-traces.ts` → `GET /api/traces`
- **Components**: `ServiceMap`, trace timeline (Gantt-style spans)
- **Features**: Trace list with search, span details, service map visualization

### Tier 4 - Settings & Logs

#### 13. Settings (`settings.tsx`)
- **Hook**: `use-settings.ts` → `GET/PUT /api/settings`
- **Layout**: Form sections for monitoring interval, anomaly thresholds, cache TTL, Ollama config
- **Features**: Save button, validation, restart notification

#### 14. Edge Agent Logs (`edge-agent-logs.tsx`)
- **Hook**: `use-kibana-logs.ts` (Kibana/Elasticsearch integration)
- **Layout**: Log search interface, query builder, results table
- **Note**: This depends on Kibana being available - can show a "not configured" state

---

## Implementation Approach

### For each page:
1. Read the existing hook to understand the data shape
2. Read the existing shared components to reuse them
3. Build the page composing hooks + components + minimal new UI
4. No new backend changes needed - all APIs are already implemented

### Build & test cycle:
```bash
# After editing pages, rebuild frontend only:
docker compose build frontend && docker compose up -d
```

### Key files to reference:
- **Hooks**: `frontend/src/hooks/use-*.ts` - all 14 hooks with query keys and data shapes
- **Shared components**: `frontend/src/components/shared/` - reusable UI pieces
- **Chart components**: `frontend/src/components/charts/` - 8 chart components
- **Network components**: `frontend/src/components/network/` - React Flow topology
- **API client**: `frontend/src/lib/api.ts` - typed HTTP client
- **Backend routes**: `backend/src/routes/*.ts` - response shapes for all endpoints
- **Backend normalizers**: `backend/src/services/portainer-normalizers.ts` - data shapes

### Parallel implementation strategy:
Pages can be implemented in parallel batches using background agents:
- **Batch 1**: home.tsx + workload-explorer.tsx + fleet-overview.tsx (core data views)
- **Batch 2**: container-logs.tsx + container-health.tsx + llm-assistant.tsx
- **Batch 3**: ai-monitor.tsx + metrics-dashboard.tsx + remediation.tsx
- **Batch 4**: network-topology.tsx + image-footprint.tsx + trace-explorer.tsx + settings.tsx + edge-agent-logs.tsx

---

## Known Issues to Fix

1. **Duplicate endpoints**: Portainer shows 2 endpoints both named "local" (IDs 3 and 4) - the Portainer setup created a duplicate. Can be cleaned via Portainer UI at http://localhost:9000
2. **Rate limiting on login**: 5 req/min on `/api/auth/login` - can hit during testing
3. **Frontend build skips TypeScript**: Build uses `vite build` not `tsc -b && vite build` - there may be type errors in stubs that only surface at dev time

---

## Resume Command

To continue from this plan, tell Claude:
```
Please implement the frontend pages following the plan in .claude/plans/continuation-plan.md.
Start with Tier 1 (home, workload-explorer, fleet-overview, container-health, container-logs),
then Tier 2, etc. Use background agents in parallel batches.
After each batch, rebuild frontend and verify.
```
