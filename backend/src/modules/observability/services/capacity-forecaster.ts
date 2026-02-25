import { getMetricsDb } from '../../../core/db/timescale.js';
import { createChildLogger } from '../../../core/utils/logger.js';

const log = createChildLogger('capacity-forecaster');

// In-memory cache for forecast overview (heavy query)
let forecastCache: { data: CapacityForecast[]; limit: number; timestamp: number } | null = null;
const FORECAST_CACHE_TTL_MS = 120_000; // 2 minutes

/** Reset forecast cache (for testing). */
export function resetForecastCache(): void {
  forecastCache = null;
}

export interface ForecastPoint {
  timestamp: string;
  value: number;
  isProjected: boolean;
}

export interface CapacityForecast {
  containerId: string;
  containerName: string;
  metricType: string;
  currentValue: number;
  trend: 'increasing' | 'decreasing' | 'stable';
  slope: number;
  r_squared: number;
  forecast: ForecastPoint[];
  timeToThreshold: number | null; // hours until threshold is reached, null if stable/decreasing
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Simple linear regression: y = mx + b
 * Returns slope (m), intercept (b), and R² for goodness of fit.
 */
export function linearRegression(
  points: Array<{ x: number; y: number }>,
): { slope: number; intercept: number; rSquared: number } {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.y ?? 0, rSquared: 0 };

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumX2 += p.x * p.x;
    sumY2 += p.y * p.y;
  }

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n, rSquared: 0 };

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  // R² calculation
  const yMean = sumY / n;
  let ssTot = 0, ssRes = 0;
  for (const p of points) {
    const yPred = slope * p.x + intercept;
    ssTot += (p.y - yMean) ** 2;
    ssRes += (p.y - yPred) ** 2;
  }

  const rSquared = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

  return { slope, intercept, rSquared: Math.max(0, rSquared) };
}

/**
 * Look up a container's name from the metrics table.
 */
export async function lookupContainerName(containerId: string): Promise<string> {
  const db = await getMetricsDb();
  const { rows } = await db.query(
    `SELECT container_name FROM metrics WHERE container_id = $1 ORDER BY timestamp DESC LIMIT 1`,
    [containerId],
  );
  return (rows[0]?.container_name as string) ?? '';
}

/**
 * Get recent metric data points for a container.
 */
async function getRecentMetrics(
  containerId: string,
  metricType: string,
  hoursBack: number = 24,
): Promise<Array<{ timestamp: string; value: number }>> {
  const db = await getMetricsDb();
  const { rows } = await db.query(
    `SELECT timestamp, value FROM metrics
     WHERE container_id = $1 AND metric_type = $2
       AND timestamp >= NOW() - $3 * INTERVAL '1 hour'
     ORDER BY timestamp ASC`,
    [containerId, metricType, hoursBack],
  );
  return rows as Array<{ timestamp: string; value: number }>;
}

function buildForecastFromData(
  containerId: string,
  containerName: string,
  metricType: string,
  dataPoints: Array<{ timestamp: string; value: number }>,
  threshold: number = 90,
  hoursForward: number = 24,
): CapacityForecast | null {
  if (dataPoints.length < 5) return null;

  // Convert timestamps to hours offset from first point
  const baseTime = new Date(dataPoints[0].timestamp).getTime();
  const points = dataPoints.map((dp) => ({
    x: (new Date(dp.timestamp).getTime() - baseTime) / (1000 * 60 * 60),
    y: dp.value,
  }));

  const { slope, intercept, rSquared } = linearRegression(points);

  // Determine trend
  const trend: 'increasing' | 'decreasing' | 'stable' =
    Math.abs(slope) < 0.1 ? 'stable' : slope > 0 ? 'increasing' : 'decreasing';

  // Confidence based on R² and sample count
  const confidence: 'high' | 'medium' | 'low' =
    rSquared > 0.7 && dataPoints.length > 20 ? 'high' :
    rSquared > 0.4 && dataPoints.length > 10 ? 'medium' : 'low';

  const currentValue = dataPoints[dataPoints.length - 1].value;
  const lastX = points[points.length - 1].x;

  // Generate forecast points
  const forecast: ForecastPoint[] = [];

  // Include last few actual data points for context
  const contextCount = Math.min(5, dataPoints.length);
  for (let i = dataPoints.length - contextCount; i < dataPoints.length; i++) {
    forecast.push({
      timestamp: dataPoints[i].timestamp,
      value: dataPoints[i].value,
      isProjected: false,
    });
  }

  // Project forward
  const stepHours = hoursForward / 12; // 12 projected points
  for (let h = stepHours; h <= hoursForward; h += stepHours) {
    const projX = lastX + h;
    const projValue = Math.max(0, Math.min(100, slope * projX + intercept));
    const projTime = new Date(
      new Date(dataPoints[dataPoints.length - 1].timestamp).getTime() + h * 60 * 60 * 1000,
    ).toISOString();
    forecast.push({ timestamp: projTime, value: projValue, isProjected: true });
  }

  // Time to threshold (only for increasing metrics approaching a threshold)
  let timeToThreshold: number | null = null;
  if (slope > 0 && currentValue < threshold) {
    const hoursToThreshold = (threshold - currentValue) / slope;
    if (hoursToThreshold > 0 && hoursToThreshold < 168) { // Within 7 days
      timeToThreshold = Math.round(hoursToThreshold);
    }
  }

  return {
    containerId,
    containerName,
    metricType,
    currentValue,
    trend,
    slope,
    r_squared: rSquared,
    forecast,
    timeToThreshold,
    confidence,
  };
}

