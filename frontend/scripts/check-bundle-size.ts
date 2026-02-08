/**
 * Bundle Size Checker
 *
 * Reads built JS files from dist/, gzips each one, and compares
 * against the budgets defined in bundle-size.config.json.
 *
 * Exit code 0 = all budgets pass
 * Exit code 1 = one or more budgets exceeded
 *
 * Usage: npx tsx scripts/check-bundle-size.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BudgetConfig {
  budgets: {
    total: { maxGzipKB: number };
    individual: { maxGzipKB: number };
  };
  allowedGrowthPercent: number;
}

export interface ChunkMeasurement {
  name: string;
  rawBytes: number;
  gzipBytes: number;
}

export interface CheckResult {
  chunks: ChunkMeasurement[];
  totalGzipBytes: number;
  totalBudgetBytes: number;
  individualBudgetBytes: number;
  failures: string[];
}

// ---------------------------------------------------------------------------
// Core logic (exported for testing)
// ---------------------------------------------------------------------------

/** Collect all .js files from the given directories and measure sizes. */
export function measureChunks(distDir: string): ChunkMeasurement[] {
  const subdirs = ['entries', 'chunks', 'assets'];
  const measurements: ChunkMeasurement[] = [];

  for (const sub of subdirs) {
    const dir = path.join(distDir, sub);
    if (!fs.existsSync(dir)) continue;

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
    for (const file of files) {
      const content = fs.readFileSync(path.join(dir, file));
      const gzipped = zlib.gzipSync(content);
      measurements.push({
        name: `${sub}/${file}`,
        rawBytes: content.length,
        gzipBytes: gzipped.length,
      });
    }
  }

  // Sort largest-gzip-first for readability
  measurements.sort((a, b) => b.gzipBytes - a.gzipBytes);
  return measurements;
}

/** Compare measurements against budget config and return structured results. */
export function checkBudgets(
  chunks: ChunkMeasurement[],
  config: BudgetConfig,
): CheckResult {
  const totalGzipBytes = chunks.reduce((sum, c) => sum + c.gzipBytes, 0);
  const totalBudgetBytes = config.budgets.total.maxGzipKB * 1024;
  const individualBudgetBytes = config.budgets.individual.maxGzipKB * 1024;
  const failures: string[] = [];

  // Check individual chunk budgets
  for (const chunk of chunks) {
    if (chunk.gzipBytes > individualBudgetBytes) {
      const gzipKB = (chunk.gzipBytes / 1024).toFixed(1);
      failures.push(
        `${chunk.name} (${gzipKB} KB gzip) exceeds individual budget of ${config.budgets.individual.maxGzipKB} KB`,
      );
    }
  }

  // Check total budget
  if (totalGzipBytes > totalBudgetBytes) {
    const totalKB = (totalGzipBytes / 1024).toFixed(1);
    failures.push(
      `Total bundle (${totalKB} KB gzip) exceeds total budget of ${config.budgets.total.maxGzipKB} KB`,
    );
  }

  return {
    chunks,
    totalGzipBytes,
    totalBudgetBytes,
    individualBudgetBytes,
    failures,
  };
}

/** Format the results as a human-readable table string. */
export function formatReport(result: CheckResult, config: BudgetConfig): string {
  const lines: string[] = [];
  const divider = '-'.repeat(88);

  lines.push('');
  lines.push('  Bundle Size Report');
  lines.push(divider);
  lines.push(
    '  ' +
      'Chunk'.padEnd(52) +
      'Raw KB'.padStart(10) +
      'Gzip KB'.padStart(10) +
      'Status'.padStart(10),
  );
  lines.push(divider);

  const individualBudgetKB = config.budgets.individual.maxGzipKB;

  for (const chunk of result.chunks) {
    const rawKB = (chunk.rawBytes / 1024).toFixed(1);
    const gzipKB = (chunk.gzipBytes / 1024).toFixed(1);
    const overIndividual = chunk.gzipBytes > result.individualBudgetBytes;
    const status = overIndividual ? 'FAIL' : 'ok';
    lines.push(
      '  ' +
        chunk.name.padEnd(52) +
        rawKB.padStart(10) +
        gzipKB.padStart(10) +
        status.padStart(10),
    );
  }

  lines.push(divider);

  const totalRawKB = (
    result.chunks.reduce((s, c) => s + c.rawBytes, 0) / 1024
  ).toFixed(1);
  const totalGzipKB = (result.totalGzipBytes / 1024).toFixed(1);
  const totalOver = result.totalGzipBytes > result.totalBudgetBytes;
  const totalStatus = totalOver ? 'FAIL' : 'ok';

  lines.push(
    '  ' +
      'TOTAL'.padEnd(52) +
      totalRawKB.padStart(10) +
      totalGzipKB.padStart(10) +
      totalStatus.padStart(10),
  );
  lines.push(divider);
  lines.push('');
  lines.push(`  Budgets: total ${config.budgets.total.maxGzipKB} KB gzip | individual ${individualBudgetKB} KB gzip`);

  if (result.failures.length === 0) {
    lines.push('');
    lines.push('  All chunks within budget.');
  } else {
    lines.push('');
    lines.push(`  ${result.failures.length} budget violation(s):`);
    for (const f of result.failures) {
      lines.push(`    - ${f}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function main(): void {
  const frontendRoot = path.resolve(import.meta.dirname, '..');
  const distDir = path.join(frontendRoot, 'dist');
  const configPath = path.join(frontendRoot, 'bundle-size.config.json');

  // Validate prerequisites
  if (!fs.existsSync(distDir)) {
    console.error(
      'Error: dist/ directory not found. Run "npm run build" first.',
    );
    process.exit(1);
  }

  if (!fs.existsSync(configPath)) {
    console.error('Error: bundle-size.config.json not found.');
    process.exit(1);
  }

  const config: BudgetConfig = JSON.parse(
    fs.readFileSync(configPath, 'utf-8'),
  );

  const chunks = measureChunks(distDir);

  if (chunks.length === 0) {
    console.error('Error: No .js files found in dist/. Is the build output empty?');
    process.exit(1);
  }

  const result = checkBudgets(chunks, config);
  const report = formatReport(result, config);

  console.log(report);

  if (result.failures.length > 0) {
    process.exit(1);
  }
}

// Only run when executed directly as a CLI script, not when imported by tests.
// In ESM, there is no require.main === module equivalent, so we compare the
// current module URL against the entry point resolved from process.argv[1].
const entryUrl = process.argv[1]
  ? new URL(process.argv[1], import.meta.url).href
  : undefined;

if (import.meta.url === entryUrl) {
  main();
}
