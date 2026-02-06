import { describe, expect, it } from 'vitest';
import { buildRegex, detectLevel, parseLogs, sortByTimestamp, toLocalTimestamp } from './log-viewer';

describe('log-viewer utilities', () => {
  it('detects log level from line text', () => {
    expect(detectLevel('ERROR failed')).toBe('error');
    expect(detectLevel('warn: retry')).toBe('warn');
    expect(detectLevel('debug trace')).toBe('debug');
    expect(detectLevel('info started')).toBe('info');
    expect(detectLevel('plain output')).toBe('unknown');
  });

  it('parses timestamp and message', () => {
    const entries = parseLogs({
      containerId: 'abc',
      containerName: 'api',
      logs: '2026-02-06T10:00:00Z INFO up\nplain',
    });

    expect(entries).toHaveLength(2);
    expect(entries[0].timestamp).toBe('2026-02-06T10:00:00Z');
    expect(entries[0].message).toBe('INFO up');
    expect(entries[1].timestamp).toBeNull();
  });

  it('sorts chronologically', () => {
    const sorted = sortByTimestamp([
      { id: '2', containerId: 'a', containerName: 'x', timestamp: '2026-02-06T10:02:00Z', level: 'info', message: 'b', raw: 'b' },
      { id: '1', containerId: 'a', containerName: 'x', timestamp: '2026-02-06T10:01:00Z', level: 'info', message: 'a', raw: 'a' },
    ]);
    expect(sorted[0].id).toBe('1');
  });

  it('builds valid regex and rejects invalid pattern', () => {
    expect(buildRegex('error|timeout')).toBeInstanceOf(RegExp);
    expect(buildRegex('[')).toBeNull();
  });

  it('formats timestamps safely', () => {
    expect(toLocalTimestamp('2026-02-06T10:00:00Z')).not.toBe('-');
    expect(toLocalTimestamp(null)).toBe('-');
  });
});
