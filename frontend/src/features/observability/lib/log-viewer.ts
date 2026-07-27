export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'unknown';

/**
 * How a line's level was established.
 *
 * `emitted` — the record stated its own level (a pino/bunyan `level` field, or
 * a `LEVEL:`-style prefix). Trustworthy.
 * `guessed` — inferred from keywords anywhere in the line. This is a grep
 * result and it is wrong often: the visible line `module: "trace-store"` was
 * labelled DEBUG because it contains the word "trace", `no errors found` was
 * labelled ERROR, and `warning: none` was labelled WARN. The level column is
 * the operator's primary triage signal, so a guess must be distinguishable
 * from a fact rather than sharing its treatment.
 * `none` — nothing to go on.
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
 * The level the record states about itself, or null if it states none.
 *
 * Covers pino/bunyan JSON (`"level":30` or `"level":"info"`) and the common
 * `LEVEL: message` / `[LEVEL]` prefixes. Anything found here is a fact from
 * the emitter, not an inference about the text.
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

  // A level prefix at the head of the line: "INFO: ...", "[WARN] ...",
  // "10:40:55 ERROR ...". Anchored near the start so a level word buried in
  // prose cannot masquerade as a declaration.
  const prefix = /^[^A-Za-z]{0,32}\[?([A-Za-z]{3,11})\]?\s*[:|-]?\s/.exec(input);
  if (prefix) return normalizeLevelWord(prefix[1]);

  return null;
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
