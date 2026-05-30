import { describe, it, expect } from 'vitest';
import {
  checkBudgets,
  formatReport,
  type BudgetConfig,
  type ChunkMeasurement,
} from '../../../scripts/check-bundle-size';

const defaultConfig: BudgetConfig = {
  budgets: {
    total: { maxGzipKB: 500 },
    individual: { maxGzipKB: 250 },
  },
  allowedGrowthPercent: 10,
};

function makeChunk(name: string, gzipKB: number): ChunkMeasurement {
  return {
    name,
    rawBytes: gzipKB * 1024 * 3, // approximate raw = 3x gzip
    gzipBytes: gzipKB * 1024,
  };
}

describe('checkBudgets', () => {
  it('passes when all chunks are within budget', () => {
    const chunks = [makeChunk('chunks/app.js', 100), makeChunk('chunks/vendor.js', 200)];
    const result = checkBudgets(chunks, defaultConfig);

    expect(result.failures).toHaveLength(0);
    expect(result.totalGzipBytes).toBe(300 * 1024);
  });

  it('fails when an individual chunk exceeds the individual budget', () => {
    const chunks = [makeChunk('chunks/huge.js', 300)];
    const result = checkBudgets(chunks, defaultConfig);

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain('chunks/huge.js');
    expect(result.failures[0]).toContain('exceeds individual budget');
  });

  it('fails when total gzip size exceeds the total budget', () => {
    const chunks = [
      makeChunk('chunks/a.js', 200),
      makeChunk('chunks/b.js', 200),
      makeChunk('chunks/c.js', 200),
    ];
    const result = checkBudgets(chunks, defaultConfig);

    expect(result.failures.length).toBeGreaterThanOrEqual(1);
    const totalFailure = result.failures.find((f) => f.includes('Total bundle'));
    expect(totalFailure).toBeDefined();
    expect(totalFailure).toContain('exceeds total budget');
  });

  it('reports both individual and total failures simultaneously', () => {
    const chunks = [
      makeChunk('chunks/giant.js', 400),
      makeChunk('chunks/big.js', 200),
    ];
    const result = checkBudgets(chunks, defaultConfig);

    const individualFailures = result.failures.filter((f) =>
      f.includes('exceeds individual budget'),
    );
    const totalFailures = result.failures.filter((f) =>
      f.includes('exceeds total budget'),
    );

    expect(individualFailures).toHaveLength(1);
    expect(totalFailures).toHaveLength(1);
  });

  it('handles empty chunks array', () => {
    const result = checkBudgets([], defaultConfig);
    expect(result.failures).toHaveLength(0);
    expect(result.totalGzipBytes).toBe(0);
  });

  it('passes a chunk exactly at the budget boundary', () => {
    const chunks = [makeChunk('chunks/exact.js', 250)];
    const result = checkBudgets(chunks, defaultConfig);

    // Exactly at budget should NOT fail (only exceeding fails)
    const individualFailures = result.failures.filter((f) =>
      f.includes('exceeds individual budget'),
    );
    expect(individualFailures).toHaveLength(0);
  });
});

describe('formatReport', () => {
  it('includes "All chunks within budget" when there are no failures', () => {
    const chunks = [makeChunk('chunks/app.js', 50)];
    const result = checkBudgets(chunks, defaultConfig);
    const report = formatReport(result, defaultConfig);

    expect(report).toContain('All chunks within budget');
    expect(report).not.toContain('FAIL');
  });

  it('shows FAIL status for chunks exceeding individual budget', () => {
    const chunks = [makeChunk('chunks/huge.js', 300)];
    const result = checkBudgets(chunks, defaultConfig);
    const report = formatReport(result, defaultConfig);

    expect(report).toContain('FAIL');
    expect(report).toContain('budget violation');
  });

  it('includes budget limits in the report', () => {
    const chunks = [makeChunk('chunks/app.js', 50)];
    const result = checkBudgets(chunks, defaultConfig);
    const report = formatReport(result, defaultConfig);

    expect(report).toContain('total 500 KB gzip');
    expect(report).toContain('individual 250 KB gzip');
  });

  it('shows chunk names and sizes in the report', () => {
    const chunks = [makeChunk('chunks/app.js', 50)];
    const result = checkBudgets(chunks, defaultConfig);
    const report = formatReport(result, defaultConfig);

    expect(report).toContain('chunks/app.js');
    expect(report).toContain('50.0');
  });
});
