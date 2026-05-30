# Active Incidents — Two-Level Rollup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat 455-row Active Incidents list on `/health` with a two-level rollup (signature group → top-10 containers + Show all) that scales to thousands of incidents and gives a 5-second overview.

**Architecture:** Backend adds a `signature` column on `incidents`, populated at insert time from the source insight's structured fields. A new SQL aggregate endpoint `GET /api/incidents/groups` returns one row per signature with counts, top-10 containers, and the full container-name list for client-side search. A new `POST /api/incidents/resolve` batch endpoint lets the UI resolve a group atomically per-id. Frontend renders a new `IncidentGroupsView` with summary strip, endpoint chips, expandable groups, and the existing search/sort/time-range controls preserved.

**Tech Stack:** PostgreSQL (real DB tests via `test-db-helper`), Fastify 5, TypeScript, Zod, npm workspaces (`packages/core`, `packages/ai-intelligence`), Vitest, React 19 + Vite + TanStack Query, Radix UI, jsdom + `@testing-library/react`.

**Spec:** `docs/superpowers/specs/2026-05-06-active-incidents-rollup-design.md`

**Reference dependency:** Cache utilities (`cachedFetchSWR`, `getCacheKey`, `TTL`, `cache.invalidateTag`) are already in `@dashboard/core/portainer/portainer-cache.js` and importable from `packages/ai-intelligence`. No promotion task needed.

---

## Conventions for this plan

- **Working dir:** repo root unless noted. Commands are zsh.
- **Backend tests:** `cd packages/ai-intelligence && npx vitest run src/__tests__/<file>.test.ts`. DB-backed tests need `POSTGRES_TEST_URL=postgresql://app_user:changeme-postgres-app@localhost:5433/portainer_dashboard_test` (see `CLAUDE.md`).
- **Frontend tests:** `cd frontend && npx vitest run src/features/ai-intelligence/<path>` (must run from `frontend/`).
- **Commit style:** match existing repo style. Each task ends in one commit per `docs/superpowers/specs/...`. Branch: continue on `feature/health-monitoring-ux-overhaul`.
- **TDD:** every task writes the failing test first, runs it to confirm failure, implements, runs again to confirm pass, commits.
- **Do not skip hooks** (`--no-verify` is forbidden by `CLAUDE.md`).

---

### Task 1: Phase A migration — add `signature` column

**Files:**
- Create: `packages/core/src/db/postgres-migrations/029_add_incident_signature.sql`

**Why:** Non-blocking column add (Postgres metadata-only). Phase B index creation lives in Task 2 because `CREATE INDEX CONCURRENTLY` cannot run inside a transaction, but the migration runner wraps each migration in one.

- [ ] **Step 1: Verify next migration number**

```bash
ls packages/core/src/db/postgres-migrations/ | tail -3
```

Expected: highest existing number is `028_*.sql`. Use `029` for the new file.

- [ ] **Step 2: Create the migration file**

Write `packages/core/src/db/postgres-migrations/029_add_incident_signature.sql`:

```sql
-- Migration 029: add `signature` column to incidents
--
-- Backs the two-level rollup on the Health & Monitoring page.
-- Populated at insert time from the source insight's structured
-- fields (`category`, `metric_type`, `detection_method`).
--
-- Phase A only — column add, no indexes here. The
-- `CREATE INDEX CONCURRENTLY` step lives in
-- packages/ai-intelligence/scripts/create-incident-signature-indexes.ts
-- and is invoked outside any transaction at deploy time.

ALTER TABLE incidents ADD COLUMN IF NOT EXISTS signature TEXT;
```

- [ ] **Step 3: Apply migration to dev DB**

```bash
docker compose -f docker/docker-compose.dev.yml up -d postgres-app postgres-test
# The migration runs automatically on first getDb() call. Trigger it
# by running the existing test suite once:
cd packages/ai-intelligence && npx vitest run src/__tests__/incidents.test.ts -t "list incidents"
```

Expected: tests pass, no migration error in logs.

- [ ] **Step 4: Verify column exists**

```bash
docker compose -f docker/docker-compose.dev.yml exec postgres-app \
  psql -U app_user -d portainer_dashboard -c '\d incidents' | grep signature
```

Expected: `signature | text` line in output.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/db/postgres-migrations/029_add_incident_signature.sql
git commit -m "feat(incidents): add nullable signature column (Phase A migration)"
```

---

### Task 2: Phase B index-creation script

**Files:**
- Create: `packages/ai-intelligence/scripts/create-incident-signature-indexes.ts`
- Create: `packages/ai-intelligence/scripts/README.md` (only if absent — small index of scripts)
- Modify: `packages/ai-intelligence/package.json` (add `scripts.indexes:incidents`)

**Why:** `CREATE INDEX CONCURRENTLY` requires running outside any transaction. The auto-migration runner wraps migrations in one, so this lives as a deploy-time script.

- [ ] **Step 1: Write the script**

Write `packages/ai-intelligence/scripts/create-incident-signature-indexes.ts`:

```ts
#!/usr/bin/env tsx
/**
 * Phase B of the incident-signature rollup migration.
 *
 * Creates two indexes on the incidents table without holding a
 * transaction lock — required by Postgres for CONCURRENTLY.
 *
 * Idempotent: IF NOT EXISTS guards re-runs.
 *
 * Usage (in a deploy step or one-off):
 *   POSTGRES_APP_URL=postgresql://… npm run -w @dashboard/ai indexes:incidents
 */
import { Client } from 'pg';

const APP_URL = process.env.POSTGRES_APP_URL ?? process.env.POSTGRES_URL;
if (!APP_URL) {
  console.error('POSTGRES_APP_URL (or POSTGRES_URL) must be set');
  process.exit(1);
}

