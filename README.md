# Container-Infrastructure

*Powered by AI*

An intelligent container monitoring platform that extends Portainer with AI-powered insights, anomaly detection, and a modern glassmorphism UI.

## Features

- **Multi-Endpoint Management** - Connect to multiple Portainer instances
- **Real-time Monitoring** - CPU/memory metrics with anomaly detection
- **AI Intelligence** - LLM-powered insights and chat assistant (Ollama)
- **Automated Remediation** - AI-suggested fixes for detected issues
- **Network Topology** - Visual container network diagrams
- **Image Footprint** - Treemap and sunburst visualizations of image sizes
- **Fleet Overview** - Bird's eye view of all endpoints and containers
- **Modern UI** - Apple-inspired glassmorphism theme with light/dark modes

> **Note**: This dashboard is **observer-only** - it provides visibility into your container infrastructure without the ability to start, stop, or restart containers.

## Screenshots

| Light Theme | Dark Theme |
|-------------|------------|
| Glassmorphism with soft gradients | Deep space aesthetic with glowing elements |

## Tech Stack

| Layer | Technologies |
|-------|-------------|
| **Frontend** | React 19, TypeScript, Vite, Tailwind CSS v4, TanStack Query |
| **Backend** | Fastify 5, TypeScript, SQLite, Socket.IO |
| **AI** | Ollama (local LLM) |
| **UI** | Radix UI, Recharts, cmdk, Lucide Icons |

## Quick Start

### Prerequisites

- Docker & Docker Compose
- A Portainer instance with an API key

### 1. Clone and configure

```bash
git clone https://github.com/kenhaesler/ai-portainer-dashboard.git
cd ai-portainer-dashboard
cp .env.example .env
```

Edit `.env` with your Portainer credentials:
```
PORTAINER_API_URL=http://host.docker.internal:9000
PORTAINER_API_KEY=ptr_your_token_here
```

> **Note**: Use `host.docker.internal` instead of `localhost` when Portainer runs on your host machine. Inside Docker containers, `localhost` refers to the container itself, not the host.

### 2. Start the application

**Production:**
```bash
docker compose up -d
```

**Development:**
```bash
docker compose -f docker-compose.dev.yml up -d
```

### 3. Pull the LLM model (for AI features)

```bash
docker compose exec ollama ollama pull llama3.2
```

### 4. Access the dashboard

| Mode | URL |
|------|-----|
| Production | http://localhost:8080 |
| Development | http://localhost:5173 |

**Login**: `admin` / `changeme123`

## Navigation

| Section | Pages |
|---------|-------|
| **Overview** | Home, Workload Explorer, Fleet Overview, Stack Overview |
| **Containers** | Container Health, Image Footprint, Network Topology |
| **Intelligence** | AI Monitor, Metrics Dashboard, Remediation, Trace Explorer, LLM Assistant |
| **Operations** | Edge Agent Logs, Settings |

## UI Features

- **Command Palette** - Press `Cmd+K` (Mac) or `Ctrl+K` (Windows/Linux) for quick navigation
- **Collapsible Sidebar** - Click group headers to collapse/expand sections
- **Theme Toggle** - Switch between Glass Light and Glass Dark themes
- **Responsive Design** - Works on desktop and tablet devices

## Dummy Workload for Testing

A dummy workload is provided to test the dashboard with realistic containers.

### Workload Containers

| Container | Image | Purpose |
|-----------|-------|---------|
| web-frontend | nginx:alpine | Frontend web server |
| web-backend-1/2 | httpd:alpine | Backend servers |
| db-postgres | postgres:16-alpine | Primary database |
| db-redis | redis:7-alpine | Cache layer |
| mq-rabbitmq | rabbitmq:3-management | Message queue |
| worker-1/2 | alpine | Background workers |
| monitoring-prometheus | prom/prometheus | Metrics collection |
| staging-web | nginx:alpine | Staging environment |
| staging-api | httpd:alpine | Staging API |
| dev-web | nginx:alpine | Development environment |
| unhealthy-service | alpine | Intentionally failing (test alerts) |
| cpu-stress | alpine | CPU load generator (test metrics) |
| stopped-service | alpine | Exits immediately (test states) |

### Deploy Workload to Portainer

```bash
# Deploy/start the workload stack
./scripts/deploy-workload.sh start

# Check status
./scripts/deploy-workload.sh status

# Stop the stack
./scripts/deploy-workload.sh stop

# Remove the stack completely
./scripts/deploy-workload.sh delete
```

The script reads `PORTAINER_API_URL` and `PORTAINER_API_KEY` from your `.env` file.

## Development

### Running Tests

```bash
# Backend tests
docker compose -f docker-compose.dev.yml exec backend npm test

# Frontend tests
docker compose -f docker-compose.dev.yml exec frontend npm test
```

### Project Structure

```
ai-portainer-dashboard/
├── backend/               # Fastify API server
│   ├── src/
│   │   ├── routes/        # API endpoints
│   │   ├── services/      # Business logic
│   │   ├── sockets/       # WebSocket handlers
│   │   └── db/            # SQLite migrations
│   └── Dockerfile
├── frontend/              # React SPA
│   ├── src/
│   │   ├── pages/         # Page components
│   │   ├── components/    # Reusable components
│   │   ├── hooks/         # Custom React hooks
│   │   ├── stores/        # Zustand state
│   │   └── providers/     # Context providers
│   └── Dockerfile
├── scripts/
│   └── deploy-workload.sh # Workload deploy script
├── docker-compose.yml     # Production
├── docker-compose.dev.yml # Development
└── docker-compose.workload.yml # Test workload
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORTAINER_API_URL` | Portainer instance URL | `http://host.docker.internal:9000` |
| `PORTAINER_API_KEY` | Portainer API key | (required) |
| `DASHBOARD_USERNAME` | Dashboard login username | `admin` |
| `DASHBOARD_PASSWORD` | Dashboard login password | `changeme123` |
| `OLLAMA_MODEL` | LLM model for AI features | `llama3.2` |
| `MONITORING_ENABLED` | Enable background monitoring | `true` |
| `METRICS_COLLECTION_ENABLED` | Enable metrics collection | `true` |

See `.env.example` for all available options.

## License

MIT
