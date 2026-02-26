import { useState, useRef, useCallback } from 'react';
import { api } from '@/lib/api';

export type StreamStatus = 'idle' | 'connecting' | 'streaming' | 'reconnecting' | 'error' | 'stopped';

interface StreamingLogsOptions {
  maxLines?: number;
  timestamps?: boolean;
  autoReconnect?: boolean;
}

interface StreamingLogsResult {
  lines: string[];
  status: StreamStatus;
  error: string | null;
  start: () => void;
  stop: () => void;
  clear: () => void;
  reconnectCount: number;
}

const DEFAULT_MAX_LINES = 10_000;
const MAX_RECONNECT_ATTEMPTS = 10;
const HEARTBEAT_TIMEOUT_MS = 30_000;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

export function useStreamingLogs(
  endpointId: number | undefined,
  containerId: string | undefined,
  options?: StreamingLogsOptions,
): StreamingLogsResult {
  const maxLines = options?.maxLines ?? DEFAULT_MAX_LINES;
  const timestamps = options?.timestamps ?? true;
  const autoReconnect = options?.autoReconnect ?? true;

  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState<StreamStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [reconnectCount, setReconnectCount] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const stoppedRef = useRef(false);
  const reconnectCountRef = useRef(0);

  const clearHeartbeatTimer = useCallback(() => {
    if (heartbeatTimerRef.current) {
      clearTimeout(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const resetHeartbeatTimer = useCallback((onTimeout: () => void) => {
    clearHeartbeatTimer();
    heartbeatTimerRef.current = setTimeout(onTimeout, HEARTBEAT_TIMEOUT_MS);
  }, [clearHeartbeatTimer]);

  const appendLines = useCallback((newLines: string[]) => {
    setLines((prev) => {
      const combined = [...prev, ...newLines];
      if (combined.length > maxLines) {
        return combined.slice(combined.length - maxLines);
      }
      return combined;
    });
  }, [maxLines]);

  const connect = useCallback((since?: number) => {
    if (!endpointId || !containerId) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const isReconnect = since != null;
    setStatus(isReconnect ? 'reconnecting' : 'connecting');
    if (!isReconnect) {
      setError(null);
    }

    const baseUrl = import.meta.env.VITE_API_URL || window.location.origin;
    const url = new URL(`/api/containers/${endpointId}/${containerId}/logs/stream`, baseUrl);
    url.searchParams.set('timestamps', String(timestamps));
    if (since) url.searchParams.set('since', String(since));

    const token = api.getToken();

    const doConnect = async () => {
      try {
        const response = await fetch(url.toString(), {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          let msg = `Stream failed: ${response.status}`;
          try {
            const body = await response.json();
            if (body.error) msg = body.error;
          } catch { /* non-JSON response */ }
          setStatus('error');
          setError(msg);
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          setStatus('error');
          setError('Stream not available');
          return;
        }

        setStatus('streaming');
        if (isReconnect) {
          setError(null);
        }
        reconnectCountRef.current = 0;
        setReconnectCount(0);

        const decoder = new TextDecoder();
        let sseBuffer = '';

        const handleTimeout = () => {
          if (stoppedRef.current) return;
          // No heartbeat/data received — trigger reconnection
          controller.abort();
        };

        resetHeartbeatTimer(handleTimeout);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          resetHeartbeatTimer(handleTimeout);

          sseBuffer += decoder.decode(value, { stream: true });
          const sseLines = sseBuffer.split('\n');
          // Keep last incomplete line in the buffer
          sseBuffer = sseLines.pop() ?? '';

          const newLogLines: string[] = [];

          for (const sseLine of sseLines) {
            if (!sseLine.startsWith('data: ')) continue;
            try {
              const data = JSON.parse(sseLine.slice(6));

              if (data.line) {
                newLogLines.push(data.line);
                if (data.ts) lastTsRef.current = data.ts;
              }

              if (data.heartbeat && data.ts) {
                lastTsRef.current = data.ts;
              }

              if (data.done) {
                clearHeartbeatTimer();
                setStatus('stopped');
                return;
              }

              if (data.error) {
                setStatus('error');
                setError(data.error);
                clearHeartbeatTimer();
                return;
              }
            } catch {
              // Skip malformed SSE data
            }
          }

          if (newLogLines.length > 0) {
            appendLines(newLogLines);
          }
        }

        // Stream ended naturally
        clearHeartbeatTimer();

        if (!stoppedRef.current && autoReconnect) {
          scheduleReconnect();
        } else {
          setStatus('stopped');
        }
      } catch (err) {
        clearHeartbeatTimer();

        if (err instanceof DOMException && err.name === 'AbortError') {
          // Deliberate abort — either from stop() or heartbeat timeout
          if (!stoppedRef.current && autoReconnect) {
            scheduleReconnect();
          }
          return;
        }

        if (!stoppedRef.current && autoReconnect) {
          scheduleReconnect();
        } else {
          setStatus('error');
          setError(err instanceof Error ? err.message : 'Connection failed');
        }
      }
    };

    const scheduleReconnect = () => {
      if (stoppedRef.current) return;
      const attempt = reconnectCountRef.current;
      if (attempt >= MAX_RECONNECT_ATTEMPTS) {
        setStatus('error');
        setError(`Failed after ${MAX_RECONNECT_ATTEMPTS} reconnection attempts`);
        return;
      }

      reconnectCountRef.current = attempt + 1;
      setReconnectCount(attempt + 1);
      setStatus('reconnecting');

      const backoff = Math.min(INITIAL_BACKOFF_MS * Math.pow(2, attempt), MAX_BACKOFF_MS);
      reconnectTimerRef.current = setTimeout(() => {
        if (!stoppedRef.current) {
          connect(lastTsRef.current ? Math.floor(lastTsRef.current / 1000) : undefined);
        }
      }, backoff);
    };

    doConnect();
  }, [endpointId, containerId, timestamps, autoReconnect, appendLines, resetHeartbeatTimer, clearHeartbeatTimer]);

  const start = useCallback(() => {
    stoppedRef.current = false;
    reconnectCountRef.current = 0;
    setReconnectCount(0);
    setError(null);
    connect();
  }, [connect]);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    clearHeartbeatTimer();
    clearReconnectTimer();
    abortRef.current?.abort();
    setStatus('stopped');
  }, [clearHeartbeatTimer, clearReconnectTimer]);

  const clear = useCallback(() => {
    setLines([]);
    lastTsRef.current = null;
  }, []);

  return {
    lines,
    status,
    error,
    start,
    stop,
    clear,
    reconnectCount,
  };
}
