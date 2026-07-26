import { describe, it, expect } from 'vitest';
import { clampConfidenceScore, parseSeverity } from './model-confidence.js';

describe('clampConfidenceScore', () => {
  it('passes a usable score through', () => {
    expect(clampConfidenceScore(0.42)).toBe(0.42);
    expect(clampConfidenceScore(0)).toBe(0);
    expect(clampConfidenceScore(1)).toBe(1);
  });

  it('clamps a badly expressed judgement rather than discarding it', () => {
    expect(clampConfidenceScore(1.5)).toBe(1);
    expect(clampConfidenceScore(-2)).toBe(0);
  });

  it('returns null for anything the model did not supply as a finite number', () => {
    expect(clampConfidenceScore(undefined)).toBeNull();
    expect(clampConfidenceScore(null)).toBeNull();
    expect(clampConfidenceScore('0.8')).toBeNull();
    expect(clampConfidenceScore(NaN)).toBeNull();
    expect(clampConfidenceScore(Infinity)).toBeNull();
    expect(clampConfidenceScore({})).toBeNull();
  });

  it('keeps a supplied 0.5 distinguishable from an absent score', () => {
    // The whole point: the old code returned 0.5 for "not supplied", making the
    // two indistinguishable on screen.
    expect(clampConfidenceScore(0.5)).toBe(0.5);
    expect(clampConfidenceScore(undefined)).toBeNull();
  });

  it('never returns a number for an absent score, at any of the old defaults', () => {
    for (const legacyDefault of [0.5, 0.35, 0.3, 0.1]) {
      expect(clampConfidenceScore(undefined)).not.toBe(legacyDefault);
    }
  });
});

describe('parseSeverity', () => {
  it('passes through the three severities the prompts ask for', () => {
    expect(parseSeverity('critical')).toBe('critical');
    expect(parseSeverity('warning')).toBe('warning');
    expect(parseSeverity('info')).toBe('info');
  });

  it('returns null instead of defaulting to warning', () => {
    expect(parseSeverity(undefined)).toBeNull();
    expect(parseSeverity(null)).toBeNull();
    expect(parseSeverity('sev1')).toBeNull();
    expect(parseSeverity('Critical')).toBeNull();
    expect(parseSeverity(2)).toBeNull();
  });
});
