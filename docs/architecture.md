# Architecture

## Architecture Map (Route → Service/Data)

Backend request flow is organized by route modules, with most Portainer-facing routes using the Portainer client + cache/normalizers. Monitoring and metrics read/write directly to SQLite.

| Route Area | Primary Routes | Service/Data Dependencies |
|---|---|---|
| Auth | `/api/auth/*` | `services/session-store.ts`, `services/audit-logger.ts` |
| OIDC | `/api/auth/oidc/*` | `services/oidc.ts`, `services/session-store.ts`, `services/audit-logger.ts` |
| Dashboard | `/api/dashboard/summary` | `services/portainer-client.ts`, `services/portainer-cache.ts`, `services/portainer-normalizers.ts` |
| Endpoints | `/api/endpoints*` | `services/portainer-client.ts`, `services/portainer-cache.ts`, `services/portainer-normalizers.ts` |
| Containers | `/api/containers*` | `services/portainer-client.ts`, `services/portainer-cache.ts`, `services/portainer-normalizers.ts` |
| Container Logs | `/api/containers/:eid/:cid/logs` | `services/portainer-client.ts` |
| Images | `/api/images*` | `services/portainer-client.ts`, `services/portainer-cache.ts`, `services/portainer-normalizers.ts` |
| Networks | `/api/networks*` | `services/portainer-client.ts`, `services/portainer-cache.ts`, `services/portainer-normalizers.ts` |
| Stacks | `/api/stacks*` | `services/portainer-client.ts`, `services/portainer-cache.ts`, `services/portainer-normalizers.ts` |
| Search | `/api/search` | `services/portainer-client.ts`, `services/portainer-cache.ts`, `services/portainer-normalizers.ts` |
| Metrics | `/api/metrics*` | SQLite via `db/sqlite.ts` |
| Monitoring | `/api/monitoring/*` | SQLite via `db/sqlite.ts` |
| Remediation | `/api/remediation/*` | `services/portainer-client.ts`, `services/audit-logger.ts`, SQLite |
| Settings | `/api/settings*` | SQLite via `db/sqlite.ts`, `services/audit-logger.ts` |
| Logs | `/api/logs/*` | `services/notification-service.ts` (test), optional external log backend |
| Traces | `/api/traces*` | SQLite via `db/sqlite.ts` |
| Investigations | `/api/investigations*` | `services/investigation-store.ts` (SQLite) |
| Backup | `/api/backup*` | `services/audit-logger.ts`, filesystem |
| Cache Admin | `/api/admin/cache/*` | `services/portainer-cache.ts`, `services/audit-logger.ts` |
| PCAP | `/api/pcap/*` | `services/pcap-service.ts`, `services/audit-logger.ts` |

## System Overview

<div align="left">

