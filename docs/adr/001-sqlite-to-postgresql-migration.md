# ADR-001: SQLite to PostgreSQL Migration Decisions

**Status:** Accepted
**Date:** 2026-02-14
**Epic:** #617 — Migrate SQLite app data to PostgreSQL

## Context

The dashboard uses a dual-database architecture: TimescaleDB (PostgreSQL 17) for time-series metrics and SQLite (`better-sqlite3`) for all remaining app data (32+ tables across 39 files). SQLite has limitations for multi-user scenarios: single writer, no concurrent connections, no JSONB, and risky backups under load.

Since TimescaleDB already runs PostgreSQL 17, we have proven PostgreSQL infrastructure and expertise. Consolidating app data into a separate PostgreSQL instance eliminates the dual-database overhead.

## Decisions

### Decision 1: PostgreSQL 17 (not 18)

**Choice:** PostgreSQL 17

**Rationale:**
- TimescaleDB already runs PostgreSQL 17 (`timescale/timescaledb:2.25.0-pg17`)
- PostgreSQL 18 is currently in beta — not suitable for production
- PG18 improvements (virtual generated columns) are not critical for this migration
- Matching versions reduces operational complexity (one PG major version to manage)
- Upgrade path to PG18 is straightforward when it reaches GA

**Trade-off:** We miss PG18 features, but gain stability and operational simplicity.

### Decision 2: Raw `pg` (not Drizzle ORM)

**Choice:** Raw `pg` with parameterized queries

**Rationale:**
- The existing TimescaleDB integration (`backend/src/db/timescale.ts`) uses raw `pg.Pool` with `$1, $2` parameterized queries
- Consistency with existing patterns reduces cognitive load
- No new dependency or learning curve
- The `pg` package is already installed (`pg@8.18.0` in `backend/package.json`)
- The migration scope is already very large — adding an ORM would increase complexity

**Trade-off:** Manual parameterized queries require more boilerplate than an ORM, but the codebase already uses this pattern for TimescaleDB.

### Decision 3: AppDb Abstraction Layer for Incremental Migration

**Choice:** Create a thin async `AppDb` interface with SQLite and PostgreSQL adapters, plus a router for per-domain table routing.

**Interface:**
```typescript
export interface AppDb {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T = unknown>(sql: string, params?: unknown[]): Promise<T | null>;
  execute(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  transaction<T>(fn: (db: AppDb) => Promise<T>): Promise<T>;
  healthCheck(): Promise<boolean>;
}
```

**Rationale:**
- 39 files import from `sqlite.ts` — migrating all at once is high-risk
- The abstraction enables table-by-table migration with a routing layer
- Service files adopt the async interface first, then the underlying driver is swapped
- The abstraction is temporary — removed in Phase 4 cleanup (#654)

**Parameter style:** The interface uses `?` placeholders (SQLite-compatible). The PostgreSQL adapter converts `?` to `$1, $2, $3` internally. This minimizes changes in service files during migration.

**Trade-off:** Adds temporary complexity, but dramatically reduces migration risk.

### Decision 4: Test Strategy

**Choice:** SQLite for unit tests, Testcontainers for integration tests.

**Rationale:**
- Current tests use in-memory SQLite via `better-sqlite3` — fast and reliable
- Requiring PostgreSQL for all tests would significantly slow CI
- The AppDb abstraction enables unit tests to use the SQLite adapter (unchanged)
- Integration tests use Testcontainers for real PostgreSQL validation
- PG-specific SQL syntax issues are caught by integration tests

**Trade-off:** Unit tests won't catch PG-specific syntax issues, but integration tests will. This is acceptable because:
1. Most SQL syntax differences are caught at migration-write time (compile-time equivalent)
2. The PostgreSQL adapter handles parameter conversion internally
3. Integration tests run in CI before merge

## Consequences

- All subsequent sub-issues (#647-#654) follow these decisions
- `backend/src/db/postgres.ts` will mirror the `timescale.ts` pattern
- Service files will be migrated incrementally through the AppDb interface
- Docker Compose files will add a PostgreSQL 17 service (separate from TimescaleDB)
- The `better-sqlite3` dependency will be removed only in Phase 4 (#654) after all tables are migrated

## References

- `backend/src/db/timescale.ts` — PostgreSQL template (161 lines)
- `backend/src/db/sqlite.ts` — Current SQLite layer (175 lines)
- `backend/src/config/env.schema.ts` — Environment variable schema
- Epic #617 — Full migration plan with dependency graph
