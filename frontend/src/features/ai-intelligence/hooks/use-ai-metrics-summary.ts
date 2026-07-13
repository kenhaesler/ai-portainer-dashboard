import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/shared/lib/api';

interface AiMetricsSummaryState {
  summary: string;
  isStreaming: boolean;
  error: string | null;
}

export function useAiMetricsSummary(
  endpointId: number | undefined,
  containerId: string | undefined,
  timeRange: string,
) {
  const [state, setState] = useState<AiMetricsSummaryState>({
    summary: '',
    isStreaming: false,
    error: null,
  });
  const abortRef = useRef<AbortController | null>(null);
  const cacheRef = useRef<Map<string, { summary: string; timestamp: number }>>(new Map());
  const requestKeyRef = useRef<string>('');

  const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

  const fetchSummary = useCallback(async (
    epId: number,
    cId: string,
    tr: string,
    skipCache = false,
  ) => {
    const cacheKey = `${epId}:${cId}:${tr}`;
    requestKeyRef.current = cacheKey;

    // Check cache
    if (!skipCache) {
      const cached = cacheRef.current.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        setState({ summary: cached.summary, isStreaming: false, error: null });
        return;
      }
    }

    // Abort previous request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({ summary: '', isStreaming: true, error: null });

    try {
      const token = api.getToken();
      const baseUrl = import.meta.env.VITE_API_URL || window.location.origin;
      const url = new URL(`/api/metrics/${epId}/${cId}/ai-summary`, baseUrl);
      url.searchParams.set('timeRange', tr);

      const response = await fetch(url.toString(), {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: controller.signal,
      });

      if (response.status === 503) {
        setState({ summary: '', isStreaming: false, error: 'unavailable' });
        return;
      }

      if (!response.ok) {
        // Streams can't use ApiClient (long-lived body reader), so replicate its
        // 401 → auth:expired handling inline: clear the stale token and route to
        // re-login instead of surfacing a raw error toast (mirrors
        // use-streaming-logs.ts).
        if (response.status === 401) {
          api.handleUnauthorized();
        }
        setState({ summary: '', isStreaming: false, error: 'Failed to generate summary' });
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        setState({ summary: '', isStreaming: false, error: 'Stream not available' });
        return;
      }

      const decoder = new TextDecoder();
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        const lines = text.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.chunk) {
              accumulated += data.chunk;
              // Only update state if this is still the active request
              if (requestKeyRef.current === cacheKey) {
                setState({ summary: accumulated, isStreaming: true, error: null });
              }
            }
            if (data.done) {
              // The `done` event carries the fully sanitized summary as the
              // authoritative result (#1516) — prefer it over the accumulated
              // stream so leaked content filtered out server-side after
              // streaming never persists client-side.
              const finalSummary = typeof data.summary === 'string' ? data.summary : accumulated;
              cacheRef.current.set(cacheKey, { summary: finalSummary, timestamp: Date.now() });
              if (requestKeyRef.current === cacheKey) {
                setState({ summary: finalSummary, isStreaming: false, error: null });
              }
            }
            if (data.error) {
              if (requestKeyRef.current === cacheKey) {
                setState({ summary: '', isStreaming: false, error: data.error });
              }
            }
          } catch {
            // Skip malformed SSE lines
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (requestKeyRef.current === cacheKey) {
        setState({ summary: '', isStreaming: false, error: 'Failed to connect to AI service' });
      }
    }
  }, []);

  useEffect(() => {
    if (!endpointId || !containerId) {
      setState({ summary: '', isStreaming: false, error: null });
      return;
    }

    fetchSummary(endpointId, containerId, timeRange);

    return () => {
      abortRef.current?.abort();
    };
  }, [endpointId, containerId, timeRange, fetchSummary]);

  const refresh = useCallback(() => {
    if (endpointId && containerId) {
      fetchSummary(endpointId, containerId, timeRange, true);
    }
  }, [endpointId, containerId, timeRange, fetchSummary]);

  return {
    ...state,
    refresh,
  };
}
