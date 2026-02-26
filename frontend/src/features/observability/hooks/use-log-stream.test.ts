import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLogStream } from './use-log-stream';

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
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => 'test-jwt-token'),
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
  });

  it('does not create EventSource when containers is empty', () => {
    renderHook(() => useLogStream({
      containers: [],
      enabled: true,
    }));

    expect(MockEventSource.instances).toHaveLength(0);
  });

  it('creates EventSource per container when enabled', () => {
    renderHook(() => useLogStream({
      containers: [
        { id: 'c1', name: 'web', endpointId: 1 },
        { id: 'c2', name: 'api', endpointId: 1 },
      ],
      enabled: true,
    }));

    expect(MockEventSource.instances).toHaveLength(2);
    expect(MockEventSource.instances[0].url).toContain('/api/containers/1/c1/logs/stream');
    expect(MockEventSource.instances[1].url).toContain('/api/containers/1/c2/logs/stream');
  });

  it('includes token query parameter in URL', () => {
    renderHook(() => useLogStream({
      containers: [{ id: 'c1', name: 'web', endpointId: 1 }],
      enabled: true,
    }));

    expect(MockEventSource.instances[0].url).toContain('token=test-jwt-token');
  });

  it('accumulates streamed entries on message', () => {
    const { result } = renderHook(() => useLogStream({
      containers: [{ id: 'c1', name: 'web', endpointId: 1 }],
      enabled: true,
    }));

    const source = MockEventSource.instances[0];

    act(() => {
      source.simulateOpen();
      source.simulateMessage({ line: '2026-02-16T12:00:00.000Z INFO server started' });
    });

    expect(result.current.streamedEntries).toHaveLength(1);
    expect(result.current.streamedEntries[0].message).toContain('server started');
  });

  it('skips heartbeat messages', () => {
    const { result } = renderHook(() => useLogStream({
      containers: [{ id: 'c1', name: 'web', endpointId: 1 }],
      enabled: true,
    }));

    const source = MockEventSource.instances[0];

    act(() => {
      source.simulateOpen();
      source.simulateMessage({ heartbeat: true, ts: Date.now() });
    });

    expect(result.current.streamedEntries).toHaveLength(0);
  });

  it('sets isFallback when SSE fails', () => {
    const { result } = renderHook(() => useLogStream({
      containers: [{ id: 'c1', name: 'web', endpointId: 1 }],
      enabled: true,
    }));

    const source = MockEventSource.instances[0];

    act(() => {
      source.simulateError();
    });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.isFallback).toBe(true);
  });

  it('sets isStreaming when SSE connects', () => {
    const { result } = renderHook(() => useLogStream({
      containers: [{ id: 'c1', name: 'web', endpointId: 1 }],
      enabled: true,
    }));

    const source = MockEventSource.instances[0];

    act(() => {
      source.simulateOpen();
    });

    expect(result.current.isStreaming).toBe(true);
    expect(result.current.isFallback).toBe(false);
  });

  it('closes EventSource on unmount', () => {
    const { unmount } = renderHook(() => useLogStream({
      containers: [{ id: 'c1', name: 'web', endpointId: 1 }],
      enabled: true,
    }));

    const source = MockEventSource.instances[0];

    unmount();

    expect(source.close).toHaveBeenCalled();
  });

  it('resets entries when containers change', () => {
    const { result, rerender } = renderHook(
      (props: { containers: Array<{ id: string; name: string; endpointId: number }> }) =>
        useLogStream({ containers: props.containers, enabled: true }),
      {
        initialProps: { containers: [{ id: 'c1', name: 'web', endpointId: 1 }] },
      },
    );

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
