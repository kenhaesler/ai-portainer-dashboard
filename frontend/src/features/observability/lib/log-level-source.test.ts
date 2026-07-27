import { describe, it, expect } from 'vitest';
import { emittedLevel, detectLevel, resolveLevel, parseLogs, LEVEL_TOKEN_RE } from './log-viewer';

/**
 * `resolveLevel` prefers the level a record states about itself over
 * `detectLevel`'s keyword match, and reports which of the two it used.
 *
 * `detectLevel` matches keywords anywhere in the line: `module: "trace-store"`
 * resolves to DEBUG, `no error found` to ERROR. It stays as the fallback — a
 * plain-text container log offers nothing else — but its answers carry
 * `levelSource: 'guessed'`.
 */
describe('emittedLevel', () => {
  it('reads a pino string level', () => {
    expect(emittedLevel('{"level":"warn","msg":"disk filling"}')).toBe('warn');
  });

  it('reads a pino numeric level', () => {
    expect(emittedLevel('{"level":50,"msg":"boom"}')).toBe('error');
    expect(emittedLevel('{"level":30,"msg":"ok"}')).toBe('info');
    expect(emittedLevel('{"level":20,"msg":"detail"}')).toBe('debug');
  });

  it('reads a level prefix', () => {
    expect(emittedLevel('INFO: Received shutdown signal')).toBe('info');
    expect(emittedLevel('[WARN] cache miss')).toBe('warn');
    expect(emittedLevel('10:40:55 ERROR connection refused')).toBe('error');
  });

  it('reads a level prefix behind an ISO-8601 timestamp', () => {
    // The `T` and `Z` are letters, so LEADING_NON_LETTERS_RE stops at the `T`;
    // LEADING_TIMESTAMP_RE consumes the whole timestamp. Both ParsedLogEntry
    // producers strip this leading form before calling resolveLevel — the
    // TS_PREFIX_RE in log-viewer.ts and the copy in use-log-stream.ts — so it
    // reaches emittedLevel attached only on a direct call like this one. That
    // regex is anchored on `\d{4}`, which is why the bracketed form below is
    // the one that arrives with its timestamp still on the line.
    expect(emittedLevel('2026-07-27T10:40:55Z ERROR starting up')).toBe('error');
    expect(emittedLevel('2026-07-27T10:40:55.123Z [warn] disk filling')).toBe('warn');
  });

  it('returns null when the record states nothing', () => {
    expect(emittedLevel('module: "trace-store"')).toBeNull();
    expect(emittedLevel('no error found')).toBeNull();
  });

  /**
   * A level synonym in head position is a declaration only with a delimiter or
   * all caps; these lines have neither and must fall through to `detectLevel`.
   */
  it('does not read a sentence that opens with a level synonym as a declaration', () => {
    expect(emittedLevel('Trace ID 4711 processed')).toBeNull();
    expect(emittedLevel('Critical section entered')).toBeNull();
    expect(emittedLevel('Notice period expired')).toBeNull();
    expect(emittedLevel('Verbose output enabled')).toBeNull();
    expect(emittedLevel('Debug mode is off')).toBeNull();
    expect(emittedLevel('Error handling middleware registered')).toBeNull();
  });

  /**
   * A boundary guard, not a regression guard: both lines are rejected by
   * `normalizeLevelWord`, which has no case for "errors" or "warningly", and
   * both were rejected by the looser regex this rule replaced. They pin the
   * intended behaviour; they would not catch its removal.
   */
  it('rejects a longer word that merely starts with a level synonym', () => {
    expect(emittedLevel('ERRORS: 0')).toBeNull();
    expect(emittedLevel('WARNINGLY loud')).toBeNull();
  });

  /**
   * `LEVEL_TOKEN_RE` is `/^[A-Za-z]{3,11}(?![A-Za-z])/`. Drop the lookahead
   * and the greedy quantifier returns the first 11 letters of a longer run:
   * `INFORMATIONAL` becomes `INFORMATION`, a synonym `normalizeLevelWord`
   * maps to `info`. `emittedLevel` cannot show the difference — a truncated
   * token is followed by a letter, and `isLevelDeclaration` rejects that
   * regardless — so the assertion has to be on the regex.
   */
  it('does not truncate a 12-letter-or-longer word into a level synonym', () => {
    expect(LEVEL_TOKEN_RE.exec('INFORMATIONAL notice')).toBeNull();
    // Same input through the full function: null under either token rule,
    // recorded here so the two levels of the guard are visible together.
    expect(emittedLevel('INFORMATIONAL notice')).toBeNull();
  });

  /**
   * The form that reaches `resolveLevel` with its timestamp intact, since
   * TS_PREFIX_RE is anchored on `\d{4}` and skips a line opening with `[`.
   * LEADING_NON_LETTERS_RE alone consumes `[2026-07-27` and stops at the `T`,
   * leaving no level token at the head; the space-separated variant carries no
   * letters, so only the ISO one needs LEADING_TIMESTAMP_RE.
   */
  it('reads a level prefix behind a bracketed timestamp', () => {
    expect(emittedLevel('[2026-07-27T10:40:55Z] INFO started')).toBe('info');
    expect(emittedLevel('[2026-07-27 10:40:55] ERROR boom')).toBe('error');
    expect(emittedLevel('[2026-07-27T10:40:55.123456789Z] DEBUG tick')).toBe('debug');
    expect(emittedLevel('[2026-07-27T10:40:55+02:00] INFO tz')).toBe('info');
    expect(emittedLevel('(2026-07-27T10:40:55Z) WARN slow')).toBe('warn');
  });

  /**
   * The bracket allowance widened what counts as strippable prefix noise, so
   * every prose line that must stay a guess is re-asserted here — bare, and
   * behind a bracketed timestamp.
   */
  it('does not promote prose to a declaration behind a bracketed timestamp', () => {
    const prose = [
      'Trace ID 4711 processed',
      'Critical section entered',
      'Notice period expired',
      'Verbose output enabled',
      'Debug mode is off',
      'Error handling middleware registered',
      'module: "trace-store"',
      'no error found',
      'count: 27',
    ];

    for (const line of prose) {
      expect(emittedLevel(line)).toBeNull();
      expect(emittedLevel(`[2026-07-27T10:40:55Z] ${line}`)).toBeNull();
      expect(resolveLevel(line).levelSource).not.toBe('emitted');
    }
  });
});

