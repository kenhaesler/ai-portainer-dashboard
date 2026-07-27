import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useStreamingLogs } from './use-streaming-logs';
import { api } from '@/shared/lib/api';

vi.mock('@/shared/lib/api', () => ({
  api: {
    getToken: vi.fn().mockReturnValue('test-token'),
    handleUnauthorized: vi.fn(),
  },
}));

// Helper to create a mock ReadableStream from SSE lines. The element type is
// the one a real `Response.body` carries, since that is what it stands in for.
function createMockSSEStream(events: string[], delay = 0): NonNullable<Response['body']> {
  const encoder = new TextEncoder();
  let index = 0;

  return new ReadableStream({
    async pull(controller) {
      if (index >= events.length) {
        controller.close();
        return;
      }
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      const data = events[index++];
      controller.enqueue(encoder.encode(data));
    },
  });
}

// `typeof fetch` merges the DOM and @types/node declarations into an overload
// set, and `Mock<T>` only carries T's last overload — so name the single
// signature the hook actually calls.
type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

// useStreamingLogs reads exactly `ok`, `status`, `body` and `json()` off the
// response, so tests supply those and nothing else. One helper so the narrowing
// to Response lives in a single place.
type ResponseStub = Pick<Response, 'ok'> & Partial<Pick<Response, 'status' | 'body' | 'json'>>;
function mockResponse(stub: ResponseStub): Response {
  return stub as Response;
}

describe('useStreamingLogs', () => {
  let mockFetch: Mock<FetchFn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockFetch = vi.fn<FetchFn>();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns idle status initially', () => {
    const { result } = renderHook(() =>
      useStreamingLogs(1, 'abc123', { autoReconnect: false }),
    );

    expect(result.current.status).toBe('idle');
    expect(result.current.lines).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.reconnectCount).toBe(0);
  });

  it('transitions idle → connecting → streaming on start()', async () => {
    vi.useRealTimers();

    const sseStream = createMockSSEStream([
      `data: ${JSON.stringify({ line: 'hello', ts: 1000 })}\n\n`,
      `data: ${JSON.stringify({ done: true, reason: 'container_stopped' })}\n\n`,
    ]);

    mockFetch.mockResolvedValue(mockResponse({
      ok: true,
      body: sseStream,
      json: vi.fn<Response['json']>(),
    }));

    const { result } = renderHook(() =>
      useStreamingLogs(1, 'abc123', { autoReconnect: false }),
    );

    expect(result.current.status).toBe('idle');

    act(() => {
      result.current.start();
    });

    // Should transition to connecting, then streaming
    await waitFor(() => expect(result.current.status).toBe('stopped'));
    expect(result.current.lines).toContain('hello');
  });

  it('accumulates lines from SSE events', async () => {
    vi.useRealTimers();

    const sseStream = createMockSSEStream([
      `data: ${JSON.stringify({ line: 'line 1', ts: 1000 })}\ndata: ${JSON.stringify({ line: 'line 2', ts: 1001 })}\n\n`,
      `data: ${JSON.stringify({ line: 'line 3', ts: 1002 })}\n\n`,
      `data: ${JSON.stringify({ done: true })}\n\n`,
    ]);

    mockFetch.mockResolvedValue(mockResponse({
      ok: true,
      body: sseStream,
      json: vi.fn<Response['json']>(),
    }));

    const { result } = renderHook(() =>
      useStreamingLogs(1, 'abc123', { autoReconnect: false }),
    );

    act(() => {
      result.current.start();
    });

    await waitFor(() => expect(result.current.status).toBe('stopped'));
    expect(result.current.lines).toEqual(['line 1', 'line 2', 'line 3']);
  });

  it('respects maxLines limit', async () => {
    vi.useRealTimers();

    const events = [];
    for (let i = 0; i < 10; i++) {
      events.push(`data: ${JSON.stringify({ line: `line ${i}`, ts: 1000 + i })}\n\n`);
    }
    events.push(`data: ${JSON.stringify({ done: true })}\n\n`);

    const sseStream = createMockSSEStream(events);

    mockFetch.mockResolvedValue(mockResponse({
      ok: true,
      body: sseStream,
      json: vi.fn<Response['json']>(),
    }));

    const { result } = renderHook(() =>
      useStreamingLogs(1, 'abc123', { maxLines: 5, autoReconnect: false }),
    );

    act(() => {
      result.current.start();
    });

    await waitFor(() => expect(result.current.status).toBe('stopped'));
    expect(result.current.lines.length).toBeLessThanOrEqual(5);
    // Should keep the most recent lines
    expect(result.current.lines).toContain('line 9');
  });

  it('transitions to error on stream failure', async () => {
    vi.useRealTimers();

    mockFetch.mockResolvedValue(mockResponse({
      ok: false,
      status: 502,
      json: vi.fn<Response['json']>().mockResolvedValue({ error: 'Docker unavailable' }),
    }));

    const { result } = renderHook(() =>
      useStreamingLogs(1, 'abc123', { autoReconnect: false }),
    );

    act(() => {
      result.current.start();
    });

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('Docker unavailable');
  });

  it('routes a 401 through the shared auth:expired handler', async () => {
    vi.useRealTimers();

    mockFetch.mockResolvedValue(mockResponse({
      ok: false,
      status: 401,
      json: vi.fn<Response['json']>().mockResolvedValue({ error: 'Session expired' }),
    }));

    const { result } = renderHook(() =>
      useStreamingLogs(1, 'abc123', { autoReconnect: false }),
    );

    act(() => {
      result.current.start();
    });

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(api.handleUnauthorized).toHaveBeenCalled();
  });

  it('stop() prevents reconnection', async () => {
    vi.useRealTimers();

    const sseStream = createMockSSEStream([
      `data: ${JSON.stringify({ line: 'first', ts: 1000 })}\n\n`,
      `data: ${JSON.stringify({ done: true })}\n\n`,
    ]);

    mockFetch.mockResolvedValue(mockResponse({
      ok: true,
      body: sseStream,
      json: vi.fn<Response['json']>(),
    }));

    const { result } = renderHook(() =>
      useStreamingLogs(1, 'abc123', { autoReconnect: true }),
    );

    act(() => {
      result.current.start();
    });

    // Stop before stream ends
    act(() => {
      result.current.stop();
    });

    expect(result.current.status).toBe('stopped');
    // fetch should have been called only once (no reconnection)
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('clear() empties lines', async () => {
    vi.useRealTimers();

    const sseStream = createMockSSEStream([
      `data: ${JSON.stringify({ line: 'data', ts: 1000 })}\n\n`,
      `data: ${JSON.stringify({ done: true })}\n\n`,
    ]);

    mockFetch.mockResolvedValue(mockResponse({
      ok: true,
      body: sseStream,
      json: vi.fn<Response['json']>(),
    }));

    const { result } = renderHook(() =>
      useStreamingLogs(1, 'abc123', { autoReconnect: false }),
    );

    act(() => {
      result.current.start();
    });

    await waitFor(() => expect(result.current.lines.length).toBeGreaterThan(0));

    act(() => {
      result.current.clear();
    });

    expect(result.current.lines).toEqual([]);
  });

  it('cleans up on unmount', () => {
    const { result, unmount } = renderHook(() =>
      useStreamingLogs(1, 'abc123', { autoReconnect: false }),
    );

    // Start and immediately unmount — should not throw
    act(() => {
      result.current.start();
    });

    expect(() => unmount()).not.toThrow();
  });
});
