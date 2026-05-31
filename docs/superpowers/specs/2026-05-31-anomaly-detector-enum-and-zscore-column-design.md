# Design: anomaly-detector enum SSOT (#1314) + typed z-score column (#1308)

**Date:** 2026-05-31
**Issues:** #1314 (enum single source of truth), #1308 (persist anomaly z-score)
**Status:** approved — ready for implementation plan

Two structural follow-up refactors from prior anomaly-detection PR reviews. Both
remove fragile coupling; neither changes user-visible behavior. They are shipped
as **two stacked PRs** because both edit `packages/core/src/models/monitoring.ts`:

- **PR 1** — `feature/1314-anomaly-detector-enum-ssot`, branched off `dev`. Closes #1314.
- **PR 2** — `feature/1308-persist-anomaly-zscore`, branched off PR 1's branch so the
  shared `monitoring.ts` edits do not conflict. Closes #1308. Rebased onto `dev`
  after PR 1 merges.

Each PR is independently reviewable and links to its own issue (`Closes #<n>`).

---

## PR 1 — #1314: single source of truth for the anomaly-detector enum

### Problem

The set of valid detector identifiers is declared in **three** places with no
compile-time link (the issue named two; a third was found during design):

1. `ANOMALY_FEEDBACK_DETECTORS` route allowlist — `packages/ai-intelligence/src/routes/monitoring.ts:33`
   (8 values: 6 persisted + 2 in-memory `correlated-zscore`, `isolation-forest`).
2. `InsightSchema.detection_method` Zod enum — `packages/core/src/models/monitoring.ts:35` (6 persisted).
3. `InsightInsert.detection_method` TS union — `packages/ai-intelligence/src/services/insights-store.ts:22`
   (6 persisted, hand-copied from the schema).

Silent drift risk: a new detector added to one list but not the others causes the
rate query's `COALESCE(detection_method, 'unknown')` to collapse real detections
into `'unknown'`, or a Zod 400 on feedback submission. Nothing fails at build time.

### Change

Add canonical constants to `packages/core/src/models/monitoring.ts`:

```ts
export const PERSISTED_ANOMALY_DETECTORS = [
  'threshold', 'ml-anomaly', 'prediction',
  'health-check', 'log-pattern', 'security-scan',
] as const;

// Correlated / in-memory detectors that never reach insights.detection_method
// but DO land on anomaly_feedback.detector.
export const IN_MEMORY_ANOMALY_DETECTORS = [
  'correlated-zscore', 'isolation-forest',
] as const;

export const ANOMALY_DETECTORS = [
  ...PERSISTED_ANOMALY_DETECTORS,
  ...IN_MEMORY_ANOMALY_DETECTORS,
] as const;

export type PersistedAnomalyDetector = (typeof PERSISTED_ANOMALY_DETECTORS)[number];
export type AnomalyDetector = (typeof ANOMALY_DETECTORS)[number];
```

Then rewire the three consumers:

- `InsightSchema.detection_method` → `z.enum(PERSISTED_ANOMALY_DETECTORS).optional()`.
- `InsightInsert.detection_method` (`insights-store.ts`) → `PersistedAnomalyDetector` (deletes the third copy).
- Route `detector` field → `z.enum(ANOMALY_DETECTORS).optional()`; delete the local
  `ANOMALY_FEEDBACK_DETECTORS` literal. Re-export the shared constant under that name
  if any test imports it, to avoid churn (`export { ANOMALY_DETECTORS as ANOMALY_FEEDBACK_DETECTORS }`),
  or update the import site — decided during implementation based on what imports it.

After this, adding a detector is one edit in `monitoring.ts`.

### Tests

- New `packages/core/src/models/monitoring.test.ts`: assert every value in
  `PERSISTED_ANOMALY_DETECTORS` is in `ANOMALY_DETECTORS`; assert `ANOMALY_DETECTORS`
  equals the union of persisted + in-memory with no duplicates and no extras.
- Existing anomaly-feedback-route detector-validation tests
  (`packages/ai-intelligence/src/__tests__/anomaly-feedback-route.test.ts`) must
  pass unchanged — they pin the accepted/rejected detector behavior.

### Scope

Pure structural refactor. No migration, no behavior change, no UX change.

---

## PR 2 — #1308: persist anomaly z-score as a typed column

### Problem

The Sensitivity preset post-filter recovers the z-score by regex-scraping the
insight's free-text `description` (`extractZScore` in
`packages/ai-intelligence/src/services/sensitivity-preset.ts`, regex
`/z-score:\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/`). If any detector ever changes
its wording, every record parses as `null` and the filter silently degrades to
"pass everything through" — no error, no metrics blip. The detector format is
documented nowhere except the regex and its tests.

### Storage decision

