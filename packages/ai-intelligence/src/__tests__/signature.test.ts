import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Insight } from '@dashboard/core/models/monitoring.js';
import {
  deriveSignature,
  deriveSignatureFromTitle,
  signatureLabel,
  slugifyTitle,
} from '../services/signature.js';

describe('deriveSignature — structured-field path', () => {
  it('uses metric_type + detection_method when both present', () => {
    expect(
      deriveSignature({
        category: 'anomaly',
        metric_type: 'cpu',
        detection_method: 'ml-anomaly',
        title: 'whatever',
      }),
    ).toBe('anomaly:ml-anomaly:cpu');
  });

  it('encodes prediction:memory correctly', () => {
    expect(
      deriveSignature({
        category: 'predictive',
        metric_type: 'memory',
        detection_method: 'prediction',
        title: 'Predicted memory exhaustion ~24h',
      }),
    ).toBe('predictive:prediction:memory');
  });
});

describe('deriveSignature — category-only fallbacks', () => {
  it('returns security:scan for security category', () => {
    expect(
      deriveSignature({ category: 'security', title: 'CVE-2024-1234 in container x' }),
    ).toBe('security:scan');
  });
  it('returns log:pattern for log-analysis category', () => {
    expect(deriveSignature({ category: 'log-analysis', title: 'OOM in logs' })).toBe('log:pattern');
  });
  it('returns ai:analysis for ai-analysis category', () => {
    expect(deriveSignature({ category: 'ai-analysis', title: 'AI summary' })).toBe('ai:analysis');
  });
});

describe('deriveSignatureFromTitle — title regex fallback', () => {
  it('matches "Predicted X exhaustion"', () => {
    expect(deriveSignatureFromTitle('Predicted memory exhaustion on "x" ~24h'))
      .toBe('predictive:prediction:memory');
    expect(deriveSignatureFromTitle('Predicted cpu exhaustion on "x" ~6h'))
      .toBe('predictive:prediction:cpu');
  });

  it('matches "Anomalous X usage" with ML', () => {
    expect(deriveSignatureFromTitle('Anomalous cpu usage on "x" (ML-detected)'))
      .toBe('anomaly:ml-anomaly:cpu');
  });

  it('matches "Anomalous X usage" without ML qualifier', () => {
    expect(deriveSignatureFromTitle('Anomalous memory usage on "x"'))
      .toBe('anomaly:threshold:memory');
  });

  it('matches "High X usage"', () => {
    expect(deriveSignatureFromTitle('High cpu usage on "x"'))
      .toBe('anomaly:threshold:cpu');
  });

  it('matches "no health check"', () => {
    expect(deriveSignatureFromTitle('Container x has no health check configured'))
      .toBe('config:health-check:missing');
  });

  it('matches "host network mode"', () => {
    expect(deriveSignatureFromTitle('Container x using host network mode'))
      .toBe('config:network:host-mode');
  });

  it('falls through to unknown:<slug> on no match', () => {
    expect(deriveSignatureFromTitle('Some bizarre new thing happened'))
      .toMatch(/^unknown:/);
  });
});

describe('slugifyTitle', () => {
  it('strips commas (signatures cannot contain commas — used as URL separator)', () => {
    expect(slugifyTitle('a, b, c')).not.toContain(',');
  });
  it('lowercases and dashes', () => {
    expect(slugifyTitle('Hello World')).toBe('hello-world');
  });
});

describe('signatureLabel', () => {
  it('returns curated label for known signature', () => {
    expect(signatureLabel('predictive:prediction:memory')).toBe('Predicted memory exhaustion');
  });
  it('falls back to humanized form for unknown', () => {
    expect(signatureLabel('anomaly:threshold:disk')).toBe('Anomaly · threshold · disk');
  });
});

describe('equivalence — regex output equals structured-field output', () => {
  // For each title pattern, the regex must produce the same signature
  // the structured-field path would for the same problem class.
  const cases = [
    { title: 'Anomalous cpu usage on "x" (ML-detected)',
      structured: { category: 'anomaly', metric_type: 'cpu' as const, detection_method: 'ml-anomaly' as const } },
    { title: 'Anomalous memory usage on "x"',
      structured: { category: 'anomaly', metric_type: 'memory' as const, detection_method: 'threshold' as const } },
    { title: 'Predicted memory exhaustion on "x" ~24h',
      structured: { category: 'predictive', metric_type: 'memory' as const, detection_method: 'prediction' as const } },
    { title: 'Predicted cpu exhaustion on "x" ~6h',
      structured: { category: 'predictive', metric_type: 'cpu' as const, detection_method: 'prediction' as const } },
    { title: 'High cpu usage on "x"',
      structured: { category: 'anomaly', metric_type: 'cpu' as const, detection_method: 'threshold' as const } },
  ];

  for (const c of cases) {
    it(`"${c.title}" — regex matches structured`, () => {
      const fromRegex = deriveSignatureFromTitle(c.title);
      const fromStructured = deriveSignature({ ...c.structured, title: c.title });
      expect(fromRegex).toBe(fromStructured);
    });
  }
});

describe('drift corpus — historical titles', () => {
  const csvPath = path.join(__dirname, 'fixtures/historical-titles.csv');
  const text = fs.readFileSync(csvPath, 'utf8').trim();
  const [, ...rows] = text.split('\n');

  type CsvRecord = {
    title: string;
    category: string | undefined;
    metric_type: string | undefined;
    detection_method: string | undefined;
  };

  const records: CsvRecord[] = rows.map((r) => {
    // Naive CSV parser sufficient for our quoted format.
    const cells: string[] = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < r.length; i++) {
      const ch = r[i];
      if (ch === '"') {
        if (inQuote && r[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuote = !inQuote;
        }
      } else if (ch === ',' && !inQuote) {
        cells.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    cells.push(cur);
    const [title, category, metric_type, detection_method] = cells;
    return {
      title,
      category: category || undefined,
      metric_type: metric_type || undefined,
      detection_method: detection_method || undefined,
    };
  });

  it('every row derives a non-unknown signature', () => {
    for (const r of records) {
      const sig = deriveSignatureFromTitle(r.title);
      expect(sig, `title="${r.title}"`).not.toMatch(/^unknown:/);
    }
  });

  it('regex output equals structured-field output (when fields present)', () => {
    for (const r of records) {
      if (!r.category) continue;
      const fromRegex = deriveSignatureFromTitle(r.title);
      const fromStructured = deriveSignature({
        category: r.category,
        metric_type: r.metric_type as Insight['metric_type'],
        detection_method: r.detection_method as Insight['detection_method'],
        title: r.title,
      });
      expect(fromRegex, `title="${r.title}"`).toBe(fromStructured);
    }
  });
});
