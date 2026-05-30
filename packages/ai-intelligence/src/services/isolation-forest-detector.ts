import { getConfig } from '@dashboard/core/config/index.js';
import { createChildLogger } from '@dashboard/core/utils/logger.js';
import { IsolationForest } from './isolation-forest.js';
import type { AnomalyDetection } from '@dashboard/core/models/metrics.js';
import type { Metric } from '@dashboard/contracts';

const log = createChildLogger('isolation-forest-detector');

interface CachedModel {
  forest: IsolationForest;
  trainedAt: number;
}

// In-memory model cache: containerId → cached model
const modelCache = new Map<string, CachedModel>();

const MIN_TRAINING_SAMPLES = 50;

/**
 * Deterministic 32-bit seed from a container id (FNV-1a). Seeding per-container
 * (and NOT per-time-window) makes the trained forest a pure function of the
 * container + its training data: retrains on stable data reproduce the same
 * model, so a point no longer flips anomalous↔normal between retrains (#1361).
 * Mirrors scikit-learn's fixed `random_state` convention.
 */
function seedForContainer(containerId: string): number {
  let h = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < containerId.length; i++) {
    h ^= containerId.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // FNV prime
  }
  return h >>> 0;
}

/** Mulberry32 seeded PRNG (see isolation-forest.test.ts for rationale). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type GetMetricsFn = (
  containerId: string,
  metricType: string,
  from: string,
  to: string,
) => Promise<Metric[]>;

/**
 * @param getMetrics - injected dependency to avoid @dashboard/observability import
 */
export async function getOrTrainModel(
  containerId: string,
  getMetrics: GetMetricsFn,
): Promise<IsolationForest | null> {
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
    mulberry32(seedForContainer(containerId)),
  );
  forest.fit(trainingData);

  modelCache.set(containerId, { forest, trainedAt: now });
  log.info({ containerId, samples: trainingData.length }, 'Isolation Forest model trained');

  return forest;
}

/**
 * @param getMetrics - injected dependency to avoid @dashboard/observability import
 */
export async function detectAnomalyIsolationForest(
  containerId: string,
  containerName: string,
  metricType: string,
  currentValue: number,
  cpuValue: number,
  memoryValue: number,
  getMetrics: GetMetricsFn,
): Promise<AnomalyDetection | null> {
  const forest = await getOrTrainModel(containerId, getMetrics);
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
