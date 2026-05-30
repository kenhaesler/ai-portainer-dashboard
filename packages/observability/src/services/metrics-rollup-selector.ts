/**
 * Auto-selects the best rollup table based on the requested time range.
 * Shorter ranges use higher-resolution data; longer ranges use pre-aggregated data.
 */

export interface RollupSelection {
  table: string;
  timestampCol: string;
  valueCol: string;
  isRollup: boolean;
}

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export function selectRollupTable(from: Date, to: Date): RollupSelection {
  const rangeMs = to.getTime() - from.getTime();

  if (rangeMs <= SIX_HOURS_MS) {
    return { table: 'metrics', timestampCol: 'timestamp', valueCol: 'value', isRollup: false };
  }

  if (rangeMs <= SEVEN_DAYS_MS) {
    return { table: 'metrics_5min', timestampCol: 'bucket', valueCol: 'avg_value', isRollup: true };
  }

  if (rangeMs <= NINETY_DAYS_MS) {
    return { table: 'metrics_1hour', timestampCol: 'bucket', valueCol: 'avg_value', isRollup: true };
  }

  return { table: 'metrics_1day', timestampCol: 'bucket', valueCol: 'avg_value', isRollup: true };
}
