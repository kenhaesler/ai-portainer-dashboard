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

async function cli(): Promise<void> {
  const force = process.argv.includes('--force');
  const result = await backfillSignatures({ batchSize: 500, force });
  console.log(`Updated ${result.updated} rows`);
  for (const [sig, n] of Object.entries(result.bySignature).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${sig.padEnd(40)} ${n}`);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  cli().catch((err) => { console.error(err); process.exit(1); });
}