```mermaid
graph LR
    subgraph Frontend["&nbsp; Frontend — React 19 + Vite 6 :5273 &nbsp;"]
        direction TB
        Router["React Router v7<br/><i>28 lazy-loaded pages</i>"]

        subgraph Pages["&nbsp; Pages &nbsp;"]
            direction LR
            P1["Home<br/>Fleet Overview"]
            P2["Workload Explorer<br/>Stack Overview"]
            P3["Container Detail<br/>Container Health"]
            P4["Container Comparison<br/>Image Footprint"]
            P5["Network Topology<br/>AI Monitor"]
            P6["Metrics Dashboard<br/>Remediation"]
            P7["Trace Explorer<br/>LLM Assistant"]
            P8["LLM Observability<br/>Edge Logs"]
            P9["Log Viewer<br/>Packet Capture"]
            P10["Investigations<br/>Investigation Detail"]
            P11["Security Audit<br/>Status Page"]
            P12["Webhooks<br/>Users"]
            P13["Backups<br/>Reports"]
            P14["Settings<br/>Login"]
        end

        subgraph FState["&nbsp; State &nbsp;"]
            direction LR
            RQ["TanStack Query 5<br/><i>Server state</i>"]
            Zustand["Zustand 5<br/><i>UI state</i>"]
            SIOClient["Socket.IO<br/><i>3 namespaces</i>"]
        end

        subgraph FUI["&nbsp; UI Layer &nbsp;"]
            direction LR
            Radix["Radix UI"]
            Recharts["Recharts"]
            XYFlow["XYFlow"]
            Tailwind["Tailwind v4"]
        end

        Router --> Pages
        Pages --> FState
        Pages --> FUI
    end

    subgraph Backend["&nbsp; Backend — Fastify 5 + TypeScript :3051 &nbsp;"]
        direction TB
        API["REST API<br/><i>34 route modules</i>"]

        subgraph Sockets["&nbsp; Socket.IO &nbsp;"]
            direction LR
            NSllm["/llm"]
            NSmon["/monitoring"]
            NSrem["/remediation"]
        end

        subgraph Services["&nbsp; Services — 35 modules &nbsp;"]
            direction TB
            subgraph SvcRow1[" "]
                direction LR
                SvcCore["<b>Core</b><br/>Portainer Client · Normalizers<br/>Hybrid Cache · LLM Client<br/>LLM Tools · Event Bus"]
                SvcAI["<b>AI &amp; Detection</b><br/>Anomaly Detection · Isolation Forest<br/>Anomaly Explainer · NLP Log Analyzer<br/>Predictive Alerting"]
                SvcMetrics["<b>Monitoring &amp; Metrics</b><br/>Monitoring · Metrics Collector<br/>Metric Correlator · LTTB Decimator<br/>Capacity Forecaster"]
            end
            subgraph SvcRow2[" "]
                direction LR
                SvcIncident["<b>Incidents &amp; Response</b><br/>Incident Correlator · Summarizer<br/>Alert Similarity · Investigation<br/>Remediation"]
                SvcTrace["<b>Tracing &amp; Security</b><br/>Trace Store · OTLP Transformer<br/>PCAP Service · PCAP Analysis<br/>Security Scanner · Image Staleness"]
                SvcInfra["<b>Infrastructure</b><br/>OIDC · Session Store · Audit Logger<br/>Notifications · Webhooks · Backup<br/>ES Forwarder · Kibana Client"]
            end
        end

        subgraph Scheduler["&nbsp; Scheduler &nbsp;"]
            direction LR
            J1(["Metrics<br/><i>60s</i>"])
            J2(["Monitoring<br/><i>5min</i>"])
            J3(["Cleanup<br/><i>daily</i>"])
        end

        DB[("SQLite + WAL")]

        API --> Services
        Sockets --> Services
        Scheduler --> Services
        Services --> DB
    end

    subgraph Bottom[" "]
        direction TB

        subgraph Schema["&nbsp; DB Schema — 19 tables &nbsp;"]
            direction TB
            subgraph SchemaRow1[" "]
                direction LR
                T1["sessions"]
                T2["settings"]
                T3["insights"]
                T4["metrics"]
                T5["actions"]
            end
            subgraph SchemaRow2[" "]
                direction LR
                T6["spans"]
                T7["audit_log"]
                T8["investigations"]
                T9["incidents"]
                T10["users"]
            end
            subgraph SchemaRow3[" "]
                direction LR
                T11["pcap_captures"]
                T12["webhooks"]
                T13["webhook_deliveries"]
                T14["notification_log"]
                T15["llm_traces"]
            end
            subgraph SchemaRow4[" "]
                direction LR
                T16["kpi_snapshots"]
                T17["image_staleness"]
                T18["monitoring_cycles"]
                T19["monitoring_snapshots"]
            end
        end

        subgraph External["&nbsp; External Services &nbsp;"]
            direction TB
            subgraph ExtRow1[" "]
                direction LR
                Portainer(["Portainer API"])
                Ollama(["Ollama LLM"])
            end
            subgraph ExtRow2[" "]
                direction LR
                Redis(["Redis"])
                Kibana(["Elasticsearch"])
                TimescaleDB(["TimescaleDB"])
            end
        end
    end

    %% Frontend to Backend
    RQ -- "HTTP /api/*" --> API
    SIOClient -- "WebSocket" --> Sockets

    %% Backend to External
    SvcCore -- "REST" --> Portainer
    SvcCore -- "API" --> Ollama
    SvcCore -- "cache" --> Redis
    SvcInfra -. "optional" .-> Kibana
    SvcMetrics -. "scale" .-> TimescaleDB

    %% Database
    DB --> Schema

    %% --- Styling ---
    classDef external fill:#eff6ff,stroke:#3b82f6,stroke-width:2px,color:#1e40af
    classDef frontend fill:#f0f9ff,stroke:#0ea5e9,stroke-width:1.5px,color:#0c4a6e
    classDef backend fill:#f0fdf4,stroke:#22c55e,stroke-width:1.5px,color:#14532d
    classDef scheduler fill:#faf5ff,stroke:#a855f7,stroke-width:1.5px,color:#581c87
    classDef data fill:#fffbeb,stroke:#f59e0b,stroke-width:2px,color:#78350f
    classDef invisible fill:none,stroke:none

    class Portainer,Ollama,Kibana,Redis,TimescaleDB external
    class Router,P1,P2,P3,P4,P5,P6,P7,P8,P9,P10,P11,P12,P13,P14,RQ,Zustand,SIOClient,Radix,Recharts,XYFlow,Tailwind frontend
    class API,NSllm,NSmon,NSrem backend
    class SvcCore,SvcAI,SvcMetrics,SvcIncident,SvcTrace,SvcInfra backend
    class J1,J2,J3 scheduler
    class DB,T1,T2,T3,T4,T5,T6,T7,T8,T9,T10,T11,T12,T13,T14,T15,T16,T17,T18,T19 data
    class Bottom,SvcRow1,SvcRow2,SchemaRow1,SchemaRow2,SchemaRow3,SchemaRow4,ExtRow1,ExtRow2 invisible
```

