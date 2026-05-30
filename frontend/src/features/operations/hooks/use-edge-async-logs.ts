import { useState, useCallback, useRef, useEffect } from 'react';
import { api } from '@/shared/lib/api';

export type EdgeAsyncLogStatus = 'idle' | 'initiating' | 'collecting' | 'complete' | 'error';

interface CollectResponse {
  jobId: number;
  status: string;
}

interface LogsReadyResponse {
  logs: string;
  containerId: string;
  endpointId: number;
  durationMs: number;
  source: string;
}

const MAX_POLLS = 24; // 24 * 5s = 120s max
const POLL_INTERVAL_MS = 5000;

export function useEdgeAsyncLogs(endpointId: number | undefined, containerId: string | undefined) {
  const [status, setStatus] = useState<EdgeAsyncLogStatus>('idle');
  const [logs, setLogs] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCountRef = useRef(0);

  const clearPoll = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    pollCountRef.current = 0;
  }, []);

  // Cleanup on unmount
  useEffect(() => clearPoll, [clearPoll]);

  const collect = useCallback(async (opts?: { tail?: number }) => {
    if (!endpointId || !containerId) return;

    setStatus('initiating');
    setLogs(null);
    setDurationMs(null);
    setError(null);
    clearPoll();

    let jobId: number;

    try {
      const res = await api.post<CollectResponse>(
        `/api/containers/${endpointId}/${containerId}/logs/collect`,
        opts?.tail ? { tail: opts.tail } : undefined,
      );
      jobId = res.jobId;
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Failed to initiate log collection');
      return;
    }

    setStatus('collecting');
    pollCountRef.current = 0;

    pollIntervalRef.current = setInterval(async () => {
      pollCountRef.current += 1;

      if (pollCountRef.current > MAX_POLLS) {
        clearPoll();
        setStatus('error');
        setError('Log collection timed out. The Edge agent may be offline or slow to respond.');
        return;
      }

      try {
        const res = await api.get<CollectResponse | LogsReadyResponse>(
          `/api/containers/${endpointId}/${containerId}/logs/collect/${jobId}`,
        );

        if ('logs' in res) {
          clearPoll();
          setLogs(res.logs);
          setDurationMs(res.durationMs);
          setStatus('complete');
        }
        // else still 'collecting' — keep polling
      } catch (err) {
        clearPoll();
        setStatus('error');
        setError(err instanceof Error ? err.message : 'Failed to retrieve logs');
      }
    }, POLL_INTERVAL_MS);
  }, [endpointId, containerId, clearPoll]);

  const reset = useCallback(() => {
    clearPoll();
    setStatus('idle');
    setLogs(null);
    setDurationMs(null);
    setError(null);
  }, [clearPoll]);

  return { status, logs, durationMs, error, collect, reset };
}
