import { useState, useEffect, useCallback } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSockets } from '@/providers/socket-provider';

type Severity = 'critical' | 'warning' | 'info';

interface Insight {
  id: string;
  endpoint_id: number | null;
  endpoint_name: string | null;
  container_id: string | null;
  container_name: string | null;
  severity: Severity;
  category: string;
  title: string;
  description: string;
  suggested_action: string | null;
  is_acknowledged: number;
  created_at: string;
}

interface AcknowledgeResponse {
  success: boolean;
}

export function useMonitoring() {
  const { monitoringSocket } = useSockets();
  const [insights, setInsights] = useState<Insight[]>([]);
  const [subscribedSeverities, setSubscribedSeverities] = useState<Set<Severity>>(
    new Set(['critical', 'warning', 'info'])
  );

  const historyQuery = useQuery<{ insights: Insight[]; total: number }>({
    queryKey: ['monitoring', 'insights'],
    queryFn: () => api.get<{ insights: Insight[]; total: number }>('/api/monitoring/insights'),
  });

  useEffect(() => {
    if (historyQuery.data?.insights) {
      setInsights(historyQuery.data.insights);
    }
  }, [historyQuery.data]);

  useEffect(() => {
    if (!monitoringSocket) return;

    // Subscribe to all severities on connect
    monitoringSocket.emit('insights:subscribe', { severity: 'all' });

    const handleNewInsight = (insight: Insight) => {
      if (subscribedSeverities.has(insight.severity)) {
        setInsights((prev) => [insight, ...prev]);
      }
    };

    monitoringSocket.on('insights:new', handleNewInsight);

    return () => {
      monitoringSocket.off('insights:new', handleNewInsight);
    };
  }, [monitoringSocket, subscribedSeverities]);

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
