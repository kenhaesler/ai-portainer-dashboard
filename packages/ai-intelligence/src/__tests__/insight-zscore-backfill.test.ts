import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTestDb, truncateTestTables, closeTestDb } from '@dashboard/core/db/test-db-helper.js';
import type { AppDb } from '@dashboard/core/db/app-db.js';

let db: AppDb;

const __dirname = dirname(fileURLToPath(import.meta.url));
// Single source of truth: read the actual UPDATE from migration 038 so this
// test can never drift from the shipped backfill. Reading from the .sql file
// also avoids JS string-escaping of the regex (the file uses literal `\s`).
const migrationSql = readFileSync(
  join(__dirname, '../../../core/src/db/postgres-migrations/038_add_insight_z_score.sql'),
  'utf-8',
);
const BACKFILL_SQL = migrationSql.match(/UPDATE insights[\s\S]+?;/)?.[0] ?? '';

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
  it('resolved the backfill UPDATE from migration 038', () => {
    expect(BACKFILL_SQL).toMatch(/^UPDATE insights[\s\S]+;$/);
    expect(BACKFILL_SQL).toContain('z_score');
  });

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

  it('does not overwrite a z_score that was already explicitly set', async () => {
    await seedRow('z5', 'cpu (z-score: 4.00)');
    await db.execute('UPDATE insights SET z_score = 7.77 WHERE id = ?', ['z5']);
    await db.execute(BACKFILL_SQL, []);
    const [row] = await db.query<{ z_score: string | null }>(
      'SELECT z_score FROM insights WHERE id = ?', ['z5']);
    expect(Number(row.z_score)).toBeCloseTo(7.77, 5);
  });
});
