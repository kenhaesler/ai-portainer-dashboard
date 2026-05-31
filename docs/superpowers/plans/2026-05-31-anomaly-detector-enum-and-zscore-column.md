# Anomaly-detector enum SSOT (#1314) + typed z-score column (#1308) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two structural refactors of the anomaly pipeline — collapse the triplicated detector-identifier list into one canonical constant (#1314), and replace the fragile description-regex z-score recovery with a typed `z_score` column read by the Sensitivity filter (#1308).

**Architecture:** Two stacked PRs. PR 1 (`feature/1314-anomaly-detector-enum-ssot`, already branched off `dev`) adds canonical detector constants to `packages/core/src/models/monitoring.ts` and rewires the three consumers. PR 2 (`feature/1308-persist-anomaly-zscore`, branched off PR 1) adds migration 038, persists `z_score` from the emitters that already embed it in their description, and switches `shouldIncludeAnomaly` to a typed read — preserving today's filter behaviour byte-for-byte (records that never carried a `z-score:` substring keep passing through as NULL).

**Tech Stack:** TypeScript (strict), Fastify 5, Zod v4, PostgreSQL (real DB in tests, port 5433), Vitest.

**Conventions for the executor:**
- TDD: failing test first, minimal impl, green, commit. Frequent small commits.
- Never use `--no-verify`. Backend/package DB tests need PostgreSQL on `localhost:5433` (`docker compose -f docker/docker-compose.yml up -d postgres` or the project's standard test DB).
- Run a single package's tests with `cd packages/<pkg> && npx vitest run src/path/file.test.ts`.
- **Do NOT push or open PRs.** Commit locally only; the user pushes and opens PRs (see Execution Handoff).
- Commit message footer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

# PR 1 — #1314: single source of truth for the detector enum

The detector list is currently declared in **three** places:
1. `ANOMALY_FEEDBACK_DETECTORS` route allowlist — `packages/ai-intelligence/src/routes/monitoring.ts:33` (8 values)
2. `InsightSchema.detection_method` Zod enum — `packages/core/src/models/monitoring.ts:35` (6 values)
3. `InsightInsert.detection_method` TS union — `packages/ai-intelligence/src/services/insights-store.ts:22` (6 values)

## File structure (PR 1)

- Modify: `packages/core/src/models/monitoring.ts` — add canonical constants + types; rewire `InsightSchema.detection_method`.
- Create: `packages/core/src/models/monitoring.test.ts` — constant invariants + schema acceptance.
- Modify: `packages/ai-intelligence/src/services/insights-store.ts` — `InsightInsert.detection_method` uses the shared type.
- Modify: `packages/ai-intelligence/src/routes/monitoring.ts` — `detector` field uses `ANOMALY_DETECTORS`; delete the local literal.
- Modify: `CLAUDE.md` — update the prose reference to the allowlist.

---

### Task 1: Canonical detector constants in core model

**Files:**
- Modify: `packages/core/src/models/monitoring.ts`
- Test: `packages/core/src/models/monitoring.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/models/monitoring.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  PERSISTED_ANOMALY_DETECTORS,
  IN_MEMORY_ANOMALY_DETECTORS,
  ANOMALY_DETECTORS,
  InsightSchema,
} from './monitoring.js';

describe('anomaly detector constants (#1314)', () => {
  it('ANOMALY_DETECTORS is exactly the union of persisted + in-memory, in order', () => {
    expect(ANOMALY_DETECTORS).toEqual([
      ...PERSISTED_ANOMALY_DETECTORS,
      ...IN_MEMORY_ANOMALY_DETECTORS,
    ]);
  });

  it('every persisted detector is a member of ANOMALY_DETECTORS', () => {
    for (const d of PERSISTED_ANOMALY_DETECTORS) {
      expect(ANOMALY_DETECTORS).toContain(d);
    }
  });

  it('has no duplicate identifiers across the two groups', () => {
    expect(new Set(ANOMALY_DETECTORS).size).toBe(ANOMALY_DETECTORS.length);
  });

  it('exposes the persisted set the insert path historically hard-coded', () => {
    expect([...PERSISTED_ANOMALY_DETECTORS]).toEqual([
      'threshold', 'ml-anomaly', 'prediction', 'health-check', 'log-pattern', 'security-scan',
    ]);
  });

  it('exposes the in-memory correlated detectors', () => {
    expect([...IN_MEMORY_ANOMALY_DETECTORS]).toEqual(['correlated-zscore', 'isolation-forest']);
  });

  it('InsightSchema.detection_method accepts persisted detectors and rejects in-memory ones', () => {
    for (const d of PERSISTED_ANOMALY_DETECTORS) {
      expect(InsightSchema.shape.detection_method.safeParse(d).success).toBe(true);
    }
    expect(InsightSchema.shape.detection_method.safeParse('correlated-zscore').success).toBe(false);
    expect(InsightSchema.shape.detection_method.safeParse('isolation-forest').success).toBe(false);
    expect(InsightSchema.shape.detection_method.safeParse(undefined).success).toBe(true); // optional
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run src/models/monitoring.test.ts`
Expected: FAIL — `PERSISTED_ANOMALY_DETECTORS` (etc.) is `undefined` / not exported.

- [ ] **Step 3: Add the constants and rewire the schema**

In `packages/core/src/models/monitoring.ts`, insert the following **immediately before** `export const InsightSchema = z.object({` (currently line 21):

```ts
/**
 * Canonical anomaly-detector identifiers — single source of truth (#1314).
 *
 * `PERSISTED_ANOMALY_DETECTORS` are the only values that can land in
 * `insights.detection_method`. `IN_MEMORY_ANOMALY_DETECTORS` are correlated /
 * in-memory detectors that never reach the `insights` table but DO appear on
 * `anomaly_feedback.detector`. The anomaly-feedback route allowlist accepts the
 * union (`ANOMALY_DETECTORS`); the persisted-record schema accepts only the
 * persisted subset. Adding a detector source is now a single edit here.
 */
export const PERSISTED_ANOMALY_DETECTORS = [
  'threshold',
  'ml-anomaly',
  'prediction',
  'health-check',
  'log-pattern',
  'security-scan',
] as const;

export const IN_MEMORY_ANOMALY_DETECTORS = [
  'correlated-zscore',
  'isolation-forest',
] as const;

export const ANOMALY_DETECTORS = [
  ...PERSISTED_ANOMALY_DETECTORS,
  ...IN_MEMORY_ANOMALY_DETECTORS,
] as const;

export type PersistedAnomalyDetector = (typeof PERSISTED_ANOMALY_DETECTORS)[number];
export type AnomalyDetector = (typeof ANOMALY_DETECTORS)[number];
```

Then replace the inline enum on `detection_method` (currently lines 35-37):

```ts
  detection_method: z
    .enum(['threshold', 'ml-anomaly', 'prediction', 'health-check', 'log-pattern', 'security-scan'])
    .optional(),
```

with:

```ts
  detection_method: z.enum(PERSISTED_ANOMALY_DETECTORS).optional(),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run src/models/monitoring.test.ts`
Expected: PASS (all assertions green).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/models/monitoring.ts packages/core/src/models/monitoring.test.ts
git commit -m "refactor(anomaly): canonical detector constants in core model (#1314)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Point InsightInsert at the shared type

**Files:**
- Modify: `packages/ai-intelligence/src/services/insights-store.ts:3,22`

- [ ] **Step 1: Update the import**

In `packages/ai-intelligence/src/services/insights-store.ts`, change line 3 from:

```ts
import type { Insight, AnomalyDimension } from '@dashboard/core/models/monitoring.js';
```

to:

```ts
import type { Insight, AnomalyDimension, PersistedAnomalyDetector } from '@dashboard/core/models/monitoring.js';
```

- [ ] **Step 2: Replace the hand-copied union**

Change line 22 from:

```ts
  detection_method?: 'threshold' | 'ml-anomaly' | 'prediction' | 'health-check' | 'log-pattern' | 'security-scan';
```

to:

```ts
  detection_method?: PersistedAnomalyDetector;
```

- [ ] **Step 3: Verify with typecheck**

Run: `npm run typecheck -w packages/ai-intelligence`
Expected: PASS. (All existing `detection_method: 'ml-anomaly'` etc. literals in `monitoring-service.ts` / `trace-anomaly.ts` are members of the shared type, so no errors.)

- [ ] **Step 4: Run the package's insights tests**

Run: `cd packages/ai-intelligence && npx vitest run src/__tests__/insights-store.test.ts`
Expected: PASS (no behaviour change).

- [ ] **Step 5: Commit**

```bash
git add packages/ai-intelligence/src/services/insights-store.ts
git commit -m "refactor(anomaly): InsightInsert.detection_method uses shared type (#1314)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Route allowlist uses the shared constant

**Files:**
- Modify: `packages/ai-intelligence/src/routes/monitoring.ts:24-52`
- Test (regression, unchanged): `packages/ai-intelligence/src/__tests__/anomaly-feedback-route.test.ts`

Note: no source file imports `ANOMALY_FEEDBACK_DETECTORS` (only a code comment in the route test references the name). Safe to delete the local literal.

- [ ] **Step 1: Confirm nothing imports the literal (guard against surprise)**

Run: `grep -rn "ANOMALY_FEEDBACK_DETECTORS" packages --include=*.ts | grep -v dist`
Expected: only `routes/monitoring.ts` definition/comments and a comment line in `anomaly-feedback-route.test.ts` — no `import` statements.

- [ ] **Step 2: Add the shared import**

In `packages/ai-intelligence/src/routes/monitoring.ts`, add to the existing import block (after the `InsightsQuerySchema` import on line 7):

```ts
import { ANOMALY_DETECTORS } from '@dashboard/core/models/monitoring.js';
```

- [ ] **Step 3: Delete the local literal and rewire the field**

Delete the comment + literal currently at lines 24-42 (the block from `// Allowlist of detector identifiers…` through the closing `] as const;` of `ANOMALY_FEEDBACK_DETECTORS`). Replace the `detector` field (line 52) and its preceding comment so the schema reads:

```ts
const AnomalyFeedbackBodySchema = z.object({
  anomalyId: z.string().min(1).max(200),
  disposition: z.literal('false-positive').optional().default('false-positive'),
  // Detector source — denormalised onto the feedback row so the rate
  // calculation works for correlated anomalies (which never appear in the
  // `insights` table). Optional. Constrained to the canonical allowlist
  // ANOMALY_DETECTORS (persisted + in-memory) from
  // packages/core/src/models/monitoring.ts — single source of truth (#1314).
  detector: z.enum(ANOMALY_DETECTORS).optional(),
});
```

(Keep the `// ── Anomaly feedback Zod schemas — issue #1298 ──` header and the `disposition` comment above the object intact.)

- [ ] **Step 4: Run the regression tests (must still pass unchanged)**

Run: `cd packages/ai-intelligence && npx vitest run src/__tests__/anomaly-feedback-route.test.ts`
Expected: PASS — including "rejects an unknown detector value" (400) and "accepts a known detector value from the allowlist". The accepted/rejected behaviour is identical because `ANOMALY_DETECTORS` has the same 8 members as the deleted literal.

- [ ] **Step 5: Typecheck the package**

Run: `npm run typecheck -w packages/ai-intelligence`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ai-intelligence/src/routes/monitoring.ts
git commit -m "refactor(anomaly): feedback route allowlist uses shared ANOMALY_DETECTORS (#1314)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Docs + full verification (PR 1)

**Files:**
- Modify: `CLAUDE.md` (anomaly-feedback prose)

- [ ] **Step 1: Update the CLAUDE.md allowlist reference**

In `CLAUDE.md`, find the sentence in the "Anomaly feedback (issue #1298)" paragraph:

> The `detector` field on POST is restricted to a Zod allowlist (`ANOMALY_FEEDBACK_DETECTORS`) so client input cannot pollute the per-detector rate breakdown.

Replace it with:

> The `detector` field on POST is restricted to a Zod allowlist — the canonical `ANOMALY_DETECTORS` constant in `packages/core/src/models/monitoring.ts` (persisted detectors + in-memory correlated detectors; single source of truth, #1314) — so client input cannot pollute the per-detector rate breakdown.

- [ ] **Step 2: Full verification across both touched packages**

Run:
```bash
npm run lint
npm run typecheck
cd packages/core && npx vitest run src/models/monitoring.test.ts && cd ../..
cd packages/ai-intelligence && npx vitest run src/__tests__/anomaly-feedback-route.test.ts src/__tests__/insights-store.test.ts && cd ../..
```
Expected: lint clean, typecheck clean, all listed tests PASS.

- [ ] **Step 3: Commit the docs**

```bash
git add CLAUDE.md
git commit -m "docs(anomaly): note detector allowlist now derives from shared constant (#1314)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: STOP — hand PR 1 to the user**

Do not push or open the PR. Report: branch `feature/1314-anomaly-detector-enum-ssot` is ready, N commits, verification green. Ask the user to push / open the PR (`Closes #1314`). Proceed to PR 2 only after confirming (PR 2 branches off this branch regardless of whether it has merged yet).

---

# PR 2 — #1308: persist anomaly z-score as a typed column

**Branch setup (run once, after PR 1's commits exist locally):**

```bash
git checkout -b feature/1308-persist-anomaly-zscore feature/1314-anomaly-detector-enum-ssot
```

**Behaviour-preservation contract (do not deviate):** the legacy filter only acted on records whose `description` contained a `z-score:` substring. Those are: the statistical metric anomaly (`monitoring-service.ts`) and the trace `latency_p95` anomaly (`trace-anomaly.ts`). Isolation-forest ("anomaly score: X"), threshold, prediction, and **error-rate-only** trace anomalies have no `z-score:` and pass through today. So `z_score` is written ONLY by those two emitters (and the correlated insight inherits the latency value, since its combined description's first `z-score:` match is the latency dimension). Everything else stays NULL → still passes through.

## File structure (PR 2)

- Create: `packages/core/src/db/postgres-migrations/038_add_insight_z_score.sql` — column + idempotent backfill.
- Create: `packages/ai-intelligence/src/__tests__/insight-zscore-backfill.test.ts` — backfill SQL behaviour (real DB).
- Modify: `packages/core/src/models/monitoring.ts` — add `z_score` to `InsightSchema`.
- Modify: `packages/ai-intelligence/src/services/insights-store.ts` — `InsightInsert.z_score` + both INSERTs.
- Modify: `packages/ai-intelligence/src/__tests__/insights-store.test.ts` — round-trip assertions.
- Modify: `packages/ai-intelligence/src/services/sensitivity-preset.ts` — typed read; delete `extractZScore`.
- Modify: `packages/ai-intelligence/src/__tests__/sensitivity-preset.test.ts` — migrate to typed column.
- Modify: `packages/ai-intelligence/src/routes/monitoring.ts` — pass `z_score` to the filter (+ add to container query SELECT).
- Modify: `packages/ai-intelligence/src/services/monitoring-service.ts` — set `z_score` on statistical insight.
- Modify: `packages/ai-intelligence/src/services/trace-anomaly.ts` — add `persistedDimensionZScore` helper; set `z_score` on single-dim + correlated inserts.
- Create: `packages/ai-intelligence/src/__tests__/trace-anomaly-zscore.test.ts` — pure helper test.
- Modify: `CLAUDE.md` (Sensitivity preset note).

---

### Task 5: Migration 038 + backfill, with a DB test

**Files:**
- Create: `packages/core/src/db/postgres-migrations/038_add_insight_z_score.sql`
- Test: `packages/ai-intelligence/src/__tests__/insight-zscore-backfill.test.ts` (create)

- [ ] **Step 1: Write the migration file**

Create `packages/core/src/db/postgres-migrations/038_add_insight_z_score.sql`:

```sql
-- Migration 038: add typed `z_score` column to insights (#1308)
--
-- The per-user Sensitivity preset filter (#1297) previously recovered each
-- anomaly's z-score by regex-scraping the free-text `description` column
-- (`extractZScore`). That coupling silently degrades to "pass everything
-- through" if a detector ever changes its wording. This column persists the
-- z-score as structured data so the read-path filter reads a typed value.
--
-- NULL for records that never carried a z-score (isolation-forest, threshold,
-- prediction, error-rate-only trace anomalies) — the filter passes NULL
-- through unchanged, preserving today's behaviour.
--
-- Idempotent: `ADD COLUMN IF NOT EXISTS` + the backfill is guarded by
-- `z_score IS NULL`. Reversible via `ALTER TABLE insights DROP COLUMN z_score`.

ALTER TABLE insights ADD COLUMN IF NOT EXISTS z_score NUMERIC;

-- One-time backfill: re-parse the load-bearing "z-score: X" substring from the
-- existing description so historical rows match the typed read. Mirrors the JS
-- regex /z-score:\s*(-?\d+(?:\.\d+)?)/. Guarded by z_score IS NULL so re-runs
-- are no-ops; only rows whose description contains a numeric z-score are touched.
UPDATE insights
SET z_score = (substring(description from 'z-score:\s*(-?[0-9]+(?:\.[0-9]+)?)'))::numeric
WHERE z_score IS NULL
  AND description ~ 'z-score:\s*-?[0-9]';
```

- [ ] **Step 2: Write the failing backfill test**

Create `packages/ai-intelligence/src/__tests__/insight-zscore-backfill.test.ts`:

```ts
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { getTestDb, truncateTestTables, closeTestDb } from '@dashboard/core/db/test-db-helper.js';
import type { AppDb } from '@dashboard/core/db/app-db.js';

let db: AppDb;

// Mirrors the UPDATE in migration 038. The migration itself runs automatically
// when getTestDb() applies migrations; this re-runs the statement against
// seeded rows so the parsing/idempotency logic is asserted directly.
const BACKFILL_SQL = `
  UPDATE insights
  SET z_score = (substring(description from 'z-score:\\s*(-?[0-9]+(?:\\.[0-9]+)?)'))::numeric
  WHERE z_score IS NULL
    AND description ~ 'z-score:\\s*-?[0-9]'
`;

// Insert WITHOUT z_score so the column starts NULL, mimicking a pre-migration row.
async function seedRow(id: string, description: string): Promise<void> {
  await db.execute(
    `INSERT INTO insights (id, severity, category, title, description, is_acknowledged, created_at)
     VALUES (?, 'warning', 'anomaly', ?, ?, false, NOW())`,
    [id, `title-${id}`, description],
  );
}

beforeAll(async () => { db = await getTestDb(); });
afterAll(async () => { await closeTestDb(); });
beforeEach(async () => { await truncateTestTables('insights'); });

describe('migration 038 — z_score backfill (#1308)', () => {
  it('parses the z-score from a legacy description into the typed column', async () => {
    await seedRow('z1', 'Current cpu: 95.0% (mean: 40.0%, z-score: 3.50)');
    await db.execute(BACKFILL_SQL, []);
    const [row] = await db.query<{ z_score: string | null }>(
      'SELECT z_score FROM insights WHERE id = ?', ['z1']);
    expect(row.z_score).not.toBeNull();
    expect(Number(row.z_score)).toBeCloseTo(3.5, 5);
  });

  it('parses negative z-scores', async () => {
    await seedRow('z2', 'Latency drop (z-score: -2.95)');
    await db.execute(BACKFILL_SQL, []);
    const [row] = await db.query<{ z_score: string | null }>(
      'SELECT z_score FROM insights WHERE id = ?', ['z2']);
    expect(Number(row.z_score)).toBeCloseTo(-2.95, 5);
  });

  it('leaves rows without a z-score substring NULL (predictive forecasts, error-rate)', async () => {
    await seedRow('z3', 'Memory usage forecast indicates threshold breach in 6h');
    await seedRow('z3b', 'Recent error rate: 8.00% (baseline: 1.00%, threshold: 5%, baseline-source: flat).');
    await db.execute(BACKFILL_SQL, []);
    const rows = await db.query<{ id: string; z_score: string | null }>(
      'SELECT id, z_score FROM insights WHERE id IN (?, ?)', ['z3', 'z3b']);
    for (const r of rows) expect(r.z_score).toBeNull();
  });

  it('is idempotent — a second run does not change an already-populated value', async () => {
    await seedRow('z4', 'cpu (z-score: 4.00)');
    await db.execute(BACKFILL_SQL, []);
    await db.execute(BACKFILL_SQL, []);
    const [row] = await db.query<{ z_score: string | null }>(
      'SELECT z_score FROM insights WHERE id = ?', ['z4']);
    expect(Number(row.z_score)).toBeCloseTo(4, 5);
  });
});
```

- [ ] **Step 3: Run the test to verify it passes**

Ensure PostgreSQL is up on :5433, then run:
`cd packages/ai-intelligence && npx vitest run src/__tests__/insight-zscore-backfill.test.ts`
Expected: PASS. (`getTestDb()` applies migration 038 — adding the column — before the test body runs; the seeded rows then exercise the backfill statement.)

If it fails with "column z_score does not exist", the test DB cached an older migration set — that cannot happen for a brand-new migration file (the helper applies any file not in `_app_migrations`), but if so, drop/recreate the test database and re-run.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/db/postgres-migrations/038_add_insight_z_score.sql \
        packages/ai-intelligence/src/__tests__/insight-zscore-backfill.test.ts
git commit -m "feat(anomaly): add insights.z_score column + idempotent backfill (#1308)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Persist z_score through the store

**Files:**
- Modify: `packages/core/src/models/monitoring.ts` (InsightSchema)
- Modify: `packages/ai-intelligence/src/services/insights-store.ts` (InsightInsert + both INSERTs)
- Test: `packages/ai-intelligence/src/__tests__/insights-store.test.ts`

- [ ] **Step 1: Write the failing round-trip tests**

In `packages/ai-intelligence/src/__tests__/insights-store.test.ts`, add inside the top-level `describe('insights-store', () => {` block (e.g. after the existing `describe('insertInsight', ...)`):

```ts
  describe('z_score column (#1308)', () => {
    it('round-trips a typed z_score through insertInsight', async () => {
      await insertInsight(makeInsight({ id: 'z-single', z_score: 3.42 }));
      const [row] = await testDb.query<{ z_score: string | null }>(
        'SELECT z_score FROM insights WHERE id = ?', ['z-single']);
      expect(Number(row.z_score)).toBeCloseTo(3.42, 5);
    });

    it('stores NULL z_score when omitted (preserves filter pass-through)', async () => {
      await insertInsight(makeInsight({ id: 'z-null' }));
      const [row] = await testDb.query<{ z_score: string | null }>(
        'SELECT z_score FROM insights WHERE id = ?', ['z-null']);
      expect(row.z_score).toBeNull();
    });

    it('round-trips z_score through the batch insertInsights path', async () => {
      await insertInsights([makeInsight({ id: 'z-batch', container_id: 'cb', z_score: -4.1 })]);
      const [row] = await testDb.query<{ z_score: string | null }>(
        'SELECT z_score FROM insights WHERE id = ?', ['z-batch']);
      expect(Number(row.z_score)).toBeCloseTo(-4.1, 5);
    });
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/ai-intelligence && npx vitest run src/__tests__/insights-store.test.ts -t "z_score column"`
Expected: FAIL — `z_score` is not a known property of `InsightInsert` (typecheck/compile error) or the column is never written (NULL when 3.42 expected).

- [ ] **Step 3: Add z_score to the model schema**

In `packages/core/src/models/monitoring.ts`, inside `InsightSchema`, add after the `detection_method` field:

```ts
  /**
   * Typed z-score for anomaly insights (#1308). Replaces regex-scraping the
   * value out of `description`. NULL for records that never carried a z-score
   * (isolation-forest, threshold, prediction, error-rate-only trace anomalies).
   * pg returns NUMERIC as a string, so coerce on read.
   */
  z_score: z.coerce.number().nullable().optional(),
```

- [ ] **Step 4: Add z_score to InsightInsert and both INSERT statements**

In `packages/ai-intelligence/src/services/insights-store.ts`:

(a) Add to the `InsightInsert` interface (after the `dimensions?` field, ~line 29):

```ts
  /**
   * Typed z-score (#1308). Set only by detectors whose description embeds a
   * `z-score:` substring (statistical metric anomalies; trace latency_p95) so
   * the read-path Sensitivity filter no longer parses free text. `undefined`
   * / null for everything else (threshold, prediction, isolation-forest,
   * error-rate-only) — those pass the filter unchanged.
   */
  z_score?: number | null;
```

(b) In `insertInsight` (the singular path), update the column list, the VALUES list, and the params. Change the SQL column line `metric_type, detection_method, dimensions,` → `metric_type, detection_method, dimensions, z_score,` and the VALUES `..., ?, ?::jsonb, false, NOW())` → `..., ?, ?::jsonb, ?, false, NOW())`. Add the param immediately after the `insight.dimensions ? JSON.stringify(...) : null,` line:

```ts
      insight.z_score ?? null,
```

(c) In `insertInsights` (the batch path), apply the identical three edits to `insertSQL` and to the `txDb.execute(insertSQL, [...])` params array (add `insight.z_score ?? null,` after the dimensions param).

The resulting INSERT (both paths) reads:

```sql
INSERT INTO insights (
  id, endpoint_id, endpoint_name, container_id, container_name,
  severity, category, title, description, suggested_action,
  metric_type, detection_method, dimensions, z_score,
  is_acknowledged, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, false, NOW())
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd packages/ai-intelligence && npx vitest run src/__tests__/insights-store.test.ts`
Expected: PASS (the new z_score tests + all pre-existing tests, including the dimensions round-trip).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/models/monitoring.ts \
        packages/ai-intelligence/src/services/insights-store.ts \
        packages/ai-intelligence/src/__tests__/insights-store.test.ts
git commit -m "feat(anomaly): persist z_score on insert + InsightSchema field (#1308)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Switch the Sensitivity filter to the typed column

**Files:**
- Modify: `packages/ai-intelligence/src/services/sensitivity-preset.ts`
- Test: `packages/ai-intelligence/src/__tests__/sensitivity-preset.test.ts`

- [ ] **Step 1: Rewrite the filter tests to use the typed column**

In `packages/ai-intelligence/src/__tests__/sensitivity-preset.test.ts`:

(a) Change the import (remove `extractZScore`):

```ts
import {
  effectiveThresholds,
  shouldIncludeAnomaly,
  SensitivityPresetSchema,
} from '../services/sensitivity-preset.js';
```

(b) Delete the entire `describe('extractZScore', () => { ... })` block (lines ~59-93).

(c) Replace the `describe('shouldIncludeAnomaly — description format regression …')` block AND the `describe('shouldIncludeAnomaly', …)` block (everything from line ~95 through line ~186) with:

```ts
describe('shouldIncludeAnomaly (typed z_score column — #1308)', () => {
  it('passes through insights without a z-score (null/undefined) under every preset', () => {
    const rows = [
      { z_score: null, category: 'predictive' as const },
      { category: 'predictive' as const }, // z_score undefined
    ];
    for (const row of rows) {
      expect(shouldIncludeAnomaly(row, 'low', DEFAULTS)).toBe(true);
      expect(shouldIncludeAnomaly(row, 'default', DEFAULTS)).toBe(true);
      expect(shouldIncludeAnomaly(row, 'high', DEFAULTS)).toBe(true);
    }
  });

  it('coerces pg NUMERIC-as-string before comparing', () => {
    expect(shouldIncludeAnomaly({ z_score: '3.60' }, 'default', DEFAULTS)).toBe(true);
    expect(shouldIncludeAnomaly({ z_score: '3.40' }, 'default', DEFAULTS)).toBe(false);
  });

  it('keeps a record when |z| >= effective threshold', () => {
    expect(shouldIncludeAnomaly({ z_score: 3.6 }, 'default', DEFAULTS)).toBe(true);
  });

  it('drops a record when |z| < effective threshold', () => {
    expect(shouldIncludeAnomaly({ z_score: 3.4 }, 'default', DEFAULTS)).toBe(false);
  });

  it('Low preset (stricter) drops records Default would have kept', () => {
    expect(shouldIncludeAnomaly({ z_score: 4.0 }, 'default', DEFAULTS)).toBe(true);
    expect(shouldIncludeAnomaly({ z_score: 4.0 }, 'low', DEFAULTS)).toBe(false);
  });

  it('High preset (looser) keeps records Default would have dropped', () => {
    expect(shouldIncludeAnomaly({ z_score: 3.0 }, 'default', DEFAULTS)).toBe(false);
    expect(shouldIncludeAnomaly({ z_score: 3.0 }, 'high', DEFAULTS)).toBe(true);
  });

  it('treats |z| symmetrically (negative z-scores below mean also count)', () => {
    expect(shouldIncludeAnomaly({ z_score: -4.0 }, 'default', DEFAULTS)).toBe(true);
  });

  it('passes through a non-finite z-score (NaN / unparseable string) like a non-anomaly row', () => {
    expect(shouldIncludeAnomaly({ z_score: Number.NaN }, 'default', DEFAULTS)).toBe(true);
    expect(shouldIncludeAnomaly({ z_score: 'abc' }, 'default', DEFAULTS)).toBe(true);
  });

  it('issue #1297 AC — three presets produce different visible counts on the same set', () => {
    const items = [2.5, 3.0, 3.6, 4.6, 5.0].map((z) => ({ z_score: z }));
    const counts = (preset: 'low' | 'default' | 'high') =>
      items.filter((i) => shouldIncludeAnomaly(i, preset, DEFAULTS)).length;
    const low = counts('low');
    const def = counts('default');
    const high = counts('high');
    expect(low).toBeLessThan(def);
    expect(def).toBeLessThan(high);
    expect(new Set([low, def, high]).size).toBe(3);
  });
});
```

Leave the `describe('effectiveThresholds', …)` and `describe('SensitivityPresetSchema', …)` blocks unchanged.

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/ai-intelligence && npx vitest run src/__tests__/sensitivity-preset.test.ts`
Expected: FAIL — `extractZScore` import is gone (compile error) and `shouldIncludeAnomaly` still reads `description`, so the `{ z_score: … }` cases don't filter.

- [ ] **Step 3: Rewrite the filter, delete extractZScore**

In `packages/ai-intelligence/src/services/sensitivity-preset.ts`:

(a) Delete the entire `extractZScore` function and its preceding doc comment (lines ~85-105).

(b) Replace `shouldIncludeAnomaly` (lines ~107-127) with:

```ts
/**
 * Returns true if the insight should be VISIBLE under the user's preset.
 *
 * Reads the typed `z_score` column (#1308). Records without a z-score
 * (`null` / `undefined` — predictive forecasts, isolation-forest, threshold,
 * error-rate-only trace anomalies) always pass through; the preset only filters
 * z-score-based anomalies. pg returns NUMERIC as a string, so the value is
 * coerced before comparison; non-finite values pass through (conservative).
 *
 * This is Option A from issue #1297 (post-filter on read): the detectors write
 * everything, the per-user view filters.
 */
export function shouldIncludeAnomaly(
  insight: { z_score?: number | string | null; category?: string | null },
  preset: SensitivityPreset,
  defaults: { zScore: number; contamination: number },
): boolean {
  if (insight.z_score === null || insight.z_score === undefined) return true;
  const z = typeof insight.z_score === 'number' ? insight.z_score : Number(insight.z_score);
  if (!Number.isFinite(z)) return true;
  const { zScore: threshold } = effectiveThresholds(preset, defaults);
  return Math.abs(z) >= threshold;
}
```

(c) Update the file-header doc comment (lines ~17-19) that describes "The post-filter looks at the z-score embedded in the insight's description …". Replace that sentence with:

```ts
 * The post-filter reads the typed `z_score` column persisted by the detectors
 * (#1308). Records whose |z-score| is BELOW the effective threshold are dropped
 * before they leave the API; records without a z-score pass through.
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/ai-intelligence && npx vitest run src/__tests__/sensitivity-preset.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ai-intelligence/src/services/sensitivity-preset.ts \
        packages/ai-intelligence/src/__tests__/sensitivity-preset.test.ts
git commit -m "refactor(anomaly): Sensitivity filter reads typed z_score, drop regex (#1308)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Feed z_score to the filter at both route call sites

**Files:**
- Modify: `packages/ai-intelligence/src/routes/monitoring.ts` (~lines 173-179 and 256-280)

The two call sites currently pass `{ description, category }`. `shouldIncludeAnomaly` no longer reads `description`, so they must pass `z_score`. The list query is `SELECT *` (z_score present); the container query selects explicit columns and must add `z_score`.

- [ ] **Step 1: Update the `/api/monitoring/insights` list filter**

Replace the `filteredItems` filter (currently lines ~173-179) with:

```ts
      const filteredItems = items.filter((i) =>
        shouldIncludeAnomaly(
          {
            z_score: (i as Record<string, unknown>).z_score as number | string | null,
            category: i.category as string | null | undefined,
          },
          preset,
          defaults,
        ),
      );
```

- [ ] **Step 2: Add z_score to the container-explanations query + row type**

In the `/api/monitoring/insights/container/:containerId` handler, update the `db.query` row type (currently lines ~256-264) to include `z_score`, and add `z_score` to the SELECT list (line ~265). Result:

```ts
      const rows = await db.query<{
        id: string;
        severity: string;
        category: string;
        title: string;
        description: string;
        suggested_action: string | null;
        created_at: string;
        z_score: number | string | null;
      }>(`
        SELECT id, severity, category, title, description, suggested_action, created_at, z_score
        FROM insights
        WHERE ${where}
        ORDER BY created_at DESC
        LIMIT 50
      `, [...params]);
```

Then update its filter (currently line ~278-280):

```ts
      const visibleRows = rows.filter((row) =>
        shouldIncludeAnomaly({ z_score: row.z_score, category: row.category }, preset, defaults),
      );
```

- [ ] **Step 3: Typecheck + run the route/integration tests**

Run:
```bash
npm run typecheck -w packages/ai-intelligence
cd packages/ai-intelligence && npx vitest run src/__tests__/sensitivity-route.integration.test.ts src/__tests__/monitoring-route.test.ts && cd ../..
```
Expected: typecheck clean; route tests PASS. If `sensitivity-route.integration.test.ts` seeds insights via raw SQL with a `z-score:` description but no `z_score` column value, confirm it still passes — the migration backfill does not run mid-test, so such rows have NULL `z_score` and now pass through. If a test asserted that a high-z seeded row is FILTERED, update that seed to set the `z_score` column explicitly (the realistic post-#1308 shape) so the assertion holds. Make the minimal seed edit needed and note it in the commit.

- [ ] **Step 4: Commit**

```bash
git add packages/ai-intelligence/src/routes/monitoring.ts
git commit -m "refactor(anomaly): route filters insights by typed z_score column (#1308)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Emitters write z_score (statistical + trace)

**Files:**
- Modify: `packages/ai-intelligence/src/services/trace-anomaly.ts` (helper + 2 insert objects)
- Create: `packages/ai-intelligence/src/__tests__/trace-anomaly-zscore.test.ts`
- Modify: `packages/ai-intelligence/src/services/monitoring-service.ts` (statistical insight object)
- Modify: `packages/ai-intelligence/src/__tests__/monitoring-service-emission.test.ts` (schema-level assertion)

- [ ] **Step 1: Write the failing helper test**

Create `packages/ai-intelligence/src/__tests__/trace-anomaly-zscore.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { persistedDimensionZScore } from '../services/trace-anomaly.js';
import type { AnomalyDimension } from '@dashboard/core/models/monitoring.js';

const dim = (over: Partial<AnomalyDimension>): AnomalyDimension => ({
  type: 'latency_p95', value: 1, baseline: 1, zScore: 0, severity: 'warning', ...over,
});

describe('persistedDimensionZScore (#1308)', () => {
  it('returns the zScore for latency_p95 (its description embeds "z-score:")', () => {
    expect(persistedDimensionZScore(dim({ type: 'latency_p95', zScore: 4.8 }))).toBe(4.8);
  });

  it('returns null for error_rate (its description carries no z-score → legacy pass-through)', () => {
    expect(persistedDimensionZScore(dim({ type: 'error_rate', zScore: 2.3 }))).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/ai-intelligence && npx vitest run src/__tests__/trace-anomaly-zscore.test.ts`
Expected: FAIL — `persistedDimensionZScore` is not exported.

- [ ] **Step 3: Add the helper and wire both trace inserts**

In `packages/ai-intelligence/src/services/trace-anomaly.ts`:

(a) Ensure `AnomalyDimension` is imported from `@dashboard/core/models/monitoring.js` (add it to the existing import if missing).

(b) Add the exported helper near the top-level helpers (e.g. just above the detector function, alongside `normalisedSignalScore`):

```ts
/**
 * The typed z_score persisted on an insight for a given dimension (#1308).
 *
 * Only `latency_p95` formats a `z-score:` substring into its description, so
 * historically only it was visible to the Sensitivity post-filter. Other
 * dimensions (error_rate) never carried a parseable z-score and passed the
 * filter through; returning `null` for them preserves that behaviour exactly.
 */
export function persistedDimensionZScore(dim: AnomalyDimension): number | null {
  return dim.type === 'latency_p95' ? dim.zScore : null;
}
```

(c) In the single-dimension insert (`insights.push({ … })` at ~line 525), add after `detection_method: 'ml-anomaly',`:

```ts
          z_score: persistedDimensionZScore(c.dimension),
```

(d) In the correlated insert (`insights.push({ … })` at ~line 604), add after `dimensions,`:

```ts
        // The combined description joins each candidate's text; its first
        // `z-score:` match is the latency_p95 dimension (latency is pushed
        // before error_rate). Persist that value so the typed read matches
        // what the legacy regex extracted from `combinedDescription`.
        z_score: group.map((c) => persistedDimensionZScore(c.dimension)).find((z) => z !== null) ?? null,
```

- [ ] **Step 4: Run the helper test (green) + the trace-anomaly suite**

Run: `cd packages/ai-intelligence && npx vitest run src/__tests__/trace-anomaly-zscore.test.ts`
Expected: PASS.
Also run any existing trace tests to be safe: `cd packages/ai-intelligence && npx vitest run -t "trace"` — Expected: PASS.

- [ ] **Step 5: Set z_score on the statistical metric anomaly**

In `packages/ai-intelligence/src/services/monitoring-service.ts`, in the statistical-anomaly insight pushed at ~line 377-396 (the object with `detection_method: 'ml-anomaly'` whose description contains `z-score: ${anomaly.z_score.toFixed(2)}`), add after `detection_method: 'ml-anomaly',`:

```ts
          // Typed z-score (#1308) — mirrors the value already formatted into
          // `description`. Threshold / isolation-forest / prediction inserts
          // intentionally omit z_score (their descriptions carry none), so
          // they keep passing through the Sensitivity filter.
          z_score: anomaly.z_score,
```

Do NOT add `z_score` to the threshold (~line 439), isolation-forest (~line 497), or prediction (~line 538) inserts.

- [ ] **Step 6: Add the schema-level emission assertion**

In `packages/ai-intelligence/src/__tests__/monitoring-service-emission.test.ts`, add a test inside the existing `describe('Insight emission — structured fields are typeable', () => {` block:

```ts
  it('an anomaly insight carrying a typed z_score parses (#1308)', () => {
    const insight = {
      id: '2',
      endpoint_id: 1,
      endpoint_name: 'e',
      container_id: 'c',
      container_name: 'cn',
      severity: 'warning' as const,
      category: 'anomaly',
      title: 'Anomalous cpu usage on "x"',
      description: 'cpu (z-score: 3.50)',
      suggested_action: null,
      is_acknowledged: 0,
      created_at: new Date().toISOString(),
      metric_type: 'cpu' as const,
      detection_method: 'ml-anomaly' as const,
      z_score: 3.5,
    };
    expect(InsightSchema.safeParse(insight).success).toBe(true);
  });
```

(Note: like the existing test in this file, this asserts at the schema layer — it does not run the full monitoring service. The emitter wiring itself follows the file's documented convention of typecheck-level coverage.)

- [ ] **Step 7: Run both emission/schema tests + typecheck**

Run:
```bash
npm run typecheck -w packages/ai-intelligence
cd packages/ai-intelligence && npx vitest run src/__tests__/monitoring-service-emission.test.ts src/__tests__/trace-anomaly-zscore.test.ts && cd ../..
```
Expected: typecheck clean; tests PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/ai-intelligence/src/services/trace-anomaly.ts \
        packages/ai-intelligence/src/services/monitoring-service.ts \
        packages/ai-intelligence/src/__tests__/trace-anomaly-zscore.test.ts \
        packages/ai-intelligence/src/__tests__/monitoring-service-emission.test.ts
git commit -m "feat(anomaly): emitters persist typed z_score for z-score-based anomalies (#1308)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Docs + full verification (PR 2)

**Files:**
- Modify: `CLAUDE.md` (+ `docs/architecture.md` if it enumerates the insights schema)

- [ ] **Step 1: Update CLAUDE.md**

In `CLAUDE.md`, find the Environment sentence:

> Per-user preferences (e.g. the anomaly Sensitivity preset from #1297) live in the `user_settings(user_id, key, value)` table (migration 036).

Append after it (same paragraph):

> The Sensitivity post-filter reads each insight's typed `insights.z_score` column (migration 038, #1308) rather than regex-parsing the description; detectors persist `z_score` only for z-score-based anomalies (statistical metric + trace `latency_p95`), leaving it NULL elsewhere so non-z-score insights pass through.

- [ ] **Step 2: Update architecture docs if the insights schema is enumerated**

Run: `grep -rn "detection_method\|insights table\|dimensions JSONB" docs/architecture.md`
- If a matching insights-schema section exists, add `z_score NUMERIC` to it with a one-line note: "typed anomaly z-score for the Sensitivity filter (#1308)".
- If no such enumeration exists, skip (the migration file is self-documenting). Note which path you took in the commit body.

- [ ] **Step 3: Full PR 2 verification**

Ensure PostgreSQL is up on :5433, then run:
```bash
npm run lint
npm run typecheck
npm run test -w packages/core
npm run test -w packages/ai-intelligence
```
Expected: lint clean, typecheck clean, both package suites PASS (covers migration backfill, store round-trip, filter, emitter helper, routes, and all pre-existing tests).

- [ ] **Step 4: Commit the docs**

```bash
git add CLAUDE.md docs/architecture.md
git commit -m "docs(anomaly): document insights.z_score typed column (#1308)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: STOP — hand PR 2 to the user**

Do not push or open the PR. Report: branch `feature/1308-persist-anomaly-zscore` ready (stacked on `feature/1314-…`), verification green. Recommend the user open PR 1 first (`Closes #1314`, base `dev`), then PR 2 (`Closes #1308`) — base it on the #1314 branch for a clean diff, retargeting/rebasing onto `dev` after #1314 merges.

---

## Self-Review

**Spec coverage:**
- #1314 three duplicate sites → Tasks 1 (model), 2 (insights-store), 3 (route). ✔
- #1314 subset test → Task 1. ✔
- #1308 dedicated `z_score NUMERIC` column → Task 5. ✔
- #1308 idempotent migration + backfill + rollback doc → Task 5 (migration comment documents rollback). ✔
- #1308 emitters write typed value, behaviour preserved (error-rate/IF/threshold stay NULL) → Task 9 + the explicit contract. ✔
- #1308 `extractZScore` deleted, filter reads typed column → Task 7. ✔
- #1308 route call sites fed the column (incl. adding it to the container SELECT) → Task 8. ✔
- #1308 migrate PR #1304 regression tests to typed value → Task 7. ✔
- #1308 new tests for both emitters + migration backfill → Tasks 5, 6, 9. ✔
- Docs per convention → Tasks 4, 10. ✔

**Placeholder scan:** No TBD/TODO. The two conditional steps (Task 8 Step 3 seed fix, Task 10 Step 2 architecture.md) each state the exact edit and the decision rule, with concrete text — not "handle as needed".

**Type consistency:** `PersistedAnomalyDetector` / `ANOMALY_DETECTORS` (Task 1) used verbatim in Tasks 2-3. `z_score?: number | null` on `InsightInsert` (Task 6) is compatible with the emitter assignments in Task 9 (`number` and `number | null`). `shouldIncludeAnomaly` signature `{ z_score?: number | string | null; category?: string | null }` (Task 7) matches both route call sites (Task 8) and all migrated unit tests (Task 7). `persistedDimensionZScore(dim: AnomalyDimension): number | null` (Task 9) used consistently in its test and both insert objects.
