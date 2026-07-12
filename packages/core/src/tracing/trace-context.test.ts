import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  runWithTraceContext,
  withSpan,
  getCurrentTraceContext,
} from './trace-context.js';

const mockEnqueueSpan = vi.fn();

// Kept: span-buffer mock — withSpan buffers spans instead of inserting; no PostgreSQL in CI
vi.mock('./span-buffer.js', () => ({
  enqueueSpan: (...args: unknown[]) => mockEnqueueSpan(...args),
}));

describe('trace-context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('runWithTraceContext', () => {
    it('provides trace context within the callback', () => {
      runWithTraceContext({ traceId: 'trace-1', spanId: 'span-1', source: 'http' }, () => {
        const ctx = getCurrentTraceContext();
        expect(ctx).toBeDefined();
        expect(ctx!.traceId).toBe('trace-1');
        expect(ctx!.spanId).toBe('span-1');
        expect(ctx!.source).toBe('http');
      });
    });

    it('generates traceId and spanId if not provided', () => {
      runWithTraceContext({ source: 'scheduler' }, () => {
        const ctx = getCurrentTraceContext();
        expect(ctx).toBeDefined();
        expect(ctx!.traceId).toBeTruthy();
        expect(ctx!.spanId).toBeTruthy();
        expect(ctx!.source).toBe('scheduler');
      });
    });

    it('returns undefined outside of context', () => {
      expect(getCurrentTraceContext()).toBeUndefined();
    });

    it('returns the value from the callback', () => {
      const result = runWithTraceContext({ source: 'http' }, () => 42);
      expect(result).toBe(42);
    });
  });

  describe('withSpan', () => {
    it('creates a child span linked to current trace', async () => {
      await runWithTraceContext(
        { traceId: 'trace-1', spanId: 'root-span', source: 'http' },
        async () => {
          await withSpan('test-op', 'test-service', 'client', async () => {
            return 'result';
          });
        },
      );

      expect(mockEnqueueSpan).toHaveBeenCalledOnce();
      const span = mockEnqueueSpan.mock.calls[0][0];
      expect(span.trace_id).toBe('trace-1');
      expect(span.parent_span_id).toBe('root-span');
      expect(span.name).toBe('test-op');
      expect(span.service_name).toBe('test-service');
      expect(span.kind).toBe('client');
      expect(span.status).toBe('ok');
      expect(span.trace_source).toBe('http');
      expect(span.duration_ms).toBeGreaterThanOrEqual(0);
    });

    it('sets status to error when function throws', async () => {
      await runWithTraceContext(
        { traceId: 'trace-err', spanId: 'root', source: 'http' },
        async () => {
          try {
            await withSpan('failing-op', 'test-service', 'internal', async () => {
              throw new Error('boom');
            });
          } catch {
            // expected
          }
        },
      );

      expect(mockEnqueueSpan).toHaveBeenCalledOnce();
      const span = mockEnqueueSpan.mock.calls[0][0];
      expect(span.status).toBe('error');
    });

    it('propagates the error to the caller', async () => {
      const err = await runWithTraceContext(
        { traceId: 'trace-2', spanId: 'root', source: 'http' },
        async () => {
          try {
            await withSpan('op', 'svc', 'client', async () => {
              throw new Error('test error');
            });
          } catch (e) {
            return e;
          }
          return undefined;
        },
      );

      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe('test error');
    });

    it('runs without tracing when no context exists', async () => {
      const result = await withSpan('orphan', 'svc', 'client', async () => 'ok');
      expect(result).toBe('ok');
      expect(mockEnqueueSpan).not.toHaveBeenCalled();
    });

    it('nests spans correctly', async () => {
      await runWithTraceContext(
        { traceId: 'trace-nested', spanId: 'root', source: 'scheduler' },
        async () => {
          await withSpan('parent-op', 'svc-a', 'server', async () => {
            await withSpan('child-op', 'svc-b', 'client', async () => {
              return 'deep';
            });
          });
        },
      );

      expect(mockEnqueueSpan).toHaveBeenCalledTimes(2);

      // Child span is inserted first (innermost completes first)
      const childSpan = mockEnqueueSpan.mock.calls[0][0];
      const parentSpan = mockEnqueueSpan.mock.calls[1][0];

      expect(childSpan.trace_id).toBe('trace-nested');
      expect(childSpan.name).toBe('child-op');
      expect(childSpan.service_name).toBe('svc-b');
      // The child's parent should be the parent span, not the root
      expect(childSpan.parent_span_id).toBe(parentSpan.id);

      expect(parentSpan.trace_id).toBe('trace-nested');
      expect(parentSpan.parent_span_id).toBe('root');
      expect(parentSpan.name).toBe('parent-op');
      expect(parentSpan.trace_source).toBe('scheduler');
    });

    it('does not fail if enqueueSpan throws', async () => {
      mockEnqueueSpan.mockImplementationOnce(() => {
        throw new Error('buffer append failed');
      });

      const result = await runWithTraceContext(
        { traceId: 't', spanId: 's', source: 'http' },
        async () => {
          return withSpan('op', 'svc', 'client', async () => 'ok');
        },
      );

      expect(result).toBe('ok');
    });
  });
});
