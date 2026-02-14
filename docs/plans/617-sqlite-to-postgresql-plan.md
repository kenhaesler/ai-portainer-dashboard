# Epic #617: SQLite → PostgreSQL Migration — Implementation Plan

## Table of Contents
1. [#646 ADR Document](#task-1-646-adr-document)
2. [#647 PostgreSQL Foundation](#task-2-647-postgresql-foundation)
3. [#648 Abstraction Layer](#task-3-648-abstraction-layer)
4. [#649 Phase 1: High-Write Tables](#task-4-649-phase-1-high-write-tables)
5. [#650 Phase 2: Core App Tables](#task-5-650-phase-2-core-app-tables)
6. [#651 Phase 3: Feature Tables](#task-6-651-phase-3-feature-tables)
7. [#653 Backup Service Rewrite](#task-7-653-backup-service-rewrite)
8. [#654 Cleanup](#task-8-654-cleanup)

---

## SQL Conversion Reference (All Tasks)

These rules apply across all migration phases:

| SQLite | PostgreSQL |
|--------|------------|
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `SERIAL PRIMARY KEY` (or `BIGSERIAL` for high-write) |
| `TEXT` for timestamps | `TIMESTAMPTZ NOT NULL DEFAULT NOW()` |
| `datetime('now')` | `NOW()` |
| `unixepoch(x)` | `EXTRACT(EPOCH FROM x::timestamptz)` |
| `TEXT DEFAULT '{}'` (JSON) | `JSONB NOT NULL DEFAULT '{}'::jsonb` |
| `INTEGER` for booleans (0/1) | `BOOLEAN NOT NULL DEFAULT FALSE` |
| `INSERT OR IGNORE` | `INSERT ... ON CONFLICT DO NOTHING` |
| `ON CONFLICT(key) DO UPDATE SET` | Same syntax (works in PG) |
| `?` placeholders | `$1, $2, $3` numbered placeholders |
| `db.prepare(sql).run(...)` (sync) | `pool.query(sql, [...])` (async) |
| `db.prepare(sql).get(...)` → row | `pool.query(sql, [...])` → `rows[0]` |
| `db.prepare(sql).all(...)` → rows | `pool.query(sql, [...])` → `rows` |
| `db.transaction(fn)` (sync) | `BEGIN; ...; COMMIT;` via client checkout (async) |
| `CAST(... AS REAL)` | `CAST(... AS DOUBLE PRECISION)` or just `::float` |
| `NULLIF(COUNT(*), 0)` | Same (works in PG) |
| `LIKE` (case-insensitive in SQLite) | `ILIKE` (PG is case-sensitive for LIKE) |

**JSONB upgrade targets**: `spans.attributes`, `incidents.related_insight_ids`, `incidents.affected_containers`, `webhooks.events`, `mcp_servers.args/env/disabled_tools`, `prompt_profiles.prompts_json`, `llm_prompt_suggestions.evidence_feedback_ids`, `pcap_captures.protocol_stats`, `investigations.evidence_summary` (if structured)

---

## Task 1: #646 ADR Document

**Goal**: Record 4 architectural decisions in ADR format.

### Files to Create
- `docs/adr/001-postgresql-over-sqlite.md`

### Content — 4 Decisions

**Decision 1: PostgreSQL 17 over alternatives**
- Context: SQLite becomes bottleneck at 20-30 containers (query latency >1s for 30-day ranges). Need async I/O, JSONB, concurrent writes.
- Options: PostgreSQL 17, MySQL 8, DuckDB, keep SQLite
- Recommendation: PostgreSQL 17 — matches existing TimescaleDB (PG17 extension), single DB engine, JSONB, `pg` client already in dependencies
- Trade-offs: +operational complexity (connection pool), +deployment dependency; −no file-based simplicity

**Decision 2: Raw `pg` client (no ORM)**
- Context: `timescale.ts` already uses raw `pg.Pool` with parameterized queries
- Options: raw `pg`, Drizzle ORM, Kysely, Knex
- Recommendation: raw `pg` — consistency with timescale.ts, zero new dependencies, full SQL control
- Trade-offs: +consistency, +no abstraction leaks; −more boilerplate, −no type-safe query builder

**Decision 3: Shared PostgreSQL instance vs dedicated**
- Context: TimescaleDB is already PostgreSQL 17. App data is ~10 tables, low volume.
- Options: (A) Separate database in same PG instance, (B) Same database different schema, (C) Entirely separate PG container
- Recommendation: (A) Separate database `dashboard` in the same TimescaleDB container — one PG process, two logical databases, clean isolation
- Trade-offs: +one container, +shared resources; −shared failure domain (mitigated: PG is already a hard dependency)

**Decision 4: Testing strategy**
- Context: 24 service files use SQLite. Tests need to be fast and reliable.
- Options: (A) SQLite for unit tests + Testcontainers for integration, (B) Testcontainers everywhere, (C) Mock everything
- Recommendation: (A) — Unit tests mock the AppDb interface (fast, no containers). Integration tests use `@testcontainers/postgresql` for real PG validation.
- Trade-offs: +fast CI, +real PG in integration; −two test styles

### Test Strategy
- No code changes, no tests needed for ADR
- Review: ensure decisions are consistent with timescale.ts patterns

---

## Task 2: #647 PostgreSQL Foundation

**Goal**: Create `postgres.ts`, add Docker service config, env vars, health check.

### Files to Create

#### `backend/src/db/postgres.ts`
Follow `timescale.ts` pattern exactly:
```
- Import pg, fs, path, getConfig, createChildLogger
- Set pg type parsers for TIMESTAMPTZ (OID 1184) and TIMESTAMP (OID 1114) — same as timescale.ts
- let pool: pg.Pool | null = null
- let migrationsReady = false
- export function isAppDbReady(): boolean — return pool !== null && migrationsReady
- export async function getAppDb(): Promise<pg.Pool>
  - Create pool with config.POSTGRES_APP_URL, config.POSTGRES_APP_MAX_CONNECTIONS
  - Pool settings: idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000
  - pool.on('error', ...) logging
  - await runMigrations(pool)
  - migrationsReady = true
  - Persist pool only after migrations succeed
- async function runMigrations(db: pg.Pool): Promise<void>
  - Create _app_migrations table (SERIAL PRIMARY KEY, name TEXT UNIQUE, applied_at TIMESTAMPTZ DEFAULT NOW())
  - Read from 'pg-migrations/' directory
  - Execute each .sql file not yet applied
  - Use statement-by-statement execution (same approach as timescale.ts)
- export async function closeAppDb(): Promise<void>
- export async function isAppDbHealthy(): Promise<boolean>
  - SELECT 1 as ok
```

#### `backend/src/db/pg-migrations/` (empty directory)
- Create with `.gitkeep` to track in git
- Migrations will be added in #649, #650, #651

### Files to Modify

#### `backend/src/config/env.schema.ts`
Add after TIMESCALE_MAX_CONNECTIONS line:
```typescript
// PostgreSQL App Database (sessions, settings, audit, etc.)
POSTGRES_APP_URL: z.string().default('postgresql://dashboard_user:changeme@localhost:5432/dashboard'),
POSTGRES_APP_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(200).default(20),
```

#### `docker/docker-compose.yml`
Modify `timescaledb` service environment to add init script:
```yaml
environment:
  POSTGRES_DB: metrics
  POSTGRES_USER: metrics_user
  POSTGRES_PASSWORD: ${TIMESCALE_PASSWORD:?...}
volumes:
  - timescale-data:/var/lib/postgresql/data
  - ./init-pg-databases.sql:/docker-entrypoint-initdb.d/02-create-app-db.sql:ro
```

Add to `backend` service environment:
```yaml
- POSTGRES_APP_URL=postgresql://dashboard_user:${POSTGRES_APP_PASSWORD:?POSTGRES_APP_PASSWORD is required}@timescaledb:5432/dashboard
- POSTGRES_APP_MAX_CONNECTIONS=${POSTGRES_APP_MAX_CONNECTIONS:-20}
```

Add `depends_on` for backend already has timescaledb — no change needed.

#### `docker/docker-compose.dev.yml`
Same changes but with dev defaults:
```yaml
- POSTGRES_APP_URL=postgresql://dashboard_user:${POSTGRES_APP_PASSWORD:-changeme-dashboard}@timescaledb:5432/dashboard
- POSTGRES_APP_MAX_CONNECTIONS=${POSTGRES_APP_MAX_CONNECTIONS:-10}
```

TimescaleDB service env add volume mount for init script.

#### Create `docker/init-pg-databases.sql`
```sql
-- Create the app database and user (runs once on first container start)
-- The metrics database + metrics_user are created by POSTGRES_DB/POSTGRES_USER env vars

CREATE USER dashboard_user WITH PASSWORD 'changeme';
CREATE DATABASE dashboard OWNER dashboard_user;

-- Grant connect privilege
GRANT CONNECT ON DATABASE dashboard TO dashboard_user;
```

Note: In production, `POSTGRES_APP_PASSWORD` must be set. The init script password will be overridden by the compose env var. Actually, the init script runs only on first `initdb` — for dynamic passwords, use the env var `POSTGRES_APP_PASSWORD` and template it into the init script, or use a shell-based init script:

Better approach — create `docker/init-pg-databases.sh`:
```bash
#!/bin/bash
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
  CREATE USER dashboard_user WITH PASSWORD '${POSTGRES_APP_PASSWORD:-changeme}';
  CREATE DATABASE dashboard OWNER dashboard_user;
  GRANT ALL PRIVILEGES ON DATABASE dashboard TO dashboard_user;
EOSQL
```

Mount as: `./init-pg-databases.sh:/docker-entrypoint-initdb.d/02-create-app-db.sh:ro`

#### `backend/src/routes/health.ts`
Add import:
```typescript
import { isAppDbHealthy, isAppDbReady } from '../db/postgres.js';
```

Add check in `runChecks()` after metricsDb check:
```typescript
// Check App PostgreSQL database (sessions, settings, audit, etc.)
const appDbHealthy = await isAppDbHealthy();
const appMigrationsReady = isAppDbReady();
if (appDbHealthy && appMigrationsReady) {
  checks.appDb = { status: 'healthy' };
} else if (appDbHealthy && !appMigrationsReady) {
  checks.appDb = { status: 'degraded', error: 'App DB connected but migrations not applied' };
} else {
  checks.appDb = { status: 'unhealthy', error: 'App DB query failed' };
}
```

#### `backend/src/index.ts`
Add import and shutdown:
```typescript
import { closeAppDb } from './db/postgres.js';
// In shutdown handler, add:
await closeAppDb();
```

#### `.env.example`
Add:
```
POSTGRES_APP_PASSWORD=changeme-dashboard
POSTGRES_APP_URL=postgresql://dashboard_user:changeme-dashboard@timescaledb:5432/dashboard
POSTGRES_APP_MAX_CONNECTIONS=20
```

### Test Strategy
- **Unit test**: `backend/src/db/postgres.test.ts` — mock `pg.Pool`, verify pool creation, migration tracking, health check
- **Integration test**: `backend/src/db/postgres.integration.test.ts` — use `@testcontainers/postgresql` to verify real PG connection, migration execution, health check returns true
- **Health route test**: Update `backend/src/routes/health.test.ts` to mock new `isAppDbHealthy` and `isAppDbReady`

### Risk Mitigation
- The init script only runs on first `initdb` — document that existing TimescaleDB volumes need manual DB creation
- Add startup log warning if `getAppDb()` fails (non-fatal during transition while SQLite is still primary)

---

## Task 3: #648 Abstraction Layer

**Goal**: Create AppDb interface so services can be migrated incrementally from SQLite to PG.

### Files to Create

#### `backend/src/db/app-db.ts`
```typescript
export interface AppDb {
  /** Run a query and return all rows */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;

  /** Run a query and return the first row (or undefined) */
  queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;

  /** Execute a statement (INSERT/UPDATE/DELETE), return affected row count */
  execute(sql: string, params?: unknown[]): Promise<{ rowCount: number }>;

  /** Run multiple statements in a transaction */
  transaction<T>(fn: (tx: AppDbTransaction) => Promise<T>): Promise<T>;

  /** Health check */
  healthCheck(): Promise<boolean>;
}

export interface AppDbTransaction {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  execute(sql: string, params?: unknown[]): Promise<{ rowCount: number }>;
}
```

#### `backend/src/db/sqlite-adapter.ts`
Wraps synchronous `better-sqlite3` calls in async interface:
```typescript
import { getDb } from './sqlite.js';
import type { AppDb, AppDbTransaction } from './app-db.js';

export function createSqliteAdapter(): AppDb {
  return {
    async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
      return getDb().prepare(sql).all(...(params ?? [])) as T[];
    },
    async queryOne<T>(sql: string, params?: unknown[]): Promise<T | undefined> {
      return getDb().prepare(sql).get(...(params ?? [])) as T | undefined;
    },
    async execute(sql: string, params?: unknown[]): Promise<{ rowCount: number }> {
      const result = getDb().prepare(sql).run(...(params ?? []));
      return { rowCount: result.changes };
    },
    async transaction<T>(fn: (tx: AppDbTransaction) => Promise<T>): Promise<T> {
      // better-sqlite3 transactions are synchronous, but we wrap them
      // The fn is async but all SQLite calls resolve immediately
      const db = getDb();
      const sqliteTx = db.transaction(async () => {
        const tx: AppDbTransaction = {
          async query<U>(sql: string, params?: unknown[]): Promise<U[]> {
            return db.prepare(sql).all(...(params ?? [])) as U[];
          },
          async queryOne<U>(sql: string, params?: unknown[]): Promise<U | undefined> {
            return db.prepare(sql).get(...(params ?? [])) as U | undefined;
          },
          async execute(sql: string, params?: unknown[]): Promise<{ rowCount: number }> {
            const r = db.prepare(sql).run(...(params ?? []));
            return { rowCount: r.changes };
          },
        };
        return fn(tx);
      });
      return sqliteTx();
    },
    async healthCheck(): Promise<boolean> {
      try {
        const r = getDb().prepare('SELECT 1 as ok').get() as { ok: number };
        return r.ok === 1;
      } catch { return false; }
    },
  };
}
```

**Important caveat**: `better-sqlite3`'s `db.transaction()` callback must be synchronous. The async wrapper will work only if the `fn` doesn't `await` anything external (i.e., only calls the `tx` methods which are fake-async wrapping sync calls). This is fine for the SQLite adapter since all ops are synchronous. Document this limitation.

#### `backend/src/db/pg-adapter.ts`
```typescript
import type pg from 'pg';
import type { AppDb, AppDbTransaction } from './app-db.js';

export function createPgAdapter(pool: pg.Pool): AppDb {
  return {
    async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
      const { rows } = await pool.query(sql, params);
      return rows as T[];
    },
    async queryOne<T>(sql: string, params?: unknown[]): Promise<T | undefined> {
      const { rows } = await pool.query(sql, params);
      return rows[0] as T | undefined;
    },
    async execute(sql: string, params?: unknown[]): Promise<{ rowCount: number }> {
      const result = await pool.query(sql, params);
      return { rowCount: result.rowCount ?? 0 };
    },
    async transaction<T>(fn: (tx: AppDbTransaction) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const tx: AppDbTransaction = {
          async query<U>(sql: string, params?: unknown[]): Promise<U[]> {
            const { rows } = await client.query(sql, params);
            return rows as U[];
          },
          async queryOne<U>(sql: string, params?: unknown[]): Promise<U | undefined> {
            const { rows } = await client.query(sql, params);
            return rows[0] as U | undefined;
          },
          async execute(sql: string, params?: unknown[]): Promise<{ rowCount: number }> {
            const result = await client.query(sql, params);
            return { rowCount: result.rowCount ?? 0 };
          },
        };
        const result = await fn(tx);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
    async healthCheck(): Promise<boolean> {
      try {
        const { rows } = await pool.query('SELECT 1 as ok');
        return rows[0]?.ok === 1;
      } catch { return false; }
    },
  };
}
```

#### `backend/src/db/app-db-router.ts`
Routes calls to SQLite or PG per domain:
```typescript
import type { AppDb } from './app-db.js';
import { createSqliteAdapter } from './sqlite-adapter.js';
import { createPgAdapter } from './pg-adapter.js';
import { getAppDb, isAppDbReady } from './postgres.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('app-db-router');

// Which domains have been migrated to PG
// Updated as each phase completes
const PG_DOMAINS = new Set<string>([
  // Phase 1 (#649): 'traces', 'audit', 'llm-traces', 'monitoring', 'notifications'
  // Phase 2 (#650): 'sessions', 'users', 'settings', 'insights', 'actions', 'investigations', 'incidents'
  // Phase 3 (#651): remaining
]);

let pgAdapter: AppDb | null = null;
let sqliteAdapter: AppDb | null = null;

export async function getAppDbFor(domain: string): Promise<AppDb> {
  if (PG_DOMAINS.has(domain) && isAppDbReady()) {
    if (!pgAdapter) {
      const pool = await getAppDb();
      pgAdapter = createPgAdapter(pool);
    }
    return pgAdapter;
  }

  // Fallback to SQLite
  if (!sqliteAdapter) {
    sqliteAdapter = createSqliteAdapter();
  }
  return sqliteAdapter;
}

// For tests: reset adapters
export function resetAdapters(): void {
  pgAdapter = null;
  sqliteAdapter = null;
}
```

### Proof-of-Concept: settings-store.ts migration

#### Modify `backend/src/services/settings-store.ts`
Convert from direct SQLite to AppDb interface. This serves as the template for all subsequent migrations.

**Before** (sync, SQLite-specific):
```typescript
import { getDb } from '../db/sqlite.js';
export function getSetting(key: string): Setting | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM settings WHERE key = ?').get(key) as Setting | undefined;
}
```

**After** (async, backend-agnostic):
```typescript
import { getAppDbFor } from '../db/app-db-router.js';
export async function getSetting(key: string): Promise<Setting | undefined> {
  const db = await getAppDbFor('settings');
  return db.queryOne<Setting>('SELECT * FROM settings WHERE key = $1', [key]);
}
```

**Critical**: This changes the function from sync to async, which means ALL CALLERS must be updated to `await`. For settings-store.ts, callers include:
- `routes/settings.ts`
- `services/settings-store.ts` (internal calls like `getEffectiveLlmConfig`)
- `sockets/llm-chat.ts` (calls `getEffectiveLlmConfig`)
- Any route/service that reads settings

The PoC should convert the full settings-store.ts AND update all callers to prove the pattern works end-to-end.

**Note on placeholder syntax**: During the abstraction phase, SQL must use `$1, $2, ...` placeholders (PG syntax). The SQLite adapter must convert these to `?` internally, OR we standardize on one syntax.

**Recommended approach**: Use `$1, $2, ...` everywhere in service code. The SQLite adapter converts:
```typescript
private convertPlaceholders(sql: string): string {
  let i = 0;
  return sql.replace(/\$\d+/g, () => '?');
}
```

This means during the transition period, all service code uses PG-style placeholders, and the SQLite adapter transparently converts.

### Test Strategy
- **Unit tests**: `backend/src/db/app-db.test.ts` — test SQLite adapter with in-memory DB
- **Unit tests**: `backend/src/db/pg-adapter.test.ts` — mock `pg.Pool`, verify query/transaction behavior
- **Unit tests**: `backend/src/db/app-db-router.test.ts` — verify domain routing
- **Integration test**: `backend/src/services/settings-store.integration.test.ts` — test settings CRUD through AppDb with real PG (Testcontainers)

### Risk Mitigation
- **sync→async cascade**: The biggest risk. Every `getDb().prepare().get()` becomes `await db.queryOne()`. This ripples through all callers. Mitigate by migrating one store at a time and updating all callers before moving to the next.
- **Placeholder conversion**: Simple regex is sufficient since we never use `$` in values. But add a test to verify.
- **Transaction semantics**: SQLite adapter's async-wrapping-sync transaction is safe as long as the callback only calls tx methods. Document this clearly.

---

## Task 4: #649 Phase 1: High-Write Tables

**Goal**: Migrate 6 high-write tables + their service files to PostgreSQL.

### Tables (ordered by write volume)
1. `spans` — eBPF trace data, highest write volume
2. `audit_log` — every API action
3. `llm_traces` — every LLM call
4. `monitoring_cycles` — every 5min
5. `monitoring_snapshots` — every 5min
6. `notification_log` — every notification sent

### Migration Files to Create

#### `backend/src/db/pg-migrations/001_spans.sql`
```sql
CREATE TABLE IF NOT EXISTS spans (
  id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL,
  parent_span_id TEXT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('client', 'server', 'internal')),
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'error', 'unset')),
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  duration_ms INTEGER,
  service_name TEXT NOT NULL,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  trace_source TEXT NOT NULL DEFAULT 'http',
  http_method TEXT,
  http_route TEXT,
  http_status_code INTEGER,
  service_namespace TEXT,
  service_instance_id TEXT,
  service_version TEXT,
  deployment_environment TEXT,
  container_id TEXT,
  container_name TEXT,
  k8s_namespace TEXT,
  k8s_pod_name TEXT,
  k8s_container_name TEXT,
  server_address TEXT,
  server_port INTEGER,
  client_address TEXT,
  url_full TEXT,
  url_scheme TEXT,
  network_transport TEXT,
  network_protocol_name TEXT,
  network_protocol_version TEXT,
  net_peer_name TEXT,
  net_peer_port INTEGER,
  host_name TEXT,
  os_type TEXT,
  process_pid INTEGER,
  process_executable_name TEXT,
  process_command TEXT,
  telemetry_sdk_name TEXT,
  telemetry_sdk_language TEXT,
  telemetry_sdk_version TEXT,
  otel_scope_name TEXT,
  otel_scope_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_spans_trace ON spans(trace_id);
CREATE INDEX IF NOT EXISTS idx_spans_parent ON spans(parent_span_id);
CREATE INDEX IF NOT EXISTS idx_spans_service ON spans(service_name);
CREATE INDEX IF NOT EXISTS idx_spans_time ON spans(start_time);
CREATE INDEX IF NOT EXISTS idx_spans_source ON spans(trace_source);
```

Key changes from SQLite version:
- `attributes TEXT DEFAULT '{}'` → `JSONB NOT NULL DEFAULT '{}'::jsonb` — enables JSON queries
- All timestamp columns → `TIMESTAMPTZ`
- `datetime('now')` → `NOW()`
- Added index on `trace_source` (commonly filtered)

#### `backend/src/db/pg-migrations/002_audit_log.sql`
```sql
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT,
  username TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  request_id TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_log(target_type, target_id);
```

Key changes:
- `INTEGER PRIMARY KEY AUTOINCREMENT` → `BIGSERIAL PRIMARY KEY`
- `details TEXT DEFAULT '{}'` → `JSONB NOT NULL DEFAULT '{}'::jsonb`

#### `backend/src/db/pg-migrations/003_llm_traces.sql`
```sql
CREATE TABLE IF NOT EXISTS llm_traces (
  id BIGSERIAL PRIMARY KEY,
  trace_id TEXT NOT NULL UNIQUE,
  session_id TEXT,
  model TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'success',
  user_query TEXT,
  response_preview TEXT,
  feedback_score INTEGER,
  feedback_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_llm_traces_created ON llm_traces(created_at);
CREATE INDEX IF NOT EXISTS idx_llm_traces_model ON llm_traces(model);
CREATE INDEX IF NOT EXISTS idx_llm_traces_session ON llm_traces(session_id);
```

#### `backend/src/db/pg-migrations/004_monitoring.sql`
```sql
CREATE TABLE IF NOT EXISTS monitoring_cycles (
  id BIGSERIAL PRIMARY KEY,
  duration_ms INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_monitoring_cycles_created_at ON monitoring_cycles(created_at);

CREATE TABLE IF NOT EXISTS monitoring_snapshots (
  id BIGSERIAL PRIMARY KEY,
  containers_running INTEGER NOT NULL,
  containers_stopped INTEGER NOT NULL,
  containers_unhealthy INTEGER NOT NULL,
  endpoints_up INTEGER NOT NULL,
  endpoints_down INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_monitoring_snapshots_created_at ON monitoring_snapshots(created_at);
```

#### `backend/src/db/pg-migrations/005_notification_log.sql`
```sql
CREATE TABLE IF NOT EXISTS notification_log (
  id BIGSERIAL PRIMARY KEY,
  channel TEXT NOT NULL,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  severity TEXT DEFAULT 'info',
  container_id TEXT,
  container_name TEXT,
  endpoint_id INTEGER,
  status TEXT NOT NULL DEFAULT 'sent',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notif_log_created ON notification_log(created_at);
CREATE INDEX IF NOT EXISTS idx_notif_log_channel ON notification_log(channel);
```

### Service Files to Modify

Each service follows this conversion pattern:

#### `backend/src/services/trace-store.ts`
**Before**:
```typescript
import { getDb } from '../db/sqlite.js';
export function insertSpan(span: SpanInsert): void {
  const db = getDb();
  db.prepare(`INSERT INTO spans (...) VALUES (?, ?, ...)`).run(span.id, ...);
}
```

**After**:
```typescript
import { getAppDbFor } from '../db/app-db-router.js';
export async function insertSpan(span: SpanInsert): Promise<void> {
  const db = await getAppDbFor('traces');
  await db.execute(
    `INSERT INTO spans (...) VALUES ($1, $2, ...)`,
    [span.id, ...]
  );
}
```

**Specific changes for trace-store.ts**:
- All 6 exported functions become `async`
- `insertSpans()` batch: convert `db.transaction()` to `db.transaction(async (tx) => { ... })`
- `attributes` column: was `JSON.stringify(span.attributes)` → now pass object directly (JSONB)
- `datetime('now')` in SQL → `NOW()`
- All `?` → `$1, $2, ...`
- `CAST(... AS REAL)` → `::float`
- Return types: `.all() as T[]` → `db.query<T>(sql, params)`, `.get() as T` → `db.queryOne<T>(sql, params)`

**Transaction conversion for `insertSpans()`**:
```typescript
export async function insertSpans(spans: SpanInsert[]): Promise<number> {
  if (spans.length === 0) return 0;
  const db = await getAppDbFor('traces');
  return db.transaction(async (tx) => {
    let count = 0;
    for (const span of spans) {
      await tx.execute(`INSERT INTO spans (...) VALUES ($1, $2, ...)`, [...]);
      count++;
    }
    return count;
  });
}
```

#### `backend/src/services/audit-logger.ts`
- `writeAuditLog()`: sync → async, `prepareStmt(...).run(...)` → `db.execute(...)`
- `details`: was `JSON.stringify(entry.details || {})` → now pass object directly (JSONB handles it)
- `getAuditLogs()`: sync → async, dynamic WHERE construction stays same but with `$N` placeholders
- **Dynamic placeholder numbering**: Need a counter for dynamic WHERE clauses:
  ```typescript
  let paramIdx = 1;
  if (options?.action) {
    conditions.push(`action = $${paramIdx++}`);
    params.push(options.action);
  }
  // ... limit = $${paramIdx++}, offset = $${paramIdx++}
  ```

#### `backend/src/services/llm-trace-store.ts`
- Read file first to confirm all functions
- All sync functions → async
- Standard placeholder/timestamp conversions

#### `backend/src/services/monitoring-telemetry-store.ts`
- All sync functions → async
- Standard conversions

#### `backend/src/services/notification-service.ts`
- Notification logging functions → async
- Standard conversions

### Caller Updates (Critical!)

Every file that calls these service functions must be updated to `await` the results:

**For trace-store.ts callers**:
- `backend/src/routes/traces.ts`
- `backend/src/sockets/monitoring.ts` (if it reads traces)
- Any OTLP ingestion route

**For audit-logger.ts callers**:
- `backend/src/routes/` — nearly every route calls `writeAuditLog()`
- `backend/src/sockets/remediation.ts`

**For notification-service.ts callers**:
- `backend/src/routes/notifications.ts`
- `backend/src/services/monitoring.ts`

**Strategy**: Use TypeScript compiler to find all callers. After converting a function from sync to async (returning `Promise<T>` instead of `T`), run `npx tsc --noEmit` — every caller that doesn't `await` will produce a type error.

### Update `app-db-router.ts`
Add Phase 1 domains to `PG_DOMAINS`:
```typescript
const PG_DOMAINS = new Set<string>([
  'traces', 'audit', 'llm-traces', 'monitoring', 'notifications',
]);
```

### Test Strategy
- **Per-service unit tests**: Each `*.test.ts` file gets updated:
  - Mock `getAppDbFor` instead of `getDb`
  - All test cases become async
  - Verify SQL uses `$N` placeholders
- **Integration tests**: One integration test per service verifying real PG behavior
- **JSONB test**: Specifically test that `attributes` JSONB round-trips correctly (insert object, query, verify structure)

### Risk Mitigation
- **`writeAuditLog` is fire-and-forget**: Currently sync void, becoming async void. Callers don't await it. This is intentional — audit writes should not block request handling. But the promise should be caught to prevent unhandled rejections:
  ```typescript
  export function writeAuditLog(entry: AuditEntry): void {
    writeAuditLogAsync(entry).catch(err => log.error({ err, entry }, 'Failed to write audit log'));
  }
  // Keep the sync wrapper for backward compatibility, internally calls async
  ```
  This avoids cascading caller changes for audit-logger specifically.
- **JSONB serialization**: When passing JS objects to `pg.query()`, `pg` automatically serializes to JSON. But verify this with a test.

---

## Task 5: #650 Phase 2: Core App Tables

**Goal**: Migrate 7 core application tables to PostgreSQL.

### Tables
1. `sessions` — auth sessions
2. `users` — user accounts with RBAC
3. `settings` — app configuration (already PoC'd in #648)
4. `insights` — monitoring insights
5. `actions` — remediation actions
6. `investigations` — root cause analysis
7. `incidents` — correlated alert groups

### Migration Files to Create

#### `backend/src/db/pg-migrations/006_sessions.sql`
```sql
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  token_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_active TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_valid BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
```

Key changes:
- `INTEGER ... DEFAULT 1` for boolean → `BOOLEAN ... DEFAULT TRUE`
- `unixepoch(expires_at) > unixepoch(?)` → `expires_at > $1::timestamptz`

#### `backend/src/db/pg-migrations/007_users.sql`
```sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK(role IN ('viewer', 'operator', 'admin')),
  default_landing_page TEXT NOT NULL DEFAULT '/',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);
```

Note: `default_landing_page` column (from migration 016) is included directly in the CREATE TABLE.

#### `backend/src/db/pg-migrations/008_settings.sql`
```sql
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_settings_category ON settings(category);
```

#### `backend/src/db/pg-migrations/009_insights.sql`
```sql
CREATE TABLE IF NOT EXISTS insights (
  id TEXT PRIMARY KEY,
  endpoint_id INTEGER,
  endpoint_name TEXT,
  container_id TEXT,
  container_name TEXT,
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  suggested_action TEXT,
  is_acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_insights_severity ON insights(severity);
CREATE INDEX IF NOT EXISTS idx_insights_created ON insights(created_at);
CREATE INDEX IF NOT EXISTS idx_insights_container ON insights(container_id);
```

#### `backend/src/db/pg-migrations/010_actions.sql`
```sql
CREATE TABLE IF NOT EXISTS actions (
  id TEXT PRIMARY KEY,
  insight_id TEXT REFERENCES insights(id),
  endpoint_id INTEGER NOT NULL,
  container_id TEXT NOT NULL,
  container_name TEXT NOT NULL,
  action_type TEXT NOT NULL,
  rationale TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'executing', 'completed', 'failed')),
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  rejected_by TEXT,
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,
  executed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  execution_result TEXT,
  execution_duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_actions_status ON actions(status);
CREATE INDEX IF NOT EXISTS idx_actions_container ON actions(container_id);
CREATE INDEX IF NOT EXISTS idx_actions_created ON actions(created_at);
```

Also apply the unique constraint from migration 025:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_actions_pending_unique
  ON actions(container_id, action_type) WHERE status = 'pending';
```

#### `backend/src/db/pg-migrations/011_investigations.sql`
```sql
CREATE TABLE IF NOT EXISTS investigations (
  id TEXT PRIMARY KEY,
  insight_id TEXT NOT NULL REFERENCES insights(id),
  endpoint_id INTEGER,
  container_id TEXT,
  container_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'gathering', 'analyzing', 'complete', 'failed')),
  evidence_summary TEXT,
  root_cause TEXT,
  contributing_factors TEXT,
  severity_assessment TEXT,
  recommended_actions TEXT,
  confidence_score DOUBLE PRECISION,
  analysis_duration_ms INTEGER,
  llm_model TEXT,
  ai_summary TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_investigations_insight ON investigations(insight_id);
CREATE INDEX IF NOT EXISTS idx_investigations_container ON investigations(container_id);
CREATE INDEX IF NOT EXISTS idx_investigations_status ON investigations(status);
CREATE INDEX IF NOT EXISTS idx_investigations_created ON investigations(created_at);
```

Note: `ai_summary` column (from migration 023) included directly.

#### `backend/src/db/pg-migrations/012_incidents.sql`
```sql
CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  severity TEXT CHECK (severity IN ('critical', 'warning', 'info')) NOT NULL,
  status TEXT CHECK (status IN ('active', 'resolved')) NOT NULL DEFAULT 'active',
  root_cause_insight_id TEXT REFERENCES insights(id),
  related_insight_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  affected_containers JSONB NOT NULL DEFAULT '[]'::jsonb,
  endpoint_id INTEGER,
  endpoint_name TEXT,
  correlation_type TEXT NOT NULL,
  correlation_confidence TEXT CHECK (correlation_confidence IN ('high', 'medium', 'low')) NOT NULL DEFAULT 'medium',
  insight_count INTEGER NOT NULL DEFAULT 1,
  summary TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
CREATE INDEX IF NOT EXISTS idx_incidents_severity ON incidents(severity);
CREATE INDEX IF NOT EXISTS idx_incidents_created_at ON incidents(created_at);
CREATE INDEX IF NOT EXISTS idx_incidents_endpoint_id ON incidents(endpoint_id);
```

Key changes:
- `related_insight_ids TEXT DEFAULT '[]'` → `JSONB NOT NULL DEFAULT '[]'::jsonb`
- `affected_containers TEXT DEFAULT '[]'` → `JSONB NOT NULL DEFAULT '[]'::jsonb`

### Seed Data Migrations

#### `backend/src/db/pg-migrations/013_seed_settings.sql`
Port seed data from migrations 008, 024, 030, 039, 040, 041:
```sql
-- OIDC defaults
INSERT INTO settings (key, value, category) VALUES
  ('oidc.enabled', 'false', 'authentication'),
  ('oidc.issuer_url', '', 'authentication'),
  -- ... etc
ON CONFLICT (key) DO NOTHING;

-- Security audit ignore list
INSERT INTO settings (key, value, category, updated_at) VALUES
  ('security_audit_ignore_list', '["portainer","portainer_edge_agent",...]', 'security', NOW())
ON CONFLICT (key) DO NOTHING;

-- Default prompts (from 030)
INSERT INTO settings (key, value, category, updated_at) VALUES
  ('prompts.chat_assistant.system_prompt', '...', 'prompts', NOW()),
  -- ... all 11 prompts
ON CONFLICT (key) DO NOTHING;

-- OIDC group mapping (from 041)
INSERT INTO settings (key, value, category) VALUES
  ('oidc.groups_claim', 'groups', 'authentication'),
  ('oidc.group_role_mappings', '{}', 'authentication'),
  ('oidc.auto_provision', 'true', 'authentication')
ON CONFLICT (key) DO NOTHING;

-- Reports infrastructure patterns (from 040)
INSERT INTO settings (key, value, category, updated_at) VALUES
  ('reports.infrastructure_service_patterns', '["traefik","portainer_agent","beyla"]', 'reports', NOW())
ON CONFLICT (key) DO NOTHING;
```

### Service Files to Modify (same pattern as Phase 1)

1. **`session-store.ts`** — `prepareStmt(...)` → `db.execute/queryOne(...)`, `is_valid = 1` → `is_valid = TRUE`, `unixepoch()` → direct timestamp comparison
2. **`user-store.ts`** — sync → async, `?` → `$N`
3. **`settings-store.ts`** — already done as PoC in #648, finalize here
4. **`insights-store.ts`** — sync → async, `is_acknowledged` int → boolean
5. **`actions-store.ts`** — sync → async, standard conversions
6. **`investigation-store.ts`** — sync → async, dynamic SET clause needs `$N` counter
7. **`incident-store.ts`** — sync → async, `JSON.stringify` for related_insight_ids → pass array directly (JSONB), `JSON.parse` on read → direct object access

### OIDC Service Update
- `backend/src/services/oidc.ts` — uses `getDb()` for settings queries. Convert to use `getAppDbFor('settings')`.

### Update `app-db-router.ts`
Add Phase 2 domains:
```typescript
const PG_DOMAINS = new Set<string>([
  // Phase 1
  'traces', 'audit', 'llm-traces', 'monitoring', 'notifications',
  // Phase 2
  'sessions', 'users', 'settings', 'insights', 'actions', 'investigations', 'incidents',
]);
```

### Test Strategy
- **Session store**: Test `is_valid` boolean handling (PG `true`/`false` vs SQLite `1`/`0`)
- **Settings store**: Test `ON CONFLICT` upsert behavior
- **Incident store**: Test JSONB array round-trip for `related_insight_ids` and `affected_containers`
- **Investigation store**: Test dynamic UPDATE with variable column count
- Each service file gets updated unit tests + one integration test

### Risk Mitigation
- **Session expiry comparison**: SQLite uses `unixepoch()` which doesn't exist in PG. Replace with:
  ```sql
  -- SQLite: WHERE unixepoch(expires_at) > unixepoch(?)
  -- PG:    WHERE expires_at > $1::timestamptz
  ```
  Since we're using `TIMESTAMPTZ`, direct comparison works.
- **Boolean conversion**: SQLite `is_valid = 1` → PG `is_valid = TRUE`. The AppDb adapter should NOT auto-convert — service code must use PG syntax.
- **JSONB arrays**: In incidents, `related_insight_ids` was stored as `JSON.stringify([...])` text. In PG, pass the array directly and PG serializes to JSONB. On read, `pg` client returns parsed JS objects automatically.

---

## Task 6: #651 Phase 3: Feature Tables

**Goal**: Migrate all remaining tables to PostgreSQL.

### Complete Table Audit

All 41 SQLite migrations create/modify these tables:

| # | Migration | Table(s) | Phase |
|---|-----------|----------|-------|
| 001 | sessions | `sessions` | Phase 2 |
| 002 | settings | `settings` | Phase 2 |
| 003 | insights | `insights` | Phase 2 |
| 004 | metrics | `metrics` | **SKIP** — already in TimescaleDB |
| 005 | actions | `actions` | Phase 2 |
| 006 | traces | `spans` | Phase 1 |
| 007 | audit_log | `audit_log` | Phase 1 |
| 008 | oidc_seed | seed data for `settings` | Phase 2 |
| 009 | investigations | `investigations` | Phase 2 |
| 010 | notification_log | `notification_log` | Phase 1 |
| 011 | pcap_captures | `pcap_captures` | **Phase 3** |
| 012 | monitoring_telemetry | `monitoring_cycles`, `monitoring_snapshots` | Phase 1 |
| 013 | webhooks | `webhooks`, `webhook_deliveries` | **Phase 3** |
| 014 | incidents | `incidents` | Phase 2 |
| 015 | users | `users` | Phase 2 |
| 016 | default_landing_page | ALTER `users` | Phase 2 (merged) |
| 017 | kpi_snapshots | `kpi_snapshots` | **SKIP** — already in TimescaleDB |
| 018 | image_staleness | `image_staleness` | **Phase 3** |
| 019 | llm_traces | `llm_traces` | Phase 1 |
| 020 | network_metrics | ALTER `metrics` | **SKIP** — TimescaleDB |
| 021 | drop_llm_feedback | DROP table | N/A (cleanup) |
| 022 | trace_source | ALTER `spans` | Phase 1 (merged) |
| 023 | investigation_ai_summary | ALTER `investigations` | Phase 2 (merged) |
| 024 | security_audit_ignore_list | seed data for `settings` | Phase 2 |
| 025 | actions_pending_unique | ADD INDEX on `actions` | Phase 2 (merged) |
| 026 | pcap_analysis | ALTER `pcap_captures` | **Phase 3** (merged) |
| 027 | pcap_fix_status_constraint | ALTER `pcap_captures` | **Phase 3** (merged) |
| 028 | ebpf_coverage | `ebpf_coverage` | **Phase 3** |
| 029 | mcp_servers | `mcp_servers` | **Phase 3** |
| 030 | prompt_defaults | seed data for `settings` | Phase 2 |
| 031 | ebpf_coverage_statuses | ALTER `ebpf_coverage` | **Phase 3** (merged) |
| 032 | prompt_profiles | `prompt_profiles` | **Phase 3** |
| 033 | llm_feedback | `llm_feedback`, `llm_prompt_suggestions` | **Phase 3** |
| 034 | feedback_context | ALTER `llm_feedback` | **Phase 3** (merged) |
| 035 | ebpf_beyla_lifecycle | ALTER `ebpf_coverage` | **Phase 3** (merged) |
| 036 | trace_typed_otlp_attributes | ALTER `spans` | Phase 1 (merged) |
| 037 | ebpf_otlp_endpoint_override | ALTER `ebpf_coverage` | **Phase 3** (merged) |
| 038 | trace_extended_beyla_attributes | ALTER `spans` | Phase 1 (merged) |
| 039 | update_builtin_profile_prompts | UPDATE `prompt_profiles` | **Phase 3** |
| 040 | reports_infrastructure_patterns | seed data for `settings` | Phase 2 |
| 041 | oidc_group_mapping | seed data for `settings` | Phase 2 |

### Phase 3 Tables (remaining)

#### `backend/src/db/pg-migrations/014_pcap_captures.sql`
Merge migrations 011, 026, 027 into single CREATE TABLE:
```sql
CREATE TABLE IF NOT EXISTS pcap_captures (
  id TEXT PRIMARY KEY,
  endpoint_id INTEGER NOT NULL,
  container_id TEXT NOT NULL,
  container_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'capturing', 'processing', 'complete', 'failed', 'stopped', 'analyzed')),
  filter TEXT,
  duration_seconds INTEGER,
  max_packets INTEGER,
  capture_file TEXT,
  file_size_bytes INTEGER,
  packet_count INTEGER,
  protocol_stats JSONB,
  exec_id TEXT,
  error_message TEXT,
  analysis_result JSONB,
  analyzed_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pcap_captures_status ON pcap_captures(status);
CREATE INDEX IF NOT EXISTS idx_pcap_captures_container_id ON pcap_captures(container_id);
CREATE INDEX IF NOT EXISTS idx_pcap_captures_created_at ON pcap_captures(created_at);
```

#### `backend/src/db/pg-migrations/015_webhooks.sql`
```sql
CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  events JSONB NOT NULL DEFAULT '["insight.created"]'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY,
  webhook_id TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  http_status INTEGER,
  response_body TEXT,
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_retry_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook_id ON webhook_deliveries(webhook_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON webhook_deliveries(status);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_next_retry ON webhook_deliveries(status, next_retry_at);
```

Key: `ON DELETE CASCADE` preserved from SQLite version.

#### `backend/src/db/pg-migrations/016_image_staleness.sql`
```sql
CREATE TABLE IF NOT EXISTS image_staleness (
  id BIGSERIAL PRIMARY KEY,
  image_name TEXT NOT NULL,
  image_tag TEXT NOT NULL DEFAULT 'latest',
  registry TEXT NOT NULL DEFAULT 'docker.io',
  local_digest TEXT,
  remote_digest TEXT,
  is_stale BOOLEAN NOT NULL DEFAULT FALSE,
  days_since_update INTEGER,
  last_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(image_name, image_tag, registry)
);

CREATE INDEX IF NOT EXISTS idx_image_staleness_stale ON image_staleness(is_stale);
CREATE INDEX IF NOT EXISTS idx_image_staleness_name ON image_staleness(image_name);
```

#### `backend/src/db/pg-migrations/017_ebpf_coverage.sql`
Merge migrations 028, 031, 035, 037:
```sql
CREATE TABLE IF NOT EXISTS ebpf_coverage (
  endpoint_id INTEGER PRIMARY KEY,
  endpoint_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (status IN ('planned', 'deployed', 'excluded', 'failed', 'unknown', 'not_deployed', 'unreachable', 'incompatible')),
  beyla_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  beyla_container_id TEXT,
  beyla_managed BOOLEAN NOT NULL DEFAULT FALSE,
  otlp_endpoint_override TEXT,
  exclusion_reason TEXT,
  deployment_profile TEXT,
  last_trace_at TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### `backend/src/db/pg-migrations/018_mcp_servers.sql`
```sql
CREATE TABLE IF NOT EXISTS mcp_servers (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  transport TEXT NOT NULL CHECK (transport IN ('stdio', 'sse', 'http')),
  command TEXT,
  url TEXT,
  args JSONB,
  env JSONB,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  disabled_tools JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Key: `args TEXT` → `JSONB`, `env TEXT` → `JSONB`, `disabled_tools TEXT` → `JSONB`, `enabled INTEGER` → `BOOLEAN`.

#### `backend/src/db/pg-migrations/019_prompt_profiles.sql`
```sql
CREATE TABLE IF NOT EXISTS prompt_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  is_built_in BOOLEAN NOT NULL DEFAULT FALSE,
  prompts_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed 3 built-in profiles
INSERT INTO prompt_profiles (id, name, description, is_built_in, prompts_json)
VALUES ('default', 'Default', 'Standard balanced prompts for general operations', TRUE, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO prompt_profiles (id, name, description, is_built_in, prompts_json)
VALUES ('security-audit', 'Security Audit', 'Focus on CVEs, lateral movement, compliance, and data exfiltration', TRUE, '...'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO prompt_profiles (id, name, description, is_built_in, prompts_json)
VALUES ('devops', 'DevOps', 'Performance, uptime, resource optimization, and deployment health', TRUE, '...'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- Set default active profile
INSERT INTO settings (key, value, category, updated_at)
VALUES ('prompts.active_profile', 'default', 'prompts', NOW())
ON CONFLICT (key) DO NOTHING;
```

#### `backend/src/db/pg-migrations/020_llm_feedback.sql`
Merge migrations 033, 034:
```sql
CREATE TABLE IF NOT EXISTS llm_feedback (
  id TEXT PRIMARY KEY,
  trace_id TEXT,
  message_id TEXT,
  feature TEXT NOT NULL,
  rating TEXT NOT NULL CHECK (rating IN ('positive', 'negative')),
  comment TEXT,
  user_id TEXT NOT NULL,
  admin_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (admin_status IN ('pending', 'approved', 'rejected', 'overruled')),
  admin_note TEXT,
  effective_rating TEXT CHECK (effective_rating IN ('positive', 'negative')),
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT,
  response_preview TEXT,
  user_query TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- indexes ...

CREATE TABLE IF NOT EXISTS llm_prompt_suggestions (
  id TEXT PRIMARY KEY,
  feature TEXT NOT NULL,
  current_prompt TEXT NOT NULL,
  suggested_prompt TEXT NOT NULL,
  reasoning TEXT NOT NULL,
  evidence_feedback_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  negative_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'applied', 'dismissed', 'edited')),
  applied_at TIMESTAMPTZ,
  applied_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### SQLite `metrics` table (004, 020) — SKIP

The `metrics` table was the original SQLite metrics storage. It was superseded by TimescaleDB (`timescale.ts`). **Confirm**: Is anything still writing to the SQLite `metrics` table? If yes, it needs migration. If no (likely — all metrics go to TimescaleDB now), skip it and delete the table in cleanup (#654).

### Service Files to Modify

1. **`pcap-store.ts`** — sync → async, `protocol_stats` TEXT → JSONB
2. **`webhook-service.ts`** — sync → async, `events TEXT` → JSONB (no `JSON.stringify`/`JSON.parse`), `enabled INTEGER` → BOOLEAN
3. **`image-staleness.ts`** — sync → async, `is_stale INTEGER` → BOOLEAN
4. **`ebpf-coverage.ts`** — sync → async, `beyla_enabled/beyla_managed INTEGER` → BOOLEAN, **async transaction conversion** for bulk operations
5. **`mcp-manager.ts`** — sync → async, `args/env/disabled_tools TEXT` → JSONB, `enabled INTEGER` → BOOLEAN
6. **`prompt-profile-store.ts`** — sync → async, `is_built_in INTEGER` → BOOLEAN, `prompts_json TEXT` → JSONB
7. **`feedback-store.ts`** — sync → async, `evidence_feedback_ids TEXT` → JSONB
8. **`status-page-store.ts`** — sync → async (if it has its own table, verify)
9. **`llm-tools.ts`** — sync → async (if it queries SQLite directly)

### `ebpf-coverage.ts` Transaction Conversion

This file uses `db.transaction()` for bulk operations (deploy/enable/disable Beyla across endpoints). Convert:
```typescript
// Before (SQLite sync transaction):
const insertOrUpdate = db.transaction((records: CoverageRecord[]) => {
  for (const r of records) { stmt.run(...); }
});

// After (PG async transaction):
await db.transaction(async (tx) => {
  for (const r of records) {
    await tx.execute(`INSERT INTO ... ON CONFLICT (endpoint_id) DO UPDATE SET ...`, [...]);
  }
});
```

### Update `app-db-router.ts`
Add all remaining domains. At this point, `PG_DOMAINS` should contain everything. Consider simplifying:
```typescript
// After Phase 3: ALL domains use PG. SQLite adapter is now unused.
// Can simplify to always return PG adapter.
```

### Test Strategy
- Same pattern as Phase 1/2: update each `*.test.ts`
- **JSONB-specific tests**:
  - `webhook-service`: Verify `events` stored as JSONB array, retrievable as JS array
  - `mcp-manager`: Verify `args` JSONB round-trip
  - `prompt-profiles`: Verify `prompts_json` JSONB with nested objects
- **FK CASCADE test**: Delete a webhook, verify all its deliveries are cascaded
- **Boolean test**: `ebpf-coverage` `beyla_enabled` — verify PG returns JS boolean, not 0/1

### Risk Mitigation
- **Transaction in ebpf-coverage.ts**: Complex logic with Portainer API calls inside transaction. The PG transaction should ONLY wrap DB operations, not API calls. Restructure: gather data first, then wrap only the DB writes in a transaction.
- **`status-page-store.ts`**: Verify if this creates its own table or uses existing tables. If no dedicated table, it just needs caller async conversion.

---

## Task 7: #653 Backup Service Rewrite

**Goal**: Replace SQLite file-copy backup with `pg_dump`-based backup.

### Files to Modify

#### `backend/src/services/backup-service.ts` — Full Rewrite

**Before**: Copy SQLite `.db` file.
**After**: Use `pg_dump` to create SQL dump files.

```typescript
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { getConfig } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);
const log = createChildLogger('backup-service');

function getBackupsDir(): string {
  const backupsDir = path.join(process.cwd(), 'data', 'backups');
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }
  return backupsDir;
}

export async function createBackup(): Promise<string> {
  const config = getConfig();
  const backupsDir = getBackupsDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `dashboard-backup-${timestamp}.sql.gz`;
  const destPath = path.join(backupsDir, filename);

  // Parse connection string for pg_dump
  const url = new URL(config.POSTGRES_APP_URL);

  // pg_dump with gzip compression
  await execFileAsync('pg_dump', [
    '-h', url.hostname,
    '-p', url.port || '5432',
    '-U', url.username,
    '-d', url.pathname.slice(1), // remove leading /
    '--format=custom',           // compressed binary format
    '--file', destPath,
  ], {
    env: { ...process.env, PGPASSWORD: url.password },
    timeout: 60_000,
  });

  log.info({ filename, destPath }, 'Database backup created');
  return filename;
}
```

**API compatibility**: Keep same interface — `createBackup()`, `listBackups()`, `getBackupPath()`, `deleteBackup()`, `restoreBackup()`.

**`restoreBackup()`**: Use `pg_restore`:
```typescript
export async function restoreBackup(filename: string): Promise<void> {
  const config = getConfig();
  const backupPath = getBackupPath(filename);
  const url = new URL(config.POSTGRES_APP_URL);

  await execFileAsync('pg_restore', [
    '-h', url.hostname,
    '-p', url.port || '5432',
    '-U', url.username,
    '-d', url.pathname.slice(1),
    '--clean',        // drop objects before recreating
    '--if-exists',    // don't error if objects don't exist
    backupPath,
  ], {
    env: { ...process.env, PGPASSWORD: url.password },
    timeout: 120_000,
  });

  log.info({ filename }, 'Database restored from backup');
}
```

**`listBackups()`**: Change file extension filter from `.db` to `.sql.gz` or custom format.

### Docker Changes
- Ensure `pg_dump` and `pg_restore` are available in the backend container
- Add to `backend/Dockerfile`:
  ```dockerfile
  RUN apk add --no-cache postgresql17-client
  ```
  (or equivalent for the base image)

#### `backend/src/routes/backup.ts`
- Functions are now async — update route handlers to `await`
- `createBackup()` → `await createBackup()`
- Download endpoint: file extension changes from `.db` to custom format

### Test Strategy
- **Unit test**: Mock `execFile`, verify correct `pg_dump` arguments
- **Integration test**: Use Testcontainers, create backup, restore to fresh DB, verify data integrity
- **Security test**: Verify path traversal protection still works

### Risk Mitigation
- **`pg_dump` not installed**: The backend Docker image needs `postgresql-client` package. Add to Dockerfile.
- **Large databases**: Use `--format=custom` (compressed) instead of plain SQL to reduce backup size
- **Restore safety**: `pg_restore --clean` drops and recreates. Add confirmation warning in API response.

---

## Task 8: #654 Cleanup

**Goal**: Remove SQLite dependency entirely, clean up code, update docs.

### Files to Delete
- `backend/src/db/sqlite.ts`
- `backend/src/db/sqlite.test.ts`
- `backend/src/db/sqlite-adapter.ts` (created in #648, no longer needed)
- `backend/src/db/migrations/` (entire directory — all 41 SQLite migration files)

### Files to Modify

#### `backend/src/db/app-db-router.ts`
Simplify — remove SQLite fallback, always return PG adapter:
```typescript
export async function getAppDbFor(_domain: string): Promise<AppDb> {
  if (!pgAdapter) {
    const pool = await getAppDb();
    pgAdapter = createPgAdapter(pool);
  }
  return pgAdapter;
}
```

Or even simpler: remove the router entirely and have services import `getAppDb()` + `createPgAdapter()` directly. But keeping the router provides a single point of change if the underlying DB ever changes again.

#### `backend/src/config/env.schema.ts`
Remove:
```typescript
SQLITE_PATH: z.string().default('./data/dashboard.db'),
SQLITE_BUSY_TIMEOUT: z.coerce.number().int().min(1000).max(60000).default(5000),
```

#### `backend/src/routes/health.ts`
Remove:
```typescript
import { isDbHealthy } from '../db/sqlite.js';
```
Remove SQLite health check from `runChecks()`.

#### `backend/src/index.ts`
Remove:
```typescript
import { closeDb } from './db/sqlite.js';
// Remove closeDb() from shutdown handler
```

#### `backend/package.json`
Remove dependency:
```
"better-sqlite3": "...",
"@types/better-sqlite3": "...",
```

#### `.env.example`
Remove:
```
SQLITE_PATH=./data/dashboard.db
SQLITE_BUSY_TIMEOUT=5000
```

#### `docker/docker-compose.yml` and `docker/docker-compose.dev.yml`
Remove SQLite-related environment variables:
```yaml
- SQLITE_PATH=/app/data/dashboard.db
```

Note: Keep the `backend-data` volume — it may still be used for PCAP storage and other file-based data.

### Documentation Updates

#### `CLAUDE.md`
- Update Architecture section: remove "SQLite (WAL)" references, add PostgreSQL
- Update Build Commands if any changed
- Update Environment section: remove SQLITE vars, add POSTGRES_APP vars

#### `AGENTS.md` and `GEMINI.md`
- Same changes as CLAUDE.md (keep in sync per project rules)

#### `docs/architecture.md`
- Update database section

#### `.env.example`
- Already covered above

### Verify: No remaining SQLite references
Run after all changes:
```bash
grep -r "sqlite" backend/src/ --include="*.ts" -l
grep -r "getDb\(\)" backend/src/ --include="*.ts" -l
grep -r "prepareStmt" backend/src/ --include="*.ts" -l
grep -r "better-sqlite3" backend/ -l
grep -r "SQLITE" backend/src/ --include="*.ts" -l
```

All should return empty.

### Test Strategy
- **Full test suite**: Run `npm test` — all tests must pass
- **Build verification**: `npm run build` — no TypeScript errors
- **Docker smoke test**: `docker compose up` — verify app starts, health checks pass
- **Grep verification**: No remaining SQLite references in codebase

### Risk Mitigation
- **Staged removal**: Only delete SQLite after ALL phases are complete and verified
- **Keep migration files archived**: Move `backend/src/db/migrations/` to `docs/archive/sqlite-migrations/` instead of deleting, for historical reference
- **Volume cleanup docs**: Document that existing deployments need to:
  1. Run the new PG migrations
  2. (Data migration is skipped — fresh data collection)
  3. Remove old SQLite volume data

---

## Execution Order & Dependencies

```
#646 (ADR)
  ↓
#647 (PG Foundation) → #648 (Abstraction Layer)
                          ↓
                        #649 (Phase 1: High-Write)
                          ↓
                        #650 (Phase 2: Core App)
                          ↓
                        #651 (Phase 3: Feature Tables)
                          ↓
                    #653 (Backup Rewrite)
                          ↓
                        #654 (Cleanup)
```

Each phase is independently deployable — the app-db-router ensures services use the correct backend during the transition.

## Summary Statistics

| Metric | Count |
|--------|-------|
| SQLite migrations to port | 41 |
| PG migration files to create | ~20 (merged) |
| Service files to convert | 24 |
| Route files to update | 10 |
| Socket files to update | 3 |
| Tables migrating to PG | ~20 (excl. metrics/kpi in TimescaleDB) |
| Tables with JSONB upgrade | 10 |
| Tables with BOOLEAN upgrade | 5 |
| Sync→async function conversions | ~100+ |
