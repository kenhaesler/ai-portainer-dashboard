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
const ANSI_ESCAPE_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\u0007]*\u0007)/g;
const CONTROL_CHAR_RE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;
const REPLACEMENT_CHAR_RE = /\uFFFD+/g;

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
    .map((line) => sanitizeLogLine(line))
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
  return line
    .replace(ANSI_ESCAPE_RE, '')
    .replace(CONTROL_CHAR_RE, '')
    .replace(REPLACEMENT_CHAR_RE, '')
    .trimStart();
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
