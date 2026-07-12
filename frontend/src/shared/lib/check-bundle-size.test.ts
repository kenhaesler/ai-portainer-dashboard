import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  checkBudgets,
  checkNoEagerRecharts,
  collectEagerChunkFiles,
  formatReport,
  parseStaticImports,
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

describe('parseStaticImports', () => {
  it('extracts named, namespace, default, and bare static imports', () => {
    const source =
      'import{a as b,c}from"./chunks/a.js";import*as ns from"./chunks/b.js";'
      + 'import def from"./chunks/c.js";import"./chunks/d.js";const x=1;';

    expect(parseStaticImports(source).sort()).toEqual([
      './chunks/a.js',
      './chunks/b.js',
      './chunks/c.js',
      './chunks/d.js',
    ]);
  });

  it('ignores dynamic import() calls and preload-map strings', () => {
    const source =
      'import{a}from"./eager.js";'
      + 'const p=()=>import("./lazy.js");'
      + 'function d(i,m=[]){return m}const deps=d(0,["../chunks/mapdep.js","../chunks/other.js"]);';

    expect(parseStaticImports(source)).toEqual(['./eager.js']);
  });
});

describe('eager recharts guard (#1507)', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Build a minimal fake dist/ with entries/ + chunks/. */
  function makeDist(files: Record<string, string>): string {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-check-'));
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(tmpDir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
    return tmpDir;
  }

  it('collects the transitive static-import closure from entries', () => {
    const dist = makeDist({
      'entries/index-abc.js': 'import{a}from"../chunks/vendor-a.js";import("../chunks/lazy-b.js");',
      'chunks/vendor-a.js': 'import{b}from"./nested-c.js";export const a=1;',
      'chunks/nested-c.js': 'export const b=2;',
      'chunks/lazy-b.js': 'export const lazy=3;',
    });

    expect(collectEagerChunkFiles(dist)).toEqual([
      'chunks/nested-c.js',
      'chunks/vendor-a.js',
      'entries/index-abc.js',
    ]);
  });

  it('fails when an eagerly imported chunk contains recharts code', () => {
    const dist = makeDist({
      'entries/index-abc.js': 'import{a}from"../chunks/chart-vendor.js";',
      'chunks/chart-vendor.js': 'export const a="recharts-wrapper";',
    });

    const failures = checkNoEagerRecharts(dist);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('chunks/chart-vendor.js');
  });

  it('passes when recharts code is only reachable via dynamic import', () => {
    const dist = makeDist({
      'entries/index-abc.js': 'import{a}from"../chunks/react-vendor.js";import("../chunks/chart-page.js");',
      'chunks/react-vendor.js': 'export const a=1;',
      'chunks/chart-page.js': 'export const c="recharts-wrapper";',
    });

    expect(checkNoEagerRecharts(dist)).toEqual([]);
  });
});
