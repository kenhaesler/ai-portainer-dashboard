# ADR-004: Microservices Evaluation — Stay with Monolith

**Status:** Accepted
**Date:** 2026-02-18

## Context

As the AI Portainer Dashboard backend grew to ~65K lines across 73 services, a formal evaluation was conducted to determine whether splitting the application into microservices would provide architectural benefits. This ADR documents that analysis and the decision to remain a monolith.

## Current State Assessment

The backend is already well-structured with clean internal boundaries:

| Domain | Key Files | Responsibility |
|--------|-----------|---------------|
| **Auth** | `routes/auth.ts`, `services/auth.ts`, `services/oidc.ts` | JWT, OIDC/SSO, sessions |
| **Portainer Proxy** | `routes/portainer.ts`, `services/portainer-api.ts` | API proxy + caching |
| **Containers** | `routes/containers.ts`, `services/containers.ts` | Container CRUD + actions |
| **Monitoring** | `services/monitoring.ts`, `services/metrics-store.ts` | Scheduled collection, TimescaleDB storage |
| **AI/LLM** | `routes/llm.ts`, `services/ollama.ts`, `services/prompt-guard.ts` | Chat, inference, safety |
| **Security Audit** | `services/security-audit.ts` | Container security scanning |
| **Harbor** | `routes/harbor.ts`, `services/harbor/` | Registry integration |
| **Real-time** | `services/socket.ts` | Socket.IO events |

This is a **well-modularized monolith** — the services already have clean separation of concerns.

## Decision

**Reject microservices. Remain a monolith (with modular restructuring per ADR-003).**

## Rationale

### 1. Tight Data Coupling

Almost every service reads from the same Portainer API data and shares the same caching layer (in-memory L1 + Redis L2). The monitoring cycle collects metrics that the dashboard, AI assistant, and security audit all consume. Splitting these apart would require either duplicating data or adding inter-service communication overhead that negates any isolation benefit.

### 2. Real-time Requirements

Socket.IO broadcasts cut across domain boundaries — monitoring insights, container state changes, and chat messages all flow through the same socket layer. In a microservices architecture, this would require a message broker (NATS, RabbitMQ) or Redis pub/sub just to coordinate what a single process handles today with zero latency.

### 3. Shared Auth Context

Every route uses `fastify.authenticate` and `fastify.requireRole()`. In microservices, this would require either an API gateway handling auth or token validation duplicated in every service — adding complexity and potential security inconsistency.

### 4. Operational Overhead vs. Team Size

This is a small-team project. Microservices multiply operational complexity: separate deployments, service discovery, distributed tracing, health checks per service, network failure handling, and version coordination. That overhead is justified for large organizations with dedicated platform teams — not here.

### 5. The "Distributed Monolith" Risk

Given how intertwined the data flows are (Portainer data -> cache -> monitoring -> metrics -> AI context -> security audit), splitting into services would likely create a distributed monolith — all the complexity of microservices with none of the independence benefits.

## Scaling Path (If Ever Needed)

If the application reaches scaling limits, the recommended path is:

1. **Horizontal scaling** of the monolith behind a load balancer (with sticky sessions for Socket.IO)
2. **Worker process** for the monitoring scheduler (same codebase, different entry point)
3. **Extract only when proven necessary** by real bottlenecks

The natural first extraction candidate would be the **monitoring/metrics collector** — it runs on a schedule, is write-heavy, and has the loosest coupling to the request/response cycle. But even that doesn't warrant extraction until actual scaling limits are hit.

## Consequences

### Positive

- No distributed systems complexity (network partitions, service discovery, distributed transactions)
- Single deployment artifact — simple Docker Compose workflow preserved
- Shared caching and auth remain zero-overhead
- Real-time Socket.IO broadcasting stays in-process
- Developer experience remains simple (one `npm run dev` starts everything)

### Negative

- Cannot independently scale individual domains (mitigated by horizontal monolith scaling)
- All domains share the same deployment lifecycle (mitigated by modular monolith restructuring in ADR-003)

## Related

- [ADR-003: Modular Monolith Backend Architecture](./003-modular-monolith-architecture.md) — the chosen path for improving internal structure
- Epic: Monorepo Modularization (#705)