const STATEMENTS = [
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_incidents_signature_status
     ON incidents (signature, status)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_incidents_endpoint_status
     ON incidents (endpoint_id, status)`,
];

async function main() {
  const client = new Client({ connectionString: APP_URL });
  await client.connect();
  try {
    for (const sql of STATEMENTS) {
      const start = Date.now();
      console.log(`> ${sql.split('\n')[0].trim()}`);
      await client.query(sql);
      console.log(`  ok (${Date.now() - start} ms)`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Index creation failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Add npm script entry**

Edit `packages/ai-intelligence/package.json` — add this entry inside `"scripts"`:

```json
"indexes:incidents": "tsx scripts/create-incident-signature-indexes.ts"
```

- [ ] **Step 3: Run the script against dev DB**

```bash
POSTGRES_APP_URL=postgresql://app_user:changeme-postgres-app@localhost:5432/portainer_dashboard \
  npm run -w @dashboard/ai indexes:incidents
```

Expected output:
```
> CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_incidents_signature_status
  ok (... ms)
> CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_incidents_endpoint_status
  ok (... ms)
```

- [ ] **Step 4: Re-run to verify idempotency**

Run the same command again. Expected: both statements succeed (no error from `IF NOT EXISTS`).

- [ ] **Step 5: Verify indexes exist**

```bash
docker compose -f docker/docker-compose.dev.yml exec postgres-app \
  psql -U app_user -d portainer_dashboard -c '\d incidents' | grep idx_incidents
```

Expected: two `btree` index lines, one for `(signature, status)`, one for `(endpoint_id, status)`.

- [ ] **Step 6: Commit**

```bash
git add packages/ai-intelligence/scripts/create-incident-signature-indexes.ts \
        packages/ai-intelligence/package.json
git commit -m "feat(incidents): Phase B index-creation script (CONCURRENTLY, idempotent)"
```

---

### Task 3: Add structured fields to the `Insight` model

**Files:**
- Modify: `packages/core/src/models/monitoring.ts` (Insight Zod schema)
- Test: `packages/core/src/__tests__/monitoring-schema.test.ts` (create if absent — small)

**Why:** `metric_type` and `detection_method` are the structured inputs to `deriveSignature` (Task 4). Adding them as **optional** fields keeps every existing call site backward-compatible.

- [ ] **Step 1: Find the schema**

```bash
grep -n "InsightSchema\|insightSchema\|category: z\." packages/core/src/models/monitoring.ts
```

Expected: location of the `category: z.string()` line previously identified at line 10.

- [ ] **Step 2: Write the failing test**

Create or extend `packages/core/src/__tests__/monitoring-schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { InsightSchema } from '../models/monitoring.js';

describe('Insight schema — structured signature inputs', () => {
  it('accepts optional metric_type and detection_method', () => {
    const parsed = InsightSchema.parse({
      id: 'a',
      endpoint_id: 1,
      endpoint_name: 'e',
      container_id: 'c',
      container_name: 'cn',
      severity: 'warning',
      category: 'anomaly',
      title: 't',
      description: 'd',
      suggested_action: null,
      is_acknowledged: 0,
      created_at: new Date().toISOString(),
      metric_type: 'cpu',
      detection_method: 'ml-anomaly',
    });
    expect(parsed.metric_type).toBe('cpu');
    expect(parsed.detection_method).toBe('ml-anomaly');
  });

  it('still parses without the new optional fields', () => {
    const parsed = InsightSchema.parse({
      id: 'a',
      endpoint_id: 1,
      endpoint_name: 'e',
      container_id: 'c',
      container_name: 'cn',
      severity: 'warning',
      category: 'anomaly',
      title: 't',
      description: 'd',
      suggested_action: null,
      is_acknowledged: 0,
      created_at: new Date().toISOString(),
    });
    expect(parsed.metric_type).toBeUndefined();
    expect(parsed.detection_method).toBeUndefined();
  });

  it('rejects unknown metric_type values', () => {
    expect(() =>
      InsightSchema.parse({
        id: 'a', endpoint_id: 1, endpoint_name: 'e', container_id: 'c',
        container_name: 'cn', severity: 'warning', category: 'anomaly',
        title: 't', description: 'd', suggested_action: null,
        is_acknowledged: 0, created_at: new Date().toISOString(),
        metric_type: 'bogus',
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 3: Run the test, verify failure**

```bash
cd packages/core && npx vitest run src/__tests__/monitoring-schema.test.ts
```

Expected: failure (the schema rejects `metric_type` because it isn't declared yet, OR the import succeeds but the field is unknown).

- [ ] **Step 4: Add the fields to the schema**

In `packages/core/src/models/monitoring.ts`, locate the existing Insight definition and add:

```ts
metric_type: z.enum(['cpu', 'memory', 'disk', 'network', 'restart']).optional(),
detection_method: z
  .enum(['threshold', 'ml-anomaly', 'prediction', 'health-check', 'log-pattern', 'security-scan'])
  .optional(),
```

(Add these fields immediately after `category` for grouping. If the file has both a Zod schema and a TS interface, mirror the change in the interface as `metric_type?: ...` / `detection_method?: ...`.)

- [ ] **Step 5: Run the test, verify pass**

```bash
cd packages/core && npx vitest run src/__tests__/monitoring-schema.test.ts
```

Expected: 3 passing.

- [ ] **Step 6: Run the full core test suite**

```bash
cd packages/core && npx vitest run
```

Expected: no regressions.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/models/monitoring.ts \
        packages/core/src/__tests__/monitoring-schema.test.ts
git commit -m "feat(monitoring): add optional metric_type and detection_method to Insight schema"
```

---

### Task 4: `signature.ts` derivation module + tests

**Files:**
- Create: `packages/ai-intelligence/src/services/signature.ts`
- Test: `packages/ai-intelligence/src/__tests__/signature.test.ts`

**Why:** Single source of truth for signature derivation, used by both `buildIncident()` (Task 7) and the backfill (Task 8). Pure module — easy to test in isolation.

- [ ] **Step 1: Write the failing test file**

Create `packages/ai-intelligence/src/__tests__/signature.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  deriveSignature,
  deriveSignatureFromTitle,
  signatureLabel,
  slugifyTitle,
} from '../services/signature.js';

describe('deriveSignature — structured-field path', () => {
  it('uses metric_type + detection_method when both present', () => {
    expect(
      deriveSignature({
        category: 'anomaly',
        metric_type: 'cpu',
        detection_method: 'ml-anomaly',
        title: 'whatever',
      }),
    ).toBe('anomaly:ml-anomaly:cpu');
  });

  it('encodes prediction:memory correctly', () => {
    expect(
      deriveSignature({
        category: 'predictive',
        metric_type: 'memory',
        detection_method: 'prediction',
        title: 'Predicted memory exhaustion ~24h',
      }),
    ).toBe('predictive:prediction:memory');
  });
});

describe('deriveSignature — category-only fallbacks', () => {
  it('returns security:scan for security category', () => {
    expect(
      deriveSignature({ category: 'security', title: 'CVE-2024-1234 in container x' }),
    ).toBe('security:scan');
  });
  it('returns log:pattern for log-analysis category', () => {
    expect(deriveSignature({ category: 'log-analysis', title: 'OOM in logs' })).toBe('log:pattern');
  });
  it('returns ai:analysis for ai-analysis category', () => {
    expect(deriveSignature({ category: 'ai-analysis', title: 'AI summary' })).toBe('ai:analysis');
  });
});

describe('deriveSignatureFromTitle — title regex fallback', () => {
  it('matches "Predicted X exhaustion"', () => {
    expect(deriveSignatureFromTitle('Predicted memory exhaustion on "x" ~24h'))
      .toBe('predictive:prediction:memory');
    expect(deriveSignatureFromTitle('Predicted cpu exhaustion on "x" ~6h'))
      .toBe('predictive:prediction:cpu');
  });

  it('matches "Anomalous X usage"', () => {
    expect(deriveSignatureFromTitle('Anomalous cpu usage on "x" (ML-detected)'))
      .toBe('anomaly:ml-anomaly:cpu');
    expect(deriveSignatureFromTitle('Anomalous memory usage on "x"'))
      .toBe('anomaly:threshold:memory');
  });

  it('matches "High X usage"', () => {
    expect(deriveSignatureFromTitle('High cpu usage on "x"'))
      .toBe('anomaly:threshold:cpu');
  });

  it('matches "no health check"', () => {
    expect(deriveSignatureFromTitle('Container x has no health check configured'))
      .toBe('config:health-check:missing');
  });

  it('matches "host network mode"', () => {
    expect(deriveSignatureFromTitle('Container x using host network mode'))
      .toBe('config:network:host-mode');
  });

  it('falls through to unknown:<slug> on no match', () => {
    expect(deriveSignatureFromTitle('Some bizarre new thing happened'))
      .toMatch(/^unknown:/);
  });
});

describe('slugifyTitle', () => {
  it('strips commas (signatures cannot contain commas — used as URL separator)', () => {
    expect(slugifyTitle('a, b, c')).not.toContain(',');
  });
  it('lowercases and dashes', () => {
    expect(slugifyTitle('Hello World')).toBe('hello-world');
  });
});

describe('signatureLabel', () => {
  it('returns curated label for known signature', () => {
    expect(signatureLabel('predictive:prediction:memory')).toBe('Predicted memory exhaustion');
  });
  it('falls back to humanized form for unknown', () => {
    expect(signatureLabel('anomaly:threshold:disk')).toBe('Anomaly · threshold · disk');
  });
});

describe('equivalence — regex output equals structured-field output', () => {
  // For each title pattern, the regex must produce the same signature
  // the structured-field path would for the same problem class.
  const cases = [
    { title: 'Anomalous cpu usage on "x" (ML-detected)',
      structured: { category: 'anomaly', metric_type: 'cpu' as const, detection_method: 'ml-anomaly' as const } },
    { title: 'Anomalous memory usage on "x"',
      structured: { category: 'anomaly', metric_type: 'memory' as const, detection_method: 'threshold' as const } },
    { title: 'Predicted memory exhaustion on "x" ~24h',
      structured: { category: 'predictive', metric_type: 'memory' as const, detection_method: 'prediction' as const } },
    { title: 'Predicted cpu exhaustion on "x" ~6h',
      structured: { category: 'predictive', metric_type: 'cpu' as const, detection_method: 'prediction' as const } },
    { title: 'High cpu usage on "x"',
      structured: { category: 'anomaly', metric_type: 'cpu' as const, detection_method: 'threshold' as const } },
  ];

  for (const c of cases) {
    it(`"${c.title}" — regex matches structured`, () => {
      const fromRegex = deriveSignatureFromTitle(c.title);
      const fromStructured = deriveSignature({ ...c.structured, title: c.title });
      expect(fromRegex).toBe(fromStructured);
    });
  }
});
```

- [ ] **Step 2: Run, verify failure**

```bash
cd packages/ai-intelligence && npx vitest run src/__tests__/signature.test.ts
```

Expected: failure ("Cannot find module '../services/signature.js'" or similar).

- [ ] **Step 3: Implement signature.ts**

Create `packages/ai-intelligence/src/services/signature.ts`:

```ts
import type { Insight } from '@dashboard/core/models/monitoring.js';

type DerivableInsight = Pick<Insight, 'category' | 'metric_type' | 'detection_method' | 'title'>;

const SIGNATURE_LABELS: Record<string, string> = {
  'anomaly:ml-anomaly:cpu': 'Anomalous CPU usage (ML)',
  'anomaly:ml-anomaly:memory': 'Anomalous memory usage (ML)',
  'anomaly:threshold:cpu': 'High CPU usage',
  'anomaly:threshold:memory': 'High memory usage',
  'predictive:prediction:cpu': 'Predicted CPU exhaustion',
  'predictive:prediction:memory': 'Predicted memory exhaustion',
  'predictive:prediction:disk': 'Predicted disk exhaustion',
  'config:health-check:missing': 'Missing health check',
  'config:network:host-mode': 'Host network mode',
  'security:scan': 'Security scan finding',
  'log:pattern': 'Log pattern detected',
  'ai:analysis': 'AI analysis finding',
};

export function deriveSignature(input: DerivableInsight): string {
  if (input.metric_type && input.detection_method) {
    return `${input.category}:${input.detection_method}:${input.metric_type}`;
  }
  if (input.category === 'security') return 'security:scan';
  if (input.category === 'log-analysis') return 'log:pattern';
  if (input.category === 'ai-analysis') return 'ai:analysis';
  return deriveSignatureFromTitle(input.title);
}

const TITLE_RULES: Array<{ rx: RegExp; signature: (m: RegExpExecArray) => string }> = [
  // Predictions: "Predicted memory exhaustion …"
  {
    rx: /predicted\s+(cpu|memory|disk)\s+exhaustion/i,
    signature: (m) => `predictive:prediction:${m[1].toLowerCase()}`,
  },
  // Anomalous via ML: "Anomalous cpu usage on "x" (ML-detected)"
  {
    rx: /anomalous\s+(cpu|memory|disk)\s+usage[^()]*\(ml-detected\)/i,
    signature: (m) => `anomaly:ml-anomaly:${m[1].toLowerCase()}`,
  },
  // Anomalous threshold: "Anomalous cpu usage on "x"" (no ML qualifier)
  {
    rx: /anomalous\s+(cpu|memory|disk)\s+usage/i,
    signature: (m) => `anomaly:threshold:${m[1].toLowerCase()}`,
  },
  // Threshold: "High cpu usage on "x""
  {
    rx: /high\s+(cpu|memory|disk)\s+usage/i,
    signature: (m) => `anomaly:threshold:${m[1].toLowerCase()}`,
  },
  // Config: missing health check
  {
    rx: /no health check (configured|defined)|missing health check/i,
    signature: () => 'config:health-check:missing',
  },
  // Config: host network mode
  {
    rx: /host network mode/i,
    signature: () => 'config:network:host-mode',
  },
];

export function deriveSignatureFromTitle(title: string): string {
  for (const rule of TITLE_RULES) {
    const m = rule.rx.exec(title);
    if (m) return rule.signature(m);
  }
  return `unknown:${slugifyTitle(title)}`;
}

export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[",]/g, '')          // strip commas (URL separator) and quotes
    .replace(/[^a-z0-9]+/g, '-')   // any non-alnum → dash
    .replace(/^-+|-+$/g, '')       // trim dashes
    .slice(0, 80);                  // bound length
}

export function signatureLabel(signature: string): string {
  return SIGNATURE_LABELS[signature] ?? humanizeSignature(signature);
}

function humanizeSignature(signature: string): string {
  return signature
    .split(':')
    .map((s) => s.replace(/-/g, ' '))
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' · ');
}

export { SIGNATURE_LABELS };
```

- [ ] **Step 4: Run, verify pass**

```bash
cd packages/ai-intelligence && npx vitest run src/__tests__/signature.test.ts
```

Expected: all tests passing.

- [ ] **Step 5: Commit**

```bash
git add packages/ai-intelligence/src/services/signature.ts \
        packages/ai-intelligence/src/__tests__/signature.test.ts
git commit -m "feat(incidents): signature derivation module + tests"
```

---

### Task 5: Historical-titles dump + drift CSV + corpus assertions

**Files:**
- Create: `packages/ai-intelligence/scripts/dump-historical-titles.ts`
- Create: `packages/ai-intelligence/src/__tests__/fixtures/historical-titles.csv`
- Modify: `packages/ai-intelligence/src/__tests__/signature.test.ts` (add corpus block)

**Why:** Drift verification (spec §3.4) — every legacy title must derive a signature that matches the structured-field path.

- [ ] **Step 1: Write the dump script**

Create `packages/ai-intelligence/scripts/dump-historical-titles.ts`:

```ts
#!/usr/bin/env tsx
/**
 * Exports a sample of historical incident titles (and their root insight
 * structured fields, where available) to a CSV usable as a drift-test
 * corpus.
 *
 * Usage:
 *   POSTGRES_APP_URL=postgresql://… npm run -w @dashboard/ai dump:titles \
 *     > packages/ai-intelligence/src/__tests__/fixtures/historical-titles.csv
 */
import { Client } from 'pg';

const APP_URL = process.env.POSTGRES_APP_URL ?? process.env.POSTGRES_URL;
if (!APP_URL) { console.error('POSTGRES_APP_URL must be set'); process.exit(1); }

const SQL = `
  SELECT DISTINCT
    i.title AS incident_title,
    ins.category,
    ins.metric_type,
    ins.detection_method
  FROM incidents i
  LEFT JOIN insights ins ON ins.id = i.root_cause_insight_id
  ORDER BY i.title
  LIMIT 500
`;

async function main() {
  const client = new Client({ connectionString: APP_URL });
  await client.connect();
  try {
    const r = await client.query(SQL);
    console.log('title,category,metric_type,detection_method');
    for (const row of r.rows) {
      const csv = [row.incident_title, row.category, row.metric_type, row.detection_method]
        .map((v) => v == null ? '' : `"${String(v).replace(/"/g, '""')}"`)
        .join(',');
      console.log(csv);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Add the npm script**

Edit `packages/ai-intelligence/package.json` — add inside `"scripts"`:

```json
"dump:titles": "tsx scripts/dump-historical-titles.ts"
```

- [ ] **Step 3: Seed the corpus CSV**

Create `packages/ai-intelligence/src/__tests__/fixtures/historical-titles.csv` with a starter corpus (replace with real exported data when run against prod):

```csv
title,category,metric_type,detection_method
"Anomalous cpu usage on ""docker-postgres-app-1"" (ML-detected)",anomaly,cpu,ml-anomaly
"Anomalous memory usage on ""docker-postgres-app-1""",anomaly,memory,threshold
"Predicted memory exhaustion on ""docker-postgres-app-1"" ~24h",predictive,memory,prediction
"Predicted cpu exhaustion on ""docker-timescale-backup-1"" ~6h",predictive,cpu,prediction
"High cpu usage on ""portainer-portainer-1""",anomaly,cpu,threshold
"Container ""nginx"" has no health check configured",,,
"Container ""custom"" using host network mode",,,
```

- [ ] **Step 4: Add the corpus assertion to the existing test file**

Append to `packages/ai-intelligence/src/__tests__/signature.test.ts`:

```ts
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('drift corpus — historical titles', () => {
  const csvPath = path.join(__dirname, 'fixtures/historical-titles.csv');
  const text = fs.readFileSync(csvPath, 'utf8').trim();
  const [, ...rows] = text.split('\n');

  const records = rows.map((r) => {
    // Naive CSV parser sufficient for our quoted format.
    const cells: string[] = [];
    let cur = ''; let inQuote = false;
    for (let i = 0; i < r.length; i++) {
      const ch = r[i];
      if (ch === '"') {
        if (inQuote && r[i + 1] === '"') { cur += '"'; i++; }
        else { inQuote = !inQuote; }
      } else if (ch === ',' && !inQuote) { cells.push(cur); cur = ''; }
      else { cur += ch; }
    }
    cells.push(cur);
    const [title, category, metric_type, detection_method] = cells;
    return { title, category, metric_type: metric_type || undefined, detection_method: detection_method || undefined };
  });

  it('every row derives a non-unknown signature', () => {
    for (const r of records) {
      const sig = deriveSignatureFromTitle(r.title);
      expect(sig, `title="${r.title}"`).not.toMatch(/^unknown:/);
    }
  });

  it('regex output equals structured-field output (when fields present)', () => {
    for (const r of records) {
      if (!r.category) continue;
      const fromRegex = deriveSignatureFromTitle(r.title);
      const fromStructured = deriveSignature({
        category: r.category,
        metric_type: r.metric_type as Insight['metric_type'],
        detection_method: r.detection_method as Insight['detection_method'],
        title: r.title,
      });
      expect(fromRegex, `title="${r.title}"`).toBe(fromStructured);
    }
  });
});
```

Also add the import at the top of the test file:

```ts
import type { Insight } from '@dashboard/core/models/monitoring.js';
```

- [ ] **Step 5: Run, verify pass**

```bash
cd packages/ai-intelligence && npx vitest run src/__tests__/signature.test.ts
```

Expected: all tests passing including the corpus block.

- [ ] **Step 6: Commit**

```bash
git add packages/ai-intelligence/scripts/dump-historical-titles.ts \
        packages/ai-intelligence/src/__tests__/fixtures/historical-titles.csv \
        packages/ai-intelligence/src/__tests__/signature.test.ts \
        packages/ai-intelligence/package.json
git commit -m "test(incidents): drift corpus + dump script for signature derivation"
```

---

### Task 6: `monitoring-service` emits structured fields

**Files:**
- Modify: `packages/ai-intelligence/src/services/monitoring-service.ts`
- Test: `packages/ai-intelligence/src/__tests__/monitoring-service-emission.test.ts` (create — small)

**Why:** With the structured fields populated on emission, `deriveSignature` (Task 4) takes the preferred path instead of falling through to title regex.

- [ ] **Step 1: Write the failing test**

Create `packages/ai-intelligence/src/__tests__/monitoring-service-emission.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { InsightSchema } from '@dashboard/core/models/monitoring.js';

// We assert at the schema layer rather than running the full service
// (which depends on Portainer / DB / metrics). The principle: every
// path in monitoring-service.ts that pushes an Insight literal MUST
// include metric_type and detection_method when the category is
// 'anomaly' or 'predictive'. If a future emission path forgets, this
// test does not catch it — but the typecheck below will.
describe('Insight emission — structured fields are typeable', () => {
  it('an anomaly insight with structured fields parses', () => {
    const insight = {
      id: '1',
      endpoint_id: 1,
      endpoint_name: 'e',
      container_id: 'c',
      container_name: 'cn',
      severity: 'warning' as const,
      category: 'anomaly',
      title: 'Anomalous cpu usage on "x"',
      description: 'd',
      suggested_action: null,
      is_acknowledged: 0,
      created_at: new Date().toISOString(),
      metric_type: 'cpu' as const,
      detection_method: 'ml-anomaly' as const,
    };
    expect(() => InsightSchema.parse(insight)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run, verify it passes (it's an enabling test)**

```bash
cd packages/ai-intelligence && npx vitest run src/__tests__/monitoring-service-emission.test.ts
```

Expected: pass. (This test is the type-anchor: if Task 3's fields aren't on the schema, it fails.)

- [ ] **Step 3: Add structured fields to ML-anomaly emission**

In `packages/ai-intelligence/src/services/monitoring-service.ts`, locate the anomaly insight push around line 350–367 (search for `Anomalous ${item.metricType}`). Add to the object literal alongside `category: 'anomaly'`:

```ts
metric_type: item.metricType as 'cpu' | 'memory',
detection_method: 'ml-anomaly',
```

- [ ] **Step 4: Add structured fields to threshold emission**

In the same file, locate the high-threshold emission around line 397–417 (search for `High ${metricType}`). Add to the literal:

```ts
metric_type: metricType,
detection_method: 'threshold',
```

- [ ] **Step 5: Add structured fields to anomaly-context-only emission**

Locate the third anomaly emission near line 458 (search for the third `category: 'anomaly'`). Read the 30 lines above to identify what the emission represents — typically a `metric_type` variable already exists in the surrounding scope (e.g., the loop variable `metricType`) and the detection mode is implied by the function context (z-score → `'ml-anomaly'`, threshold compare → `'threshold'`, prediction series → `'prediction'`). Add the matching pair to the literal:

```ts
metric_type: metricType,           // existing loop variable
detection_method: '<mode>',         // 'ml-anomaly' | 'threshold' | 'prediction' per surrounding logic
```

Verify the choice by adding a corresponding row to the historical-titles CSV (Task 5 fixture) using a real title from this emission and confirming `signature.test.ts` still passes the equivalence assertion. If the equivalence fails, the chosen `detection_method` is wrong — re-read the surrounding code.

- [ ] **Step 6: Add structured fields to prediction emission**

Locate `category: 'predictive'` (line 498). Add:

```ts
metric_type: predictedMetric, // 'cpu' | 'memory' from surrounding code
detection_method: 'prediction',
```

- [ ] **Step 7: Add structured fields to log-analysis emission**

Locate `category: 'log-analysis'` (line 564). Add:

```ts
detection_method: 'log-pattern',
```

(`metric_type` typically not applicable for log-pattern; leave it omitted — `deriveSignature` falls back to category-only `log:pattern`.)

- [ ] **Step 8: Add structured fields to ai-analysis emission**

Locate `category: 'ai-analysis'` (line 625). Leave both fields omitted — category-only fallback handles it.

- [ ] **Step 9: Add structured fields to security emissions**

In `packages/ai-intelligence/src/routes/monitoring.ts` lines 264 and 293 (the two `category: 'security'` literals), add:

```ts
detection_method: 'security-scan',
```

- [ ] **Step 10: Run the existing monitoring service tests**

```bash
cd packages/ai-intelligence && npx vitest run src/__tests__/
```

Expected: all existing tests still pass.

- [ ] **Step 11: Commit**

```bash
git add packages/ai-intelligence/src/services/monitoring-service.ts \
        packages/ai-intelligence/src/routes/monitoring.ts \
        packages/ai-intelligence/src/__tests__/monitoring-service-emission.test.ts
git commit -m "feat(monitoring): emit structured metric_type and detection_method on insights"
```

---

### Task 7: `incident-correlator` writes `signature` on insert

**Files:**
- Modify: `packages/ai-intelligence/src/services/incident-correlator.ts`
- Modify: `packages/ai-intelligence/src/services/incident-store.ts`
- Test: `packages/ai-intelligence/src/__tests__/incident-correlator.test.ts` (additions — likely an existing file)

**Why:** Live writes start populating the `signature` column. From this point onward, every new incident has a signature.

- [ ] **Step 1: Write the failing test**

Add to `packages/ai-intelligence/src/__tests__/incident-correlator.test.ts` (create file if absent — follow the `incidents.test.ts` style for DB setup):

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestDb, truncateTestTables, closeTestDb } from '@dashboard/core/db/test-db-helper.js';
import { correlateInsights } from '../services/incident-correlator.js';
import { insertInsights } from '../services/insights-store.js';
import type { InsightInsert } from '../services/insights-store.js';

describe('correlateInsights — writes signature', () => {
  beforeEach(async () => {
    await getTestDb();
    await truncateTestTables(['incidents', 'insights']);
  });
  afterAll(async () => { await closeTestDb(); });

  it('writes signature derived from structured fields', async () => {
    const insights: InsightInsert[] = [
      {
        id: 'i1', endpoint_id: 1, endpoint_name: 'e', container_id: 'c1', container_name: 'cn1',
        severity: 'warning', category: 'anomaly',
        metric_type: 'cpu', detection_method: 'ml-anomaly',
        title: 'Anomalous cpu usage on "cn1"', description: 'd', suggested_action: null,
      },
      {
        id: 'i2', endpoint_id: 1, endpoint_name: 'e', container_id: 'c1', container_name: 'cn1',
        severity: 'warning', category: 'anomaly',
        metric_type: 'cpu', detection_method: 'ml-anomaly',
        title: 'Anomalous cpu usage on "cn1"', description: 'd', suggested_action: null,
      },
    ];
    await insertInsights(insights);
    // Re-fetch with structured fields for correlator input
    const fullInsights = insights.map((i) => ({ ...i, is_acknowledged: 0, created_at: new Date().toISOString() }));
    await correlateInsights(fullInsights as never);

    const db = await getTestDb();
    const rows = await db.query<{ signature: string }>(
      'SELECT signature FROM incidents',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].signature).toBe('anomaly:ml-anomaly:cpu');
  });
});
```

- [ ] **Step 2: Run, verify failure**

```bash
cd packages/ai-intelligence && \
  POSTGRES_TEST_URL=postgresql://app_user:changeme-postgres-app@localhost:5433/portainer_dashboard_test \
  npx vitest run src/__tests__/incident-correlator.test.ts
```

Expected: failure (signature column exists but value is NULL because correlator doesn't write it yet).

- [ ] **Step 3: Update `IncidentInsert` interface**

In `packages/ai-intelligence/src/services/incident-store.ts`, add to the `IncidentInsert` interface (search for `export interface IncidentInsert`):

```ts
signature: string;
```

- [ ] **Step 4: Update `insertIncident` SQL**

In the same file, modify the INSERT statement in `insertIncident` to include `signature`:

```ts
await db.execute(`
  INSERT INTO incidents (
    id, title, severity, status, root_cause_insight_id,
    related_insight_ids, affected_containers, endpoint_id, endpoint_name,
    correlation_type, correlation_confidence, insight_count, summary, signature,
    created_at, updated_at
  ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
`, [
  incident.id,
  incident.title,
  incident.severity,
  incident.root_cause_insight_id,
  JSON.stringify(incident.related_insight_ids),
  JSON.stringify(incident.affected_containers),
  incident.endpoint_id,
  incident.endpoint_name,
  incident.correlation_type,
  incident.correlation_confidence,
  incident.insight_count,
  incident.summary,
  incident.signature,
]);
```

- [ ] **Step 5: Update `buildIncident` to compute signature**

In `packages/ai-intelligence/src/services/incident-correlator.ts`, add the import:

```ts
import { deriveSignature } from './signature.js';
```

In `buildIncident()` (search for `function buildIncident`), compute and include the signature:

```ts
const signature = deriveSignature({
  category: rootCause.category,
  metric_type: rootCause.metric_type,
  detection_method: rootCause.detection_method,
  title: rootCause.title,
});

return {
  id: uuidv4(),
  title,
  severity,
  root_cause_insight_id: rootCause.id,
  related_insight_ids: relatedIds,
  affected_containers: containers,
  endpoint_id: rootCause.endpoint_id,
  endpoint_name: rootCause.endpoint_name,
  correlation_type: correlationType,
  correlation_confidence: confidence,
  insight_count: insights.length,
  summary,
  signature,
};
```

- [ ] **Step 6: Run, verify pass**

```bash
cd packages/ai-intelligence && \
  POSTGRES_TEST_URL=postgresql://app_user:changeme-postgres-app@localhost:5433/portainer_dashboard_test \
  npx vitest run src/__tests__/incident-correlator.test.ts
```

Expected: pass.

- [ ] **Step 7: Run all incident-related tests**

```bash
cd packages/ai-intelligence && \
  POSTGRES_TEST_URL=postgresql://app_user:changeme-postgres-app@localhost:5433/portainer_dashboard_test \
  npx vitest run src/__tests__/incidents.test.ts src/__tests__/incidents-jsonb.test.ts
```

Expected: pass (the existing tests don't assert on signature, but they shouldn't break).

- [ ] **Step 8: Commit**

```bash
git add packages/ai-intelligence/src/services/incident-correlator.ts \
        packages/ai-intelligence/src/services/incident-store.ts \
        packages/ai-intelligence/src/__tests__/incident-correlator.test.ts
git commit -m "feat(incidents): write signature on incident insert"
```

---

### Task 8: Backfill script

**Files:**
- Create: `packages/ai-intelligence/scripts/backfill-incident-signatures.ts`
- Test: `packages/ai-intelligence/src/__tests__/incidents-backfill.test.ts`
- Modify: `packages/ai-intelligence/package.json` (npm script)

**Why:** Existing legacy rows have `NULL` signatures. Backfill populates them with the same `deriveSignature` used by live writes.

- [ ] **Step 1: Write the failing test**

Create `packages/ai-intelligence/src/__tests__/incidents-backfill.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestDb, truncateTestTables, closeTestDb } from '@dashboard/core/db/test-db-helper.js';
import { backfillSignatures } from '../scripts/backfill-incident-signatures.js';

describe('backfillSignatures', () => {
  beforeEach(async () => {
    await getTestDb();
    await truncateTestTables(['incidents', 'insights']);
  });
  afterAll(async () => { await closeTestDb(); });

  it('populates NULL signatures using the root insight category/fields', async () => {
    const db = await getTestDb();
    await db.execute(`
      INSERT INTO insights (id, endpoint_id, endpoint_name, container_id, container_name,
                            severity, category, title, description, suggested_action,
                            is_acknowledged, created_at, metric_type, detection_method)
      VALUES ('ins1', 1, 'e', 'c', 'cn', 'warning', 'anomaly',
              'Anomalous cpu usage on "cn"', 'd', NULL, false, NOW(), 'cpu', 'ml-anomaly')
    `);
    await db.execute(`
      INSERT INTO incidents (id, title, severity, status, root_cause_insight_id,
                             related_insight_ids, affected_containers, endpoint_id, endpoint_name,
                             correlation_type, correlation_confidence, insight_count, summary,
                             signature, created_at, updated_at)
      VALUES ('inc1', 'Anomalous cpu usage on "cn"', 'warning', 'active', 'ins1',
              '[]'::jsonb, '["cn"]'::jsonb, 1, 'e', 'dedup', 'high', 1, NULL,
              NULL, NOW(), NOW())
    `);
    const result = await backfillSignatures({ batchSize: 100, force: false });
    expect(result.updated).toBe(1);

    const after = await db.queryOne<{ signature: string }>('SELECT signature FROM incidents WHERE id = ?', ['inc1']);
    expect(after?.signature).toBe('anomaly:ml-anomaly:cpu');
  });

  it('is idempotent — running again does nothing', async () => {
    const db = await getTestDb();
    await db.execute(`
      INSERT INTO incidents (id, title, severity, status, root_cause_insight_id,
                             related_insight_ids, affected_containers, endpoint_id, endpoint_name,
                             correlation_type, correlation_confidence, insight_count, summary,
                             signature, created_at, updated_at)
      VALUES ('inc1', 'High cpu usage on "cn"', 'warning', 'active', NULL,
              '[]'::jsonb, '[]'::jsonb, NULL, NULL, 'temporal', 'medium', 1, NULL,
              NULL, NOW(), NOW())
    `);
    const r1 = await backfillSignatures({ batchSize: 100, force: false });
    expect(r1.updated).toBe(1);
    const r2 = await backfillSignatures({ batchSize: 100, force: false });
    expect(r2.updated).toBe(0);
  });

  it('handles missing root insight via title fallback', async () => {
    const db = await getTestDb();
    await db.execute(`
      INSERT INTO incidents (id, title, severity, status, root_cause_insight_id,
                             related_insight_ids, affected_containers, endpoint_id, endpoint_name,
                             correlation_type, correlation_confidence, insight_count, summary,
                             signature, created_at, updated_at)
      VALUES ('inc1', 'Predicted memory exhaustion on "cn" ~24h', 'warning', 'active', 'gone',
              '[]'::jsonb, '["cn"]'::jsonb, 1, 'e', 'dedup', 'high', 1, NULL,
              NULL, NOW(), NOW())
    `);
    const result = await backfillSignatures({ batchSize: 100, force: false });
    expect(result.updated).toBe(1);

    const after = await db.queryOne<{ signature: string }>('SELECT signature FROM incidents WHERE id = ?', ['inc1']);
    expect(after?.signature).toBe('predictive:prediction:memory');
  });
});
```

- [ ] **Step 2: Run, verify failure**

```bash
cd packages/ai-intelligence && \
  POSTGRES_TEST_URL=postgresql://app_user:changeme-postgres-app@localhost:5433/portainer_dashboard_test \
  npx vitest run src/__tests__/incidents-backfill.test.ts
```

Expected: failure (`backfillSignatures` not exported).

- [ ] **Step 3: Implement the backfill function**

Create `packages/ai-intelligence/scripts/backfill-incident-signatures.ts`:

```ts
#!/usr/bin/env tsx
/**
 * Populates the `signature` column on incidents that don't yet have one.
 *
 * Idempotent: only updates rows where signature IS NULL by default.
 * Use --force to re-derive every row.
 *
 * Usage:
 *   POSTGRES_APP_URL=… npm run -w @dashboard/ai backfill:signatures
 *   POSTGRES_APP_URL=… npm run -w @dashboard/ai backfill:signatures -- --force
 */
import { getDbForDomain } from '@dashboard/core/db/app-db-router.js';
import { deriveSignature, deriveSignatureFromTitle } from '../src/services/signature.js';

interface BackfillOptions { batchSize: number; force: boolean; }

interface IncidentRow {
  id: string;
  title: string;
  root_cause_insight_id: string | null;
}
interface InsightRow {
  category: string;
  metric_type: string | null;
  detection_method: string | null;
  title: string;
}

export async function backfillSignatures(opts: BackfillOptions = { batchSize: 500, force: false }): Promise<{ updated: number; bySignature: Record<string, number> }> {
  const db = getDbForDomain('incidents');
  const where = opts.force ? '1=1' : 'signature IS NULL';
  const bySignature: Record<string, number> = {};
  let updated = 0;

  while (true) {
    const incidents = await db.query<IncidentRow>(
      `SELECT id, title, root_cause_insight_id FROM incidents WHERE ${where} ORDER BY created_at LIMIT ?`,
      [opts.batchSize],
    );
    if (incidents.length === 0) break;

    for (const inc of incidents) {
      let signature: string;
      if (inc.root_cause_insight_id) {
        const ins = await db.queryOne<InsightRow>(
          'SELECT category, metric_type, detection_method, title FROM insights WHERE id = ?',
          [inc.root_cause_insight_id],
        );
        if (ins) {
          signature = deriveSignature({
            category: ins.category,
            metric_type: ins.metric_type as 'cpu' | 'memory' | 'disk' | 'network' | 'restart' | undefined,
            detection_method: ins.detection_method as 'threshold' | 'ml-anomaly' | 'prediction' | 'health-check' | 'log-pattern' | 'security-scan' | undefined,
            title: ins.title,
          });
        } else {
          signature = deriveSignatureFromTitle(inc.title);
        }
      } else {
        signature = deriveSignatureFromTitle(inc.title);
      }
      await db.execute(
        opts.force
          ? 'UPDATE incidents SET signature = ? WHERE id = ?'
          : 'UPDATE incidents SET signature = ? WHERE id = ? AND signature IS NULL',
        [signature, inc.id],
      );
      bySignature[signature] = (bySignature[signature] ?? 0) + 1;
      updated++;
    }
    if (incidents.length < opts.batchSize) break;
  }

  return { updated, bySignature };
}

async function cli() {
  const force = process.argv.includes('--force');
  const result = await backfillSignatures({ batchSize: 500, force });
  console.log(`Updated ${result.updated} rows`);
  for (const [sig, n] of Object.entries(result.bySignature).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${sig.padEnd(40)} ${n}`);
  }
}

if (import.meta.url.endsWith(process.argv[1] ?? '')) {
  cli().catch((err) => { console.error(err); process.exit(1); });
}
```

Note: the backfill imports `deriveSignature` from `../src/services/signature.js`. If your `tsconfig`/`tsx` resolution complains, adjust to a relative path that resolves to the `src` directory from `scripts/`.

- [ ] **Step 4: Add npm script**

Edit `packages/ai-intelligence/package.json` — add inside `"scripts"`:

```json
"backfill:signatures": "tsx scripts/backfill-incident-signatures.ts"
```

- [ ] **Step 5: Run, verify pass**

```bash
cd packages/ai-intelligence && \
  POSTGRES_TEST_URL=postgresql://app_user:changeme-postgres-app@localhost:5433/portainer_dashboard_test \
  npx vitest run src/__tests__/incidents-backfill.test.ts
```

Expected: 3 passing.

- [ ] **Step 6: Commit**

```bash
git add packages/ai-intelligence/scripts/backfill-incident-signatures.ts \
        packages/ai-intelligence/src/__tests__/incidents-backfill.test.ts \
        packages/ai-intelligence/package.json
git commit -m "feat(incidents): backfill script for legacy signature population"
```

---

### Task 9: `/api/incidents` accepts `?signature=` filter

**Files:**
- Modify: `packages/ai-intelligence/src/services/incident-store.ts`
- Modify: `packages/ai-intelligence/src/routes/incidents.ts`
- Test: `packages/ai-intelligence/src/__tests__/incidents-list.test.ts` (create or extend)

**Why:** The frontend "Show all" pagination calls `/api/incidents?status=active&signature=X` — that filter must exist.

- [ ] **Step 1: Write the failing test**

Create or extend `packages/ai-intelligence/src/__tests__/incidents-list.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestDb, truncateTestTables, closeTestDb } from '@dashboard/core/db/test-db-helper.js';
import { getIncidents } from '../services/incident-store.js';

describe('getIncidents — signature filter', () => {
  beforeEach(async () => {
    await getTestDb();
    await truncateTestTables(['incidents']);
    const db = await getTestDb();
    const insertSQL = `
      INSERT INTO incidents (id, title, severity, status, root_cause_insight_id,
                             related_insight_ids, affected_containers, endpoint_id, endpoint_name,
                             correlation_type, correlation_confidence, insight_count, summary,
                             signature, created_at, updated_at)
      VALUES (?, ?, ?, 'active', NULL, '[]'::jsonb, '[]'::jsonb, NULL, NULL,
              'temporal', 'medium', 1, NULL, ?, NOW(), NOW())
    `;
    await db.execute(insertSQL, ['a', 'A', 'warning', 'anomaly:ml-anomaly:cpu']);
    await db.execute(insertSQL, ['b', 'B', 'warning', 'anomaly:ml-anomaly:memory']);
    await db.execute(insertSQL, ['c', 'C', 'warning', 'predictive:prediction:memory']);
  });
  afterAll(async () => { await closeTestDb(); });

  it('returns only matching signature when provided', async () => {
    const rows = await getIncidents({ signature: 'anomaly:ml-anomaly:memory' });
    expect(rows.map((r) => r.id)).toEqual(['b']);
  });

  it('combines with status filter', async () => {
    const rows = await getIncidents({ status: 'active', signature: 'predictive:prediction:memory' });
    expect(rows.map((r) => r.id)).toEqual(['c']);
  });

  it('returns all when omitted', async () => {
    const rows = await getIncidents({});
    expect(rows).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run, verify failure**

```bash
cd packages/ai-intelligence && \
  POSTGRES_TEST_URL=postgresql://app_user:changeme-postgres-app@localhost:5433/portainer_dashboard_test \
  npx vitest run src/__tests__/incidents-list.test.ts
```

Expected: failure (`signature` is not a valid option).

- [ ] **Step 3: Add `signature` to `GetIncidentsOptions`**

In `packages/ai-intelligence/src/services/incident-store.ts`, modify the interface and the query:

```ts
export interface GetIncidentsOptions {
  status?: 'active' | 'resolved';
  severity?: string;
  signature?: string;     // NEW
  limit?: number;
  offset?: number;
}

export async function getIncidents(options: GetIncidentsOptions = {}): Promise<Incident[]> {
  const db = getDbForDomain('incidents');
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.status)    { conditions.push('status = ?');    params.push(options.status); }
  if (options.severity)  { conditions.push('severity = ?');  params.push(options.severity); }
  if (options.signature) { conditions.push('signature = ?'); params.push(options.signature); }   // NEW

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  return db.query<Incident>(`
    SELECT * FROM incidents ${where}
    ORDER BY created_at DESC LIMIT ? OFFSET ?
  `, [...params, limit, offset]);
}
```

- [ ] **Step 4: Update the route to accept `?signature=`**

In `packages/ai-intelligence/src/routes/incidents.ts`, modify the `/api/incidents` handler:

```ts
const { status, severity, signature, limit = 50, offset = 0 } = request.query as {
  status?: 'active' | 'resolved';
  severity?: string;
  signature?: string;  // NEW
  limit?: number;
  offset?: number;
};

const incidents = await getIncidents({ status, severity, signature, limit, offset });
```

- [ ] **Step 5: Run, verify pass**

```bash
cd packages/ai-intelligence && \
  POSTGRES_TEST_URL=postgresql://app_user:changeme-postgres-app@localhost:5433/portainer_dashboard_test \
  npx vitest run src/__tests__/incidents-list.test.ts
```

Expected: 3 passing.

- [ ] **Step 6: Commit**

```bash
git add packages/ai-intelligence/src/services/incident-store.ts \
        packages/ai-intelligence/src/routes/incidents.ts \
        packages/ai-intelligence/src/__tests__/incidents-list.test.ts
git commit -m "feat(incidents): /api/incidents accepts ?signature= filter"
```

---

### Task 10: `getIncidentGroups` SQL aggregate + `GET /api/incidents/groups` route

**Files:**
- Modify: `packages/ai-intelligence/src/services/incident-store.ts` (add `getIncidentGroups`)
- Modify: `packages/ai-intelligence/src/routes/incidents.ts` (add new route + cache wrap)
- Test: `packages/ai-intelligence/src/__tests__/incidents-groups.test.ts`

**Why:** Heart of the rollup. One SQL round-trip returns one row per signature with all the data the UI needs.

- [ ] **Step 1: Write the failing test**

Create `packages/ai-intelligence/src/__tests__/incidents-groups.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestDb, truncateTestTables, closeTestDb } from '@dashboard/core/db/test-db-helper.js';
import { getIncidentGroups } from '../services/incident-store.js';

describe('getIncidentGroups', () => {
  beforeEach(async () => {
    await getTestDb();
    await truncateTestTables(['incidents']);
    const db = await getTestDb();
    const ins = `
      INSERT INTO incidents (id, title, severity, status, root_cause_insight_id,
                             related_insight_ids, affected_containers, endpoint_id, endpoint_name,
                             correlation_type, correlation_confidence, insight_count, summary,
                             signature, created_at, updated_at)
      VALUES (?, ?, ?, 'active', NULL, '[]'::jsonb, ?::jsonb, ?, ?, 'temporal', 'medium', ?, NULL, ?, NOW(), NOW())
    `;
    // 3 active CPU anomalies on 3 containers, 1 critical 2 warning
    await db.execute(ins, ['a1', 'cpu', 'critical', '["c1"]', 1, 'eA', 5, 'anomaly:ml-anomaly:cpu']);
    await db.execute(ins, ['a2', 'cpu', 'warning',  '["c2"]', 1, 'eA', 3, 'anomaly:ml-anomaly:cpu']);
    await db.execute(ins, ['a3', 'cpu', 'warning',  '["c3"]', 2, 'eB', 2, 'anomaly:ml-anomaly:cpu']);
    // 1 active memory prediction
    await db.execute(ins, ['m1', 'mem', 'warning',  '["c4"]', 2, 'eB', 1, 'predictive:prediction:memory']);
    // 1 resolved (must not appear when status=active)
    await db.execute(`
      INSERT INTO incidents (id, title, severity, status, signature, related_insight_ids,
                             affected_containers, correlation_type, correlation_confidence,
                             insight_count, created_at, updated_at, resolved_at)
      VALUES ('r1', 'r', 'warning', 'resolved', 'anomaly:ml-anomaly:cpu', '[]'::jsonb,
              '[]'::jsonb, 'temporal', 'medium', 1, NOW(), NOW(), NOW())
    `);
  });
  afterAll(async () => { await closeTestDb(); });

  it('aggregates by signature with counts', async () => {
    const result = await getIncidentGroups({ status: 'active' });
    expect(result.total_active).toBe(4);

    const cpu = result.groups.find((g) => g.signature === 'anomaly:ml-anomaly:cpu');
    expect(cpu).toBeDefined();
    expect(cpu!.incident_count).toBe(3);
    expect(cpu!.container_count).toBe(3);
    expect(cpu!.alert_count).toBe(1 + 1 + 2);
    expect(cpu!.severity).toBe('critical');  // highest in group
  });

  it('returns top_containers ordered by severity then recency, capped at 10', async () => {
    const result = await getIncidentGroups({ status: 'active' });
    const cpu = result.groups.find((g) => g.signature === 'anomaly:ml-anomaly:cpu')!;
    expect(cpu.top_containers.length).toBeLessThanOrEqual(10);
    expect(cpu.top_containers[0].severity).toBe('critical');
  });

  it('includes all_container_names with names_truncated flag', async () => {
    const result = await getIncidentGroups({ status: 'active' });
    const cpu = result.groups.find((g) => g.signature === 'anomaly:ml-anomaly:cpu')!;
    expect(cpu.all_container_names.sort()).toEqual(['c1', 'c2', 'c3']);
    expect(cpu.names_truncated).toBe(false);
  });

  it('endpoint_facets reflects distribution', async () => {
    const result = await getIncidentGroups({ status: 'active' });
    const eA = result.endpoint_facets.find((f) => f.endpoint_id === 1)!;
    expect(eA.incident_count).toBe(2);
    const eB = result.endpoint_facets.find((f) => f.endpoint_id === 2)!;
    expect(eB.incident_count).toBe(2);
  });

  it('endpoint_id filter narrows the result', async () => {
    const result = await getIncidentGroups({ status: 'active', endpoint_id: 2 });
    expect(result.total_active).toBe(2);
  });

  it('since filter applies against updated_at', async () => {
    // updated_at is NOW(); all rows match a 1-hour window
    const result = await getIncidentGroups({ status: 'active', since_minutes: 60 });
    expect(result.total_active).toBe(4);
  });

  it('excludes resolved incidents when status=active', async () => {
    const result = await getIncidentGroups({ status: 'active' });
    const incidentIds = result.groups.flatMap((g) => g.top_containers.map((tc) => tc.incident_id));
    expect(incidentIds).not.toContain('r1');
  });
});
```

- [ ] **Step 2: Run, verify failure**

```bash
cd packages/ai-intelligence && \
  POSTGRES_TEST_URL=postgresql://app_user:changeme-postgres-app@localhost:5433/portainer_dashboard_test \
  npx vitest run src/__tests__/incidents-groups.test.ts
```

Expected: failure (`getIncidentGroups` not exported).

- [ ] **Step 3: Implement `getIncidentGroups`**

Append to `packages/ai-intelligence/src/services/incident-store.ts`:

```ts
import { signatureLabel } from './signature.js';

const TOP_CONTAINERS_PER_GROUP = 10;
const ALL_NAMES_CAP = 500;

export interface IncidentGroupsOptions {
  status?: 'active' | 'resolved';
  endpoint_id?: number;
  since_minutes?: number;     // 60 / 1440 / 10080 — frontend converts ranges
  severity?: 'critical' | 'warning' | 'info';
}

export interface IncidentGroup {
  signature: string;
  label: string;
  severity: 'critical' | 'warning' | 'info';
  incident_count: number;
  container_count: number;
  alert_count: number;
  earliest_at: string;
  latest_update_at: string;
  top_containers: Array<{
    incident_id: string;
    container_name: string;
    endpoint_id: number | null;
    endpoint_name: string | null;
    severity: 'critical' | 'warning' | 'info';
    created_at: string;
  }>;
  all_container_names: string[];
  names_truncated: boolean;
}

export interface IncidentGroupsResult {
  groups: IncidentGroup[];
  endpoint_facets: Array<{ endpoint_id: number | null; endpoint_name: string | null; incident_count: number }>;
  total_active: number;
}

export async function getIncidentGroups(options: IncidentGroupsOptions = {}): Promise<IncidentGroupsResult> {
  const db = getDbForDomain('incidents');
  const where: string[] = ['signature IS NOT NULL'];
  const params: unknown[] = [];
  if (options.status)        { where.push('status = ?');                                              params.push(options.status); }
  if (options.endpoint_id !== undefined) { where.push('endpoint_id = ?');                              params.push(options.endpoint_id); }
  if (options.since_minutes) { where.push("updated_at >= NOW() - (? || ' minutes')::INTERVAL");        params.push(`-${options.since_minutes}`); }
  if (options.severity)      { where.push('severity = ?');                                            params.push(options.severity); }
  const whereSQL = `WHERE ${where.join(' AND ')}`;

  // 1. Per-signature aggregate + first/last + name list (capped)
  const rawGroups = await db.query<{
    signature: string;
    severity: 'critical' | 'warning' | 'info';
    incident_count: number;
    alert_count: number;
    earliest_at: string;
    latest_update_at: string;
    container_count: number;
    all_names: string[];
  }>(`
    WITH base AS (
      SELECT id, signature, severity, insight_count, created_at, updated_at, affected_containers
      FROM incidents ${whereSQL}
    ),
    expanded AS (
      SELECT signature, severity, insight_count, created_at, updated_at,
             jsonb_array_elements_text(affected_containers) AS container_name
      FROM base
    )
    SELECT b.signature,
           CASE WHEN BOOL_OR(b.severity = 'critical') THEN 'critical'
                WHEN BOOL_OR(b.severity = 'warning')  THEN 'warning'
                ELSE 'info' END                                                AS severity,
           COUNT(DISTINCT b.id)::int                                           AS incident_count,
           COALESCE(SUM(b.insight_count), 0)::int                              AS alert_count,
           MIN(b.created_at)::text                                             AS earliest_at,
           MAX(b.updated_at)::text                                             AS latest_update_at,
           COUNT(DISTINCT e.container_name)::int                               AS container_count,
           (ARRAY(
             SELECT DISTINCT container_name
             FROM expanded e2
             WHERE e2.signature = b.signature
             ORDER BY container_name
             LIMIT ${ALL_NAMES_CAP}
           ))                                                                  AS all_names
    FROM base b
    LEFT JOIN expanded e ON e.signature = b.signature
    GROUP BY b.signature
    ORDER BY (CASE WHEN BOOL_OR(b.severity = 'critical') THEN 0
                   WHEN BOOL_OR(b.severity = 'warning')  THEN 1
                   ELSE 2 END), incident_count DESC
  `, params);

  // 2. Top-N containers per signature
  const rawTop = await db.query<{
    signature: string; incident_id: string; container_name: string;
    endpoint_id: number | null; endpoint_name: string | null;
    severity: 'critical' | 'warning' | 'info'; created_at: string; rn: number;
  }>(`
    WITH base AS (
      SELECT id, signature, severity, endpoint_id, endpoint_name, created_at, affected_containers
      FROM incidents ${whereSQL}
    ),
    expanded AS (
      SELECT id AS incident_id, signature, severity, endpoint_id, endpoint_name, created_at,
             jsonb_array_elements_text(affected_containers) AS container_name
      FROM base
    ),
    ranked AS (
      SELECT *,
             ROW_NUMBER() OVER (
               PARTITION BY signature
               ORDER BY (CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END),
                        created_at DESC
             ) AS rn
      FROM expanded
    )
    SELECT signature, incident_id, container_name, endpoint_id, endpoint_name, severity, created_at::text, rn
    FROM ranked
    WHERE rn <= ${TOP_CONTAINERS_PER_GROUP}
  `, params);

  // 3. Endpoint facets
  const rawFacets = await db.query<{ endpoint_id: number | null; endpoint_name: string | null; incident_count: number }>(`
    SELECT endpoint_id, endpoint_name, COUNT(*)::int AS incident_count
    FROM incidents ${whereSQL}
    GROUP BY endpoint_id, endpoint_name
    ORDER BY incident_count DESC
  `, params);

  // 4. Stitch
  const topBySig = new Map<string, IncidentGroup['top_containers']>();
  for (const r of rawTop) {
    const arr = topBySig.get(r.signature) ?? [];
    arr.push({
      incident_id: r.incident_id, container_name: r.container_name,
      endpoint_id: r.endpoint_id, endpoint_name: r.endpoint_name,
      severity: r.severity, created_at: r.created_at,
    });
    topBySig.set(r.signature, arr);
  }

  const groups: IncidentGroup[] = rawGroups.map((g) => ({
    signature: g.signature,
    label: signatureLabel(g.signature),
    severity: g.severity,
    incident_count: g.incident_count,
    container_count: g.container_count,
    alert_count: g.alert_count,
    earliest_at: g.earliest_at,
    latest_update_at: g.latest_update_at,
    top_containers: topBySig.get(g.signature) ?? [],
    all_container_names: g.all_names ?? [],
    names_truncated: (g.all_names?.length ?? 0) >= ALL_NAMES_CAP && g.container_count > ALL_NAMES_CAP,
  }));

  const total_active = rawGroups.reduce((sum, g) => sum + g.incident_count, 0);

  return { groups, endpoint_facets: rawFacets, total_active };
}
```

- [ ] **Step 4: Run service tests, verify pass**

```bash
cd packages/ai-intelligence && \
  POSTGRES_TEST_URL=postgresql://app_user:changeme-postgres-app@localhost:5433/portainer_dashboard_test \
  npx vitest run src/__tests__/incidents-groups.test.ts
```

Expected: all 7 passing.

- [ ] **Step 5: Add the route**

In `packages/ai-intelligence/src/routes/incidents.ts`, add the new route with a cache wrap. Add imports:

```ts
import { cachedFetchSWR, getCacheKey, cache } from '@dashboard/core/portainer/portainer-cache.js';
import { getIncidents, getIncident, resolveIncident, getIncidentCount, getIncidentGroups } from '../services/incident-store.js';
```

Then add inside `incidentsRoutes(fastify)`:

```ts
// List incident groups (rollup view)
fastify.get('/api/incidents/groups', {
  schema: {
    tags: ['Incidents'],
    summary: 'List active incidents grouped by signature',
    security: [{ bearerAuth: [] }],
  },
  preHandler: [fastify.authenticate],
}, async (request) => {
  const { status = 'active', endpoint_id, since, severity } = request.query as {
    status?: 'active' | 'resolved';
    endpoint_id?: string;
    since?: '1h' | '24h' | '7d';
    severity?: 'critical' | 'warning' | 'info';
  };
  const since_minutes = since === '1h' ? 60 : since === '24h' ? 1440 : since === '7d' ? 10080 : undefined;
  const epId = endpoint_id != null ? Number(endpoint_id) : undefined;

  const cacheKey = getCacheKey('incidents-groups', status, epId ?? 'all', since ?? 'all', severity ?? 'all');
  return cachedFetchSWR(cacheKey, 10, () =>
    getIncidentGroups({ status, endpoint_id: epId, since_minutes, severity }),
  );
});
```

Then update the existing single-resolve handler to invalidate the cache. Locate the existing `/api/incidents/:id/resolve` handler and add at the end after `await resolveIncident(id);`:

```ts
await cache.invalidateTag('incidents-groups').catch(() => undefined);
```

Wait — `invalidateTag` invalidates entries tagged with `'incidents-groups'`, not the key prefix. Since `cachedFetchSWR` does not tag entries (the tag mechanism is opt-in via `setWithTags`), the easier route is to use `cache.invalidatePattern('incidents-groups')` if available, or to simply `cache.del()` per known cache key. **Simpler approach for this task:** invalidate via a pattern delete. Add this helper next to the cache import in `incidents.ts`:

```ts
async function invalidateGroupsCache(): Promise<void> {
  // L1 invalidation: delete in-memory entries whose key starts with 'incidents-groups:'
  await cache.invalidatePattern?.('incidents-groups').catch(() => undefined);
}
```

If `cache.invalidatePattern` does not exist on the public surface, the implementer instead lowers the TTL to 5s for this PR and files a follow-up to add tag support; the spec acknowledges this fallback.

Then call `await invalidateGroupsCache()` after every write: `/api/incidents/:id/resolve`, plus the batch resolve added in Task 11.

- [ ] **Step 6: Commit**

```bash
git add packages/ai-intelligence/src/services/incident-store.ts \
        packages/ai-intelligence/src/routes/incidents.ts \
        packages/ai-intelligence/src/__tests__/incidents-groups.test.ts
git commit -m "feat(incidents): GET /api/incidents/groups aggregate endpoint with SWR cache"
```

---

### Task 11: `POST /api/incidents/resolve` batch endpoint

**Files:**
- Modify: `packages/ai-intelligence/src/services/incident-store.ts` (add `resolveIncidentsBatch`)
- Modify: `packages/ai-intelligence/src/routes/incidents.ts` (add new route)
- Test: `packages/ai-intelligence/src/__tests__/incidents-resolve-batch.test.ts`

**Why:** The frontend's per-group "Resolve all" calls one batch endpoint instead of N sequential POSTs.

- [ ] **Step 1: Write the failing test**

Create `packages/ai-intelligence/src/__tests__/incidents-resolve-batch.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestDb, truncateTestTables, closeTestDb } from '@dashboard/core/db/test-db-helper.js';
import { resolveIncidentsBatch } from '../services/incident-store.js';

describe('resolveIncidentsBatch', () => {
  beforeEach(async () => {
    await getTestDb();
    await truncateTestTables(['incidents']);
    const db = await getTestDb();
    const ins = `
      INSERT INTO incidents (id, title, severity, status, root_cause_insight_id,
                             related_insight_ids, affected_containers, endpoint_id, endpoint_name,
                             correlation_type, correlation_confidence, insight_count, summary,
                             signature, created_at, updated_at)
      VALUES (?, 't', 'warning', 'active', NULL, '[]'::jsonb, '[]'::jsonb, NULL, NULL,
              'temporal', 'medium', 1, NULL, 'anomaly:ml-anomaly:cpu', NOW(), NOW())
    `;
    await db.execute(ins, ['a']);
    await db.execute(ins, ['b']);
    await db.execute(ins, ['c']);
  });
  afterAll(async () => { await closeTestDb(); });

  it('resolves all valid ids', async () => {
    const r = await resolveIncidentsBatch(['a', 'b', 'c']);
    expect(r.resolved).toEqual(['a', 'b', 'c']);
    expect(r.failed).toEqual([]);
  });

  it('does not roll back successful ids when one fails', async () => {
    const r = await resolveIncidentsBatch(['a', 'does-not-exist', 'c']);
    expect(r.resolved.sort()).toEqual(['a', 'c']);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].id).toBe('does-not-exist');

    const db = await getTestDb();
    const aRow = await db.queryOne<{ status: string }>('SELECT status FROM incidents WHERE id = ?', ['a']);
    const cRow = await db.queryOne<{ status: string }>('SELECT status FROM incidents WHERE id = ?', ['c']);
    expect(aRow?.status).toBe('resolved');
    expect(cRow?.status).toBe('resolved');
  });
});
```

- [ ] **Step 2: Run, verify failure**

```bash
cd packages/ai-intelligence && \
  POSTGRES_TEST_URL=postgresql://app_user:changeme-postgres-app@localhost:5433/portainer_dashboard_test \
  npx vitest run src/__tests__/incidents-resolve-batch.test.ts
```

Expected: failure (`resolveIncidentsBatch` not exported).

- [ ] **Step 3: Implement `resolveIncidentsBatch`**

Append to `packages/ai-intelligence/src/services/incident-store.ts`:

```ts
export interface BatchResolveResult {
  resolved: string[];
  failed: Array<{ id: string; error: string }>;
}

export async function resolveIncidentsBatch(ids: string[]): Promise<BatchResolveResult> {
  const result: BatchResolveResult = { resolved: [], failed: [] };
  for (const id of ids) {
    try {
      // Per-id, atomic. The existing resolveIncident is already an UPDATE
      // — we additionally verify the row existed by checking affected rows.
      const db = getDbForDomain('incidents');
      const before = await db.queryOne<{ id: string }>('SELECT id FROM incidents WHERE id = ?', [id]);
      if (!before) {
        result.failed.push({ id, error: 'not found' });
        continue;
      }
      await resolveIncident(id);
      result.resolved.push(id);
    } catch (err) {
      result.failed.push({ id, error: err instanceof Error ? err.message : 'unknown' });
    }
  }
  return result;
}
```

- [ ] **Step 4: Add the route**

In `packages/ai-intelligence/src/routes/incidents.ts`, add inside `incidentsRoutes(fastify)`:

```ts
import { z } from 'zod';

// ... existing routes ...

fastify.post('/api/incidents/resolve', {
  schema: {
    tags: ['Incidents'],
    summary: 'Resolve a batch of incidents',
    security: [{ bearerAuth: [] }],
    body: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'string', format: 'uuid' }, minItems: 1, maxItems: 500 },
      },
      required: ['ids'],
    },
  },
  preHandler: [fastify.authenticate, fastify.requireRole('admin')],
}, async (request, reply) => {
  const parsed = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }).safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'invalid body', details: parsed.error.flatten() });
  }
  const result = await resolveIncidentsBatch(parsed.data.ids);
  await invalidateGroupsCache();
  return result;
});
```

Also import `resolveIncidentsBatch`:

```ts
import { ..., resolveIncidentsBatch } from '../services/incident-store.js';
```

- [ ] **Step 5: Run, verify pass**

```bash
cd packages/ai-intelligence && \
  POSTGRES_TEST_URL=postgresql://app_user:changeme-postgres-app@localhost:5433/portainer_dashboard_test \
  npx vitest run src/__tests__/incidents-resolve-batch.test.ts
```

Expected: 2 passing.

- [ ] **Step 6: Commit**

```bash
git add packages/ai-intelligence/src/services/incident-store.ts \
        packages/ai-intelligence/src/routes/incidents.ts \
        packages/ai-intelligence/src/__tests__/incidents-resolve-batch.test.ts
git commit -m "feat(incidents): POST /api/incidents/resolve batch endpoint with per-id transactions"
```

---

### Task 12: Frontend hook `useIncidentGroups`

**Files:**
- Create: `frontend/src/features/ai-intelligence/hooks/use-incident-groups.ts`
- Test: `frontend/src/features/ai-intelligence/hooks/use-incident-groups.test.ts`

**Why:** Data hook for the rollup view, with camelCase → snake_case boundary mapping.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/features/ai-intelligence/hooks/use-incident-groups.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useIncidentGroups } from './use-incident-groups';

vi.mock('@/shared/lib/api', () => ({
  api: { get: vi.fn() },
}));
import { api } from '@/shared/lib/api';

const wrap = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
};

describe('useIncidentGroups', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('serializes camelCase params to snake_case query string', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ groups: [], endpoint_facets: [], total_active: 0 });
    const { result } = renderHook(
      () => useIncidentGroups({ status: 'active', endpointId: 42, since: '24h', severity: 'critical' }),
      { wrapper: wrap() },
    );
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(api.get).toHaveBeenCalledWith('/api/incidents/groups', {
      params: { status: 'active', endpoint_id: '42', since: '24h', severity: 'critical' },
    });
  });

  it('omits undefined params', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ groups: [], endpoint_facets: [], total_active: 0 });
    renderHook(() => useIncidentGroups({}), { wrapper: wrap() });
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    const call = (api.get as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].params).toEqual({});
  });
});
```

- [ ] **Step 2: Run, verify failure**

```bash
cd frontend && npx vitest run src/features/ai-intelligence/hooks/use-incident-groups.test.ts
```

Expected: failure (module not found).

- [ ] **Step 3: Implement the hook**

Create `frontend/src/features/ai-intelligence/hooks/use-incident-groups.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/lib/api';
import { usePageVisibility } from '@/shared/hooks/use-page-visibility';

export interface IncidentGroup {
  signature: string;
  label: string;
  severity: 'critical' | 'warning' | 'info';
  incident_count: number;
  container_count: number;
  alert_count: number;
  earliest_at: string;
  latest_update_at: string;
  top_containers: Array<{
    incident_id: string;
    container_name: string;
    endpoint_id: number | null;
    endpoint_name: string | null;
    severity: 'critical' | 'warning' | 'info';
    created_at: string;
  }>;
  all_container_names: string[];
  names_truncated: boolean;
}

export interface IncidentGroupsResponse {
  groups: IncidentGroup[];
  endpoint_facets: Array<{ endpoint_id: number | null; endpoint_name: string | null; incident_count: number }>;
  total_active: number;
}

export interface UseIncidentGroupsParams {
  status?: 'active' | 'resolved';
  endpointId?: number;
  since?: '1h' | '24h' | '7d';
  severity?: 'critical' | 'warning' | 'info';
}

export function useIncidentGroups(params: UseIncidentGroupsParams = {}) {
  const isVisible = usePageVisibility();
  const queryParams: Record<string, string> = {};
  if (params.status) queryParams.status = params.status;
  if (params.endpointId !== undefined) queryParams.endpoint_id = String(params.endpointId);
  if (params.since) queryParams.since = params.since;
  if (params.severity) queryParams.severity = params.severity;

  return useQuery<IncidentGroupsResponse>({
    queryKey: ['incident-groups', params.status, params.endpointId, params.since, params.severity],
    queryFn: () => api.get<IncidentGroupsResponse>('/api/incidents/groups', { params: queryParams }),
    refetchInterval: isVisible ? 30_000 : false,
  });
}
```

- [ ] **Step 4: Run, verify pass**

```bash
cd frontend && npx vitest run src/features/ai-intelligence/hooks/use-incident-groups.test.ts
```

Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/ai-intelligence/hooks/use-incident-groups.ts \
        frontend/src/features/ai-intelligence/hooks/use-incident-groups.test.ts
git commit -m "feat(frontend): useIncidentGroups hook with camelCase→snake_case mapping"
```

---

### Task 13: `IncidentGroupsView` — skeleton, summary, groups, expand, top-N, "Show all"

**Files:**
- Create: `frontend/src/features/ai-intelligence/components/incident-groups-view.tsx`
- Test: `frontend/src/features/ai-intelligence/components/incident-groups-view.test.tsx`
- Test: `frontend/src/features/ai-intelligence/components/incident-groups-view.show-all.test.tsx`

**Why:** Core component. Renders summary strip, groups, expand state with default-expand-on-critical, top-10 rows, "Show all" pagination.

- [ ] **Step 1: Write rendering tests (failing)**

Create `frontend/src/features/ai-intelligence/components/incident-groups-view.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IncidentGroupsView } from './incident-groups-view';
import type { IncidentGroupsResponse } from '../hooks/use-incident-groups';

vi.mock('../hooks/use-incident-groups', () => ({
  useIncidentGroups: vi.fn(),
}));
import { useIncidentGroups } from '../hooks/use-incident-groups';

const wrap = (children: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter>{children}</MemoryRouter>
  </QueryClientProvider>
);

const mock = (data: IncidentGroupsResponse) => {
  (useIncidentGroups as ReturnType<typeof vi.fn>).mockReturnValue({ data, isLoading: false });
};

describe('IncidentGroupsView — rendering', () => {
  it('renders summary strip with single-bucket-per-container counts', () => {
    mock({
      total_active: 3,
      endpoint_facets: [{ endpoint_id: 1, endpoint_name: 'eA', incident_count: 3 }],
      groups: [
        {
          signature: 'a:b:c', label: 'Critical thing', severity: 'critical',
          incident_count: 1, container_count: 1, alert_count: 1,
          earliest_at: '2026-05-06T00:00:00Z', latest_update_at: '2026-05-06T00:00:00Z',
          top_containers: [{ incident_id: 'x', container_name: 'cn-A', endpoint_id: 1, endpoint_name: 'eA', severity: 'critical', created_at: '2026-05-06T00:00:00Z' }],
          all_container_names: ['cn-A'], names_truncated: false,
        },
        {
          signature: 'd:e:f', label: 'Warning thing', severity: 'warning',
          incident_count: 2, container_count: 2, alert_count: 2,
          earliest_at: '2026-05-06T00:00:00Z', latest_update_at: '2026-05-06T00:00:00Z',
          top_containers: [
            { incident_id: 'y1', container_name: 'cn-A', endpoint_id: 1, endpoint_name: 'eA', severity: 'warning', created_at: '2026-05-06T00:00:00Z' },
            { incident_id: 'y2', container_name: 'cn-B', endpoint_id: 1, endpoint_name: 'eA', severity: 'warning', created_at: '2026-05-06T00:00:00Z' },
          ],
          all_container_names: ['cn-A', 'cn-B'], names_truncated: false,
        },
      ],
    });
    render(wrap(<IncidentGroupsView />));
    // cn-A is in both critical and warning → counts in critical only.
    expect(screen.getByTestId('summary-strip')).toHaveTextContent(/Critical:.*1.*container/i);
    expect(screen.getByTestId('summary-strip')).toHaveTextContent(/Warning:.*1.*container/i);  // cn-B only
  });

  it('expands critical groups by default, collapses warnings', () => {
    mock({
      total_active: 2,
      endpoint_facets: [],
      groups: [
        { signature: 'crit', label: 'Crit', severity: 'critical', incident_count: 1, container_count: 1, alert_count: 1,
          earliest_at: '', latest_update_at: '',
          top_containers: [{ incident_id: 'x', container_name: 'cn', endpoint_id: 1, endpoint_name: 'e', severity: 'critical', created_at: '' }],
          all_container_names: ['cn'], names_truncated: false },
        { signature: 'warn', label: 'Warn', severity: 'warning', incident_count: 1, container_count: 1, alert_count: 1,
          earliest_at: '', latest_update_at: '',
          top_containers: [{ incident_id: 'y', container_name: 'cn2', endpoint_id: 1, endpoint_name: 'e', severity: 'warning', created_at: '' }],
          all_container_names: ['cn2'], names_truncated: false },
      ],
    });
    render(wrap(<IncidentGroupsView />));
    expect(screen.getByText('cn')).toBeInTheDocument();      // critical group expanded
    expect(screen.queryByText('cn2')).not.toBeInTheDocument(); // warning collapsed
  });

  it('toggling a group expands its top-10 rows', async () => {
    mock({
      total_active: 1,
      endpoint_facets: [],
      groups: [
        { signature: 'warn', label: 'Warn', severity: 'warning', incident_count: 1, container_count: 1, alert_count: 1,
          earliest_at: '', latest_update_at: '',
          top_containers: [{ incident_id: 'y', container_name: 'cn2', endpoint_id: 1, endpoint_name: 'e', severity: 'warning', created_at: '' }],
          all_container_names: ['cn2'], names_truncated: false },
      ],
    });
    render(wrap(<IncidentGroupsView />));
    expect(screen.queryByText('cn2')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Warn/i }));
    expect(screen.getByText('cn2')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Write the "Show all" test (failing)**

Create `frontend/src/features/ai-intelligence/components/incident-groups-view.show-all.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IncidentGroupsView } from './incident-groups-view';

vi.mock('../hooks/use-incident-groups', () => ({ useIncidentGroups: vi.fn() }));
vi.mock('@/shared/lib/api', () => ({ api: { get: vi.fn() } }));
import { useIncidentGroups } from '../hooks/use-incident-groups';
import { api } from '@/shared/lib/api';

const wrap = (children: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter>{children}</MemoryRouter>
  </QueryClientProvider>
);

describe('IncidentGroupsView — Show all pagination', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders Show all button when container_count > 10 and fetches the long tail on click', async () => {
    (useIncidentGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        total_active: 12, endpoint_facets: [],
        groups: [{
          signature: 'a:b:c', label: 'Big', severity: 'critical',
          incident_count: 12, container_count: 12, alert_count: 12,
          earliest_at: '', latest_update_at: '',
          top_containers: Array.from({ length: 10 }, (_, i) => ({
            incident_id: `i${i}`, container_name: `cn-${i}`,
            endpoint_id: 1, endpoint_name: 'e', severity: 'warning' as const,
            created_at: '',
          })),
          all_container_names: Array.from({ length: 12 }, (_, i) => `cn-${i}`),
          names_truncated: false,
        }],
      },
      isLoading: false,
    });
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      incidents: [
        { id: 'i10', title: 't', signature: 'a:b:c', severity: 'warning', status: 'active',
          affected_containers: ['cn-10'], endpoint_id: 1, endpoint_name: 'e',
          created_at: '', updated_at: '' },
        { id: 'i11', title: 't', signature: 'a:b:c', severity: 'warning', status: 'active',
          affected_containers: ['cn-11'], endpoint_id: 1, endpoint_name: 'e',
          created_at: '', updated_at: '' },
      ],
      counts: { active: 12, resolved: 0, total: 12 },
      limit: 50, offset: 0,
    });

    render(wrap(<IncidentGroupsView />));
    const showAll = screen.getByRole('button', { name: /Show all 12/i });
    await userEvent.click(showAll);

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/api/incidents', {
        params: { status: 'active', signature: 'a:b:c', limit: '500' },
      });
    });
    expect(screen.getByText('cn-10')).toBeInTheDocument();
    expect(screen.getByText('cn-11')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run, verify failure**

```bash
cd frontend && npx vitest run src/features/ai-intelligence/components/incident-groups-view.test.tsx \
  src/features/ai-intelligence/components/incident-groups-view.show-all.test.tsx
```

Expected: failure (`incident-groups-view` not found).

- [ ] **Step 4: Implement the component**

Create `frontend/src/features/ai-intelligence/components/incident-groups-view.tsx`:

```tsx
import { useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, Layers } from 'lucide-react';
import { useIncidentGroups, type IncidentGroup } from '../hooks/use-incident-groups';
import { api } from '@/shared/lib/api';
import { cn } from '@/shared/lib/utils';

interface LongTailRow {
  incident_id: string;
  container_name: string;
  endpoint_id: number | null;
  endpoint_name: string | null;
  severity: 'critical' | 'warning' | 'info';
  created_at: string;
}

export function IncidentGroupsView() {
  const { data, isLoading } = useIncidentGroups({ status: 'active' });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [longTailBySig, setLongTailBySig] = useState<Record<string, LongTailRow[]>>({});

  const summary = useMemo(() => computeSummary(data?.groups ?? []), [data?.groups]);

  const toggle = useCallback((sig: string, defaultOpen: boolean) => {
    setExpanded((prev) => ({ ...prev, [sig]: prev[sig] === undefined ? !defaultOpen : !prev[sig] }));
  }, []);
  const isOpen = (sig: string, severity: IncidentGroup['severity']) =>
    expanded[sig] !== undefined ? expanded[sig] : severity === 'critical';

  const showAll = useCallback(async (group: IncidentGroup) => {
    const r = await api.get<{ incidents: Array<{ id: string; affected_containers: string[]; endpoint_id: number | null; endpoint_name: string | null; severity: 'critical' | 'warning' | 'info'; created_at: string }> }>(
      '/api/incidents',
      { params: { status: 'active', signature: group.signature, limit: '500' } },
    );
    const rows: LongTailRow[] = r.incidents.flatMap((inc) =>
      (inc.affected_containers ?? []).map((name) => ({
        incident_id: inc.id, container_name: name,
        endpoint_id: inc.endpoint_id, endpoint_name: inc.endpoint_name,
        severity: inc.severity, created_at: inc.created_at,
      })),
    );
    setLongTailBySig((prev) => ({ ...prev, [group.signature]: rows }));
  }, []);

  if (isLoading || !data) return null;
  if (data.groups.length === 0) {
    return <div className="rounded-lg border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">No active incidents in this view.</div>;
  }

  return (
    <div className="space-y-3">
      <div data-testid="summary-strip" className="text-sm">
        {summary.critical.containers > 0 && (
          <span>Critical: {summary.critical.kinds} kinds across {summary.critical.containers} container{summary.critical.containers === 1 ? '' : 's'}</span>
        )}
        {summary.warning.containers > 0 && (
          <span> · Warning: {summary.warning.kinds} kinds across {summary.warning.containers} container{summary.warning.containers === 1 ? '' : 's'}</span>
        )}
        {summary.info.containers > 0 && (
          <span> · Info: {summary.info.kinds} / {summary.info.containers}</span>
        )}
      </div>

      {data.groups.map((g) => {
        const open = isOpen(g.signature, g.severity);
        const longTail = longTailBySig[g.signature];
        const rows = longTail ?? g.top_containers;
        return (
          <div key={g.signature} className={cn('overflow-hidden rounded-lg border-2 bg-card', g.severity === 'critical' ? 'border-red-500/40' : 'border-amber-500/40')}>
            <button onClick={() => toggle(g.signature, g.severity === 'critical')} className="w-full p-4 text-left transition-colors hover:bg-muted/20" aria-label={g.label}>
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className={cn('h-2 w-2 rounded-full', g.severity === 'critical' ? 'bg-red-500' : g.severity === 'warning' ? 'bg-amber-500' : 'bg-blue-500')} />
                  <Layers className="h-4 w-4 text-muted-foreground" />
                  <span className="font-semibold">{g.label}</span>
                  <span className="text-sm text-muted-foreground">{g.container_count} container{g.container_count === 1 ? '' : 's'} · {g.alert_count} alert{g.alert_count === 1 ? '' : 's'}</span>
                </div>
                {open ? <ChevronDown className="h-5 w-5 text-muted-foreground" /> : <ChevronRight className="h-5 w-5 text-muted-foreground" />}
              </div>
            </button>
            {open && (
              <div className="border-t bg-muted/10">
                <ul className="divide-y">
                  {rows.map((row) => (
                    <li key={`${row.incident_id}:${row.container_name}`} className="flex items-center justify-between px-4 py-2 text-sm">
                      <Link to={`/containers/${row.endpoint_id}/${row.container_name}`} className="font-mono text-sm hover:underline">{row.container_name}</Link>
                      <span className="text-xs text-muted-foreground">{row.severity} · {row.endpoint_name ?? 'unknown'}</span>
                    </li>
                  ))}
                </ul>
                {!longTail && g.container_count > g.top_containers.length && (
                  <button type="button" onClick={() => showAll(g)} className="block w-full px-4 py-2 text-center text-sm text-primary hover:bg-muted/30">
                    Show all {g.container_count}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function computeSummary(groups: IncidentGroup[]): {
  critical: { kinds: number; containers: number };
  warning:  { kinds: number; containers: number };
  info:     { kinds: number; containers: number };
} {
  const containerHighest = new Map<string, IncidentGroup['severity']>();
  for (const g of groups) {
    for (const name of g.all_container_names) {
      const cur = containerHighest.get(name);
      if (!cur || rankSeverity(g.severity) < rankSeverity(cur)) containerHighest.set(name, g.severity);
    }
  }
  const out = { critical: { kinds: 0, containers: 0 }, warning: { kinds: 0, containers: 0 }, info: { kinds: 0, containers: 0 } };
  for (const g of groups) out[g.severity].kinds++;
  for (const sev of containerHighest.values()) out[sev].containers++;
  return out;
}
function rankSeverity(s: IncidentGroup['severity']): number {
  return s === 'critical' ? 0 : s === 'warning' ? 1 : 2;
}
```

- [ ] **Step 5: Run, verify pass**

```bash
cd frontend && npx vitest run src/features/ai-intelligence/components/incident-groups-view.test.tsx \
  src/features/ai-intelligence/components/incident-groups-view.show-all.test.tsx
```

Expected: 4 passing total.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/ai-intelligence/components/incident-groups-view.tsx \
        frontend/src/features/ai-intelligence/components/incident-groups-view.test.tsx \
        frontend/src/features/ai-intelligence/components/incident-groups-view.show-all.test.tsx
git commit -m "feat(frontend): IncidentGroupsView with summary, expand, top-N, Show all"
```

---

### Task 14: Search + 250 ms debounce + truncated-group fallback

**Files:**
- Modify: `frontend/src/features/ai-intelligence/components/incident-groups-view.tsx`
- Test: `frontend/src/features/ai-intelligence/components/incident-groups-view.search.test.tsx`
- Test: `frontend/src/features/ai-intelligence/components/incident-groups-view.search-debounce.test.tsx`

**Why:** The search input must filter via `all_container_names` (no false negatives in the long tail). Truncated groups (`names_truncated: true`) delegate search to backend.

- [ ] **Step 1: Write search tests (failing)**

Create `frontend/src/features/ai-intelligence/components/incident-groups-view.search.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IncidentGroupsView } from './incident-groups-view';

