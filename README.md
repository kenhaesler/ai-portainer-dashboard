# AI Portainer Dashboard

*Intelligent container monitoring that extends Portainer with AI-powered insights, anomaly detection, and a real-time chat assistant.*

[![CI](https://github.com/kenhaesler/ai-portainer-dashboard/actions/workflows/ci.yml/badge.svg)](https://github.com/kenhaesler/ai-portainer-dashboard/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> **Observer-first** — This dashboard focuses on deep visibility into your container infrastructure. Some actions can be triggered through an explicit approval workflow (e.g., remediation execution).

---

## Features

- **Multi-Endpoint Fleet Management** — Connect to multiple Portainer instances from a single pane of glass
- **Real-Time Monitoring** — CPU/memory metrics collected every 60s with multi-method anomaly detection (z-score, Bollinger bands, adaptive, and Isolation Forest ML)
- **AI Intelligence** — LLM-powered insights, anomaly explanations, NLP log analysis, predictive alerting, root cause investigation, and conversational chat assistant (Ollama)
- **Automated Remediation** — AI-suggested fixes with approval workflow (pending → approved → executed)
- **Network Topology** — Interactive graph visualization of container networks (XYFlow)
- **Image Footprint Analysis** — Treemap and sunburst visualizations of image sizes across your fleet
- **Distributed Tracing** — Trace explorer for request flow analysis
- **Elasticsearch Integration** — Optional Kibana/Elasticsearch log search
- **Modern UI** — Apple-inspired glassmorphism theme with light/dark modes and command palette (`Ctrl+K`)

---

## Quick Start

### Prerequisites

- **Docker & Docker Compose** (recommended) or **Node.js >= 22**
- A **Portainer** instance with an API key ([how to create one](https://docs.portainer.io/api/access))

### 1. Clone and configure

```bash
git clone https://github.com/kenhaesler/ai-portainer-dashboard.git
cd ai-portainer-dashboard
cp .env.example .env
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

**Development** (hot-reload on ports 5173 + 3001):

```bash
docker compose -f docker-compose.dev.yml up -d
```

**Without Docker:**

```bash
npm install
npm run dev
```

### 3. Start Ollama externally (for AI features)

Ollama is not bundled in the Docker Compose stack. Install and run it on your host machine:

```bash
ollama pull llama3.2
ollama serve
```

### 4. Access the dashboard

| Mode | URL |
|------|-----|
| Production | http://localhost:8080 |
| Development | http://localhost:5173 |

Default credentials: `admin` / `changeme123`

---

## Navigation

| Section | Pages | Description |
|---------|-------|-------------|
| **Overview** | Home, Workload Explorer, Fleet Overview, Stack Overview | High-level infrastructure visibility |
| **Containers** | Container Health, Image Footprint, Network Topology | Container-level inspection and analysis |
| **Intelligence** | AI Monitor, Metrics Dashboard, Remediation, Trace Explorer, LLM Assistant | AI-powered monitoring and interaction |
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
docker compose -f docker-compose.dev.yml up -d
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
