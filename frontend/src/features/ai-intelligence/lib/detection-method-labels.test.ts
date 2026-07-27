import { describe, it, expect } from 'vitest';
import { DETECTION_METHOD_LABELS, detectionMethodLabel } from './detection-method-labels';
import { detectionMethodLabel as signatureMetaLabel } from './signature-meta';

/**
 * Guards the invariant that lost this argument once already.
 *
 * `insight-card.tsx` carried a twelve-line comment explaining that a badge is a
 * claim about what ran, that the `ml-anomaly` column cannot distinguish the
 * adaptive z-score path from the isolation-forest path, and that it must
 * therefore read "Metric anomaly" and never "ML". Four hundred pixels away on
 * the same page, `signature-meta.ts` labelled the identical key "ML".
 *
 * The reasoning was recorded in prose, and prose does not fail CI. This does.
 * It is deliberately modelled on `navigation-manifest.test.ts`, which is how
 * this codebase already stops six copies of a route list from drifting.
 */
describe('detection method labels', () => {
  it('has exactly one label per detector across every consumer', () => {
    // Both surfaces resolve through the same map. If either reintroduces a
    // local copy, one of these lookups diverges and this fails.
    for (const method of Object.keys(DETECTION_METHOD_LABELS)) {
      expect(signatureMetaLabel(method)).toBe(detectionMethodLabel(method));
    }
  });

  it('never claims a detector is ML', () => {
    // The detector identifier `ml-anomaly` is a storage key, not a statement
    // about the technique. Nothing derived from it may render as "ML".
    for (const [method, label] of Object.entries(DETECTION_METHOD_LABELS)) {
      expect(label, `label for "${method}"`).not.toMatch(/\bML\b/);
      expect(label, `label for "${method}"`).not.toMatch(/machine learning/i);
    }
  });

  it('labels ml-anomaly by what is actually known about it', () => {
    expect(detectionMethodLabel('ml-anomaly')).toBe('Metric anomaly');
    expect(signatureMetaLabel('ml-anomaly')).toBe('Metric anomaly');
  });

  it('resolves the short signature tokens to the same words as their long forms', () => {
    // `deriveSignature` emits `security:scan` / `log:pattern` when an insight
    // carries no detection_method column, so the signature parser sees `scan`
    // and `pattern` for the same concepts the column calls `security-scan` and
    // `log-pattern`. Two names for one detector must still read identically.
    expect(detectionMethodLabel('scan')).toBe(detectionMethodLabel('security-scan'));
    expect(detectionMethodLabel('pattern')).toBe(detectionMethodLabel('log-pattern'));
  });

  it('renders nothing rather than defaulting for an unknown or absent method', () => {
    expect(detectionMethodLabel('something-new')).toBeNull();
    expect(detectionMethodLabel(null)).toBeNull();
    expect(detectionMethodLabel(undefined)).toBeNull();
    expect(detectionMethodLabel('')).toBeNull();
  });
});