A **dedicated `z_score NUMERIC NULL` column** on `insights` (not the existing
`dimensions` JSONB). Rationale: `dimensions` (added in #1306) is populated **only**
for correlated multi-signal anomalies; single-dimension records — the common case
the filter operates on — have `dimensions === undefined`. Covering them via JSONB
would require always populating `dimensions` across every detector, a much larger
change. A scalar column is cheap, indexable, and matches the single-scalar use.

### Behavior-preservation constraint (critical)

The current filter acts **only** on records whose description contains `z-score:`:

- Statistical ml-anomaly (`monitoring-service.ts`) — has `z-score: X.YZ` → filtered.
- Trace latency anomaly (`trace-anomaly.ts`) — has `z-score: X.YZ` → filtered.
- Isolation-forest — description says `Isolation Forest anomaly score: X`, **no**
  `z-score:` substring → `extractZScore` returns `null` → passes through today.
- Threshold / prediction / health-check / etc. — no `z-score:` → pass through.

To preserve this exactly, `z_score` is written **only** by the emitters that
currently embed `z-score:`, with the identical value, and left `NULL` everywhere
else (isolation-forest, threshold, prediction). The migration backfill parses the
same `z-score:` substring, so historical rows stay consistent. Net effect: the
typed read returns precisely what `extractZScore` would have returned.

During implementation, verify whether the **correlated-anomaly** insight
(`trace-anomaly.ts`, "Correlated anomaly on service …") embeds a `z-score:`
substring; if it does, populate `z_score` with the same first-match value the
regex would have grabbed (the dimensions array already carries per-signal zScores).

### Migration — `038_add_insight_z_score.sql`

```sql
ALTER TABLE insights ADD COLUMN IF NOT EXISTS z_score NUMERIC;

-- Idempotent backfill: re-parse the load-bearing "z-score: X" substring from the
-- existing description so historical rows match the typed read. Guarded by
-- z_score IS NULL so re-runs are no-ops. Mirrors the JS regex (negative, decimal).
UPDATE insights
SET z_score = (substring(description from 'z-score:\s*(-?\d+(?:\.\d+)?)'))::numeric
WHERE z_score IS NULL
  AND description ~ 'z-score:\s*-?\d';
```

Reversible via `ALTER TABLE insights DROP COLUMN z_score`.

### Writes

- Add `z_score?: number | null` to `InsightInsert` (`insights-store.ts`) and include
  it in both INSERT statements (`insertInsight`, `insertInsights`). Does not affect
  the dedup key (which is `container_id, category, metric_type, detection_method`).
- Set `z_score` in `monitoring-service.ts` (statistical path, `= anomaly.z_score`)
  and `trace-anomaly.ts` (latency path, `= zScore`), matching the value already
  formatted into the description.

### Read

- Add `z_score` to `InsightSchema` (`models/monitoring.ts`). pg returns `NUMERIC`
  as a string, so the read path coerces to a number (`Number(...)`); `null` stays
  `null`.
- Rewrite `shouldIncludeAnomaly` (`sensitivity-preset.ts`) to read the typed
  `insight.z_score` instead of parsing the description. `null` → pass through
  (unchanged semantics); otherwise `|z| >= effectiveThreshold`.
- **Delete `extractZScore`** and the `description`-format coupling. Migrate the
  load-bearing regression tests in
  `packages/ai-intelligence/src/__tests__/sensitivity-preset.test.ts` to assert
  against the typed column value instead of the description-format contract.

### Tests

- Migration test: insert a row with a `z-score: 3.50` description and `NULL`
  `z_score`, run the backfill, assert `z_score = 3.50`; assert idempotency (second
  run is a no-op); assert a description with no z-score stays `NULL`.
- Emitter tests: statistical and trace-latency emitters write the correct `z_score`.
- Filter tests: `shouldIncludeAnomaly` honors the typed column across low/default/
  high presets; `null` passes through; the migrated PR #1304 regression tests pass.

### Acceptance criteria (from the issue)

- A detector changing its description format does NOT break the Sensitivity filter.
- `extractZScore` is gone.
- Existing PR #1304 regression tests pass against the new typed path.
- New tests cover both emitters writing the column + the migration backfill.
- Migration is idempotent (`IF NOT EXISTS` + `WHERE z_score IS NULL`) and rollback
  is documented.

---

## Verification (both PRs)

Before opening each PR, from repo root:

```bash
npm run lint
npm run typecheck
npm run test -w backend        # + the touched packages
```

Backend/package tests use real PostgreSQL on `localhost:5433`. Doc updates per repo
convention: `docs/architecture.md` and `CLAUDE.md`/`docker/.env.example` only if a
contract changes (neither refactor adds an env var; #1308 adds a column documented
in the migration). Never use `--no-verify`.

## Out of scope

- No new env vars, no UX change, no detector logic change.
- No broader insights-schema normalization beyond the single `z_score` column.
- Isolation-forest / threshold / prediction z-score persistence (they have no
  `z-score:` today and must keep passing through the filter).
