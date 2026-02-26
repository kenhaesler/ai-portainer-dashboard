import { createChildLogger } from '../utils/logger.js';
import type { SpanInsert } from './trace-store.js';

const log = createChildLogger('otel-exporter');

/** OTLP/HTTP JSON span representation (subset of OTel proto) */
interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  status: { code: number; message?: string };
  attributes: Array<{ key: string; value: { stringValue: string } }>;
}

export interface OtelExporterConfig {
  endpoint: string;
  headers?: Record<string, string>;
  batchSize: number;
  flushIntervalMs: number;
}

const SPAN_KIND_MAP: Record<string, number> = {
  internal: 1,
  server: 2,
  client: 3,
};

const STATUS_CODE_MAP: Record<string, number> = {
  unset: 0,
  ok: 1,
  error: 2,
};

const MAX_BUFFER_SIZE = 1000;
const MAX_RETRY_ATTEMPTS = 3;
const INITIAL_RETRY_DELAY_MS = 1000;

function isoToUnixNano(iso: string): string {
  const ms = new Date(iso).getTime();
  // Convert milliseconds to nanoseconds as a string to avoid precision loss
  return `${ms}000000`;
}

function spanInsertToOtlp(span: SpanInsert): OtlpSpan {
  const attributes: Array<{ key: string; value: { stringValue: string } }> = [];

  if (span.trace_source) {
    attributes.push({ key: 'trace.source', value: { stringValue: span.trace_source } });
  }

  // Parse stored JSON attributes
  try {
    const parsed = JSON.parse(span.attributes) as Record<string, string>;
    for (const [key, val] of Object.entries(parsed)) {
      attributes.push({ key, value: { stringValue: String(val) } });
    }
  } catch {
    // Ignore malformed attributes
  }

  return {
    traceId: span.trace_id.replace(/-/g, ''),
    spanId: span.id.replace(/-/g, '').slice(0, 16),
    parentSpanId: span.parent_span_id
      ? span.parent_span_id.replace(/-/g, '').slice(0, 16)
      : undefined,
    name: span.name,
    kind: SPAN_KIND_MAP[span.kind] ?? 1,
    startTimeUnixNano: isoToUnixNano(span.start_time),
    endTimeUnixNano: span.end_time ? isoToUnixNano(span.end_time) : isoToUnixNano(span.start_time),
    status: {
      code: STATUS_CODE_MAP[span.status] ?? 0,
    },
    attributes,
  };
}

function buildOtlpPayload(
  spans: OtlpSpan[],
  serviceName: string,
): Record<string, unknown> {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: serviceName } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: 'ai-portainer-dashboard' },
            spans,
          },
        ],
      },
    ],
  };
}

export class OtelSpanExporter {
  private buffer: SpanInsert[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private readonly config: OtelExporterConfig;
  private shuttingDown = false;

  constructor(config: OtelExporterConfig) {
    this.config = config;
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, config.flushIntervalMs);

    log.info(
      { endpoint: config.endpoint, batchSize: config.batchSize, flushIntervalMs: config.flushIntervalMs },
      'OTEL span exporter initialized',
    );
  }

  /** Add a span to the export buffer. Triggers flush if batch size reached. */
  queueSpan(span: SpanInsert): void {
    if (this.shuttingDown) {
      log.warn('Exporter is shutting down, span dropped');
      return;
    }

    if (this.buffer.length >= MAX_BUFFER_SIZE) {
      log.warn(
        { bufferSize: this.buffer.length, maxSize: MAX_BUFFER_SIZE },
        'Buffer full, dropping oldest span',
      );
      this.buffer.shift();
    }

    this.buffer.push(span);

    if (this.buffer.length >= this.config.batchSize) {
      void this.flush();
    }
  }

  /** Flush the current buffer to the OTLP endpoint. */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    // Take current buffer and reset it immediately so new spans queue separately
    const batch = this.buffer.splice(0, this.config.batchSize);

    // Group spans by service name for proper OTLP payload structure
    const byService = new Map<string, OtlpSpan[]>();
    for (const span of batch) {
      const otlp = spanInsertToOtlp(span);
      const existing = byService.get(span.service_name) ?? [];
      existing.push(otlp);
      byService.set(span.service_name, existing);
    }

    // Send one request per service (usually just 1 for this dashboard)
    for (const [serviceName, spans] of byService) {
      const payload = buildOtlpPayload(spans, serviceName);
      await this.sendWithRetry(payload, spans.length);
    }
  }

  /** Gracefully shut down: flush remaining spans and stop the interval timer. */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Flush any remaining spans
    await this.flush();

    log.info('OTEL span exporter shut down');
  }

  /** Get current buffer size (useful for monitoring/testing). */
  get bufferSize(): number {
    return this.buffer.length;
  }

  private async sendWithRetry(payload: Record<string, unknown>, spanCount: number): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          ...this.config.headers,
        };

        const response = await fetch(this.config.endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });

        if (response.ok) {
          log.debug({ spanCount, attempt: attempt + 1 }, 'Batch exported successfully');
          return;
        }

        // Non-retryable client errors (4xx except 429)
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          const body = await response.text().catch(() => '');
          log.warn(
            { status: response.status, body, spanCount },
            'Non-retryable error from collector, dropping batch',
          );
          return;
        }

        lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }

      // Exponential backoff: 1s, 2s, 4s
      if (attempt < MAX_RETRY_ATTEMPTS - 1) {
        const delayMs = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
        log.debug({ attempt: attempt + 1, delayMs }, 'Retrying batch export');
        await sleep(delayMs);
      }
    }

    // All retries exhausted
    log.warn(
      { err: lastError, spanCount, attempts: MAX_RETRY_ATTEMPTS },
      'Failed to export batch after retries, dropping spans',
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- Singleton management ----

let exporter: OtelSpanExporter | null = null;

/**
 * Initialize the global OTEL exporter from config.
 * Called once during app startup if OTEL_EXPORTER_ENABLED is true.
 */
export function initOtelExporter(config: OtelExporterConfig): OtelSpanExporter {
  if (exporter) {
    log.warn('OTEL exporter already initialized, returning existing instance');
    return exporter;
  }
  exporter = new OtelSpanExporter(config);
  return exporter;
}

/**
 * Queue a span for export if the exporter is enabled.
 * Safe to call even when the exporter is disabled (no-op).
 */
export function queueSpanForExport(span: SpanInsert): void {
  if (!exporter) return;
  exporter.queueSpan(span);
}

/**
 * Gracefully shut down the exporter. Flushes remaining spans.
 */
export async function shutdownOtelExporter(): Promise<void> {
  if (!exporter) return;
  await exporter.shutdown();
  exporter = null;
}

/**
 * Get the singleton exporter instance (or null if disabled).
 * Primarily useful for testing.
 */
export function getOtelExporter(): OtelSpanExporter | null {
  return exporter;
}

/**
 * Reset the singleton (for testing only).
 */
export function _resetExporter(): void {
  exporter = null;
}