</div>

## Data Flow

<div align="left">

```mermaid
sequenceDiagram
    actor User
    participant FE as Frontend
    participant API as REST API
    participant WS as Socket.IO
    participant Sched as Scheduler
    participant Port as Portainer
    participant LLM as Ollama
    participant DB as SQLite

    rect rgba(59, 130, 246, 0.05)
        Note over User,DB: Authentication
        User->>FE: Login
        FE->>API: POST /api/auth/login
        API->>DB: Create session
        API-->>FE: JWT token
        FE-->>User: Redirect to dashboard
    end

    rect rgba(34, 197, 94, 0.05)
        Note over User,DB: Dashboard Data
        User->>FE: Navigate to page
        FE->>API: GET /api/containers
        API->>Port: Fetch containers
        Port-->>API: Container data
        API-->>FE: Normalized response
        FE-->>User: Render UI
    end

    rect rgba(168, 85, 247, 0.05)
        Note over User,DB: Real-Time Monitoring
        Sched->>Port: Collect metrics (60s)
        Port-->>Sched: CPU/memory stats
        Sched->>DB: Store metrics
        Sched->>Sched: Anomaly detection (5min)
        Sched->>DB: Store insights
        Sched->>WS: Broadcast
        WS-->>FE: Push to /monitoring
        FE-->>User: Live update
    end

    rect rgba(245, 158, 11, 0.05)
        Note over User,DB: AI Chat
        User->>FE: Send message
        FE->>WS: Emit to /llm
        WS->>Port: Fetch context
        WS->>LLM: Stream request
        LLM-->>WS: Token stream
        WS-->>FE: Stream tokens
        FE-->>User: Render markdown
    end
```

</div>

## Tech Stack

| Layer | Technologies |
|-------|-------------|
| **Frontend** | React 19, TypeScript 5.7, Vite 6, Tailwind CSS v4, TanStack Query 5, Zustand 5, React Router 7 |
| **UI Components** | Radix UI, Recharts, XYFlow, cmdk, Lucide Icons, Sonner |
| **Backend** | Fastify 5, TypeScript 5.7, Socket.IO 4, Zod, Jose (JWT), bcrypt |
| **Database** | SQLite (better-sqlite3, WAL mode) |
| **AI** | Ollama (local LLM), optional OpenWebUI support |
| **Logging** | Pino (backend), optional Elasticsearch/Kibana integration |
| **DevOps** | Docker, Docker Compose, GitHub Actions CI |
| **Testing** | Vitest, Testing Library, jsdom |

## Project Structure

