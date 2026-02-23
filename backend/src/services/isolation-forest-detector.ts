import { getConfig } from '../core/config/index.js';
import { createChildLogger } from '../core/utils/logger.js';
import { getMetrics } from './metrics-store.js';
import { IsolationForest } from './isolation-forest.js';
import type { AnomalyDetection } from '../core/models/metrics.js';

const log = createChildLogger('isolation-forest-detector');

interface CachedModel {
  forest: IsolationForest;
  trainedAt: number;
}

// In-memory model cache: containerId → cached model
const modelCache = new Map<string, CachedModel>();

const MIN_TRAINING_SAMPLES = 50;

export async function getOrTrainModel(containerId: string): Promise<IsolationForest | null> {
  const config = getConfig();
  const now = Date.now();
  const retrainIntervalMs = config.ISOLATION_FOREST_RETRAIN_HOURS * 60 * 60 * 1000;

  // Check cache
  const cached = modelCache.get(containerId);
  if (cached && now - cached.trainedAt < retrainIntervalMs) {
    return cached.forest;
  }

  // Query 7 days of metrics for training
  const to = new Date().toISOString();
  const from = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

  const cpuMetrics = await getMetrics(containerId, 'cpu', from, to);
  const memoryMetrics = await getMetrics(containerId, 'memory', from, to);

  if (cpuMetrics.length < MIN_TRAINING_SAMPLES || memoryMetrics.length < MIN_TRAINING_SAMPLES) {
    log.debug(
      { containerId, cpuSamples: cpuMetrics.length, memorySamples: memoryMetrics.length },
      'Insufficient data for Isolation Forest training',
    );
    return null;
  }

  // Build training data: zip cpu + memory into [cpu, memory][] pairs by matching timestamps
  // Use index-based pairing since metrics are collected together
  const pairCount = Math.min(cpuMetrics.length, memoryMetrics.length);
  const trainingData: number[][] = [];
  for (let i = 0; i < pairCount; i++) {
    trainingData.push([cpuMetrics[i].value, memoryMetrics[i].value]);
  }

  if (trainingData.length < MIN_TRAINING_SAMPLES) {
    return null;
  }

  const forest = new IsolationForest(
    config.ISOLATION_FOREST_TREES,
    config.ISOLATION_FOREST_SAMPLE_SIZE,
    config.ISOLATION_FOREST_CONTAMINATION,
  );
  forest.fit(trainingData);

  modelCache.set(containerId, { forest, trainedAt: now });
  log.info({ containerId, samples: trainingData.length }, 'Isolation Forest model trained');

  return forest;
}

export async function detectAnomalyIsolationForest(
  containerId: string,
  containerName: string,
  metricType: string,
  currentValue: number,
  cpuValue: number,
  memoryValue: number,
): Promise<AnomalyDetection | null> {
  const forest = await getOrTrainModel(containerId);
  if (!forest) return null;

  const score = forest.anomalyScore([cpuValue, memoryValue]);
  const isAnomalous = forest.predict([cpuValue, memoryValue]);

  return {
    container_id: containerId,
    container_name: containerName,
    metric_type: metricType,
    current_value: currentValue,
    mean: 0, // N/A for Isolation Forest
    std_dev: 0, // N/A for Isolation Forest
    z_score: Math.round(score * 100) / 100, // Re-purpose z_score field for anomaly score
    is_anomalous: isAnomalous,
    threshold: score,
    timestamp: new Date().toISOString(),
    method: 'isolation-forest',
  };
}

/** Clear the model cache (useful for testing). */
export function clearModelCache(): void {
  modelCache.clear();
}
