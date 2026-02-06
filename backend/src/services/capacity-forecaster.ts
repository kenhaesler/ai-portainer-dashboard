import { getDb } from '../db/sqlite.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('capacity-forecaster');

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
 * Get recent metric data points for a container.
 */
function getRecentMetrics(
  containerId: string,
  metricType: string,
  hoursBack: number = 24,
): Array<{ timestamp: string; value: number }> {
  const db = getDb();
  return db.prepare(`
    SELECT timestamp, value FROM metrics
    WHERE container_id = ? AND metric_type = ?
      AND timestamp >= datetime('now', ? || ' hours')
    ORDER BY timestamp ASC
  `).all(containerId, metricType, `-${hoursBack}`) as Array<{ timestamp: string; value: number }>;
}

/**
 * Generate a capacity forecast for a specific container and metric.
 */
export function generateForecast(
  containerId: string,
  containerName: string,
  metricType: string,
  threshold: number = 90,
  hoursBack: number = 24,
  hoursForward: number = 24,
): CapacityForecast | null {
  const dataPoints = getRecentMetrics(containerId, metricType, hoursBack);

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
 * Get top containers with concerning capacity trends.
 */
export function getCapacityForecasts(
  limit: number = 10,
): CapacityForecast[] {
  const db = getDb();

  // Get unique container IDs with recent metrics
  const containers = db.prepare(`
    SELECT DISTINCT container_id, container_name
    FROM metrics
    WHERE timestamp >= datetime('now', '-24 hours')
    GROUP BY container_id
    HAVING COUNT(*) >= 5
    ORDER BY container_name ASC
    LIMIT ?
  `).all(limit * 2) as Array<{ container_id: string; container_name: string }>;

  const forecasts: CapacityForecast[] = [];

  for (const container of containers) {
    for (const metricType of ['cpu', 'memory']) {
      const forecast = generateForecast(
        container.container_id,
        container.container_name,
        metricType,
      );
      if (forecast) {
        forecasts.push(forecast);
      }
    }
  }

  // Sort: increasing trends first, then by time to threshold
  return forecasts
    .sort((a, b) => {
      if (a.trend === 'increasing' && b.trend !== 'increasing') return -1;
      if (a.trend !== 'increasing' && b.trend === 'increasing') return 1;
      if (a.timeToThreshold && b.timeToThreshold) return a.timeToThreshold - b.timeToThreshold;
      if (a.timeToThreshold) return -1;
      if (b.timeToThreshold) return 1;
      return 0;
    })
    .slice(0, limit);
}
