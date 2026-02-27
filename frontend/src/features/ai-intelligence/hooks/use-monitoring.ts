import { useState, useEffect, useCallback, useRef } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { Insight, Severity } from '@dashboard/contracts';
import { api } from '@/shared/lib/api';
import { useSockets } from '@/providers/socket-provider';

export type { Insight, Severity };

interface AcknowledgeResponse {
  success: boolean;
}

const MAX_INSIGHTS = 1000;
const BATCH_DEBOUNCE_MS = 300;

export function useMonitoring() {
  const { monitoringSocket } = useSockets();
  const [insights, setInsights] = useState<Insight[]>([]);
  const [subscribedSeverities, setSubscribedSeverities] = useState<Set<Severity>>(
    new Set(['critical', 'warning', 'info'])
  );

  // Buffer for debounced batch updates
  const batchBufferRef = useRef<Insight[]>([]);
  const batchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const historyQuery = useQuery<{ insights: Insight[]; total: number }>({
    queryKey: ['monitoring', 'insights'],
    queryFn: () => api.get<{ insights: Insight[]; total: number }>('/api/monitoring/insights'),
    staleTime: 60_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (historyQuery.data?.insights) {
      setInsights(historyQuery.data.insights.slice(0, MAX_INSIGHTS));
    }
  }, [historyQuery.data]);

  const flushBatch = useCallback(() => {
    const buffered = batchBufferRef.current;
    if (buffered.length === 0) return;
    batchBufferRef.current = [];

    setInsights((prev) => {
      const merged = [...buffered, ...prev];
      return merged.slice(0, MAX_INSIGHTS);
    });
  }, []);

  const enqueueInsights = useCallback(
    (newInsights: Insight[]) => {
      batchBufferRef.current = [...newInsights, ...batchBufferRef.current];

      if (batchTimerRef.current) {
        clearTimeout(batchTimerRef.current);
      }
      batchTimerRef.current = setTimeout(flushBatch, BATCH_DEBOUNCE_MS);
    },
    [flushBatch]
  );

  useEffect(() => {
    if (!monitoringSocket) return;

    // Subscribe to all severities on connect
    monitoringSocket.emit('insights:subscribe', { severity: 'all' });

    const handleNewInsight = (insight: Insight) => {
      if (subscribedSeverities.has(insight.severity)) {
        enqueueInsights([insight]);
      }
    };

    const handleBatchInsights = (batch: Insight[]) => {
      const filtered = batch.filter((i) => subscribedSeverities.has(i.severity));
      if (filtered.length > 0) {
        enqueueInsights(filtered);
      }
    };

    monitoringSocket.on('insights:new', handleNewInsight);
    monitoringSocket.on('insights:batch', handleBatchInsights);

    return () => {
      monitoringSocket.off('insights:new', handleNewInsight);
      monitoringSocket.off('insights:batch', handleBatchInsights);
      if (batchTimerRef.current) {
        clearTimeout(batchTimerRef.current);
      }
    };
  }, [monitoringSocket, subscribedSeverities, enqueueInsights]);

  const subscribeSeverity = useCallback((severity: Severity) => {
    setSubscribedSeverities((prev) => {
      const next = new Set(prev);
      next.add(severity);
      return next;
    });
  }, []);

  const unsubscribeSeverity = useCallback((severity: Severity) => {
    setSubscribedSeverities((prev) => {
      const next = new Set(prev);
      next.delete(severity);
      return next;
    });
  }, []);

  const acknowledgeInsight = useMutation({
    mutationFn: async (id: string) => {
      return api.post<AcknowledgeResponse>(`/api/monitoring/insights/${id}/acknowledge`);
    },
    onMutate: async (id) => {
      let previousInsights: Insight[] = [];
      setInsights((prev) => {
        previousInsights = prev;
        return prev.map((insight) =>
          insight.id === id ? { ...insight, is_acknowledged: 1 } : insight
        );
      });
      return { previousInsights };
    },
    onError: (_error, _id, context) => {
      if (context?.previousInsights) {
        setInsights(context.previousInsights);
      }
    },
  });

  return {
    insights,
    isLoading: historyQuery.isLoading,
    error: historyQuery.error,
    subscribedSeverities,
    subscribeSeverity,
    unsubscribeSeverity,
    acknowledgeInsight: acknowledgeInsight.mutate,
    acknowledgeError: acknowledgeInsight.error,
    isAcknowledging: acknowledgeInsight.isPending,
    acknowledgingInsightId: acknowledgeInsight.variables ?? null,
    refetch: historyQuery.refetch,
  };
}