describe('resolveLevel', () => {
  it('marks a keyword match as a guess, not a fact', () => {
    const resolved = resolveLevel('module: "trace-store"');
    expect(resolved.level).toBe('debug');
    expect(resolved.levelSource).toBe('guessed');
  });

  it('marks a keyword false positive as a guess', () => {
    // A line reporting the *absence* of an error is badged ERROR by the
    // keyword pass. Singular deliberately: `/\berror\b/` is word-bounded, so
    // `no errors found` does not match and resolves to `none`.
    expect(resolveLevel('no error found')).toEqual({ level: 'error', levelSource: 'guessed' });
  });

  it('prefers what the record declares over what the text contains', () => {
    // Declares info; the word "error" appears in the message body. The
    // declaration wins, and it is a fact rather than a guess.
    const resolved = resolveLevel('{"level":"info","msg":"no error occurred"}');
    expect(resolved).toEqual({ level: 'info', levelSource: 'emitted' });
  });

  it('reports no source when there is nothing to go on', () => {
    expect(resolveLevel('count: 27')).toEqual({ level: 'unknown', levelSource: 'none' });
  });

  /**
   * A sentence opening with a level synonym must reach the keyword pass, which
   * may well return the same level — the point is the source, not the level.
   * "Error handling middleware registered" is still ERROR because it contains
   * the word "error"; it just must not claim the emitter said so.
   */
  it('demotes a sentence that opens with a level synonym to a guess', () => {
    expect(resolveLevel('Error handling middleware registered'))
      .toEqual({ level: 'error', levelSource: 'guessed' });
    expect(resolveLevel('Trace ID 4711 processed'))
      .toEqual({ level: 'debug', levelSource: 'guessed' });
    expect(resolveLevel('Debug mode is off'))
      .toEqual({ level: 'debug', levelSource: 'guessed' });
  });

  it('reports no source for a sentence whose opening synonym is not a keyword', () => {
    // "critical", "notice" and "verbose" are level synonyms but not keywords
    // detectLevel looks for, so these end up with no level at all rather than
    // with a fabricated one.
    expect(resolveLevel('Critical section entered'))
      .toEqual({ level: 'unknown', levelSource: 'none' });
    expect(resolveLevel('Notice period expired'))
      .toEqual({ level: 'unknown', levelSource: 'none' });
    expect(resolveLevel('Verbose output enabled'))
      .toEqual({ level: 'unknown', levelSource: 'none' });
  });

  it('accepts a real declaration behind a timestamp as a fact', () => {
    expect(resolveLevel('2026-07-27T10:40:55Z ERROR starting up'))
      .toEqual({ level: 'error', levelSource: 'emitted' });
    expect(resolveLevel('10:40:55 ERROR connection refused'))
      .toEqual({ level: 'error', levelSource: 'emitted' });
  });

  it('accepts a real declaration behind a bracketed timestamp as a fact', () => {
    expect(resolveLevel('[2026-07-27T10:40:55Z] INFO started'))
      .toEqual({ level: 'info', levelSource: 'emitted' });
    expect(resolveLevel('[2026-07-27 10:40:55] ERROR boom'))
      .toEqual({ level: 'error', levelSource: 'emitted' });
  });

  it('keeps detectLevel available for callers that want the raw guess', () => {
    expect(detectLevel('module: "trace-store"')).toBe('debug');
  });
});

describe('parseLogs', () => {
  it('carries levelSource onto every entry', () => {
    const entries = parseLogs({
      containerId: 'c1',
      containerName: 'api',
      logs: ['INFO: started', 'module: "trace-store"', 'count: 27'].join('\n'),
    });

    expect(entries.map((e) => [e.level, e.levelSource])).toEqual([
      ['info', 'emitted'],
      ['debug', 'guessed'],
      ['unknown', 'none'],
    ]);
  });

  it('keeps the declaration when the timestamp is split off the message', () => {
    // parseLogs hands resolveLevel the message with the leading timestamp
    // already removed, so both halves of the pipeline have to agree on what
    // counts as a declaration.
    const entries = parseLogs({
      containerId: 'c1',
      containerName: 'api',
      logs: [
        '2026-07-27T10:40:55Z ERROR starting up',
        '2026-07-27T10:40:56Z Trace ID 4711 processed',
      ].join('\n'),
    });

    expect(entries.map((e) => [e.message, e.level, e.levelSource])).toEqual([
      ['ERROR starting up', 'error', 'emitted'],
      ['Trace ID 4711 processed', 'debug', 'guessed'],
    ]);
  });
});
