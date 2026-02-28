import { describe, expect, it } from 'vitest';
import { buildSearchMatcher, detectLevel, lintLogLine, parseLogs, sanitizeLogLine, sortByTimestamp, toLocalTimestamp } from './log-viewer';

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

describe('buildSearchMatcher (ReDoS-safe)', () => {
  it('returns null for empty or whitespace-only pattern', () => {
    expect(buildSearchMatcher('')).toBeNull();
    expect(buildSearchMatcher('   ')).toBeNull();
  });

  it('returns a matcher function for a non-empty pattern', () => {
    const matcher = buildSearchMatcher('error');
    expect(matcher).toBeInstanceOf(Function);
  });

  it('matches case-insensitively', () => {
    const matcher = buildSearchMatcher('error')!;
    expect(matcher('ERROR: something failed')).toBe(true);
    expect(matcher('Error happened')).toBe(true);
    expect(matcher('no issues here')).toBe(false);
  });

  it('matches substring anywhere in the text', () => {
    const matcher = buildSearchMatcher('timeout')!;
    expect(matcher('connection timeout after 30s')).toBe(true);
    expect(matcher('TIMEOUT')).toBe(true);
    expect(matcher('no issues')).toBe(false);
  });

  it('treats regex special characters as literal text (ReDoS prevention)', () => {
    // These patterns would cause ReDoS if passed to new RegExp() unescaped
    const redosPatterns = [
      '(a+)+b',
      '([a-zA-Z]+)*',
      '(a|aa)+',
      '.*',
      '[test]',
      'a{1,100}',
      'foo|bar',
      'hello(world',
      '^start$',
      'path\\to\\file',
    ];

    for (const pattern of redosPatterns) {
      const matcher = buildSearchMatcher(pattern);
      // Should return a function, not throw or hang
      expect(matcher).toBeInstanceOf(Function);
    }
  });

  it('matches literal regex metacharacters in text', () => {
    const matcher = buildSearchMatcher('file.log')!;
    // Should match literal "file.log", not "file" + any char + "log"
    expect(matcher('output to file.log')).toBe(true);
    expect(matcher('output to filexlog')).toBe(false);
  });

  it('matches literal brackets in text', () => {
    const matcher = buildSearchMatcher('[error]')!;
    expect(matcher('2026-01-01 [error] crash')).toBe(true);
    expect(matcher('2026-01-01 error crash')).toBe(false);
  });

  it('matches literal pipe in text', () => {
    const matcher = buildSearchMatcher('error|timeout')!;
    expect(matcher('got error|timeout response')).toBe(true);
    // Should NOT match "error" alone (pipe is not treated as OR)
    expect(matcher('got error response')).toBe(false);
  });

  it('does not hang on catastrophic backtracking patterns', () => {
    const matcher = buildSearchMatcher('(a+)+b')!;
    const longInput = 'a'.repeat(100000);
    const start = performance.now();
    matcher(longInput);
    const elapsed = performance.now() - start;
    // String.includes should complete nearly instantly even on large input
    expect(elapsed).toBeLessThan(100);
  });
});
