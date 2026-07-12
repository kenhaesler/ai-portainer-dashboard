import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  enqueueSpan,
  flushSpanBuffer,
  shutdownSpanBuffer,
  getSpanBufferStats,
  __resetSpanBufferForTests,
  SPAN_BUFFER_MAX_SPANS,
  SPAN_BUFFER_FLUSH_INTERVAL_MS,
} from './span-buffer.js';
import type { SpanInsert } from './trace-store.js';

const mockInsertSpans = vi.fn(async (spans: SpanInsert[]) => spans.length);

// Kept: trace-store mock — no PostgreSQL in CI
vi.mock('./trace-store.js', () => ({
  insertSpans: (...args: [SpanInsert[]]) => mockInsertSpans(...args),
}));

function makeSpan(id: string, overrides: Partial<SpanInsert> = {}): SpanInsert {
  return {
    id,
    trace_id: `trace-${id}`,
    parent_span_id: null,
    name: 'GET /api/test',
    kind: 'server',
    status: 'ok',
    start_time: new Date().toISOString(),
    end_time: new Date().toISOString(),
    duration_ms: 5,
    service_name: 'api-gateway',
    attributes: '{}',
    trace_source: 'http',
    ...overrides,
  };
}

describe('span-buffer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsertSpans.mockImplementation(async (spans: SpanInsert[]) => spans.length);
    __resetSpanBufferForTests();
  });

  afterEach(() => {
    __resetSpanBufferForTests();
    vi.useRealTimers();
  });

  it('flushes when the buffer reaches SPAN_BUFFER_MAX_SPANS', () => {
    for (let i = 0; i < SPAN_BUFFER_MAX_SPANS; i++) {
      enqueueSpan(makeSpan(`s${i}`));
    }

    // The size-triggered flush grabs the batch synchronously
    expect(mockInsertSpans).toHaveBeenCalledOnce();
    expect(mockInsertSpans.mock.calls[0][0]).toHaveLength(SPAN_BUFFER_MAX_SPANS);
    expect(getSpanBufferStats().buffered).toBe(0);
  });

  it('flushes on the interval timer when under the size threshold', async () => {
    vi.useFakeTimers();

    enqueueSpan(makeSpan('s1'));
    enqueueSpan(makeSpan('s2'));
    expect(mockInsertSpans).not.toHaveBeenCalled();

    // Just before the interval: still buffered
    await vi.advanceTimersByTimeAsync(SPAN_BUFFER_FLUSH_INTERVAL_MS - 1);
    expect(mockInsertSpans).not.toHaveBeenCalled();
    expect(getSpanBufferStats().buffered).toBe(2);

    await vi.advanceTimersByTimeAsync(1);
    expect(mockInsertSpans).toHaveBeenCalledOnce();
    expect(mockInsertSpans.mock.calls[0][0].map((s: SpanInsert) => s.id)).toEqual(['s1', 's2']);
    expect(getSpanBufferStats().buffered).toBe(0);
  });

  it('flushes remaining spans on shutdown and drops spans enqueued afterwards', async () => {
    enqueueSpan(makeSpan('s1'));
    await shutdownSpanBuffer();

    expect(mockInsertSpans).toHaveBeenCalledOnce();
    expect(mockInsertSpans.mock.calls[0][0].map((s: SpanInsert) => s.id)).toEqual(['s1']);

    enqueueSpan(makeSpan('late'));
    expect(getSpanBufferStats().buffered).toBe(0);
    expect(getSpanBufferStats().dropped).toBe(1);
    // No second flush was scheduled for the dropped span
    await flushSpanBuffer();
    expect(mockInsertSpans).toHaveBeenCalledOnce();
  });

  it('drops the batch without throwing when the flush fails, then recovers', async () => {
    mockInsertSpans.mockRejectedValueOnce(new Error('DB write failed'));

    enqueueSpan(makeSpan('bad-1'));
    enqueueSpan(makeSpan('bad-2'));
    await expect(flushSpanBuffer()).resolves.toBeUndefined();

    expect(getSpanBufferStats()).toEqual({ buffered: 0, dropped: 2 });

    // Subsequent batches still flush normally
    enqueueSpan(makeSpan('good'));
    await flushSpanBuffer();
    expect(mockInsertSpans).toHaveBeenCalledTimes(2);
    expect(mockInsertSpans.mock.calls[1][0].map((s: SpanInsert) => s.id)).toEqual(['good']);
    expect(getSpanBufferStats().dropped).toBe(2);
  });

  it('defaults trace_source to http for spans that omit it', async () => {
    const span = makeSpan('no-source');
    delete (span as Partial<SpanInsert>).trace_source;

    enqueueSpan(span);
    await flushSpanBuffer();

    expect(mockInsertSpans.mock.calls[0][0][0].trace_source).toBe('http');
  });

  it('flushSpanBuffer is a no-op when the buffer is empty', async () => {
    await flushSpanBuffer();
    expect(mockInsertSpans).not.toHaveBeenCalled();
  });
});
