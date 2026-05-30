export const STALE_TIMES = {
  /** 2min — dashboard data (matches QueryProvider default) */
  DEFAULT: 2 * 60_000,
  /** 2min — endpoints, backups */
  SHORT: 2 * 60_000,
  /** 5min — security audits */
  MEDIUM: 5 * 60_000,
  /** 5min — images, stacks, models */
  LONG: 5 * 60_000,
} as const;
