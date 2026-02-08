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

```mermaid
graph TB
    subgraph External["External Services"]
        Portainer["Portainer API<br/><i>Container Management</i>"]
        Ollama["Ollama<br/><i>Local LLM (llama3.2)</i>"]
        Kibana["Elasticsearch / Kibana<br/><i>Log Aggregation (optional)</i>"]
    end

    subgraph Frontend["Frontend — React 19 + Vite 6 :5173"]
        direction TB
        Router["React Router v7<br/><i>18 lazy-loaded pages</i>"]

        subgraph Pages["Pages"]
            direction LR
            P1["Home<br/>Fleet Overview<br/>Workload Explorer<br/>Stack Overview"]
            P2["Container Detail<br/>Container Health<br/>Image Footprint<br/>Network Topology"]
            P3["AI Monitor<br/>Metrics Dashboard<br/>Remediation<br/>Trace Explorer"]
            P4["LLM Assistant<br/>Edge Logs<br/>Packet Capture<br/>Settings"]
        end

        subgraph FState["State Management"]
            RQ["TanStack React Query 5<br/><i>Server state & caching</i>"]
            Zustand["Zustand 5<br/><i>UI state (theme, sidebar,<br/>notifications, filters)</i>"]
        end

        subgraph FRealtime["Real-Time"]
            SIOClient["Socket.IO Client<br/><i>3 namespaces</i>"]
        end

        subgraph FUI["UI Layer"]
            Radix["Radix UI<br/><i>Accessible components</i>"]
            Recharts["Recharts<br/><i>Charts & metrics</i>"]
            XYFlow["XYFlow<br/><i>Network topology</i>"]
            Tailwind["Tailwind CSS v4<br/><i>Glassmorphism theme</i>"]
        end

        Router --> Pages
        Pages --> FState
        Pages --> FRealtime
        Pages --> FUI
    end

    subgraph Backend["Backend — Fastify 5 + TypeScript :3001"]
        direction TB
        API["REST API<br/><i>Auth, Containers, Metrics,<br/>Monitoring, Remediation,<br/>Settings, Logs, Traces</i>"]

        subgraph Sockets["Socket.IO Namespaces"]
            direction LR
            NSllm["/llm<br/><i>Chat streaming</i>"]
            NSmon["/monitoring<br/><i>Live insights</i>"]
            NSrem["/remediation<br/><i>Action updates</i>"]
        end

        subgraph Services["Services"]
            direction LR
            PortClient["Portainer Client<br/><i>Retry + backoff</i>"]
            Cache["Response Cache<br/><i>TTL-based</i>"]
            LLMClient["LLM Client<br/><i>Ollama SDK</i>"]
            AnomalyDet["Anomaly Detection<br/><i>Multi-method (Z-score,<br/>Bollinger, Adaptive, IF)</i>"]
            MonService["Monitoring Service<br/><i>Insight generation</i>"]
            MetricsCol["Metrics Collector<br/><i>CPU/memory stats</i>"]
        end

        subgraph Scheduler["Background Scheduler"]
            direction LR
            J1["Metrics Collection<br/><i>Every 60s</i>"]
            J2["Monitoring Cycle<br/><i>Every 5min</i>"]
            J3["Cleanup<br/><i>Daily</i>"]
        end

        subgraph Data["Data Layer"]
            SQLite["SQLite + WAL<br/><i>better-sqlite3</i>"]
        end

        API --> Services
        Sockets --> Services
        Scheduler --> Services
        Services --> Data
    end

    subgraph DB["Database Schema (7 tables)"]
        direction LR
        T1["sessions"]
        T2["settings"]
        T3["insights"]
        T4["metrics"]
        T5["actions"]
        T6["spans"]
        T7["audit_log"]
    end

    %% Frontend to Backend connections
    RQ -- "HTTP /api/*" --> API
    SIOClient -- "WebSocket" --> Sockets

    %% Backend to External connections
    PortClient -- "REST API" --> Portainer
    LLMClient -- "Ollama API" --> Ollama
    API -. "Optional" .-> Kibana

    %% Database
    SQLite --> DB

    %% Styling
    classDef external fill:#f0f4ff,stroke:#4a6fa5,stroke-width:2px,color:#1a2a3a
    classDef frontend fill:#dbeafe,stroke:#3b82f6,stroke-width:2px,color:#1e3a5f
    classDef backend fill:#dcfce7,stroke:#22c55e,stroke-width:2px,color:#14532d
    classDef data fill:#fef3c7,stroke:#f59e0b,stroke-width:2px,color:#78350f
    classDef scheduler fill:#f3e8ff,stroke:#a855f7,stroke-width:2px,color:#581c87

    class Portainer,Ollama,Kibana external
    class Router,RQ,Zustand,SIOClient,Radix,Recharts,XYFlow,Tailwind frontend
    class API,NSllm,NSmon,NSrem,PortClient,Cache,LLMClient,AnomalyDet,MonService,MetricsCol backend
    class J1,J2,J3 scheduler
    class SQLite,T1,T2,T3,T4,T5,T6,T7 data
```

## Data Flow

```mermaid
sequenceDiagram
    participant Browser
    participant Frontend as Frontend<br/>(React + Vite)
    participant API as Backend API<br/>(Fastify)
    participant WS as Socket.IO
    participant Scheduler as Scheduler
    participant Portainer
    participant Ollama
    participant DB as SQLite

    Note over Browser,DB: Authentication Flow
    Browser->>Frontend: Login
    Frontend->>API: POST /api/auth/login
    API->>DB: Create session
    API-->>Frontend: JWT token
    Frontend-->>Browser: Redirect to dashboard

    Note over Browser,DB: Dashboard Data Flow
    Browser->>Frontend: Navigate to page
    Frontend->>API: GET /api/containers
    API->>Portainer: Fetch containers
    Portainer-->>API: Container data
    API-->>Frontend: Normalized response
    Frontend-->>Browser: Render UI

    Note over Browser,DB: Real-Time Monitoring
    Scheduler->>Portainer: Collect metrics (every 60s)
    Portainer-->>Scheduler: CPU/memory stats
    Scheduler->>DB: Store metrics
    Scheduler->>Scheduler: Run anomaly detection (every 5min)
    Scheduler->>DB: Store insights
    Scheduler->>WS: Broadcast new insights
    WS-->>Frontend: Push to /monitoring namespace
    Frontend-->>Browser: Update UI in real-time

    Note over Browser,DB: AI Chat Flow
    Browser->>Frontend: Send chat message
    Frontend->>WS: Emit to /llm namespace
    WS->>Portainer: Fetch infrastructure context
    WS->>Ollama: Stream LLM response
    Ollama-->>WS: Token stream
    WS-->>Frontend: Stream tokens
    Frontend-->>Browser: Render markdown response
```

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
├── docker-compose.yml              # Production (Nginx + Node)
├── docker-compose.dev.yml          # Development (hot-reload)
├── workloads/                       # Multi-stack test workload compose files
│   ├── data-services.yml            #   Postgres, Redis, RabbitMQ
│   ├── web-platform.yml             #   Web tier + API gateway + cron
│   ├── workers.yml                  #   Workers + app-api + app-worker-queue
│   ├── staging-dev.yml              #   Staging + dev environments + monitoring
│   └── issue-simulators.yml         #   Issue containers + heavy-load stress
└── .github/workflows/ci.yml        # CI: typecheck → lint → test → build
```
