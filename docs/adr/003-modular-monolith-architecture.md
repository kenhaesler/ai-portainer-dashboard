# ADR-003: Modular Monolith Backend Architecture

**Status:** Proposed
**Date:** 2026-02-16

## Context

The AI Portainer Dashboard backend has grown to ~65K lines across 143 source files, 73 services, and 40 routes. The frontend adds another ~59K lines across 187 source files, 31 pages, and 60 hooks. Total codebase: ~124K LoC with 271 test files.

AI agents (Claude Code, Copilot, Cursor) struggle with context window limits because:

- `monitoring-service.ts` imports from 22 other services (god-object pattern)
- `portainer-client` is depended on by 15 other services
- `scheduler/setup.ts` imports from 15+ services across all domains
- `app.ts` registers 40 route modules linearly with no grouping
- There are no enforced domain boundaries — any file can import any other file
- A single feature change often requires understanding 20-40 files across domains

This makes AI-assisted development increasingly slow and error-prone as the codebase grows. The flat `services/` and `routes/` directories provide no signal about which files are related, forcing agents to load far more context than necessary.

## Decision Drivers

- AI agent context windows are limited (128K-200K tokens); reducing working set per task is critical
- Incremental migration is essential — cannot halt feature development for weeks
- Single deployment simplicity must be preserved (no microservice orchestration overhead)
- Test isolation by domain improves CI speed and developer experience
- Must work with multiple AI tools, not just Claude Code
- The codebase is expected to continue growing, so the solution must scale

## Identified Domain Boundaries

Analysis of service-to-service dependencies identified 6 logical domains:

| Domain | Services | Routes | Key Hub Service |
|--------|----------|--------|-----------------|
| **Core Platform** | 12 | 10 | `portainer-client` (15 dependants) |
| **AI/ML Intelligence** | 18 | 6 | `monitoring-service` (22 imports) |
| **Observability** | 10 | 6 | `metrics-store` (7 dependants) |
| **Security** | 8 | 5 | `security-scanner` |
| **Operations** | 12 | 10 | `event-bus` |
| **Infrastructure** | 8 | 3 | `elasticsearch-log-forwarder` |

### Validated Adjustments (Post-Analysis)

1. **`trace-context` moved to Core** — imported by 12 services across all 6 domains; it is a cross-cutting concern, not an observability service. Eliminates `core <-> observability` circular dependency.
2. **`image-staleness` moved to Security** — `harbor-sync` (security) depends on it; eliminates `security -> operations` circular dependency.
3. **`oidc.ts` confirmed in Core** (authentication). `prompt-test-fixtures.ts` moves with ai-intelligence.

### Circular Dependencies Identified (All Resolvable)

| Cycle | Root Cause | Resolution |
|-------|-----------|-----------|
| `core <-> observability` | `portainer-client/cache` imports `trace-context` | Move `trace-context` to `core/tracing/` |
| `ai-intelligence <-> security` | `monitoring-service` calls `scanContainer`; `pcap-analysis` calls `llm-client` | Phase 2: module public API. Phase 3: contracts interfaces |
| `ai-intelligence <-> operations` | `monitoring-service` calls `suggestAction`/`notifyInsight`; `remediation-service` calls `llm-client` | Phase 2: module public API. Phase 3: event bus + LLM interface |
| `security <-> operations` | `harbor-sync` calls `image-staleness` | Move `image-staleness` to security |

## Considered Options

### Option 1: Context Files Only (No Code Changes)

Add domain-scoped context files (`.claude/commands/`, per-domain CLAUDE.md) and `.claudeignore` patterns to help AI agents scope their working set. Zero code changes.

- **Pros**: Immediate, zero risk, no migration
- **Cons**: Advisory only (drift guaranteed), doesn't fix god-objects, doesn't help non-Claude tools
- **Verdict**: Useful as a quick win but insufficient long-term

### Option 2: Modular Monolith (Domain Modules Within Backend) — Recommended for Phase 2

Restructure `backend/src/` into domain modules with explicit boundaries. Each module owns its routes, services, models, and tests. Shared code lives in a `core/` kernel.

```
backend/src/
├── core/                          # Shared kernel
│   ├── config/
│   ├── db/
│   ├── plugins/
│   ├── utils/
│   ├── tracing/                   # trace-context (cross-cutting)
│   └── portainer/                 # portainer-client, cache, normalizers
├── modules/
│   ├── ai-intelligence/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── models/
│   │   └── tests/
│   ├── observability/
│   ├── security/
│   ├── operations/
│   └── infrastructure/
├── scheduler/
└── app.ts
```

- **Pros**: 75% context reduction for AI agents, incremental migration, no infra changes, ESLint-enforced boundaries
- **Cons**: Significant refactoring effort, convention-based (not compiler-enforced)
- **Effort**: High (estimated 5-6 weeks)

