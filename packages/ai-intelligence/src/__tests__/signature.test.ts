import { describe, it, expect } from 'vitest';
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
