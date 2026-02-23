// Shim — re-exports from core/db (will be removed in Phase H)
export {
  getMetricsDb,
  getReportsDb,
  closeMetricsDb,
  closeReportsDb,
  isMetricsDbReady,
  isMetricsDbHealthy,
} from '../core/db/timescale.js';
