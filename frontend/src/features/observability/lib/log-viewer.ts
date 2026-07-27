export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'unknown';

/**
 * How a line's level was established.
 *
 * `emitted` — the record stated its own level: a pino/bunyan `level` field, or
 * a `LEVEL:`-style prefix.
 * `guessed` — `detectLevel`'s keyword match anywhere in the line, which cannot
 * tell a level from a word: `module: "trace-store"` resolves to DEBUG and
 * `no error found` to ERROR. Render it differently from `emitted`.
 * `none` — the record stated no level and no keyword matched.
 */
export type LogLevelSource = 'emitted' | 'guessed' | 'none';

export interface ParsedLogEntry {
  id: string;
  containerId: string;
  containerName: string;
  timestamp: string | null;
  level: LogLevel;
  /** Whether `level` was stated by the emitter or inferred from keywords. */
  levelSource: LogLevelSource;
  message: string;
  raw: string;
}

interface ParseInput {
  containerId: string;
  containerName: string;
  logs: string;
}

const TS_PREFIX_RE = /^(\d{4}-\d{2}-\d{2}T[^\s]+)\s(.*)$/;
const ISO_TS_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/;
const REPLACEMENT_CHAR_RE = /\uFFFD+/g;
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const ANSI_ESCAPE_RE = new RegExp(
  `${ESC}(?:[@-Z\\\\-_]|\\[[0-?]*[ -/]*[@-~]|\\][^${BEL}]*${BEL})`,
  'g'
);

function isControlChar(charCode: number): boolean {
  return (
    (charCode >= 0x00 && charCode <= 0x08)
    || (charCode >= 0x0b && charCode <= 0x1f)
    || (charCode >= 0x7f && charCode <= 0x9f)
  );
}

function stripControlChars(input: string): string {
  let output = '';
  for (const char of input) {
    if (!isControlChar(char.charCodeAt(0))) {
      output += char;
    }
  }
  return output;
}

/** Map a level word from any emitter onto our five-value vocabulary. */
function normalizeLevelWord(word: string): LogLevel | null {
  switch (word.toLowerCase()) {
    case 'fatal': case 'panic': case 'crit': case 'critical': case 'error': case 'err':
      return 'error';
    case 'warn': case 'warning':
      return 'warn';
    case 'info': case 'notice': case 'information':
      return 'info';
    case 'debug': case 'trace': case 'verbose':
      return 'debug';
    default:
      return null;
  }
}

/**
 * Timestamps that commonly sit between the start of a line and the level the
 * emitter declares, with an optional leading `[`/`(` and trailing `]`/`)`.
 *
 * ISO-8601 needs its own pattern rather than `LEADING_NON_LETTERS_RE`: its `T`
 * and `Z` are letters, so that rule stops at the `T` and leaves
 * `T10:40:55Z] INFO started`, which has no level token at its head. The
 * space-separated form `[2026-07-27 10:40:55] ERROR boom` carries no letters
 * and never needed this pattern.
 */
const LEADING_TIMESTAMP_RE = /^[[(]?(?:\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?|\d{2}:\d{2}:\d{2}(?:[.,]\d+)?|\d{4}-\d{2}-\d{2})[\])]?\s+/;

/** Pids, brackets and other punctuation standing ahead of the level word. */
const LEADING_NON_LETTERS_RE = /^[^A-Za-z]{1,32}/;

/**
 * A candidate level word, bounded to a whole word by the trailing lookahead.
 *
 * Without the lookahead the greedy quantifier returns the first 11 letters of
 * a longer run: `INFORMATIONAL notice` yields `INFORMATION`, which
 * `normalizeLevelWord` maps to `info`.
 *
 * It does not change what `emittedLevel` returns: a truncated token is
 * followed by a letter, and `isLevelDeclaration` accepts only field
 * punctuation, whitespace or end-of-line after the word. Exported so
 * `log-level-source.test.ts` can assert the regex directly.
 */
