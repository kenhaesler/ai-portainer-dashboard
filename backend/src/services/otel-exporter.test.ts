import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  OtelSpanExporter,
  initOtelExporter,
  queueSpanForExport,
  shutdownOtelExporter,
  getOtelExporter,
  _resetExporter,
  type OtelExporterConfig,
} from './otel-exporter.js';
import type { SpanInsert } from './trace-store.js';

function makeSpan(overrides: Partial<SpanInsert> = {}): SpanInsert {
  return {
    id: 'span-1',
    trace_id: 'trace-1',
    parent_span_id: null,
    name: 'GET /api/test',
    kind: 'server',
    status: 'ok',
    start_time: '2025-01-01T00:00:00.000Z',
    end_time: '2025-01-01T00:00:00.100Z',
    duration_ms: 100,
    service_name: 'test-service',
    attributes: '{}',
    trace_source: 'http',
    ...overrides,
  };
}

const defaultConfig: OtelExporterConfig = {
  endpoint: 'http://localhost:4318/v1/traces',
  batchSize: 3,
  flushIntervalMs: 60000, // Large interval so tests control flushing manually
};

describe('OtelSpanExporter', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
    });
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(async () => {
    _resetExporter();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe('queueSpan', () => {
    it('should buffer spans without sending until batch size is reached', () => {
      const exporter = new OtelSpanExporter(defaultConfig);

      exporter.queueSpan(makeSpan({ id: 'span-1' }));
      exporter.queueSpan(makeSpan({ id: 'span-2' }));

      expect(exporter.bufferSize).toBe(2);
      expect(fetchSpy).not.toHaveBeenCalled();

      // Cleanup
      clearInterval((exporter as unknown as { flushTimer: ReturnType<typeof setInterval> }).flushTimer);
    });

    it('should drop oldest span when buffer exceeds max size (1000)', () => {
      const exporter = new OtelSpanExporter({
        ...defaultConfig,
        batchSize: 2000, // Never auto-flush
      });

      // Fill buffer to max
      for (let i = 0; i < 1001; i++) {
        exporter.queueSpan(makeSpan({ id: `span-${i}` }));
      }

      // Buffer should be capped at 1000
      expect(exporter.bufferSize).toBe(1000);

      clearInterval((exporter as unknown as { flushTimer: ReturnType<typeof setInterval> }).flushTimer);
    });

    it('should reject spans after shutdown', async () => {
      const exporter = new OtelSpanExporter(defaultConfig);
      await exporter.shutdown();

      exporter.queueSpan(makeSpan());
      expect(exporter.bufferSize).toBe(0);
    });
  });

  describe('flush on batch size threshold', () => {
    it('should auto-flush when buffer reaches batchSize', async () => {
      const exporter = new OtelSpanExporter(defaultConfig);

      exporter.queueSpan(makeSpan({ id: 'span-1' }));
      exporter.queueSpan(makeSpan({ id: 'span-2' }));
      expect(fetchSpy).not.toHaveBeenCalled();

      // Third span triggers flush (batchSize = 3)
      exporter.queueSpan(makeSpan({ id: 'span-3' }));

      // Allow the void-returned flush promise to resolve
      await vi.advanceTimersByTimeAsync(0);

      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe('http://localhost:4318/v1/traces');
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(options.body);
      expect(body.resourceSpans).toHaveLength(1);
      expect(body.resourceSpans[0].scopeSpans[0].spans).toHaveLength(3);

      clearInterval((exporter as unknown as { flushTimer: ReturnType<typeof setInterval> }).flushTimer);
    });
  });

  describe('flush on interval', () => {
    it('should flush buffered spans when interval elapses', async () => {
      const exporter = new OtelSpanExporter({
        ...defaultConfig,
        flushIntervalMs: 5000,
      });

      exporter.queueSpan(makeSpan({ id: 'span-1' }));
      expect(fetchSpy).not.toHaveBeenCalled();

      // Advance past flush interval
      await vi.advanceTimersByTimeAsync(5000);

      expect(fetchSpy).toHaveBeenCalledTimes(1);

      clearInterval((exporter as unknown as { flushTimer: ReturnType<typeof setInterval> }).flushTimer);
    });

    it('should not send if buffer is empty when interval elapses', async () => {
      const _exporter = new OtelSpanExporter({
        ...defaultConfig,
        flushIntervalMs: 5000,
      });

      await vi.advanceTimersByTimeAsync(5000);

      expect(fetchSpy).not.toHaveBeenCalled();

      clearInterval((_exporter as unknown as { flushTimer: ReturnType<typeof setInterval> }).flushTimer);
    });
  });

  describe('retry with backoff on failure', () => {
    it('should retry with exponential backoff and succeed on second attempt', async () => {
      fetchSpy
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK' });

      const exporter = new OtelSpanExporter(defaultConfig);

      exporter.queueSpan(makeSpan({ id: 'span-1' }));
      exporter.queueSpan(makeSpan({ id: 'span-2' }));
      exporter.queueSpan(makeSpan({ id: 'span-3' }));

      // Let the flush start (triggers on batchSize)
      await vi.advanceTimersByTimeAsync(0);

      // First attempt failed, now wait for 1s backoff
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1000);

      // Second attempt should succeed
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      clearInterval((exporter as unknown as { flushTimer: ReturnType<typeof setInterval> }).flushTimer);
    });
  });

  describe('drop after 3 failures', () => {
    it('should drop batch after 3 consecutive failures', async () => {
      fetchSpy
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockRejectedValueOnce(new Error('Fail 2'))
        .mockRejectedValueOnce(new Error('Fail 3'));

      const exporter = new OtelSpanExporter(defaultConfig);

      exporter.queueSpan(makeSpan({ id: 'span-1' }));
      exporter.queueSpan(makeSpan({ id: 'span-2' }));
      exporter.queueSpan(makeSpan({ id: 'span-3' }));

      // Flush triggered on batchSize
      await vi.advanceTimersByTimeAsync(0); // attempt 1
      await vi.advanceTimersByTimeAsync(1000); // attempt 2 (1s backoff)
      await vi.advanceTimersByTimeAsync(2000); // attempt 3 (2s backoff)

      expect(fetchSpy).toHaveBeenCalledTimes(3);

      // Buffer should be empty (batch was dropped)
      expect(exporter.bufferSize).toBe(0);

      clearInterval((exporter as unknown as { flushTimer: ReturnType<typeof setInterval> }).flushTimer);
    });

    it('should not retry on 4xx client errors (except 429)', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: vi.fn().mockResolvedValue('Invalid payload'),
      });

      const exporter = new OtelSpanExporter(defaultConfig);

      exporter.queueSpan(makeSpan({ id: 'span-1' }));
      exporter.queueSpan(makeSpan({ id: 'span-2' }));
      exporter.queueSpan(makeSpan({ id: 'span-3' }));

      await vi.advanceTimersByTimeAsync(0);

      // Only one attempt — no retries for 4xx
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      clearInterval((exporter as unknown as { flushTimer: ReturnType<typeof setInterval> }).flushTimer);
    });
  });

  describe('graceful shutdown', () => {
    it('should flush remaining buffer on shutdown', async () => {
      const exporter = new OtelSpanExporter(defaultConfig);

      exporter.queueSpan(makeSpan({ id: 'span-1' }));
      exporter.queueSpan(makeSpan({ id: 'span-2' }));
      expect(exporter.bufferSize).toBe(2);

      await exporter.shutdown();

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(exporter.bufferSize).toBe(0);
    });

    it('should stop the interval timer on shutdown', async () => {
      const exporter = new OtelSpanExporter({
        ...defaultConfig,
        flushIntervalMs: 1000,
      });

      await exporter.shutdown();

      // Queue a span after shutdown — should not be sent
      exporter.queueSpan(makeSpan());
      await vi.advanceTimersByTimeAsync(5000);

      // Only the shutdown flush (which had nothing to send)
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('custom headers', () => {
    it('should include custom headers in requests', async () => {
      const exporter = new OtelSpanExporter({
        ...defaultConfig,
        headers: {
          Authorization: 'Bearer test-token',
          'X-Custom': 'value',
        },
      });

      exporter.queueSpan(makeSpan({ id: 'span-1' }));
      exporter.queueSpan(makeSpan({ id: 'span-2' }));
      exporter.queueSpan(makeSpan({ id: 'span-3' }));

      await vi.advanceTimersByTimeAsync(0);

      const headers = fetchSpy.mock.calls[0][1].headers;
      expect(headers['Authorization']).toBe('Bearer test-token');
      expect(headers['X-Custom']).toBe('value');
      expect(headers['Content-Type']).toBe('application/json');

      clearInterval((exporter as unknown as { flushTimer: ReturnType<typeof setInterval> }).flushTimer);
    });
  });

  describe('OTLP payload format', () => {
    it('should produce valid OTLP JSON structure', async () => {
      const exporter = new OtelSpanExporter({ ...defaultConfig, batchSize: 1 });

      exporter.queueSpan(
        makeSpan({
          id: 'aaaabbbb-cccc-dddd-eeee-ffffffffffff',
          trace_id: '11112222-3333-4444-5555-666677778888',
          parent_span_id: '99990000-aaaa-bbbb-cccc-ddddeeeeffff',
          name: 'GET /api/containers',
          kind: 'client',
          status: 'error',
          service_name: 'portainer-proxy',
          attributes: '{"http.method":"GET","http.status_code":"500"}',
        }),
      );

      await vi.advanceTimersByTimeAsync(0);

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      const resourceSpan = body.resourceSpans[0];

      // Resource attributes
      expect(resourceSpan.resource.attributes).toEqual([
        { key: 'service.name', value: { stringValue: 'portainer-proxy' } },
      ]);

      // Scope
      expect(resourceSpan.scopeSpans[0].scope.name).toBe('ai-portainer-dashboard');

      // Span
      const span = resourceSpan.scopeSpans[0].spans[0];
      expect(span.traceId).toBe('1111222233334444555566667777888' + '8');
      expect(span.name).toBe('GET /api/containers');
      expect(span.kind).toBe(3); // client
      expect(span.status.code).toBe(2); // error

      // Attributes should include parsed JSON + trace_source
      const attrKeys = span.attributes.map((a: { key: string }) => a.key);
      expect(attrKeys).toContain('trace.source');
      expect(attrKeys).toContain('http.method');
      expect(attrKeys).toContain('http.status_code');

      clearInterval((exporter as unknown as { flushTimer: ReturnType<typeof setInterval> }).flushTimer);
    });
  });

  describe('singleton management', () => {
    it('should be disabled by default (queueSpanForExport is no-op)', () => {
      _resetExporter();

      // Should not throw and should not send anything
      queueSpanForExport(makeSpan());
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('should queue spans when exporter is initialized', async () => {
      const exp = initOtelExporter({ ...defaultConfig, batchSize: 1 });

      queueSpanForExport(makeSpan());
      await vi.advanceTimersByTimeAsync(0);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(getOtelExporter()).toBe(exp);

      clearInterval((exp as unknown as { flushTimer: ReturnType<typeof setInterval> }).flushTimer);
    });

    it('should flush and clean up on shutdownOtelExporter', async () => {
      initOtelExporter(defaultConfig);
      queueSpanForExport(makeSpan());

      await shutdownOtelExporter();

      expect(getOtelExporter()).toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('should return existing instance if initOtelExporter called twice', () => {
      const first = initOtelExporter(defaultConfig);
      const second = initOtelExporter(defaultConfig);

      expect(first).toBe(second);

      clearInterval((first as unknown as { flushTimer: ReturnType<typeof setInterval> }).flushTimer);
    });
  });
});
