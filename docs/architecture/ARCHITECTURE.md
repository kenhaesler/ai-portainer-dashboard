# AI Portainer Dashboard — Software Architecture

> An **observer-first** container-monitoring platform that extends Portainer with real-time
> insights, anomaly detection, and an LLM chat assistant. Visibility comes first; every
> container-mutating action is gated behind RBAC **and** an explicit remediation approval.

This document is the GitHub-rendered companion to the interactive diagram in
[`architecture.html`](./architecture.html) (open it in a browser for hover-to-trace edges,
package dependency view, data flows, and deployment topology).

- **Stack:** Fastify 5 + PostgreSQL/TimescaleDB backend · React 19 + Vite frontend
- **Shape:** npm-workspace monorepo — `backend/`, `frontend/`, and nine `packages/*`
- **Realtime:** Socket.IO namespaces (`/llm`, `/monitoring`, `/remediation`)

---

## 1. System overview

How the browser, edge, backend, data stores, and external systems connect.

```mermaid
flowchart TB
  classDef client fill:#0b1f33,stroke:#38bdf8,color:#e9eefb;
  classDef edge fill:#1a1330,stroke:#a78bfa,color:#e9eefb;
  classDef core fill:#2a0f24,stroke:#f472b6,color:#e9eefb;
  classDef domain fill:#0c2620,stroke:#34d399,color:#e9eefb;
  classDef ai fill:#1f1233,stroke:#c084fc,color:#e9eefb;
  classDef data fill:#2a2208,stroke:#fbbf24,color:#e9eefb;
  classDef ext fill:#2a1218,stroke:#fb7185,color:#e9eefb;

  subgraph CLIENT["🖥️ Client · React 19 SPA"]
    SPA["React SPA<br/><small>Router · Zustand · 16 themes · Recharts</small>"]:::client
    RQ["React Query<br/><small>REST cache via api client + JWT</small>"]:::client
    WSC["Socket.IO client<br/><small>/llm /monitoring /remediation</small>"]:::client
  end

  PROXY["🛡️ Reverse Proxy<br/><small>Traefik/nginx · TLS · rate limit · OTLP allowlist</small>"]:::edge

  subgraph BACKEND["⚙️ Backend · Fastify 5"]
    SERVER["@dashboard/server<br/><small>composition root · DI wiring</small>"]:::core
    SOCK["Socket.IO server<br/><small>chat / insights / actions</small>"]:::core
    SCHED["Scheduler<br/><small>metrics 60s · monitoring 5m · cleanups</small>"]:::core
    FOUND["foundation<br/><small>15 core routes</small>"]:::domain
    AI["ai-intelligence<br/><small>LLM · prompt-guard · anomalies</small>"]:::ai
    OBS["observability<br/><small>metrics · forecasts · traces</small>"]:::domain
    SEC["security<br/><small>audit · PCAP · Harbor · eBPF</small>"]:::domain
    OPS["operations<br/><small>remediation · backup · webhooks</small>"]:::domain
    INFRA["infrastructure<br/><small>edge jobs · log forwarding</small>"]:::domain
    CORE["core kernel<br/><small>auth/RBAC · DB · Portainer client · cache</small>"]:::core
  end

  PG[("🐘 PostgreSQL<br/><small>app DB · 37 migrations</small>")]:::data
  TS[("⏳ TimescaleDB<br/><small>metrics hypertable</small>")]:::data
  REDIS[("🟥 Redis<br/><small>cache · cooldowns</small>")]:::data
  PORT["🐳 Portainer API"]:::ext
  LLM["✨ LLM API<br/><small>OpenAI-compatible / Ollama</small>"]:::ext
  HARBOR["⚓ Harbor"]:::ext
  PROM["🔥 Prometheus"]:::ext
  ES["🔎 Elasticsearch"]:::ext
  MCP["🔧 MCP servers"]:::ext
  NOTIFY["📣 Teams/Discord/Telegram/SMTP"]:::ext

  SPA --> PROXY
  RQ --> PROXY
  WSC --> PROXY
  PROXY --> SERVER
  PROXY --> SOCK

  SERVER --> FOUND & AI & OBS & SEC & OPS & INFRA
  SERVER --> SOCK & SCHED
  SOCK --> AI & OBS & OPS
  SCHED --> OBS & AI & SEC & OPS

  FOUND --> CORE
  AI --> CORE
  OBS --> CORE
  SEC --> CORE
  OPS --> CORE
  INFRA --> CORE

  CORE --> PG & TS & REDIS & PORT
  AI --> LLM & MCP
  OBS --> TS & PROM
  SEC --> HARBOR
  OPS --> NOTIFY
  INFRA --> ES
```

