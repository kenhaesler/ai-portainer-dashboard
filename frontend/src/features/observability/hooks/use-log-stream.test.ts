import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useLogStream } from './use-log-stream';
import { api } from '@/shared/lib/api';

// Mock EventSource
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readyState = 0;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  close = vi.fn(() => {
    this.readyState = 2;
  });

  // Simulate the connection opening
  simulateOpen() {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }

  // Simulate receiving a message
  simulateMessage(data: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }));
  }

  // Simulate an error
  simulateError() {
    this.onerror?.(new Event('error'));
  }
}

describe('useLogStream', () => {
  let postSpy: ReturnType<typeof vi.spyOn>;
  let ticketCounter: number;

  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);

    // Each container needs a single-use ticket — return a fresh one per call.
    ticketCounter = 0;
    postSpy = vi.spyOn(api, 'post').mockImplementation(async (path: string) => {
      if (path === '/api/auth/stream-ticket') {
        ticketCounter += 1;
        return {
          ticket: `st_test_ticket_${ticketCounter}`,
          expiresAt: new Date(Date.now() + 30_000).toISOString(),
        } as unknown as never;
      }
      throw new Error(`Unexpected post path: ${path}`);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not create EventSource when disabled', () => {
    renderHook(() => useLogStream({
      containers: [{ id: 'c1', name: 'web', endpointId: 1 }],
      enabled: false,
    }));

    expect(MockEventSource.instances).toHaveLength(0);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('does not create EventSource when containers is empty', () => {
    renderHook(() => useLogStream({
      containers: [],
      enabled: true,
    }));

    expect(MockEventSource.instances).toHaveLength(0);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('creates EventSource per container when enabled', async () => {
    renderHook(() => useLogStream({
      containers: [
        { id: 'c1', name: 'web', endpointId: 1 },
        { id: 'c2', name: 'api', endpointId: 1 },
      ],
      enabled: true,
    }));

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(2));
    const urls = MockEventSource.instances.map((i) => i.url);
    expect(urls.some((u) => u.includes('/api/containers/1/c1/logs/stream'))).toBe(true);
    expect(urls.some((u) => u.includes('/api/containers/1/c2/logs/stream'))).toBe(true);
  });

  it('passes a single-use ticket (not the JWT) in the URL', async () => {
    renderHook(() => useLogStream({
      containers: [{ id: 'c1', name: 'web', endpointId: 1 }],
      enabled: true,
    }));

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
    const url = MockEventSource.instances[0].url;
    expect(url).toContain('ticket=st_test_ticket_1');
    // The JWT must never appear in the URL — only opaque tickets (#1112).
    expect(url).not.toContain('token=');
    expect(postSpy).toHaveBeenCalledWith('/api/auth/stream-ticket');
  });

  it('mints one ticket per container (single-use semantics)', async () => {
    renderHook(() => useLogStream({
      containers: [
        { id: 'c1', name: 'web', endpointId: 1 },
        { id: 'c2', name: 'api', endpointId: 1 },
        { id: 'c3', name: 'db', endpointId: 1 },
      ],
      enabled: true,
    }));

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(3));
    expect(postSpy).toHaveBeenCalledTimes(3);
    const tickets = MockEventSource.instances.map(
      (i) => new URL(i.url).searchParams.get('ticket'),
    );
    // Every ticket must be distinct.
    expect(new Set(tickets).size).toBe(3);
  });

  it('accumulates streamed entries on message', async () => {
    const { result } = renderHook(() => useLogStream({
      containers: [{ id: 'c1', name: 'web', endpointId: 1 }],
      enabled: true,
    }));

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
    const source = MockEventSource.instances[0];

    act(() => {
      source.simulateOpen();
      source.simulateMessage({ line: '2026-02-16T12:00:00.000Z INFO server started' });
    });

    expect(result.current.streamedEntries).toHaveLength(1);
    expect(result.current.streamedEntries[0].message).toContain('server started');
  });

  it('skips heartbeat messages', async () => {
    const { result } = renderHook(() => useLogStream({
      containers: [{ id: 'c1', name: 'web', endpointId: 1 }],
      enabled: true,
    }));

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
    const source = MockEventSource.instances[0];

    act(() => {
      source.simulateOpen();
      source.simulateMessage({ heartbeat: true, ts: Date.now() });
    });

    expect(result.current.streamedEntries).toHaveLength(0);
  });

  it('sets isFallback when SSE fails', async () => {
    const { result } = renderHook(() => useLogStream({
      containers: [{ id: 'c1', name: 'web', endpointId: 1 }],
      enabled: true,
    }));

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
    const source = MockEventSource.instances[0];

    act(() => {
      source.simulateError();
    });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.isFallback).toBe(true);
  });

  it('sets isFallback when ticket exchange fails', async () => {
    postSpy.mockRejectedValueOnce(new Error('ticket exchange failed'));

    const { result } = renderHook(() => useLogStream({
      containers: [{ id: 'c1', name: 'web', endpointId: 1 }],
      enabled: true,
    }));

    await waitFor(() => expect(result.current.isFallback).toBe(true));
    expect(MockEventSource.instances).toHaveLength(0);
  });

  it('sets isStreaming when SSE connects', async () => {
    const { result } = renderHook(() => useLogStream({
      containers: [{ id: 'c1', name: 'web', endpointId: 1 }],
      enabled: true,
    }));

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
    const source = MockEventSource.instances[0];

    act(() => {
      source.simulateOpen();
    });

    expect(result.current.isStreaming).toBe(true);
    expect(result.current.isFallback).toBe(false);
  });

  it('closes EventSource on unmount', async () => {
    const { unmount } = renderHook(() => useLogStream({
      containers: [{ id: 'c1', name: 'web', endpointId: 1 }],
      enabled: true,
    }));

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
    const source = MockEventSource.instances[0];

    unmount();

    expect(source.close).toHaveBeenCalled();
  });

  it('resets entries when containers change', async () => {
    const { result, rerender } = renderHook(
      (props: { containers: Array<{ id: string; name: string; endpointId: number }> }) =>
        useLogStream({ containers: props.containers, enabled: true }),
      {
        initialProps: { containers: [{ id: 'c1', name: 'web', endpointId: 1 }] },
      },
    );

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
    const source = MockEventSource.instances[0];

    act(() => {
      source.simulateOpen();
      source.simulateMessage({ line: '2026-02-16T12:00:00.000Z INFO old log' });
    });

    expect(result.current.streamedEntries).toHaveLength(1);

    // Change containers
    rerender({ containers: [{ id: 'c2', name: 'api', endpointId: 1 }] });

    expect(result.current.streamedEntries).toHaveLength(0);
    expect(source.close).toHaveBeenCalled();
  });
});
