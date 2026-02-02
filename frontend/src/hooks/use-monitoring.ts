import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSockets } from '@/providers/socket-provider';

type Severity = 'critical' | 'warning' | 'info';

interface Insight {
  id: string;
  type: string;
  severity: Severity;
  title: string;
  description: string;
  source: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
  acknowledged: boolean;
}

export function useMonitoring() {
  const { monitoringSocket } = useSockets();
  const [insights, setInsights] = useState<Insight[]>([]);
  const [subscribedSeverities, setSubscribedSeverities] = useState<Set<Severity>>(
    new Set(['critical', 'warning', 'info'])
  );

  const historyQuery = useQuery<Insight[]>({
    queryKey: ['monitoring', 'insights'],
    queryFn: async () => {
      const response = await api.get('/api/monitoring/insights');
      return response.data;
    },
  });

  useEffect(() => {
    if (historyQuery.data) {
      setInsights(historyQuery.data);
    }
  }, [historyQuery.data]);

  useEffect(() => {
    if (!monitoringSocket) return;

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

  return {
    insights,
    isLoading: historyQuery.isLoading,
    error: historyQuery.error,
    subscribedSeverities,
    subscribeSeverity,
    unsubscribeSeverity,
    refetch: historyQuery.refetch,
  };
}