/**
 * Generate a capacity forecast for a specific container and metric.
 */
export async function generateForecast(
  containerId: string,
  containerName: string,
  metricType: string,
  threshold: number = 90,
  hoursBack: number = 24,
  hoursForward: number = 24,
): Promise<CapacityForecast | null> {
  const dataPoints = await getRecentMetrics(containerId, metricType, hoursBack);
  return buildForecastFromData(
    containerId,
    containerName,
    metricType,
    dataPoints,
    threshold,
    hoursForward,
  );
}

/**
 * Get top containers with concerning capacity trends.
 * Results are cached for 2 minutes to avoid repeated heavy queries.
 */
export async function getCapacityForecasts(
  limit: number = 10,
): Promise<CapacityForecast[]> {
  const now = Date.now();
  if (forecastCache && forecastCache.limit >= limit && (now - forecastCache.timestamp) < FORECAST_CACHE_TTL_MS) {
    return forecastCache.data.slice(0, limit);
  }

  const db = await getMetricsDb();
  const hoursBack = 6;
  const maxPointsPerSeries = 180;

  // Get containers that have at least 5 data points per metric type
  const { rows: containers } = await db.query(
    `SELECT container_id, container_name
     FROM metrics
     WHERE timestamp >= NOW() - $1 * INTERVAL '1 hour'
       AND metric_type IN ('cpu', 'memory')
     GROUP BY container_id, container_name
     HAVING COUNT(*) >= 5
     ORDER BY container_name ASC
     LIMIT $2`,
    [hoursBack, limit * 2],
  );

  if (containers.length === 0) {
    return [];
  }

  const typedContainers = containers as Array<{ container_id: string; container_name: string }>;
  const containerNameById = new Map(
    typedContainers.map((c) => [c.container_id, c.container_name]),
  );
  const containerIds = typedContainers.map((c) => c.container_id);

  const { rows: recentMetrics } = await db.query(
    `SELECT container_id, metric_type, timestamp, value
     FROM metrics
     WHERE metric_type IN ('cpu', 'memory')
       AND timestamp >= NOW() - $1 * INTERVAL '1 hour'
       AND container_id = ANY($2)
     ORDER BY container_id ASC, metric_type ASC, timestamp ASC`,
    [hoursBack, containerIds],
  );

  const metricsBySeries = new Map<string, Array<{ timestamp: string; value: number }>>();
  for (const row of recentMetrics as Array<{
    container_id: string;
    metric_type: string;
    timestamp: string;
    value: number;
  }>) {
    const key = `${row.container_id}:${row.metric_type}`;
    const series = metricsBySeries.get(key) ?? [];
    series.push({ timestamp: row.timestamp, value: row.value });
    metricsBySeries.set(key, series);
  }

  const forecasts: CapacityForecast[] = [];

  for (const container of typedContainers) {
    for (const metricType of ['cpu', 'memory']) {
      const seriesKey = `${container.container_id}:${metricType}`;
      const series = metricsBySeries.get(seriesKey) ?? [];
      const sampledSeries = series.length <= maxPointsPerSeries
        ? series
        : series.filter((_, index) => index % Math.ceil(series.length / maxPointsPerSeries) === 0);
      const forecast = buildForecastFromData(
        container.container_id,
        containerNameById.get(container.container_id) ?? container.container_name,
        metricType,
        sampledSeries,
      );
      if (forecast) {
        forecasts.push(forecast);
      }
    }
  }

  // Sort: increasing trends first, then by time to threshold
  const sorted = forecasts
    .sort((a, b) => {
      if (a.trend === 'increasing' && b.trend !== 'increasing') return -1;
      if (a.trend !== 'increasing' && b.trend === 'increasing') return 1;
      if (a.timeToThreshold && b.timeToThreshold) return a.timeToThreshold - b.timeToThreshold;
      if (a.timeToThreshold) return -1;
      if (b.timeToThreshold) return 1;
      return 0;
    });

  forecastCache = { data: sorted, limit, timestamp: now };
  return sorted.slice(0, limit);
}

// Suppress unused variable warning for log
void log;