export const LEVEL_TOKEN_RE = /^[A-Za-z]{3,11}(?![A-Za-z])/;

/**
 * Drop whatever stands between the start of the line and a level the emitter
 * may have declared. Two passes, because a line can carry both a timestamp and
 * punctuation: `2026-07-27T10:40:55.123Z [warn] disk filling`.
 */
function stripPrefixNoise(line: string): string {
  let rest = line.trimStart();
  for (let pass = 0; pass < 2; pass += 1) {
    const timestamp = LEADING_TIMESTAMP_RE.exec(rest);
    if (timestamp) {
      rest = rest.slice(timestamp[0].length);
      continue;
    }
    const punctuation = LEADING_NON_LETTERS_RE.exec(rest);
    if (punctuation) {
      rest = rest.slice(punctuation[0].length);
      continue;
    }
    break;
  }
  return rest;
}

/**
 * Whether a level-synonym word at the head of a line is the emitter declaring
 * a level, or just the first word of an English sentence.
 *
 * `word` is the synonym itself; `rest` is what follows it on the line.
 */
function isLevelDeclaration(word: string, rest: string): boolean {
  // "INFO: ...", "[WARN] ...", "(debug) ..." — punctuation bound to the word,
  // which prose does not carry.
  if (/^[:\]})>]/.test(rest)) return true;
  // "INFO | ...", "WARN - ..." — a spaced separator between fields. Unspaced,
  // it is an ordinary hyphenated word: "warning-free build".
  if (/^\s+[|-]\s/.test(rest)) return true;
  // Nothing but whitespace or end-of-line after the word, so its own form is
  // the only signal left: "10:40:55 ERROR connection refused" declares a
  // level, "Error handling middleware registered" starts a sentence.
  return word === word.toUpperCase() && (rest === '' || /^\s/.test(rest));
}

/**
 * The level the record states about itself, or null if it states none.
 *
 * Covers pino/bunyan JSON (`"level":30` or `"level":"info"`) and a level word
 * at the head of the line, after any timestamp: `INFO: ...`, `[WARN] ...`,
 * `2026-07-27T10:40:55Z ERROR ...`.
 *
 * Head position alone is not enough: English sentences begin with these words
 * too (`Trace ID 4711 processed`, `Critical section entered`). A level word
 * counts as a declaration only when it carries field punctuation (`INFO:`,
 * `[WARN]`, `WARN -`) or is written in all caps. Everything else falls through
 * to `detectLevel`, whose answer `resolveLevel` labels `guessed` — or `none`
 * when `detectLevel` finds nothing either.
 */
export function emittedLevel(input: string): LogLevel | null {
  const json = /"level"\s*:\s*(?:"([a-z]+)"|(\d{1,2}))/i.exec(input);
  if (json) {
    if (json[1]) return normalizeLevelWord(json[1]);
    const n = Number(json[2]);
    if (n >= 50) return 'error';
    if (n >= 40) return 'warn';
    if (n >= 30) return 'info';
    return 'debug';
  }

  const rest = stripPrefixNoise(input);
  const token = LEVEL_TOKEN_RE.exec(rest);
  if (!token) return null;

  const level = normalizeLevelWord(token[0]);
  if (!level) return null;

  return isLevelDeclaration(token[0], rest.slice(token[0].length)) ? level : null;
}

/**
 * Keyword guess, used only when the record declares nothing.
 *
 * Deliberately still available, and deliberately labelled: `levelSource`
 * carries whether the answer came from here or from the emitter.
 */
export function detectLevel(input: string): LogLevel {
  const line = input.toLowerCase();
  if (/\berror\b|\bfatal\b|\bpanic\b|\bexception\b/.test(line)) return 'error';
  if (/\bwarn\b|\bwarning\b/.test(line)) return 'warn';
  if (/\bdebug\b|\btrace\b/.test(line)) return 'debug';
  if (/\binfo\b/.test(line)) return 'info';
  return 'unknown';
}

