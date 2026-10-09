/**
 * Invariant #7 — a number and its qualifier render together, or neither renders.
 *
 * A statistic the system could not compute (no samples in the window, an empty
 * percentile set, a missing Docker field) arrives as `null`. It must reach the
 * screen as a gap, never as a confident `0` / `0%` / `0 ms`. These are the one
 * shared spelling of that gap so pages do not each grow their own.
 */
export const NO_VALUE = '—';

/** Short qualifier rendered beside a `NO_VALUE` figure. */
export const NO_SAMPLES_QUALIFIER = 'no samples in range';

/**
 * Format a possibly-unknown figure: `NO_VALUE` for null/undefined/NaN, otherwise
 * whatever `format` makes of the real number (including a real 0).
 */
export function formatOrNoValue(
  value: number | null | undefined,
  format: (n: number) => string,
): string {
  return typeof value === 'number' && Number.isFinite(value) ? format(value) : NO_VALUE;
}