| Layer | Components | Responsibility |
|---|---|---|
| **Client** | React SPA, React Query, Socket.IO client | UI, REST data fetching with JWT, live streams |
| **Edge** | Traefik / nginx | TLS termination, routing, rate limiting, OTLP IP allowlist |
| **Backend** | `server`, Socket.IO, Scheduler, 5 domains + `foundation` | API surface, realtime, background jobs, domain logic |
| **Kernel** | `core`, `contracts` | Auth/RBAC, DB, Portainer client, cache, shared types |
| **Data** | PostgreSQL, TimescaleDB, Redis | App state, time-series metrics, cache |
| **External** | Portainer, LLM, Harbor, Prometheus, Elasticsearch, MCP, notifiers | Integrations |

---

## 2. Package dependency graph

The monorepo enforces a strict layering — a package may only import from layers below it.
`ai-intelligence` is deliberately **isolated** (depends only on `core` + `contracts`), and
`server` is the only composition root that wires every domain together.

```mermaid
flowchart TD
  classDef base fill:#1a1330,stroke:#a78bfa,color:#e9eefb;
  classDef kernel fill:#2a0f24,stroke:#f472b6,color:#e9eefb;
  classDef domain fill:#0c2620,stroke:#34d399,color:#e9eefb;
  classDef ai fill:#1f1233,stroke:#c084fc,color:#e9eefb;
  classDef root fill:#2a2208,stroke:#fbbf24,color:#e9eefb;

  CONTRACTS["📜 @dashboard/contracts<br/><small>Zod schemas · interfaces · events</small>"]:::base
  CORE["⚙️ @dashboard/core<br/><small>kernel: DB · auth · Portainer · cache</small>"]:::kernel
  OBS["📈 @dashboard/observability"]:::domain
  SEC["🔒 @dashboard/security"]:::domain
  OPS["🛠️ @dashboard/operations"]:::domain
  INFRA["🌐 @dashboard/infrastructure"]:::domain
  AI["🧠 @dashboard/ai<br/><small>isolated</small>"]:::ai
  FOUND["🚪 @dashboard/foundation<br/><small>15 routes</small>"]:::domain
  SERVER["🧩 @dashboard/server<br/><small>composition root</small>"]:::root

  CORE --> CONTRACTS
  OBS --> CORE
  SEC --> CORE
  OPS --> CORE
  INFRA --> CORE
  AI --> CORE
  FOUND --> CORE
  SERVER --> FOUND
  SERVER --> OBS
  SERVER --> SEC
  SERVER --> OPS
  SERVER --> INFRA
  SERVER --> AI
```

| Package | npm name | Purpose |
|---|---|---|
| **contracts** | `@dashboard/contracts` | Zod schemas, TS interfaces, typed events — zero deps |
| **core** | `@dashboard/core` | Kernel: DB pools + migrations, JWT/OIDC auth + RBAC, sessions, config, Portainer client + circuit breaker, Redis cache, audit log, event bus, OTLP tracing, Fastify plugins |
| **observability** | `@dashboard/observability` | Metrics ingest/query, ARIMA forecasts, OTLP trace ingest, RED metrics, service map, Prometheus export |
| **security** | `@dashboard/security` | Audit, container scanning, PCAP, Harbor CVE sync, image staleness, eBPF coverage |
| **operations** | `@dashboard/operations` | Remediation workflow, backup/restore, webhooks, notifications |
| **infrastructure** | `@dashboard/infrastructure` | Edge-agent jobs, async log collection, Docker frame decode, Elasticsearch forwarding |
| **ai-intelligence** | `@dashboard/ai` | LLM chat, 3-layer prompt-guard, anomaly detection, incidents, investigations, MCP bridge, prompt profiles |
| **foundation** | `@dashboard/foundation` | 15 routes: auth, OIDC, health, dashboard, containers, logs, stacks, settings, images, networks, search, users, endpoints, k8s, cache-admin |
| **server** | `@dashboard/server` | Fastify app factory, DI wiring, scheduler, Socket.IO namespaces |

---

## 3. Key data flows

### 3a. Monitoring cycle (anomaly detection)

