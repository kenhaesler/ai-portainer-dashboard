import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatRelativeTime } from './format-relative-time';

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-21T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const ago = (spec: { s?: number; m?: number; h?: number; d?: number }) => {
    const seconds = (spec.s ?? 0) + (spec.m ?? 0) * 60 + (spec.h ?? 0) * 3600 + (spec.d ?? 0) * 86400;
    return new Date(Date.now() - seconds * 1000).toISOString();
  };

  describe('default behaviour (shared canonical)', () => {
    it('returns "just now" for <30 seconds ago', () => {
      expect(formatRelativeTime('2026-05-21T11:59:50.000Z')).toBe('just now');
    });

    it('returns minutes for <1 hour', () => {
      expect(formatRelativeTime('2026-05-21T11:55:00.000Z')).toBe('5m ago');
    });

    it('returns hours for <1 day', () => {
      expect(formatRelativeTime('2026-05-21T09:00:00.000Z')).toBe('3h ago');
    });

    it('returns days for <30 days', () => {
      expect(formatRelativeTime('2026-05-19T12:00:00.000Z')).toBe('2d ago');
    });

    it('returns weeks for <1 year', () => {
      expect(formatRelativeTime('2026-05-07T12:00:00.000Z')).toBe('2w ago');
    });

    it('returns years for >1 year', () => {
      expect(formatRelativeTime('2024-05-21T12:00:00.000Z')).toBe('2y ago');
    });

    it('returns empty string for invalid input', () => {
      expect(formatRelativeTime('not-a-date')).toBe('');
    });

    it('accepts a Date "now" as the second argument (back-compat)', () => {
      const now = new Date('2026-05-21T12:00:00.000Z');
      expect(formatRelativeTime('2026-05-21T11:55:00.000Z', now)).toBe('5m ago');
    });

    it('accepts epoch millis and Date inputs', () => {
      expect(formatRelativeTime(Date.now() - 5 * 60_000)).toBe('5m ago');
      expect(formatRelativeTime(new Date(Date.now() - 3 * 3_600_000))).toBe('3h ago');
    });
  });

  // Second-granularity freshness widget: smart-refresh-controls + data-freshness.
  describe('second-granularity, cap at hours ("just now" <5s)', () => {
    const opts = { nowThresholdSeconds: 5, showSeconds: true, maxUnit: 'hour' as const };

    it('says just now under 5s', () => {
      expect(formatRelativeTime(ago({ s: 3 }), opts)).toBe('just now');
    });
    it('shows seconds from 5s up', () => {
      expect(formatRelativeTime(ago({ s: 5 }), opts)).toBe('5s ago');
      expect(formatRelativeTime(ago({ s: 45 }), opts)).toBe('45s ago');
    });
    it('shows minutes then caps at hours (no day rollover)', () => {
      expect(formatRelativeTime(ago({ m: 5 }), opts)).toBe('5m ago');
      expect(formatRelativeTime(ago({ h: 3 }), opts)).toBe('3h ago');
      expect(formatRelativeTime(ago({ d: 2 }), opts)).toBe('48h ago');
    });
    it('supports a capitalised just-now label (data-freshness / connection-orb)', () => {
      expect(formatRelativeTime(ago({ s: 2 }), { ...opts, justNowLabel: 'Just now' })).toBe('Just now');
    });
  });

  // connection-orb: second granularity capped at minutes.
  describe('second-granularity, cap at minutes', () => {
    const opts = { nowThresholdSeconds: 5, justNowLabel: 'Just now', showSeconds: true, maxUnit: 'minute' as const };
    it('caps at minutes and never rolls up to hours', () => {
      expect(formatRelativeTime(ago({ s: 2 }), opts)).toBe('Just now');
      expect(formatRelativeTime(ago({ s: 30 }), opts)).toBe('30s ago');
      expect(formatRelativeTime(ago({ h: 2 }), opts)).toBe('120m ago');
    });
  });

  // status-page + harbor-vulnerabilities: "just now" under a minute, cap at days.
  describe('minute threshold, cap at days', () => {
    const opts = { nowThresholdSeconds: 60, maxUnit: 'day' as const };
    it('says just now under a minute and never shows seconds', () => {
      expect(formatRelativeTime(ago({ s: 45 }), opts)).toBe('just now');
      expect(formatRelativeTime(ago({ m: 5 }), opts)).toBe('5m ago');
      expect(formatRelativeTime(ago({ h: 3 }), opts)).toBe('3h ago');
      expect(formatRelativeTime(ago({ d: 40 }), opts)).toBe('40d ago');
    });
  });

  // command-palette: epoch-ms input, capitalised, cap at days.
  describe('command-palette profile', () => {
    const opts = { nowThresholdSeconds: 60, justNowLabel: 'Just now', maxUnit: 'day' as const };
    it('formats epoch-ms timestamps', () => {
      expect(formatRelativeTime(Date.now() - 30_000, opts)).toBe('Just now');
      expect(formatRelativeTime(Date.now() - 5 * 60_000, opts)).toBe('5m ago');
      expect(formatRelativeTime(Date.now() - 2 * 86_400_000, opts)).toBe('2d ago');
    });
  });

  // tab-ai-llm: "just now" under two minutes, locale date past 30 days.
  describe('date cutoff after N days', () => {
    const opts = { nowThresholdSeconds: 120, maxUnit: 'day' as const, dateAfterDays: 30 };
    it('says just now under two minutes', () => {
      expect(formatRelativeTime(ago({ m: 1 }), opts)).toBe('just now');
      expect(formatRelativeTime(ago({ m: 5 }), opts)).toBe('5m ago');
    });
    it('shows days up to the cutoff then a locale date', () => {
      expect(formatRelativeTime(ago({ d: 29 }), opts)).toBe('29d ago');
      const iso = ago({ d: 40 });
      expect(formatRelativeTime(iso, opts)).toBe(new Date(iso).toLocaleDateString());
    });
  });

  // fleet-overview: no just-now, raw seconds, cap at days.
  describe('no just-now (threshold 0), raw seconds, cap at days', () => {
    const opts = { nowThresholdSeconds: 0, showSeconds: true, maxUnit: 'day' as const };
    it('shows seconds immediately with no just-now bucket', () => {
      expect(formatRelativeTime(ago({ s: 3 }), opts)).toBe('3s ago');
      expect(formatRelativeTime(ago({ s: 45 }), opts)).toBe('45s ago');
      expect(formatRelativeTime(ago({ m: 5 }), opts)).toBe('5m ago');
      expect(formatRelativeTime(ago({ d: 3 }), opts)).toBe('3d ago');
    });
  });

  it('returns a custom invalid label when provided', () => {
    expect(formatRelativeTime('nope', { invalidLabel: 'N/A' })).toBe('N/A');
  });
});