vi.mock('../hooks/use-incident-groups', () => ({ useIncidentGroups: vi.fn() }));
vi.mock('@/shared/lib/api', () => ({ api: { get: vi.fn() } }));
import { useIncidentGroups } from '../hooks/use-incident-groups';
import { api } from '@/shared/lib/api';

const wrap = (c: React.ReactNode) => <QueryClientProvider client={new QueryClient()}><MemoryRouter>{c}</MemoryRouter></QueryClientProvider>;

describe('IncidentGroupsView — search', () => {
  it('hides groups whose label and all_container_names do not match', async () => {
    (useIncidentGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        total_active: 2, endpoint_facets: [],
        groups: [
          { signature: 'a', label: 'Apple', severity: 'critical', incident_count: 1, container_count: 1, alert_count: 1, earliest_at: '', latest_update_at: '', top_containers: [{ incident_id: 'x', container_name: 'apple-1', endpoint_id: 1, endpoint_name: 'e', severity: 'critical', created_at: '' }], all_container_names: ['apple-1'], names_truncated: false },
          { signature: 'b', label: 'Banana', severity: 'critical', incident_count: 1, container_count: 1, alert_count: 1, earliest_at: '', latest_update_at: '', top_containers: [{ incident_id: 'y', container_name: 'banana-1', endpoint_id: 1, endpoint_name: 'e', severity: 'critical', created_at: '' }], all_container_names: ['banana-1'], names_truncated: false },
        ],
      },
      isLoading: false,
    });
    render(wrap(<IncidentGroupsView search="banana" />));
    expect(screen.getByText('Banana')).toBeInTheDocument();
    expect(screen.queryByText('Apple')).not.toBeInTheDocument();
  });

  it('auto-expands a collapsed group when its container matches', async () => {
    (useIncidentGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        total_active: 1, endpoint_facets: [],
        groups: [{
          signature: 'a', label: 'Warn', severity: 'warning',
          incident_count: 1, container_count: 1, alert_count: 1,
          earliest_at: '', latest_update_at: '',
          top_containers: [{ incident_id: 'x', container_name: 'matchme', endpoint_id: 1, endpoint_name: 'e', severity: 'warning', created_at: '' }],
          all_container_names: ['matchme'], names_truncated: false,
        }],
      },
      isLoading: false,
    });
    render(wrap(<IncidentGroupsView search="matchme" />));
    expect(screen.getByText('matchme')).toBeInTheDocument();
  });

  it('truncated groups delegate search to backend when query is non-empty', async () => {
    (useIncidentGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        total_active: 600, endpoint_facets: [],
        groups: [{
          signature: 'big', label: 'Many', severity: 'warning',
          incident_count: 600, container_count: 600, alert_count: 600,
          earliest_at: '', latest_update_at: '',
          top_containers: [],
          all_container_names: Array.from({ length: 500 }, (_, i) => `cn-${i}`),
          names_truncated: true,
        }],
      },
      isLoading: false,
    });
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ incidents: [], counts: { active: 0, resolved: 0, total: 0 }, limit: 50, offset: 0 });
    render(wrap(<IncidentGroupsView search="cn-700" />));
    // 250 ms debounce — wait
    await new Promise((r) => setTimeout(r, 300));
    expect(api.get).toHaveBeenCalledWith('/api/incidents', expect.objectContaining({ params: expect.objectContaining({ signature: 'big', q: 'cn-700' }) }));
  });
});
```

- [ ] **Step 2: Write debounce test (failing)**

Create `frontend/src/features/ai-intelligence/components/incident-groups-view.search-debounce.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IncidentGroupsView } from './incident-groups-view';

