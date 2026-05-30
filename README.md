# AI Portainer Dashboard

*Intelligent container monitoring that extends Portainer with AI-powered insights, anomaly detection, and a real-time chat assistant.*

[![CI](https://github.com/kenhaesler/ai-portainer-dashboard/actions/workflows/ci.yml/badge.svg)](https://github.com/kenhaesler/ai-portainer-dashboard/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue)](https://www.typescriptlang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> **Observer-first** — This dashboard focuses on deep visibility into your container infrastructure. Some actions can be triggered through an explicit approval workflow (e.g., remediation execution).

---

## Features

- **Multi-Endpoint Fleet Management** — Connect to multiple Portainer instances from a single pane of glass
- **Real-Time Monitoring** — CPU/memory metrics collected every 60s with multi-method anomaly detection (z-score, Bollinger bands, adaptive, and Isolation Forest ML)
- **AI Intelligence** — LLM-powered insights, anomaly explanations, NLP log analysis, predictive alerting, root cause investigation, and conversational chat assistant (via Ollama, LM Studio, vLLM, LiteLLM, or any OpenAI-compatible endpoint)
- **Automated Remediation** — AI-suggested fixes with approval workflow (pending → approved → executed)
- **Network Topology** — Interactive graph visualization of container networks (XYFlow)
- **Image Footprint Analysis** — Treemap and sunburst visualizations of image sizes across your fleet
- **Distributed Tracing** — Trace explorer for request flow analysis
- **Elasticsearch Integration** — Optional Kibana/Elasticsearch log search
- **Modern UI** — Apple-inspired glassmorphism theme with light/dark modes and command palette (`Ctrl+K`)

### Data freshness & caching

A Redis-backed server cache sits between Portainer and the dashboard so background polls and auto-refresh intervals don't hammer the upstream API. Clicking **Refresh** on any page is treated as a foreground request for the latest data — it invalidates the cache for that resource and re-fetches from Portainer directly. Non-admin users still get a fresh page render (the cache-invalidate endpoint is admin-only, so non-admin clicks gracefully degrade to a plain refetch with no error toast). Auto-refresh and React Query background revalidation continue to read the cache.

---

## Architecture

This project follows a **Monorepo** structure with a **Client-Server (Full-stack)** architectural pattern:

- **Frontend:** React 19 (Vite) + Tailwind CSS v4 + TanStack Query
- **Backend:** Fastify 5 + Socket.IO, modular monolith across 9 workspace packages
- **Storage:** PostgreSQL (app state), TimescaleDB (time-series metrics), Redis (cache + sessions)
- **Design Philosophy:** **Observer-First** — focuses on deep visibility; mutating actions are gated by a remediation approval workflow.
- **AI Engine:** OpenAI-compatible LLM client (OpenAI, LM Studio, vLLM, LiteLLM, OpenWebUI, Anthropic via proxy) for insights and chat.

### At a glance

The backend is a modular monolith composed of 9 npm workspace packages under `packages/`, wired together at a single composition root:

| Package | Responsibility |
|---------|----------------|
| `@dashboard/contracts` | Shared Zod schemas, service interfaces, typed events (zero impl) |
| `@dashboard/core` | Kernel: DB, auth, config, Portainer client, caching, tracing, event bus |
| `@dashboard/ai` | LLM client, prompt-injection guard, anomaly detection, MCP bridge |
| `@dashboard/observability` | Metrics ingestion, forecasting, distributed tracing, Prometheus export |
| `@dashboard/operations` | Remediation workflow, backups, webhooks, notifications |
| `@dashboard/security` | Container scanning, PCAP, Harbor CVE sync, eBPF coverage |
| `@dashboard/infrastructure` | Edge agents, Docker log collection, Elasticsearch forwarding |
| `@dashboard/foundation` | Foundational routes (auth, containers, settings, etc.) coupled to Portainer |
| `@dashboard/server` | Composition root: DI wiring, Fastify bootstrap, background scheduler |

See [Architecture](docs/ai-instructions/architecture.md) for the dependency graph, database schema, data-flow diagrams, and the background scheduler.

### Tech stack

| Layer | Technologies |
|-------|--------------|
| Frontend | React 19.2 (+ React Compiler), Vite 8, TypeScript 6, Tailwind CSS 4, TanStack Query/Table/Virtual, Zustand, Radix UI, Recharts, Framer Motion, Socket.IO client |
| Backend | Node ≥ 22, Fastify 5.8, Socket.IO 4.8, `jose` (JWT), `openid-client` v6 (OIDC/PKCE), `pg` 8 |
| Storage | PostgreSQL (app), TimescaleDB (metrics hypertables + continuous aggregates), Redis (cache + sessions) |
| Testing | Vitest 4 (unit/integration), Playwright 1.60 (E2E) |

---

## Quick Start

### Prerequisites

- **Docker & Docker Compose** (recommended) or **Node.js >= 22**
- A **Portainer** instance with an API key ([how to create one](https://docs.portainer.io/api/access))

### 1. Clone and configure

```bash
git clone https://github.com/kenhaesler/ai-portainer-dashboard.git
cd ai-portainer-dashboard
cp docker/.env.example .env
```

Edit `.env` with your Portainer credentials:

```ini
PORTAINER_API_URL=http://host.docker.internal:9000
PORTAINER_API_KEY=ptr_your_token_here
```

> **Tip**: Use `host.docker.internal` instead of `localhost` when Portainer runs on your host machine. Inside Docker containers, `localhost` refers to the container itself.

### 2. Start the application

**Production** (frontend served via Nginx on port 8080):

```bash
docker compose up -d
```

**Development** (hot-reload on ports 5273 + 3051):

```bash
docker compose -f docker/docker-compose.dev.yml up -d
```

**Production behind Traefik 443** (for Beyla OTLP via reverse proxy):

```bash
docker compose -f docker/docker-compose.yml -f docker/docker-compose.traefik-otlp.yml up -d
```

**With monitoring** (Prometheus + Grafana):

```bash
docker compose -f docker/docker-compose.yml -f docker/docker-compose.monitoring.yml up -d
# Grafana: http://127.0.0.1:3001 (admin / $GRAFANA_ADMIN_PASSWORD)
```

Requires `PROMETHEUS_BEARER_TOKEN` and `GRAFANA_ADMIN_PASSWORD` in `.env`. See [Architecture](docs/ai-instructions/architecture.md) for details and external-stack integration.

Production compose security note:
- Backend API (`:3051`) is bound to `127.0.0.1` only in `docker/docker-compose.yml`.
- Browser/API traffic should enter through frontend nginx on `:8080` (`/api/*` and `/socket.io/*` are proxied internally to `backend:3051`).
- For host-local debugging, use `curl http://127.0.0.1:3051/health`.
- For remote debugging, use an authenticated tunnel (for example SSH local forward) instead of exposing `:3051` publicly.

**Without Docker:**

```bash
npm install
npm run dev
```

### 3. Connect an OpenAI-compatible LLM endpoint (for AI features)

The dashboard uses any OpenAI-compatible chat-completions API: OpenAI, LM Studio, vLLM, LiteLLM, OpenWebUI, Anthropic via proxy, etc. None of these are bundled in the Docker Compose stack — point the dashboard at one with `LLM_API_URL` (and optionally `LLM_API_TOKEN`):

```bash
# In your .env (or Settings → AI & LLM → API Endpoint URL):
LLM_API_URL=http://lmstudio:1234        # /v1/chat/completions is appended automatically
LLM_API_TOKEN=sk-...                    # optional
LLM_MODEL=gpt-4o-mini                   # default model name
```

Security defaults for self-hosted LLM servers:
- Do not expose your LLM endpoint on `0.0.0.0` without authentication.
- Preferred default is localhost-only binding or an internal Docker network.
- If remote access is required, place the LLM endpoint behind an authenticated reverse proxy or bastion and set `LLM_API_URL` to that protected endpoint.

**Ollama example** — bind to localhost only:

```bash
OLLAMA_HOST=127.0.0.1:11434 ollama serve
```

Do not expose Ollama on `0.0.0.0` without authentication.

### 4. Access the dashboard

| Mode | URL |
|------|-----|
| Production | http://localhost:8080 |
| Development | http://localhost:5273 |

Default credentials: `admin` / `changeme123`

### Troubleshooting

| Symptom | Likely cause & fix |
|---------|--------------------|
| Dashboard loads but no containers/endpoints appear | Portainer API unreachable. Verify `PORTAINER_API_URL` and `PORTAINER_API_KEY`; from inside Docker use `host.docker.internal` (not `localhost`). Check `curl http://127.0.0.1:3051/health/ready`. |
| AI chat / insights silent or "LLM unavailable" | LLM endpoint not reachable. Run **Settings → AI & LLM → Test Connection**, confirm `LLM_API_URL` (don't append `/v1/chat/completions` — it's added automatically), and that the endpoint isn't bound to an unauthenticated `0.0.0.0`. |
| Backend exits on startup in production | `NODE_ENV=production` refuses to start when `JWT_SECRET` is the default or < 32 chars. Set a strong `JWT_SECRET` and the `POSTGRES_APP_PASSWORD` / `TIMESCALE_PASSWORD` vars. |
| No metrics / charts stay empty | PostgreSQL or TimescaleDB connection refused, or metrics still warming up (collection runs every 60s; anomaly baselines need ~10 samples). Check the `postgres-app` and `timescaledb` containers are healthy. |

---

## Navigation

| Section | Pages | Description |
|---------|-------|-------------|
| **Overview** | Home, Workload Explorer, Fleet Overview, Stack Overview | High-level infrastructure visibility |
| **Containers** | Health & Monitoring, Image Footprint, Network Topology | Container-level health, inspection, and analysis |
| **Intelligence** | Metrics Dashboard, Remediation, Trace Explorer, LLM Assistant | AI-powered monitoring and interaction |
| **Operations** | Edge Agent Logs, Packet Capture, Settings | Operational tools and configuration |

### UI Features

- **Command Palette** — `Ctrl+K` / `Cmd+K` or `/` for global search across containers, images, stacks, and logs
- **Collapsible Sidebar** — Click section headers to expand/collapse navigation groups
- **Theme Toggle** — Glass Light and Glass Dark themes with Catppuccin variants
- **Auto-Refresh** — Configurable automatic data refresh across all views
- **CSV Export** — Export table data for external analysis
- **Responsive Layout** — Desktop and tablet optimized

---

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/architecture.md) | System diagrams, route map, tech stack, project structure |
| [API Reference](docs/api-reference.md) | REST endpoints and WebSocket namespaces |
| [Configuration](docs/configuration.md) | All environment variables with defaults |
| [AI & Anomaly Detection](docs/ai-anomaly-detection.md) | Statistical detection, Isolation Forest, predictive alerting, NLP log analysis, smart alert grouping |
| [MCP / Kali Lab Setup](docs/mcp-kali-setup.md) | Claude Code MCP integration and smoke test prompts |
| [Test Workloads](docs/test-workloads.md) | Multi-stack test containers for development |
| [eBPF Trace Ingestion](docs/ebpf-trace-ingestion.md) | Beyla integration for distributed tracing |
| [TimescaleDB Backups](docs/timescaledb-backup.md) | Backup schedule, retention, manual backup, and restore workflow |
| [Time-Series Storage Research](docs/time-series-storage-research.md) | Scaling metrics storage beyond SQLite |

---

## Development

```bash
npm install                # Install all dependencies (both workspaces)
npm run dev                # Development (hot-reload for both workspaces)
npm run build              # Build everything
npm run lint               # Lint
npm run typecheck          # Type check
npm test                   # Run all tests
npm run test -w backend    # Tests for backend only
npm run test -w frontend   # Tests for frontend only
npm run test:watch         # Watch mode
```

Docker development (preferred):

```bash
docker compose -f docker/docker-compose.dev.yml up -d
```

See [Test Workloads](docs/test-workloads.md) for deploying realistic test containers.

### CI Pipeline

GitHub Actions runs on every push to `main` and all pull requests:

1. **Test** — TypeScript type check → lint → backend tests → frontend tests
2. **Build** — Builds both workspaces (depends on test passing)

### Git Workflow

- Never push directly to `main` — all changes go through feature branches and pull requests
- Branch naming: `feature/<issue#>-<short-description>` (e.g., `feature/42-add-log-export`)
- CI must pass before merge

---

## License

MIT
