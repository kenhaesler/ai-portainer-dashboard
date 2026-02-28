import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return 'N/A';

  // Handle SQLite datetime format (YYYY-MM-DD HH:MM:SS) by replacing space with 'T'
  const dateStr = typeof date === 'string' ? date.replace(' ', 'T') : date;
  const dateObj = new Date(dateStr);

  // Check if date is valid
  if (isNaN(dateObj.getTime())) return 'Invalid date';

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(dateObj);
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

/**
 * Format a Unix timestamp (seconds) as a compact relative age string.
 */
export function formatRelativeAge(timestampSeconds: number): string {
  const diff = Date.now() - timestampSeconds * 1000;
  if (diff < 0) return 'Future';

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m`;
  return '< 1m';
}

export function truncate(str: string, length: number): string {
  return str.length > length ? `${str.slice(0, length)}...` : str;
}

/**
 * Escape special regex characters in a string so it can be safely used
 * inside `new RegExp()` without risk of ReDoS (CWE-1333).
 *
 * All characters that have special meaning in a regular expression are
 * prefixed with a backslash, turning the input into a literal match.
 */
export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