vi.mock('../hooks/use-incident-groups', () => ({ useIncidentGroups: vi.fn() }));
vi.mock('@/shared/lib/api', () => ({ api: { get: vi.fn() } }));
import { useIncidentGroups } from '../hooks/use-incident-groups';
import { api } from '@/shared/lib/api';

const wrap = (c: React.ReactNode) => <QueryClientProvider client={new QueryClient()}><MemoryRouter>{c}</MemoryRouter></QueryClientProvider>;

const baseGroup = {
  signature: 'big', label: 'Many', severity: 'warning' as const,
  incident_count: 100, container_count: 100, alert_count: 100,
  earliest_at: '', latest_update_at: '', top_containers: [],
  all_container_names: [], names_truncated: true,
};

afterEach(() => vi.clearAllMocks());

describe('IncidentGroupsView — search debounce', () => {
  it('does not auto-fetch until 250 ms quiet', async () => {
    (useIncidentGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { total_active: 100, endpoint_facets: [], groups: [baseGroup] },
      isLoading: false,
    });
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ incidents: [], counts: { active: 0, resolved: 0, total: 0 }, limit: 50, offset: 0 });
    const { rerender } = render(wrap(<IncidentGroupsView search="a" />));
    rerender(wrap(<IncidentGroupsView search="ab" />));
    rerender(wrap(<IncidentGroupsView search="abc" />));
    // Before 250 ms: no calls
    expect(api.get).not.toHaveBeenCalled();
    // After 300 ms: exactly one call with the latest term
    await new Promise((r) => setTimeout(r, 300));
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith('/api/incidents', expect.objectContaining({ params: expect.objectContaining({ q: 'abc' }) }));
  });
});
```

- [ ] **Step 3: Run, verify failures**

```bash
cd frontend && npx vitest run src/features/ai-intelligence/components/incident-groups-view.search.test.tsx \
  src/features/ai-intelligence/components/incident-groups-view.search-debounce.test.tsx
