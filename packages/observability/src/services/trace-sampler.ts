/**
 * Ingest-side sampler for the `spans` table.
 *
 * Two stages, both pure-CPU (no DB round-trip on the hot path):
 *
 *   1. Head sampling — deterministic on `trace_id`. We hash the last 4 hex
 *      chars (16 bits) and accept iff `hash / 0xFFFF < sampleRate`. The
 *      determinism means all spans of a trace travel together; either the
 *      whole trace is kept or none of it is.
 *
 *   2. Per-source token bucket — keyed by `service_namespace || service_name`.
 *      Refills at `maxSpansPerSec` tokens/sec, capped at `maxSpansPerSec`
 *      tokens. When a noisy source empties its bucket it's locally rate-limited;
 *      quiet sources are unaffected.
 *
 * Both stages default to no-op (`sampleRate=1.0`, `maxSpansPerSec=0`).
 */
import { createChildLogger } from '@dashboard/core/utils/logger.js';

const log = createChildLogger('trace-sampler');

export interface SamplerConfig {
  /** 0..1. 1 = accept all, 0 = reject all. */
  sampleRate: number;
  /** Token-bucket refill rate per source. 0 = unbounded. */
  maxSpansPerSec: number;
}

export interface SpanForSampler {
  trace_id: string;
  service_name?: string | null;
  service_namespace?: string | null;
}

export interface SamplerStats {
  acceptedTotal: number;
  droppedTotal: number;
  perSource: Array<{
    source: string;
    accepted: number;
    dropped: number;
  }>;
}

export interface Sampler {
  shouldAccept(span: SpanForSampler): boolean;
  getStats(): SamplerStats;
}

interface PerSourceState {
  tokens: number;
  lastRefill: number;
  accepted: number;
  dropped: number;
  lastWarnedAt: number;
}

const WARN_INTERVAL_MS = 60_000;

function sourceKey(span: SpanForSampler): string {
  return span.service_namespace || span.service_name || 'unknown';
}

function headSample(traceId: string, sampleRate: number): boolean {
  if (sampleRate >= 1) return true;
  if (sampleRate <= 0) return false;
  // 16-bit hash from the trailing nibbles — deterministic across spans of a
  // trace. The 0xFFFF denominator caps the ratio at exactly 1.
  const tail = traceId.slice(-4) || '0';
  const hash = parseInt(tail, 16);
  if (Number.isNaN(hash)) return false;
  return hash / 0xffff < sampleRate;
}

export function createSampler(cfg: SamplerConfig): Sampler {
  let acceptedTotal = 0;
  let droppedTotal = 0;
  const sources = new Map<string, PerSourceState>();

  function getSource(key: string, now: number): PerSourceState {
    let s = sources.get(key);
    if (!s) {
      s = {
        tokens: cfg.maxSpansPerSec > 0 ? cfg.maxSpansPerSec : 0,
        lastRefill: now,
        accepted: 0,
        dropped: 0,
        lastWarnedAt: 0,
      };
      sources.set(key, s);
    }
    return s;
  }

  function refill(src: PerSourceState, now: number) {
    if (cfg.maxSpansPerSec <= 0) return;
    const elapsedSec = (now - src.lastRefill) / 1000;
    src.tokens = Math.min(cfg.maxSpansPerSec, src.tokens + elapsedSec * cfg.maxSpansPerSec);
    src.lastRefill = now;
  }

  return {
    shouldAccept(span) {
      const key = sourceKey(span);
      const now = Date.now();
      const src = getSource(key, now);

      // Stage 1 — head sample.
      if (!headSample(span.trace_id, cfg.sampleRate)) {
        src.dropped += 1;
        droppedTotal += 1;
        maybeWarn(src, key, now, cfg);
        return false;
      }

      // Stage 2 — token bucket.
      if (cfg.maxSpansPerSec > 0) {
        refill(src, now);
        if (src.tokens < 1) {
          src.dropped += 1;
          droppedTotal += 1;
          maybeWarn(src, key, now, cfg);
          return false;
        }
        src.tokens -= 1;
      }

      src.accepted += 1;
      acceptedTotal += 1;
      return true;
    },

    getStats() {
      return {
        acceptedTotal,
        droppedTotal,
        perSource: Array.from(sources.entries()).map(([source, v]) => ({
          source,
          accepted: v.accepted,
          dropped: v.dropped,
        })),
      };
    },
  };
}

function maybeWarn(src: PerSourceState, key: string, now: number, cfg: SamplerConfig) {
  if (now - src.lastWarnedAt < WARN_INTERVAL_MS) return;
  src.lastWarnedAt = now;
  log.warn(
    {
      source: key,
      droppedCumulative: src.dropped,
      sampleRate: cfg.sampleRate,
      maxSpansPerSec: cfg.maxSpansPerSec,
    },
    'trace ingest sampler dropped spans',
  );
}
