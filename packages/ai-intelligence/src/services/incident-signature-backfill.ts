/**
 * Populates the `signature` column on incidents that don't yet have one.
 *
 * Idempotent: only updates rows where signature IS NULL by default.
 * Use --force to re-derive every row.
 *
 * The CLI entry point lives at `scripts/backfill-incident-signatures.ts` (run via
 * `npm run -w @dashboard/ai backfill:signatures`); the logic itself lives here,
 * under `src/`, so it is covered by the package's own `tsconfig.json` (and thus
 * `npm run typecheck`) and can be unit-tested like every other service (#1586 —
 * a `scripts/` import previously tripped `tsc`'s `rootDir` check, which is why
 * this file — and its test, `src/__tests__/incidents-backfill.test.ts` — were
 * invisible to `npm run typecheck` in the first place).
 */
import { getDbForDomain } from '@dashboard/core/db/app-db-router.js';
import { deriveSignature, deriveSignatureFromTitle } from './signature.js';

export interface BackfillOptions { batchSize: number; force: boolean; }
export interface BackfillResult { updated: number; bySignature: Record<string, number>; }

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

export async function backfillSignatures(
  opts: BackfillOptions = { batchSize: 500, force: false },
): Promise<BackfillResult> {
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
          // Root insight row is gone — fall back to title regex
          signature = deriveSignatureFromTitle(inc.title);
        }
      } else {
        // No root insight reference at all — fall back to title regex
        signature = deriveSignatureFromTitle(inc.title);
      }

      if (opts.force) {
        await db.execute(
          'UPDATE incidents SET signature = ? WHERE id = ?',
          [signature, inc.id],
        );
      } else {
        await db.execute(
          'UPDATE incidents SET signature = ? WHERE id = ? AND signature IS NULL',
          [signature, inc.id],
        );
      }

      bySignature[signature] = (bySignature[signature] ?? 0) + 1;
      updated++;
    }

    if (incidents.length < opts.batchSize) break;
  }

  return { updated, bySignature };
}