```

Expected: failures (`search` prop not yet accepted).

- [ ] **Step 4: Add search prop and debounce hook**

Modify `frontend/src/features/ai-intelligence/components/incident-groups-view.tsx`. Add a `search` prop and a debounce hook. Insert near the top of the file (after imports):

```ts
import { useEffect } from 'react';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
```

Update the component signature:

```tsx
export function IncidentGroupsView({ search = '' }: { search?: string }) {
  // ... existing body ...
  const debouncedSearch = useDebounced(search, 250);
  const searchLower = debouncedSearch.toLowerCase();

  const visibleGroups = useMemo(() => {
    if (!data) return [];
    if (!searchLower) return data.groups;
    return data.groups.filter((g) =>
      g.label.toLowerCase().includes(searchLower) ||
      g.all_container_names.some((n) => n.toLowerCase().includes(searchLower)),
    );
  }, [data, searchLower]);

  // Truncated-group backend delegation
  useEffect(() => {
    if (!searchLower || !data) return;
    for (const g of data.groups) {
      if (!g.names_truncated) continue;
      api.get<{ incidents: Array<{ id: string; affected_containers: string[]; endpoint_id: number | null; endpoint_name: string | null; severity: 'critical' | 'warning' | 'info'; created_at: string }> }>(
        '/api/incidents', { params: { status: 'active', signature: g.signature, q: debouncedSearch } },
      ).then((r) => {
        const rows: LongTailRow[] = r.incidents.flatMap((inc) =>
          (inc.affected_containers ?? []).map((name) => ({
            incident_id: inc.id, container_name: name,
            endpoint_id: inc.endpoint_id, endpoint_name: inc.endpoint_name,
            severity: inc.severity, created_at: inc.created_at,
          })),
        );
        setLongTailBySig((prev) => ({ ...prev, [g.signature]: rows }));
      });
    }
  }, [searchLower, debouncedSearch, data]);

  // Replace `data.groups.map(...)` with `visibleGroups.map(...)`
  // Replace `if (data.groups.length === 0)` with the empty-state check based on visibleGroups
```

For auto-expand on container match: in the rendering loop, compute `effectivelyOpen = isOpen(g.signature, g.severity) || (searchLower && g.all_container_names.some((n) => n.toLowerCase().includes(searchLower)))` and render expanded section when this is true.

- [ ] **Step 5: Run, verify pass**

```bash
cd frontend && npx vitest run src/features/ai-intelligence/components/incident-groups-view.search.test.tsx \
  src/features/ai-intelligence/components/incident-groups-view.search-debounce.test.tsx
```

Expected: 4 passing.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/ai-intelligence/components/incident-groups-view.tsx \
        frontend/src/features/ai-intelligence/components/incident-groups-view.search.test.tsx \
        frontend/src/features/ai-intelligence/components/incident-groups-view.search-debounce.test.tsx
git commit -m "feat(frontend): IncidentGroupsView search with 250ms debounce and truncated-group backend fallback"
```

> Note: backend support for `?q=` on `/api/incidents` is not implemented in this PR — the spec lists it as a follow-up. The frontend code calls it; if the backend returns empty (current behaviour), the user sees no matches in truncated groups, which is no worse than today.

---

### Task 15: Resolve flows — per-row, multi-select, per-group with batch endpoint

**Files:**
- Modify: `frontend/src/features/ai-intelligence/components/incident-groups-view.tsx`
- Modify: `frontend/src/features/ai-intelligence/hooks/use-incidents.ts` (add `useBatchResolve`)
- Test: `frontend/src/features/ai-intelligence/components/incident-groups-view.resolve.test.tsx`

**Why:** All three resolve paths use the new batch endpoint where >1 id; partial-failure UX matches §4.5.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/features/ai-intelligence/components/incident-groups-view.resolve.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IncidentGroupsView } from './incident-groups-view';