### Option 3: npm Workspace Packages (Evolved) — Recommended for Phase 3

Create npm workspace packages for each domain with a `@dashboard/contracts` package containing shared types/schemas and a typed event bus for cross-domain communication.

```
packages/
├── contracts/                    # @dashboard/contracts — Zod schemas + types ONLY
├── core/                         # @dashboard/core — DB, auth, portainer, event-bus
├── ai-intelligence/              # @dashboard/ai — depends: contracts, core ONLY
├── observability/                # @dashboard/observability — depends: contracts, core ONLY
├── security/                     # @dashboard/security — depends: contracts, core ONLY
├── operations/                   # @dashboard/operations — depends: contracts, core ONLY
├── server/                       # @dashboard/server — composition root, wires everything
└── frontend/                     # @dashboard/frontend
```

Key innovations:
- **Contracts package**: Shared Zod schemas + TypeScript types with zero logic. Only shared knowledge between packages.
- **Typed event bus**: Cross-domain communication via typed events instead of direct imports.
- **Composition root**: `@dashboard/server` is the only package that sees all others; wires dependencies via injection.
- **Monitoring-service decomposition**: Factory function receives interfaces (`SecurityScannerInterface`, `MetricsInterface`, `LLMInterface`) instead of 22 direct imports.

- **Pros**: 85% context reduction, compiler-enforced boundaries (TypeScript project references), per-package testing/CI, natural extraction path
- **Cons**: Largest refactoring effort, TypeScript project references complexity, requires Phase 2 first
- **Effort**: Very High (estimated 4-6 weeks after Phase 2)

### Option 4: Hybrid Full-Stack Modules

Apply Option 2 to backend AND restructure frontend into feature modules that mirror backend domains. Provides full-stack domain alignment.

- **Pros**: Complete AI agent scoping across the stack
- **Cons**: Largest scope, two parallel restructurings
- **Verdict**: Frontend restructuring incorporated as a parallel Phase 2 workstream

## Decision

**Phased migration: Option 2 (Modular Monolith) as stepping stone to Option 3 (Workspace Packages).**

```
Current (flat) ──→ Phase 2: Modular Monolith ──→ Phase 3: Workspace Packages
     Now              Month 1-2                     Month 4-6 (if growth warrants)
```

Option 2 is not a dead end — it forces us to identify domain boundaries and decompose god-objects. Once that's done, extracting modules into workspace packages is mostly mechanical. Going directly to Option 3 without Phase 2 risks circular dependency deadlocks from the monitoring-service.

### Phase 2 Migration Order

| Step | Scope | Rationale |
|------|-------|-----------|
| 2.0: Extract `core/` kernel | XL | Foundation — everything depends on this |
| 2.1: Extract security module | M | Lowest coupling to other domains |
| 2.2: Extract infrastructure module | S | Small, self-contained |
| 2.3: Extract observability module | L | Required by operations and ai-intelligence |
| 2.4: Extract operations module | M | Depends on observability for metrics |
| 2.5: Extract ai-intelligence module | XL | Hardest — monitoring-service decomposition |
| 2.6: Refactor scheduler | S | Uses module entry points |
| 2.7: ESLint boundaries + CLAUDE.md | M | Enforcement layer |
| 2.8: Frontend feature modules | XL | Parallel workstream |

### Phase 3 Decision Gate

Phase 3 proceeds only if:
- Codebase exceeds ~200K LoC OR
- Multiple contributors are working concurrently OR
- Convention-based boundaries prove insufficient (repeated boundary violations)

## Consequences

### Positive

- AI agents work with ~15-25 files per domain instead of 143
- Domain boundaries are visible in the file system and enforced by ESLint (Phase 2) / TypeScript compiler (Phase 3)
- Tests can run per-module/package for faster CI feedback
- The monitoring-service god-object is decomposed, eliminating the primary coupling bottleneck
- Incremental migration: one module at a time, no big-bang required
- No deployment or infrastructure changes in either phase

### Negative

- Significant total refactoring effort (~5-6 weeks Phase 2, ~4-6 weeks Phase 3)
- Must define and maintain module interface contracts
- `core/` kernel requires discipline to prevent it from growing unbounded
- Phase 3 adds npm workspace and TypeScript project reference complexity

### Neutral

- Frontend restructuring runs in parallel with backend Phase 2
- Phase 3 may never be needed if growth stabilizes at ~200K LoC
- Existing ADRs and documentation patterns remain unchanged

## Related

- [ADR-002: Harbor Registry Vulnerability Management](./002-harbor-registry-vulnerability-management.md)
- Epic: Monorepo Modularization (#705)
- Phase 2 issues: #706-#714
- Phase 3 issues: #715-#722
