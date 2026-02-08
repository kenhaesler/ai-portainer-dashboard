export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'unknown';

export interface ParsedLogEntry {
  id: string;
  containerId: string;
  containerName: string;
  timestamp: string | null;
  level: LogLevel;
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

export function detectLevel(input: string): LogLevel {
  const line = input.toLowerCase();
  if (/\berror\b|\bfatal\b|\bpanic\b|\bexception\b/.test(line)) return 'error';
  if (/\bwarn\b|\bwarning\b/.test(line)) return 'warn';
  if (/\bdebug\b|\btrace\b/.test(line)) return 'debug';
  if (/\binfo\b/.test(line)) return 'info';
  return 'unknown';
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
        level: detectLevel(message),
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

export function buildRegex(pattern: string): RegExp | null {
  if (!pattern.trim()) return null;
  try {
    return new RegExp(pattern, 'gi');
  } catch {
    return null;
  }
}
