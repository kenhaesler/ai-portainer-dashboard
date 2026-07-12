/**
 * In-memory span buffer (#1503).
 *
 * Every API request and every withSpan()-wrapped operation used to issue an
 * awaited single-row INSERT into the heavily indexed `spans` table. This
 * buffer batches those writes: spans are appended synchronously and flushed
 * to PostgreSQL via a single multi-row INSERT (insertSpans) either when the
 * buffer reaches SPAN_BUFFER_MAX_SPANS or after SPAN_BUFFER_FLUSH_INTERVAL_MS,
 * whichever comes first.
 *
 * The eBPF ingest path (traces-ingest.ts) does NOT go through this buffer —
 * it keeps calling insertSpans() directly so its awaited accepted-count
 * semantics are preserved.
 *
 * On flush failure the batch is dropped (logged + counted) — tracing is
 * best-effort telemetry and must never crash or back-pressure the app.
 */
import { insertSpans, type SpanInsert } from './trace-store.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('span-buffer');

// Batching bounds — deliberately constants, not env vars: 50 spans keeps a
// worst-case flush well under the metrics-store batch sizes PostgreSQL already
// absorbs, and 2 s bounds how stale the Trace Explorer can be on a quiet box.
export const SPAN_BUFFER_MAX_SPANS = 50;
export const SPAN_BUFFER_FLUSH_INTERVAL_MS = 2_000;

let buffer: SpanInsert[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let droppedSpans = 0;
let isShutdown = false;

/**
 * Append a span to the buffer (synchronous, never throws on the hot path).
 * Triggers an immediate background flush when the buffer is full, otherwise
 * arms the interval timer so idle periods still flush within 2 s.
 */
export function enqueueSpan(span: SpanInsert): void {
  if (isShutdown) {
    // Process is shutting down and the final flush already ran — drop.
    droppedSpans++;
    return;
  }

  // Buffered spans always carry an explicit trace_source so insertSpans'
  // 'ebpf' default (reserved for the OTLP ingest path) never applies.
  buffer.push({ ...span, trace_source: span.trace_source ?? 'http' });

  if (buffer.length >= SPAN_BUFFER_MAX_SPANS) {
    void flushSpanBuffer();
    return;
  }

  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushSpanBuffer();
    }, SPAN_BUFFER_FLUSH_INTERVAL_MS);
    // A pending flush must not keep the process alive
    flushTimer.unref?.();
  }
}

/**
 * Flush all buffered spans in one multi-row INSERT.
 * A failed flush drops the batch (log + counter) instead of retrying —
 * retrying a poisoned batch would wedge the buffer.
 */
export async function flushSpanBuffer(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (buffer.length === 0) return;

  const batch = buffer;
  buffer = [];

  try {
    await insertSpans(batch);
  } catch (err) {
    droppedSpans += batch.length;
    log.warn(
      { err, droppedBatch: batch.length, droppedTotal: droppedSpans },
      'Failed to flush span batch — spans dropped',
    );
  }
}

/**
 * Final flush for graceful shutdown (wired in packages/server/src/index.ts).
 * Spans enqueued after this call are dropped and counted.
 */
export async function shutdownSpanBuffer(): Promise<void> {
  isShutdown = true;
  await flushSpanBuffer();
}

/** Buffer occupancy and drop counter — used by tests and diagnostics. */
export function getSpanBufferStats(): { buffered: number; dropped: number } {
  return { buffered: buffer.length, dropped: droppedSpans };
}

/** Test-only hook — resets module state so each test starts clean. */
export function __resetSpanBufferForTests(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  buffer = [];
  droppedSpans = 0;
  isShutdown = false;
}
