import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAiMetricsSummary } from './use-ai-metrics-summary';

vi.mock('@/shared/lib/api', () => ({
  api: {
    getToken: vi.fn().mockReturnValue('test-token'),
  },
}));

// Helper to create a mock ReadableStream from SSE lines
function createMockSSEStream(events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;

  return new ReadableStream({
    pull(controller) {
      if (index >= events.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(events[index++]));
    },
  });
}

function mockSseResponse(events: string[]) {
  return {
    ok: true,
    status: 200,
    body: createMockSSEStream(events),
  } as unknown as Response;
}

describe('useAiMetricsSummary', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  it('accumulates streamed chunks into the summary', async () => {
    mockFetch.mockResolvedValue(mockSseResponse([
      `data: ${JSON.stringify({ chunk: 'CPU is ' })}\n\n`,
      `data: ${JSON.stringify({ chunk: 'stable.' })}\n\n`,
      `data: ${JSON.stringify({ done: true, summary: 'CPU is stable.' })}\n\n`,
    ]));

    const { result } = renderHook(() => useAiMetricsSummary(1, 'abc123', '1h'));

    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    expect(result.current.summary).toBe('CPU is stable.');
    expect(result.current.error).toBeNull();
  });

  it('replaces the accumulated stream with the authoritative sanitized summary on done (#1516)', async () => {
    // Server-side sanitization can rewrite the final message after streaming
    // (system-prompt leak detected mid-stream) — the done.summary must win.
    mockFetch.mockResolvedValue(mockSseResponse([
      `data: ${JSON.stringify({ chunk: 'Sure! BEGIN SYSTEM PROMPT You are' })}\n\n`,
      `data: ${JSON.stringify({ done: true, summary: 'I cannot provide internal system instructions. Ask about dashboard data or navigation.' })}\n\n`,
    ]));

    const { result } = renderHook(() => useAiMetricsSummary(1, 'abc123', '1h'));

    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    expect(result.current.summary).toBe('I cannot provide internal system instructions. Ask about dashboard data or navigation.');
    expect(result.current.summary).not.toContain('BEGIN SYSTEM PROMPT');
  });

  it('falls back to the accumulated stream when done carries no summary (legacy servers)', async () => {
    mockFetch.mockResolvedValue(mockSseResponse([
      `data: ${JSON.stringify({ chunk: 'Memory usage is low.' })}\n\n`,
      `data: ${JSON.stringify({ done: true })}\n\n`,
    ]));

    const { result } = renderHook(() => useAiMetricsSummary(1, 'abc123', '1h'));

    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    expect(result.current.summary).toBe('Memory usage is low.');
  });

  it('surfaces unavailable when the LLM service responds 503', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503 } as Response);

    const { result } = renderHook(() => useAiMetricsSummary(1, 'abc123', '1h'));

    await waitFor(() => expect(result.current.error).toBe('unavailable'));
    expect(result.current.summary).toBe('');
  });
});
