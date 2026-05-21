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
});
