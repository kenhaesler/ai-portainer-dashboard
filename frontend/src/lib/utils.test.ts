import { describe, it, expect } from 'vitest';
import { formatBytes, formatDuration, formatRelativeAge, truncate, cn } from './utils';

describe('formatBytes', () => {
  it('should return "0 B" for 0 bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('should format bytes correctly', () => {
    expect(formatBytes(500)).toBe('500 B');
  });

  it('should format kilobytes correctly', () => {
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('should format megabytes correctly', () => {
    expect(formatBytes(1048576)).toBe('1 MB');
    expect(formatBytes(1572864)).toBe('1.5 MB');
  });

  it('should format gigabytes correctly', () => {
    expect(formatBytes(1073741824)).toBe('1 GB');
  });

  it('should respect decimal parameter', () => {
    expect(formatBytes(1536, 2)).toBe('1.5 KB');
    expect(formatBytes(1536, 0)).toBe('2 KB');
  });
});

describe('formatDuration', () => {
  it('should format milliseconds', () => {
    expect(formatDuration(500)).toBe('500ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  it('should format seconds', () => {
    expect(formatDuration(1000)).toBe('1.0s');
    expect(formatDuration(5500)).toBe('5.5s');
    expect(formatDuration(59999)).toBe('60.0s');
  });

  it('should format minutes', () => {
    expect(formatDuration(60000)).toBe('1.0m');
    expect(formatDuration(90000)).toBe('1.5m');
    expect(formatDuration(300000)).toBe('5.0m');
  });
});

describe('truncate', () => {
  it('should not truncate strings shorter than length', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('should not truncate strings equal to length', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });

  it('should truncate strings longer than length', () => {
    expect(truncate('hello world', 5)).toBe('hello...');
  });

  it('should handle empty strings', () => {
    expect(truncate('', 5)).toBe('');
  });
});

describe('formatRelativeAge', () => {
  it('should return "< 1m" for very recent timestamps', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(formatRelativeAge(now)).toBe('< 1m');
    expect(formatRelativeAge(now - 30)).toBe('< 1m');
  });

  it('should format minutes', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(formatRelativeAge(now - 300)).toBe('5m');
    expect(formatRelativeAge(now - 2700)).toBe('45m');
  });

  it('should format hours and minutes', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(formatRelativeAge(now - 3600)).toBe('1h 0m');
    expect(formatRelativeAge(now - 12120)).toBe('3h 22m');
  });

  it('should format days and hours', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(formatRelativeAge(now - 86400)).toBe('1d 0h');
    expect(formatRelativeAge(now - 100800)).toBe('1d 4h');
    expect(formatRelativeAge(now - 3888000)).toBe('45d 0h');
  });

  it('should handle future timestamps', () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    expect(formatRelativeAge(future)).toBe('Future');
  });
});

describe('cn', () => {
  it('should merge class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('should handle conditional classes', () => {
    const condition = false;
    expect(cn('foo', condition && 'bar', 'baz')).toBe('foo baz');
  });

  it('should merge tailwind classes correctly', () => {
    expect(cn('p-4', 'p-2')).toBe('p-2');
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
  });

  it('should handle undefined and null', () => {
    expect(cn('foo', undefined, null, 'bar')).toBe('foo bar');
  });
});
