import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { insertSpan } from './trace-store.js';
import { queueSpanForExport } from './otel-exporter.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('trace-context');

export interface TraceContext {
  traceId: string;
  spanId: string;
  source: 'http' | 'scheduler';
}

const als = new AsyncLocalStorage<TraceContext>();

/**
 * Get the current trace context from AsyncLocalStorage.
 * Returns undefined if called outside of a traced context.
 */
export function getCurrentTraceContext(): TraceContext | undefined {
  return als.getStore();
}

/**
 * Run a function with a root trace context.
 * Used by the request-tracing plugin (source='http') and scheduler (source='scheduler').
 */
export function runWithTraceContext<T>(
  ctx: { traceId?: string; spanId?: string; source: 'http' | 'scheduler' },
  fn: () => T,
): T {
  const traceContext: TraceContext = {
    traceId: ctx.traceId ?? randomUUID(),
    spanId: ctx.spanId ?? randomUUID(),
    source: ctx.source,
  };
  return als.run(traceContext, fn);
}

/**
 * Wrap an async function to create a child span linked to the current trace.
 * If no trace context exists, the function runs without tracing.
 */
export async function withSpan<T>(
  name: string,
  serviceName: string,
  kind: 'client' | 'server' | 'internal',
  fn: () => Promise<T>,
): Promise<T> {
  const parentCtx = als.getStore();
  if (!parentCtx) {
    // No trace context — run without tracing
    return fn();
  }

  const spanId = randomUUID();
  const parentSpanId = parentCtx.spanId;
  const traceId = parentCtx.traceId;
  const source = parentCtx.source;
  const startMs = Date.now();

  // Create a nested context with the new spanId so that
  // any downstream withSpan() calls become children of this span
  const childCtx: TraceContext = { traceId, spanId, source };

  let status: 'ok' | 'error' = 'ok';
  try {
    return await als.run(childCtx, fn);
  } catch (err) {
    status = 'error';
    throw err;
  } finally {
    const endMs = Date.now();
    const durationMs = endMs - startMs;
    const spanData = {
      id: spanId,
      trace_id: traceId,
      parent_span_id: parentSpanId,
      name,
      kind,
      status,
      start_time: new Date(startMs).toISOString(),
      end_time: new Date(endMs).toISOString(),
      duration_ms: durationMs,
      service_name: serviceName,
      attributes: '{}',
      trace_source: source,
    };
    try {
      insertSpan(spanData);
    } catch (insertErr) {
      log.warn({ err: insertErr, spanId, traceId }, 'Failed to insert child span');
    }
    // Queue for OTLP export if exporter is enabled (no-op when disabled)
    queueSpanForExport(spanData);
  }
}
