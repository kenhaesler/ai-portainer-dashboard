import { useCallback, useEffect, useRef, useState } from 'react';
import { detectLevel, lintLogLine, type ParsedLogEntry } from '@/lib/log-viewer';

const API_BASE = import.meta.env.VITE_API_URL || '';
const AUTH_TOKEN_KEY = 'auth_token';

interface LogStreamContainer {
  id: string;
  name: string;
  endpointId: number;
}

interface UseLogStreamOptions {
  containers: LogStreamContainer[];
  enabled: boolean;
  timestamps?: boolean;
}

interface UseLogStreamResult {
  /** New entries streamed from SSE (append-only). Reset when containers change. */
  streamedEntries: ParsedLogEntry[];
  /** Whether SSE is connected for at least one container */
  isStreaming: boolean;
  /** Whether SSE failed and fell back to polling mode */
  isFallback: boolean;
  /** Reset accumulated streamed entries */
  reset: () => void;
}

const TS_PREFIX_RE = /^(\d{4}-\d{2}-\d{2}T[^\s]+)\s(.*)$/;

function parseStreamedLine(
  line: string,
  containerId: string,
  containerName: string,
  entryIndex: number,
): ParsedLogEntry {
  const cleaned = lintLogLine(line);
  const match = cleaned.match(TS_PREFIX_RE);
  const timestamp = match?.[1] || null;
  const message = match?.[2] || cleaned;
  return {
    id: `stream-${containerId}-${entryIndex}`,
    containerId,
    containerName,
    timestamp,
    level: detectLevel(message),
    message,
    raw: cleaned,
  };
}

/**
 * Hook that connects to SSE log streaming endpoints for real-time log tailing.
 * Falls back to signalling the caller to use polling if SSE fails.
 */
export function useLogStream({
  containers,
  enabled,
  timestamps = true,
}: UseLogStreamOptions): UseLogStreamResult {
  const [streamedEntries, setStreamedEntries] = useState<ParsedLogEntry[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isFallback, setIsFallback] = useState(false);
  const eventSourcesRef = useRef<Map<string, EventSource>>(new Map());
  const entryCounterRef = useRef(0);

  const reset = useCallback(() => {
    setStreamedEntries([]);
    entryCounterRef.current = 0;
  }, []);

  // Build a stable key for the current container set
  const containerKey = containers.map((c) => `${c.endpointId}:${c.id}`).sort().join(',');

  useEffect(() => {
    // Clean up and reset when containers change
    const sources = eventSourcesRef.current;
    for (const [, source] of sources) {
      source.close();
    }
    sources.clear();
    setStreamedEntries([]);
    setIsStreaming(false);
    setIsFallback(false);
    entryCounterRef.current = 0;

    if (!enabled || containers.length === 0) {
      return;
    }

    let activeCount = 0;
    let failedCount = 0;

    function updateStreamingState() {
      if (activeCount > 0) {
        setIsStreaming(true);
        setIsFallback(false);
      } else if (failedCount === containers.length) {
        setIsStreaming(false);
        setIsFallback(true);
      }
    }

    for (const container of containers) {
      const token = (() => {
        try {
          return window.localStorage.getItem(AUTH_TOKEN_KEY);
        } catch {
          return null;
        }
      })();

      const params = new URLSearchParams();
      if (timestamps) params.set('timestamps', 'true');
      // Start from now (epoch seconds) so we only get new lines
      params.set('since', String(Math.floor(Date.now() / 1000)));
      if (token) params.set('token', token);

      const base = API_BASE || window.location.origin;
      const url = `${base}/api/containers/${container.endpointId}/${container.id}/logs/stream?${params}`;

      const source = new EventSource(url);
      sources.set(container.id, source);

      source.onopen = () => {
        activeCount++;
        updateStreamingState();
      };

      source.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // Skip heartbeats and done/error events
          if (data.heartbeat || data.done || data.error) return;

          if (data.line) {
            const entry = parseStreamedLine(
              data.line,
              container.id,
              container.name,
              entryCounterRef.current++,
            );
            setStreamedEntries((prev) => [...prev, entry]);
          }
        } catch {
          // Ignore malformed events
        }
      };

      source.onerror = () => {
        // If it was previously open, decrement
        if (sources.has(container.id)) {
          activeCount = Math.max(0, activeCount - 1);
          failedCount++;
          source.close();
          sources.delete(container.id);
          updateStreamingState();
        }
      };
    }

    return () => {
      for (const [, source] of sources) {
        source.close();
      }
      sources.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerKey, enabled, timestamps]);

  return { streamedEntries, isStreaming, isFallback, reset };
}
