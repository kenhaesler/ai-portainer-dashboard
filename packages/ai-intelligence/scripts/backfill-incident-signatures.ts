#!/usr/bin/env tsx
/**
 * CLI entry point. The actual logic lives in
 * `../src/services/incident-signature-backfill.ts` (see that file for why —
 * #1586) so it is typechecked and unit-tested as a normal service; this
 * wrapper just re-exports it and adds the `--force` CLI flag.
 *
 * Usage:
 *   POSTGRES_APP_URL=… npm run -w @dashboard/ai backfill:signatures
 *   POSTGRES_APP_URL=… npm run -w @dashboard/ai backfill:signatures -- --force
 */
import { backfillSignatures } from '../src/services/incident-signature-backfill.js';

export { backfillSignatures } from '../src/services/incident-signature-backfill.js';
export type { BackfillOptions, BackfillResult } from '../src/services/incident-signature-backfill.js';

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