/** The level and where it came from. Prefers what the record declares. */
export function resolveLevel(input: string): { level: LogLevel; levelSource: LogLevelSource } {
  const declared = emittedLevel(input);
  if (declared) return { level: declared, levelSource: 'emitted' };

  const guessed = detectLevel(input);
  return guessed === 'unknown'
    ? { level: 'unknown', levelSource: 'none' }
    : { level: guessed, levelSource: 'guessed' };
}

export function parseLogs({ containerId, containerName, logs }: ParseInput): ParsedLogEntry[] {
  return logs
    .split('\n')
    .map((line) => lintLogLine(line))
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      const match = line.match(TS_PREFIX_RE);
      const timestamp = match?.[1] || null;
      const message = match?.[2] || line;
      return {
        id: `${containerId}-${index}`,
        containerId,
        containerName,
        timestamp,
        ...resolveLevel(message),
        message,
        raw: line,
      };
    });
}

export function sanitizeLogLine(line: string): string {
  return sanitizeWithControlCharFiltering(
    line
      .replace(ANSI_ESCAPE_RE, '')
      .replaceAll(ESC, '')
      .replaceAll(BEL, '')
  );
}

function sanitizeWithControlCharFiltering(line: string): string {
  return stripControlChars(line)
    .replace(REPLACEMENT_CHAR_RE, '')
    .trimStart();
}

export function lintLogLine(line: string): string {
  let cleaned = sanitizeLogLine(line);

  // Handle JSON log envelope: {"log":"...","time":"...","stream":"stdout"}
  if (cleaned.startsWith('{') && cleaned.includes('"time"') && cleaned.includes('"log"')) {
    try {
      const parsed = JSON.parse(cleaned) as { time?: string; log?: string };
      if (parsed.time && parsed.log !== undefined) {
        cleaned = `${parsed.time} ${sanitizeLogLine(parsed.log)}`;
      }
    } catch {
      // Fall through to best-effort text cleanup.
    }
  }

  // Drop any leading junk before the first ISO timestamp.
  const tsIndex = cleaned.search(ISO_TS_RE);
  if (tsIndex > 0) {
    cleaned = cleaned.slice(tsIndex);
  }

  // Normalize excessive whitespace for readability.
  cleaned = cleaned.replace(/[ \t]+/g, ' ').trim();
  return cleaned;
}

export function sortByTimestamp(entries: ParsedLogEntry[]): ParsedLogEntry[] {
  return [...entries].sort((a, b) => {
    const left = a.timestamp ? Date.parse(a.timestamp) : 0;
    const right = b.timestamp ? Date.parse(b.timestamp) : 0;
    return left - right;
  });
}

export function toLocalTimestamp(ts: string | null): string {
  if (!ts) return '-';
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}

/**
 * Build a case-insensitive substring matcher from a user-supplied search
 * pattern.  Returns `null` when the pattern is blank.
 *
 * Uses `String.includes()` instead of `new RegExp()` to avoid
 * Regular Expression Denial-of-Service (ReDoS / CWE-1333).
 */
export function buildSearchMatcher(pattern: string): ((text: string) => boolean) | null {
  const trimmed = pattern.trim();
  if (!trimmed) return null;
  const needle = trimmed.toLowerCase();
  return (text: string) => text.toLowerCase().includes(needle);
}

/**
 * Filter parsed log entries to those whose raw text contains the given trace
 * id (case-insensitive substring match). When `trace` is empty/undefined,
 * returns the input unchanged.
 *
 * Pure helper used by the trace ↔ logs correlation flow in the log viewer.
 */
export function filterLines(
  lines: ParsedLogEntry[],
  opts: { trace?: string },
): ParsedLogEntry[] {
  const trace = opts.trace?.trim();
  if (!trace) return lines;
  const needle = trace.toLowerCase();
  return lines.filter((line) => line.raw.toLowerCase().includes(needle));
}