```mermaid
sequenceDiagram
  autonumber
  participant SCH as Scheduler
  participant PC as Portainer client (core)
  participant DB as Postgres + TimescaleDB
  participant AI as ai-intelligence
  participant SK as /monitoring socket
  participant NT as Notifiers / webhooks

  SCH->>PC: collect CPU/mem/net (every 60s)
  PC->>DB: dual-write each sample (app DB + hypertable)
  SCH->>AI: run monitoring cycle (every 5m)
  AI->>DB: read baselines, run robust-MAD / isolation-forest
  AI->>DB: persist insights + incidents + investigations
  AI->>SK: broadcast insight:new
  AI->>NT: fire notifications / webhooks
```

### 3b. LLM chat assistant

```mermaid
sequenceDiagram
  autonumber
  participant U as Browser (Socket.IO /llm)
  participant G as Prompt guard
  participant L as LLM API
  participant M as MCP tools
  participant DB as Postgres

  U->>G: chat:message (authenticated)
  G->>G: 3 layers — regex → heuristic → output sanitization
  G->>L: POST /v1/chat/completions
  L-->>M: (optional) tool call e.g. read container logs
  L-->>U: chat:response (streamed tokens)
  L-->>U: chat:complete
  L->>DB: record llm_traces (+ later llm_feedback)
```

### 3c. Remediation — observer-first, gated

```mermaid
stateDiagram-v2
  [*] --> Suggested: insight proposes action
  Suggested --> Approved: admin approves (POST .../approve)
  Approved --> Executed: admin executes via Portainer client
  Suggested --> Investigate: protected container → auto-downgrade
  Approved --> Rejected: admin rejects
  Executed --> [*]: result audited + streamed on /remediation
  Rejected --> [*]
```

---

## 4. Deployment topology

All services run as hardened containers on an isolated `dashboard-net` bridge. Only the
reverse proxy is internet-facing; internal services never bind `0.0.0.0`.

```mermaid
flowchart TB
  classDef pub fill:#1a1330,stroke:#a78bfa,color:#e9eefb;
  classDef app fill:#2a0f24,stroke:#f472b6,color:#e9eefb;
  classDef data fill:#2a2208,stroke:#fbbf24,color:#e9eefb;
  classDef opt fill:#2a1218,stroke:#fb7185,color:#e9eefb,stroke-dasharray:5 4;

  NET(["🌍 Internet"])
  TRA["Traefik / Proxy · :443"]:::pub

  subgraph DNET["dashboard-net (internal bridge)"]
    FE["frontend · nginx<br/><small>127.0.0.1:8080 · hardened</small>"]:::app
    BE["backend · Fastify + OTLP<br/><small>127.0.0.1:3051 · hardened</small>"]:::app
    PGC[("postgres-app · pg17")]:::data
    TSC[("timescaledb · pg17")]:::data
    RDC[("redis:8 · 512MB LRU")]:::data
    BK[("timescale-backup<br/><small>daily cron</small>")]:::data
  end

  subgraph OPT["Optional overlays"]
    MON["Prometheus + Grafana"]:::opt
    BEYLA["Grafana Beyla · eBPF"]:::opt
    PRT["Portainer + Edge Agent"]:::opt
    KALI["Kali MCP · pentest"]:::opt
  end

  NET --> TRA --> FE
  TRA --> BE
  BE --> PGC & TSC & RDC
  TSC --> BK
  MON -.scrape /metrics.-> BE
  BEYLA -.OTLP.-> BE
  BE -.queries.-> PRT
```

**CI/CD** (`.github/workflows/ci.yml`): `audit → typecheck → lint → backend tests (real
Postgres + Redis) → frontend + Playwright E2E → docker build`. Branch policy enforced;
nightly E2E on `dev`.

---

## 5. Security model (cross-cutting)

- **Auth & RBAC** — JWT via `jose` (32+ char secret), server-side session store in Postgres,
  validated per request. OIDC/SSO via `openid-client` v6 with PKCE. Roles: `viewer` / `operator` / `admin`.
  Mutating endpoints + sensitive reads require `requireRole('admin')`.
- **LLM safety** — 3-layer prompt-injection guard on `/api/llm/query` and `chat:message`.
- **Observer-first** — container-mutating actions gated by `admin` role + remediation approval;
  protected containers auto-downgrade to investigate-only.
- **Infrastructure isolation** — internal services never bind `0.0.0.0`; cross-service calls authenticated.
- **Input & data safety** — Zod on every API boundary, parameterized SQL only, PII scrubbing
  before logging or sending to the frontend.

---

_Generated from a full sweep of `backend/`, `packages/*`, `frontend/`, and `docker/`._
