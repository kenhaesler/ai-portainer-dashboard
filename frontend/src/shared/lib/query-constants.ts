export const STALE_TIMES = {
  /** 30s — dashboard data (matches QueryProvider default) */
  DEFAULT: 30_000,
  /** 1min — endpoints, backups */
  SHORT: 60_000,
  /** 2min — security audits */
  MEDIUM: 120_000,
  /** 5min — images, stacks, models */
  LONG: 300_000,
} as const;
