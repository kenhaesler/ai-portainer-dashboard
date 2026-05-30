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
if (!APP_URL) {
  console.error('POSTGRES_APP_URL must be set');
  process.exit(1);
}

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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