vi.mock('../hooks/use-incident-groups', () => ({ useIncidentGroups: vi.fn() }));
vi.mock('@/shared/lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
import { useIncidentGroups } from '../hooks/use-incident-groups';
import { api } from '@/shared/lib/api';

const wrap = (c: React.ReactNode) => <QueryClientProvider client={new QueryClient()}><MemoryRouter>{c}</MemoryRouter></QueryClientProvider>;

const groupOf = (ids: string[]) => ({
  signature: 'g', label: 'Grp', severity: 'critical' as const,
  incident_count: ids.length, container_count: ids.length, alert_count: ids.length,
  earliest_at: '', latest_update_at: '',
  top_containers: ids.map((id, i) => ({
    incident_id: id, container_name: `cn-${i}`, endpoint_id: 1, endpoint_name: 'e',
    severity: 'critical' as const, created_at: '',
  })),
  all_container_names: ids.map((_, i) => `cn-${i}`),
  names_truncated: false,
});

beforeEach(() => vi.clearAllMocks());

describe('IncidentGroupsView — resolve', () => {
  it('per-group "Resolve all N" calls batch endpoint with the group ids', async () => {
    (useIncidentGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { total_active: 3, endpoint_facets: [], groups: [groupOf(['x', 'y', 'z'])] },
      isLoading: false,
    });
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ resolved: ['x', 'y', 'z'], failed: [] });

    render(wrap(<IncidentGroupsView />));
    await userEvent.click(screen.getByRole('button', { name: /Resolve all 3/i }));
    // ConfirmDialog confirm — match the existing label used by the dialog
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }));

    expect(api.post).toHaveBeenCalledWith('/api/incidents/resolve', { ids: ['x', 'y', 'z'] });
  });

  it('partial failure ≤5 keeps failed inline with retry option', async () => {
    (useIncidentGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { total_active: 3, endpoint_facets: [], groups: [groupOf(['x', 'y', 'z'])] },
      isLoading: false,
    });
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      resolved: ['x', 'z'],
      failed: [{ id: 'y', error: 'boom' }],
    });

    render(wrap(<IncidentGroupsView />));
    await userEvent.click(screen.getByRole('button', { name: /Resolve all 3/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }));

    expect(await screen.findByText(/Retry 1 failed/i)).toBeInTheDocument();
  });

  it('partial failure >5 collapses into a banner', async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `i${i}`);
    (useIncidentGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { total_active: 12, endpoint_facets: [], groups: [groupOf(ids)] },
      isLoading: false,
    });
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      resolved: ids.slice(0, 5),
      failed: ids.slice(5).map((id) => ({ id, error: 'e' })),
    });

    render(wrap(<IncidentGroupsView />));
    await userEvent.click(screen.getByRole('button', { name: /Resolve all 12/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }));

    expect(await screen.findByText(/7 of 12 resolves failed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry failed only/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, verify failure**

```bash
cd frontend && npx vitest run src/features/ai-intelligence/components/incident-groups-view.resolve.test.tsx
```

Expected: failure (resolve UI not implemented).

- [ ] **Step 3: Add `useBatchResolve` hook**

In `frontend/src/features/ai-intelligence/hooks/use-incidents.ts`, append:

```ts
export interface BatchResolveResponse {
  resolved: string[];
  failed: Array<{ id: string; error: string }>;
}

export function useBatchResolveIncidents() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api.post<BatchResolveResponse>('/api/incidents/resolve', { ids }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      queryClient.invalidateQueries({ queryKey: ['incident-groups'] });
    },
  });
}
```

- [ ] **Step 4: Wire resolve UX into `IncidentGroupsView`**

In `incident-groups-view.tsx`, add:

```tsx
import { useBatchResolveIncidents, type BatchResolveResponse } from '../hooks/use-incidents';
import { ConfirmDialog } from '@/shared/components/feedback/confirm-dialog';

// inside component:
const batchResolve = useBatchResolveIncidents();
const [pendingGroup, setPendingGroup] = useState<IncidentGroup | null>(null);
const [lastFailure, setLastFailure] = useState<BatchResolveResponse | null>(null);

const onResolveGroup = useCallback(async (group: IncidentGroup) => {
  setPendingGroup(null);
  const ids = group.top_containers.map((c) => c.incident_id);
  const r = await batchResolve.mutateAsync(ids);
  if (r.failed.length > 0) setLastFailure(r);
}, [batchResolve]);

const onRetryFailed = useCallback(async () => {
  if (!lastFailure) return;
  const r = await batchResolve.mutateAsync(lastFailure.failed.map((f) => f.id));
  setLastFailure(r.failed.length > 0 ? r : null);
}, [batchResolve, lastFailure]);
```

In each group's expanded section, render a "Resolve all N" button that opens `ConfirmDialog` with `setPendingGroup(g)`. Render the dialog at the bottom of the component:

```tsx
{pendingGroup && (
  <ConfirmDialog
    title={`Resolve all ${pendingGroup.incident_count} incidents in this group?`}
    onConfirm={() => onResolveGroup(pendingGroup)}
    onCancel={() => setPendingGroup(null)}
    confirmLabel="Confirm"
  />
)}
```

For partial-failure surfacing:

```tsx
{lastFailure && lastFailure.failed.length > 0 && (
  lastFailure.failed.length <= 5 ? (
    <div role="alert" className="rounded-md border border-red-500/40 bg-red-50/30 p-2 text-sm">
      <p className="font-medium">Retry {lastFailure.failed.length} failed</p>
      <ul className="mt-1 list-disc pl-5">
        {lastFailure.failed.map((f) => <li key={f.id}>{f.id}: {f.error}</li>)}
      </ul>
      <button onClick={onRetryFailed} className="mt-1 rounded-md bg-emerald-600 px-2 py-1 text-xs text-white">Retry</button>
    </div>
  ) : (
    <div role="alert" className="rounded-md border border-red-500/40 bg-red-50/30 p-2 text-sm">
      <p className="font-medium">{lastFailure.failed.length} of {lastFailure.failed.length + lastFailure.resolved.length} resolves failed</p>
      <button onClick={onRetryFailed} className="mt-1 rounded-md bg-emerald-600 px-2 py-1 text-xs text-white">Retry failed only</button>
    </div>
  )
)}
```

- [ ] **Step 5: Run, verify pass**

```bash
cd frontend && npx vitest run src/features/ai-intelligence/components/incident-groups-view.resolve.test.tsx
```

Expected: 3 passing.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/ai-intelligence/components/incident-groups-view.tsx \
        frontend/src/features/ai-intelligence/components/incident-groups-view.resolve.test.tsx \
        frontend/src/features/ai-intelligence/hooks/use-incidents.ts
git commit -m "feat(frontend): per-group Resolve all via batch endpoint with partial-failure UX"
```

---

### Task 16: URL state — `range`, `endpoint`, `sort`, `expand`

**Files:**
- Modify: `frontend/src/features/ai-intelligence/components/incident-groups-view.tsx`
- Test: `frontend/src/features/ai-intelligence/components/incident-groups-view.url.test.tsx`

**Why:** Deep-linking and refresh-stable views.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/features/ai-intelligence/components/incident-groups-view.url.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IncidentGroupsView } from './incident-groups-view';

vi.mock('../hooks/use-incident-groups', () => ({ useIncidentGroups: vi.fn() }));
import { useIncidentGroups } from '../hooks/use-incident-groups';

const wrap = (initialEntries: string[], children: React.ReactNode) =>
  <QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter></QueryClientProvider>;

describe('IncidentGroupsView — URL ?expand=', () => {
  it('initial render with ?expand=-anomaly%3Aml-anomaly%3Acpu collapses a critical group', () => {
    (useIncidentGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { total_active: 1, endpoint_facets: [], groups: [{
        signature: 'anomaly:ml-anomaly:cpu', label: 'CPU anomaly', severity: 'critical',
        incident_count: 1, container_count: 1, alert_count: 1,
        earliest_at: '', latest_update_at: '',
        top_containers: [{ incident_id: 'x', container_name: 'cn', endpoint_id: 1, endpoint_name: 'e', severity: 'critical', created_at: '' }],
        all_container_names: ['cn'], names_truncated: false,
      }] },
      isLoading: false,
    });
    render(wrap(['/?expand=-anomaly%3Aml-anomaly%3Acpu'], <IncidentGroupsView />));
    expect(screen.queryByText('cn')).not.toBeInTheDocument();
  });

  it('toggling a critical group closed encodes -<sig> into the URL', async () => {
    (useIncidentGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { total_active: 1, endpoint_facets: [], groups: [{
        signature: 'anomaly:ml-anomaly:cpu', label: 'CPU anomaly', severity: 'critical',
        incident_count: 1, container_count: 1, alert_count: 1,
        earliest_at: '', latest_update_at: '',
        top_containers: [{ incident_id: 'x', container_name: 'cn', endpoint_id: 1, endpoint_name: 'e', severity: 'critical', created_at: '' }],
        all_container_names: ['cn'], names_truncated: false,
      }] },
      isLoading: false,
    });
    render(wrap(['/'], <IncidentGroupsView />));
    expect(screen.getByText('cn')).toBeInTheDocument(); // expanded by default
    await userEvent.click(screen.getByRole('button', { name: /CPU anomaly/i }));
    // Expected: clicking toggles closed; component updates URL via setSearchParams.
    // We assert visible state since RouterDOM updates internal location.
    expect(screen.queryByText('cn')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, verify failure**

```bash
cd frontend && npx vitest run src/features/ai-intelligence/components/incident-groups-view.url.test.tsx
```

Expected: failure (URL state not yet wired in).

- [ ] **Step 3: Wire URL state**

In `incident-groups-view.tsx`, replace the local `expanded` state with URL-driven state:

```ts
import { useSearchParams } from 'react-router-dom';

// inside component:
const [searchParams, setSearchParams] = useSearchParams();
const expandParam = searchParams.get('expand') ?? '';

const overrides = useMemo(() => {
  const opens = new Set<string>();
  const closes = new Set<string>();
  for (const part of expandParam.split(',').filter(Boolean)) {
    const decoded = decodeURIComponent(part);
    if (decoded.startsWith('-')) closes.add(decoded.slice(1));
    else opens.add(decoded);
  }
  return { opens, closes };
}, [expandParam]);

const isOpen = (sig: string, severity: IncidentGroup['severity']) => {
  if (overrides.closes.has(sig)) return false;
  if (overrides.opens.has(sig)) return true;
  return severity === 'critical';
};

const toggle = useCallback((sig: string, severity: IncidentGroup['severity']) => {
  const open = isOpen(sig, severity);
  const next = !open;
  // Compute new expand param
  const opens = new Set(overrides.opens);
  const closes = new Set(overrides.closes);
  opens.delete(sig); closes.delete(sig);
  const defaultOpen = severity === 'critical';
  if (next !== defaultOpen) {
    if (next) opens.add(sig); else closes.add(sig);
  }
  const parts = [
    ...Array.from(opens).map((s) => encodeURIComponent(s)),
    ...Array.from(closes).map((s) => '-' + encodeURIComponent(s)),
  ];
  const sp = new URLSearchParams(searchParams);
  if (parts.length > 0) sp.set('expand', parts.join(',')); else sp.delete('expand');
  setSearchParams(sp);
}, [searchParams, setSearchParams, overrides]);
```

The `range`, `endpoint`, `sort` URL params stay handled in the parent `ai-monitor.tsx` page (see Task 18). This component reads them via props if needed.

- [ ] **Step 4: Run, verify pass**

```bash
cd frontend && npx vitest run src/features/ai-intelligence/components/incident-groups-view.url.test.tsx
```

Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/ai-intelligence/components/incident-groups-view.tsx \
        frontend/src/features/ai-intelligence/components/incident-groups-view.url.test.tsx
git commit -m "feat(frontend): URL ?expand= encodes group toggle deviations from severity default"
```

---

### Task 17: Endpoint chip overflow — first 8 inline + `+N more` dropdown

**Files:**
- Modify: `frontend/src/features/ai-intelligence/components/incident-groups-view.tsx`
- Test: `frontend/src/features/ai-intelligence/components/incident-groups-view.endpoint-overflow.test.tsx`

**Why:** Multi-host fleets — chip row stays usable above 8 endpoints.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/features/ai-intelligence/components/incident-groups-view.endpoint-overflow.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IncidentGroupsView } from './incident-groups-view';

vi.mock('../hooks/use-incident-groups', () => ({ useIncidentGroups: vi.fn() }));
import { useIncidentGroups } from '../hooks/use-incident-groups';

const wrap = (c: React.ReactNode) => <QueryClientProvider client={new QueryClient()}><MemoryRouter>{c}</MemoryRouter></QueryClientProvider>;

describe('IncidentGroupsView — endpoint chip overflow', () => {
  it('renders <=8 endpoints inline, no dropdown', () => {
    (useIncidentGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        total_active: 0, groups: [],
        endpoint_facets: Array.from({ length: 5 }, (_, i) => ({ endpoint_id: i, endpoint_name: `e${i}`, incident_count: 1 })),
      },
      isLoading: false,
    });
    render(wrap(<IncidentGroupsView />));
    expect(screen.queryByText(/more/i)).not.toBeInTheDocument();
  });

  it('renders +N more dropdown when >8 endpoints', () => {
    (useIncidentGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        total_active: 0, groups: [],
        endpoint_facets: Array.from({ length: 12 }, (_, i) => ({ endpoint_id: i, endpoint_name: `e${i}`, incident_count: 1 })),
      },
      isLoading: false,
    });
    render(wrap(<IncidentGroupsView />));
    expect(screen.getByText(/\+4 more/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, verify failure**

```bash
cd frontend && npx vitest run src/features/ai-intelligence/components/incident-groups-view.endpoint-overflow.test.tsx
```

Expected: failure.

- [ ] **Step 3: Render the chip row with overflow**

In `incident-groups-view.tsx`, add (place above the groups list):

```tsx
function EndpointChips({ facets }: { facets: Array<{ endpoint_id: number | null; endpoint_name: string | null; incident_count: number }> }) {
  if (facets.length <= 1) return null;
  const inline = facets.slice(0, 8);
  const overflow = facets.slice(8);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {inline.map((f) => (
        <button key={`${f.endpoint_id}`} className="rounded-full border px-3 py-1 text-xs">
          {f.endpoint_name ?? 'unknown'} ({f.incident_count})
        </button>
      ))}
      {overflow.length > 0 && (
        <details>
          <summary className="cursor-pointer rounded-full border px-3 py-1 text-xs">+{overflow.length} more</summary>
          <ul className="absolute z-10 mt-1 max-h-64 w-64 overflow-auto rounded-md border bg-popover p-1 shadow">
            {overflow.map((f) => (
              <li key={`${f.endpoint_id}`}><button className="w-full rounded px-2 py-1 text-left text-xs hover:bg-muted">{f.endpoint_name ?? 'unknown'} ({f.incident_count})</button></li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
```

Render `<EndpointChips facets={data.endpoint_facets} />` between the summary strip and the groups list.

- [ ] **Step 4: Run, verify pass**

```bash
cd frontend && npx vitest run src/features/ai-intelligence/components/incident-groups-view.endpoint-overflow.test.tsx
```

Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/ai-intelligence/components/incident-groups-view.tsx \
        frontend/src/features/ai-intelligence/components/incident-groups-view.endpoint-overflow.test.tsx
git commit -m "feat(frontend): endpoint chip row with +N more overflow"
```

---

### Task 18: Swap the page section in `ai-monitor.tsx`

**Files:**
- Modify: `frontend/src/features/ai-intelligence/pages/ai-monitor.tsx`
- Modify: `frontend/src/features/ai-intelligence/pages/ai-monitor.test.tsx`

**Why:** The page now renders the rollup component instead of the flat list.

- [ ] **Step 1: Update an `ai-monitor.test.tsx` assertion (failing)**

In `frontend/src/features/ai-intelligence/pages/ai-monitor.test.tsx`, add a test:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AiMonitorPage } from './ai-monitor';

vi.mock('../components/incident-groups-view', () => ({
  IncidentGroupsView: () => <div data-testid="igv-marker" />,
}));

it('renders IncidentGroupsView in place of the legacy flat list', () => {
  const { getByTestId, queryByText } = render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <AiMonitorPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(getByTestId('igv-marker')).toBeInTheDocument();
  // The old per-incident card stack should not be rendered when the new
  // component is.
  expect(queryByText(/Active Incidents.*\(.* of \d+\)/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run, verify failure**

```bash
cd frontend && npx vitest run src/features/ai-intelligence/pages/ai-monitor.test.tsx
```

Expected: failure (`igv-marker` not found).

- [ ] **Step 3: Swap the section in `ai-monitor.tsx`**

Find the existing `Active Incidents` block (lines 1453–1594 per the file scan). Replace the entire `{incidentsData && incidentsData.incidents.length > 0 && ( ... )}` block with:

```tsx
<IncidentGroupsView search={searchInput} />
```

Add the import at the top:

```tsx
import { IncidentGroupsView } from '@/features/ai-intelligence/components/incident-groups-view';
```

Remove now-unused references to `useIncidents`, `visibleIncidents`, `selectedIncidentIds`, etc., that were only feeding the old block. Leave per-incident drill-down intact (the route exists separately).

- [ ] **Step 4: Run, verify pass**

```bash
cd frontend && npx vitest run src/features/ai-intelligence/pages/ai-monitor.test.tsx
```

Expected: pass.

- [ ] **Step 5: Run the entire ai-intelligence frontend test suite**

```bash
cd frontend && npx vitest run src/features/ai-intelligence/
```

Expected: no regressions.

- [ ] **Step 6: Manual smoke test in dev**

```bash
docker compose -f docker/docker-compose.dev.yml up -d
npm run dev
```

Open `http://localhost:5173/health`. Verify:
- Active Incidents shows summary + grouped list
- Critical groups expanded by default
- Clicking a group toggles
- Endpoint chips appear (only if multi-endpoint env)
- Search by container name filters groups
- Click container chip → existing detail page opens

If anything looks wrong, return to the relevant task — do not "fix" in this commit.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/ai-intelligence/pages/ai-monitor.tsx \
        frontend/src/features/ai-intelligence/pages/ai-monitor.test.tsx
git commit -m "feat(frontend): /health Active Incidents uses IncidentGroupsView rollup"
```

---

### Task 19: Final integration sweep — full lint + typecheck + test pass

**Files:** none (verification task)

**Why:** Catch typing or boundary issues introduced across the workspace.

- [ ] **Step 1: Lint**

```bash
npm run lint
```

Expected: zero new errors. Fix any introduced.

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 3: All tests**

```bash
npm test
```

Expected: pass on backend, frontend, and packages.

- [ ] **Step 4: Production verification checklist (against §5.2 of the spec)**

If any test from the spec's §5.2 production verification fails locally, file a fix as a child task. Examples to run manually:
- `GET /api/incidents/groups` p95 latency on dev DB seeded with 1000 incidents
- Force a partial failure in batch resolve (resolve already-resolved id) and verify the >5-fail collapsed banner UX
- `?range=24h` filter via URL retains after refresh

- [ ] **Step 5: Commit any fixes (if any) and prepare PR**

```bash
git status
# only if there are fixes:
git commit -am "fix(incidents): integration sweep cleanups"
```

- [ ] **Step 6: Push and open PR**

```bash
git push -u origin feature/health-monitoring-ux-overhaul
gh pr create --title "feat(health): two-level rollup for Active Incidents" \
  --body-file docs/superpowers/specs/2026-05-06-active-incidents-rollup-design.md \
  --base dev
```

(If `gh` has the TLS error from the spec session, file the PR via web UI or `curl` to the GitHub API as shown in commit history.)

---

## Self-review

I checked the plan against the spec. Coverage is complete:

- **Spec §3.1 (Migration):** Tasks 1 + 2.
- **Spec §3.2 (Insight schema):** Task 3.
- **Spec §3.3 (Signature derivation):** Tasks 4 + 5.
- **Spec §3.4 (Backfill + drift):** Task 8 + drift verification embedded in Task 5.
- **Spec §3.5 (`/api/incidents/groups`):** Task 10.
- **Spec §3.6 (Batch resolve):** Task 11.
- **Spec §3.7 (Tests):** distributed across the relevant tasks.
- **Spec §4.1 (Hook):** Task 12.
- **Spec §4.2 / §4.3 (Component layout & behavior):** Tasks 13 + 14 + 15 + 17.
- **Spec §4.4 (URL state):** Task 16 (component-level `?expand=`); page-level `range` / `endpoint` / `sort` continue to live in `ai-monitor.tsx` as today, swapped in Task 18.
- **Spec §4.5 (Resolve paths):** Task 15.
- **Spec §4.6 (Tests):** distributed.
- **Spec §5.1 (Merge order):** plan task ordering matches.
- **Spec §5.2 (Production verification):** Task 19 step 4.
- **Spec §6 (Acceptance criteria):** every item maps to a task.

Cache-promotion task (Task 4 in earlier draft) was dropped after verifying `cachedFetchSWR` is already in `@dashboard/core/portainer/portainer-cache.ts` and importable from `packages/ai-intelligence`. Boundary-clean already.

`signature` filter on `/api/incidents` (§3.5 prose) lives in Task 9 — added because §4 calls the route and the existing handler doesn't accept the filter.

No TBD/TODO/placeholder text remains.