```
ai-portainer-dashboard/
├── backend/                        # Fastify API server
│   └── src/
│       ├── routes/                 # REST API endpoints
│       │   ├── auth.ts             #   Authentication (login/logout/refresh)
│       │   ├── containers.ts       #   Container listing & details
│       │   ├── metrics.ts          #   Time-series metrics & anomalies
│       │   ├── monitoring.ts       #   Insights & acknowledgments
│       │   ├── remediation.ts      #   Action approval workflow
│       │   ├── settings.ts         #   Configuration & audit log
│       │   └── ...                 #   Dashboard, endpoints, images, etc.
│       ├── services/               # Business logic
│       │   ├── portainer-client.ts #   Portainer API (retry + backoff)
│       │   ├── portainer-cache.ts  #   Response caching (TTL)
│       │   ├── llm-client.ts       #   Ollama LLM integration
│       │   ├── adaptive-anomaly-detector.ts # Multi-method anomaly detection
│       │   ├── isolation-forest.ts #   Isolation Forest ML algorithm
│       │   ├── isolation-forest-detector.ts # IF model caching + detection
│       │   ├── log-analyzer.ts     #   NLP log analysis (LLM)
│       │   ├── alert-similarity.ts #   Jaccard text similarity grouping
│       │   ├── incident-correlator.ts # Alert → incident correlation
│       │   ├── incident-summarizer.ts # LLM incident summaries
│       │   ├── monitoring-service.ts#  Monitoring cycle orchestration
│       │   ├── metrics-collector.ts#   CPU/memory collection
│       │   └── ...                 #   Sessions, settings, audit, backup
│       ├── sockets/                # Socket.IO namespaces
│       │   ├── llm-chat.ts         #   /llm — streaming chat
│       │   ├── monitoring.ts       #   /monitoring — live insights
│       │   └── remediation.ts      #   /remediation — action updates
│       ├── scheduler/              # Background jobs
│       │   └── setup.ts            #   Metrics (60s), monitoring (5m), cleanup (daily)
│       ├── db/
│       │   ├── sqlite.ts           #   Database init (WAL mode)
│       │   └── migrations/         #   7 SQL migrations
│       ├── models/                 # Zod schemas & DB queries
│       ├── utils/                  # Crypto (JWT/bcrypt), logging (Pino)
│       └── plugins/                # Fastify plugins
├── frontend/                       # React SPA
│   └── src/
│       ├── pages/                  # 18 lazy-loaded page components
│       ├── components/
│       │   ├── layout/             #   App layout, header, sidebar, command palette
│       │   ├── charts/             #   Metrics, pie, bar, sparkline, treemap, sunburst
│       │   ├── container/          #   Container overview, metrics, logs viewers
│       │   ├── network/            #   XYFlow topology graph & nodes
│       │   └── shared/             #   Data table, KPI cards, badges, skeletons
│       ├── hooks/                  # TanStack React Query hooks (25 hooks)
│       ├── stores/                 # Zustand stores (theme, UI, notifications, filters)
│       ├── providers/              # Auth, Socket.IO, Theme, React Query providers
│       └── lib/                    # API client, socket manager, CSV export
├── scripts/
│   └── deploy-workload.sh          # Test workload deployment script
├── docker/                          # All Dockerfiles and compose files
│   ├── docker-compose.yml          # Production (Nginx + Node)
│   ├── docker-compose.dev.yml      # Development (hot-reload)
│   ├── docker-compose.loadtest.yml # Load testing suite
│   ├── docker-compose.security-mcp.yml # Security MCP servers
│   ├── backend/
│   │   ├── Dockerfile              # Backend production image
│   │   └── Dockerfile.dev          # Backend dev image (hot-reload)
│   ├── frontend/
│   │   ├── Dockerfile              # Frontend production image
│   │   └── Dockerfile.dev          # Frontend dev image (hot-reload)
│   ├── loadtests/
│   │   └── Dockerfile              # Load testing image
│   ├── kali-mcp/
│   │   └── Dockerfile              # Kali MCP server image
│   ├── grype-mcp/
│   │   └── Dockerfile              # Grype MCP server image
│   ├── nvd-mcp/
│   │   └── Dockerfile              # NVD MCP server image
│   ├── snyk-mcp/
│   │   └── Dockerfile              # Snyk MCP server image
│   └── beyla/
│       └── beyla.yml               # eBPF auto-instrumentation sidecar
├── workloads/                       # Multi-stack test workload compose files
│   ├── data-services.yml            #   Postgres, Redis, RabbitMQ
│   ├── web-platform.yml             #   Web tier + API gateway + cron
│   ├── workers.yml                  #   Workers + app-api + app-worker-queue
│   ├── staging-dev.yml              #   Staging + dev environments + monitoring
│   └── issue-simulators.yml         #   Issue containers + heavy-load stress
└── .github/workflows/ci.yml        # CI: typecheck → lint → test → build
```

---

## External Agent System Architecture

For documentation related to the underlying AI agent framework, which includes components like the `ModularStrategy`, multi-strategy code execution environments, and the generic model abstraction layer, please refer to the separate architecture document:

-   **[Agent System Architecture (`/ARCHITECTURE.md`)](<../ARCHITECTURE.md>)**

*Note: This document describes the general-purpose agent framework, while the documentation above describes the specific architecture of the AI Portainer Dashboard application.*
