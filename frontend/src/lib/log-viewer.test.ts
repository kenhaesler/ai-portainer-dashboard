import { describe, expect, it } from 'vitest';
import { buildRegex, detectLevel, lintLogLine, parseLogs, sanitizeLogLine, sortByTimestamp, toLocalTimestamp } from './log-viewer';

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

  it('sanitizes control bytes and ansi escapes from log lines', () => {
    const dirty = '\u0001\u0002\u001b[31m2026-02-08T00:05:10.721Z ERROR x.css\u001b[0m';
    const cleaned = sanitizeLogLine(dirty);
    expect(cleaned).toBe('2026-02-08T00:05:10.721Z ERROR x.css');

    const parsed = parseLogs({
      containerId: 'abc',
      containerName: 'api',
      logs: `${dirty}\n`,
    });
    expect(parsed[0].timestamp).toBe('2026-02-08T00:05:10.721Z');
    expect(parsed[0].message).toBe('ERROR x.css');
    expect(parsed[0].raw).toBe('2026-02-08T00:05:10.721Z ERROR x.css');
  });

  it('lints noisy prefix bytes and keeps first ISO timestamp log segment', () => {
    const noisy = 'x\x00\x00\x1b[32m2026-02-08T00:19:36.57591045Z   INFO   index.css';
    expect(lintLogLine(noisy)).toBe('2026-02-08T00:19:36.57591045Z INFO index.css');
  });

  it('lints docker json log envelopes', () => {
    const jsonLine = '{"log":"INFO build complete\\n","stream":"stdout","time":"2026-02-08T00:19:36.57591045Z"}';
    const parsed = parseLogs({
      containerId: 'abc',
      containerName: 'api',
      logs: jsonLine,
    });

    expect(parsed[0].timestamp).toBe('2026-02-08T00:19:36.57591045Z');
    expect(parsed[0].message).toBe('INFO build complete');
  });
});
