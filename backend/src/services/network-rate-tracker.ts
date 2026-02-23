/**
 * In-memory network rate tracker — computes byte rates from consecutive
 * Docker stats samples collected by the scheduler.
 *
 * This provides network rates without requiring TimescaleDB.  The scheduler
 * calls `recordNetworkSample()` every collection cycle (default 60 s).
 * After two samples, `getRatesForEndpoint()` returns computed rates.
 */
import { createChildLogger } from '../core/utils/logger.js';

const log = createChildLogger('network-rate-tracker');

interface Sample {
  rxBytes: number;
  txBytes: number;
  timestamp: number; // epoch ms
}

export interface LiveNetworkRate {
  rxBytesPerSec: number;
  txBytesPerSec: number;
}

// endpointId → containerId → { current, previous }
const store = new Map<number, Map<string, { current: Sample; previous?: Sample }>>();

/** Record a network byte sample for a container (called by the scheduler). */
export function recordNetworkSample(
  endpointId: number,
  containerId: string,
  rxBytes: number,
  txBytes: number,
): void {
  let endpointMap = store.get(endpointId);
  if (!endpointMap) {
    endpointMap = new Map();
    store.set(endpointId, endpointMap);
  }

  const existing = endpointMap.get(containerId);
  endpointMap.set(containerId, {
    current: { rxBytes, txBytes, timestamp: Date.now() },
    previous: existing?.current,
  });
}

/** Compute rate for a single container from stored samples. */
function computeRate(entry: { current: Sample; previous?: Sample }): LiveNetworkRate {
  if (!entry.previous) {
    return { rxBytesPerSec: 0, txBytesPerSec: 0 };
  }

  const elapsedSec = (entry.current.timestamp - entry.previous.timestamp) / 1000;
  if (elapsedSec <= 0) {
    return { rxBytesPerSec: 0, txBytesPerSec: 0 };
  }

  // Cumulative counters may reset on container restart → clamp to 0
  const rxDelta = Math.max(0, entry.current.rxBytes - entry.previous.rxBytes);
  const txDelta = Math.max(0, entry.current.txBytes - entry.previous.txBytes);

  return {
    rxBytesPerSec: rxDelta / elapsedSec,
    txBytesPerSec: txDelta / elapsedSec,
  };
}

/** Get live rates for all containers on an endpoint. */
export function getRatesForEndpoint(endpointId: number): Record<string, LiveNetworkRate> {
  const endpointMap = store.get(endpointId);
  if (!endpointMap) return {};

  const rates: Record<string, LiveNetworkRate> = {};
  for (const [containerId, entry] of endpointMap) {
    rates[containerId] = computeRate(entry);
  }
  return rates;
}

/** Get live rates for all containers across all endpoints. */
export function getAllRates(): Record<string, LiveNetworkRate> {
  const rates: Record<string, LiveNetworkRate> = {};
  for (const endpointMap of store.values()) {
    for (const [containerId, entry] of endpointMap) {
      rates[containerId] = computeRate(entry);
    }
  }
  return rates;
}

/** Clear all stored samples (for testing). */
export function _resetTracker(): void {
  store.clear();
  log.debug('Network rate tracker reset');
}
