export type RelativeTimeUnit = 'second' | 'minute' | 'hour' | 'day' | 'week' | 'year';

export interface RelativeTimeOptions {
  /** Reference "now". Defaults to the current time. */
  now?: Date;
  /** Deltas below this many seconds render as {@link justNowLabel}. Default 30. Use 0 to always show a unit. */
  nowThresholdSeconds?: number;
  /** Label for very-recent deltas. Default 'just now'. */
  justNowLabel?: string;
  /** Render sub-minute deltas as `${n}s ago` instead of rounding up to minutes. Default false. */
  showSeconds?: boolean;
  /** Largest unit to grow into; the value then stays in that unit (e.g. 'day' caps at `${n}d ago`). Default 'year'. */
  maxUnit?: RelativeTimeUnit;
  /** Once the delta reaches this many days, render a locale date instead of a relative string. */
  dateAfterDays?: number;
  /** Value returned for invalid input. Default ''. */
  invalidLabel?: string;
}

const UNIT_RANK: Record<RelativeTimeUnit, number> = {
  second: 0,
  minute: 1,
  hour: 2,
  day: 3,
  week: 4,
  year: 5,
};

/**
 * Format a timestamp as a relative string ("5m ago", "2d ago", …).
 *
 * The default behaviour ("just now" under 30s, growing through minutes/hours/days/weeks/years)
 * is shared across the app. The options let individual call sites tune their thresholds and unit
 * caps without re-implementing the bucketing logic — see the per-site wrappers in the freshness
 * widgets, status page, fleet overview, command palette, and settings tabs.
 *
 * @param value The timestamp: ISO string, epoch millis, or Date.
 * @param optionsOrNow Options, or (back-compat) a Date used as "now".
 */
export function formatRelativeTime(
  value: string | number | Date,
  optionsOrNow: Date | RelativeTimeOptions = {},
): string {
  // Back-compat: the second argument used to be `now: Date`.
  const options: RelativeTimeOptions =
    optionsOrNow instanceof Date ? { now: optionsOrNow } : optionsOrNow;
  const {
    now = new Date(),
    nowThresholdSeconds = 30,
    justNowLabel = 'just now',
    showSeconds = false,
    maxUnit = 'year',
    dateAfterDays,
    invalidLabel = '',
  } = options;

  const then = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(then.getTime())) return invalidLabel;

  const seconds = Math.max(0, Math.floor((now.getTime() - then.getTime()) / 1000));
  if (seconds < nowThresholdSeconds) return justNowLabel;

  const days = Math.floor(seconds / 86_400);
  if (dateAfterDays !== undefined && days >= dateAfterDays) {
    return then.toLocaleDateString();
  }

  // True once `maxUnit` is the current bucket (or smaller), meaning we stop growing here.
  const capAt = (unit: RelativeTimeUnit) => UNIT_RANK[maxUnit] <= UNIT_RANK[unit];

  if (showSeconds && seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60 || capAt('minute')) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24 || capAt('hour')) return `${hours}h ago`;
  if (days < 7 || capAt('day')) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 52 || capAt('week')) return `${weeks}w ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}
