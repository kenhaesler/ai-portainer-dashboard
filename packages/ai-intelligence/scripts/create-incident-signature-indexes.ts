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
