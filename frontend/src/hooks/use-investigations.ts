import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSockets } from '@/providers/socket-provider';

export type InvestigationStatus = 'pending' | 'gathering' | 'analyzing' | 'complete' | 'failed';

export interface RecommendedAction {
  action: string;
  priority: 'high' | 'medium' | 'low';
  rationale?: string;
}

export interface Investigation {
  id: string;
  insight_id: string;
  endpoint_id: number | null;
  container_id: string | null;
  container_name: string | null;
  status: InvestigationStatus;
  evidence_summary: string | null;
  root_cause: string | null;
  contributing_factors: string | null;
  severity_assessment: string | null;
  recommended_actions: string | null;
  confidence_score: number | null;
  analysis_duration_ms: number | null;
  llm_model: string | null;
  ai_summary: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
  insight_title?: string;
  insight_severity?: string;
  insight_category?: string;
}

export function safeParseJson<T>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function useInvestigations() {
  const { monitoringSocket } = useSockets();
  const [investigations, setInvestigations] = useState<Investigation[]>([]);

  const query = useQuery<{ investigations: Investigation[] }>({
    queryKey: ['investigations'],
    queryFn: () => api.get<{ investigations: Investigation[] }>('/api/investigations'),
  });

  useEffect(() => {
    if (query.data?.investigations) {
      setInvestigations(query.data.investigations);
    }
  }, [query.data]);

  useEffect(() => {
    if (!monitoringSocket) return;

    const handleComplete = (investigation: Investigation) => {
      setInvestigations((prev) => {
        const idx = prev.findIndex((i) => i.id === investigation.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = investigation;
          return next;
        }
        return [investigation, ...prev];
      });
    };

    const handleUpdate = (data: { id: string; status: InvestigationStatus }) => {
      setInvestigations((prev) =>
        prev.map((i) => (i.id === data.id ? { ...i, status: data.status } : i)),
      );
    };

    monitoringSocket.on('investigation:complete', handleComplete);
    monitoringSocket.on('investigation:update', handleUpdate);

    return () => {
      monitoringSocket.off('investigation:complete', handleComplete);
      monitoringSocket.off('investigation:update', handleUpdate);
    };
  }, [monitoringSocket]);

  const getInvestigationForInsight = useCallback(
    (insightId: string): Investigation | undefined => {
      return investigations.find((i) => i.insight_id === insightId);
    },
    [investigations],
  );

  return {
    investigations,
    isLoading: query.isLoading,
    error: query.error,
    getInvestigationForInsight,
    refetch: query.refetch,
  };
}

export function useInvestigationDetail(id: string | undefined) {
  return useQuery<Investigation>({
    queryKey: ['investigation', id],
    queryFn: () => api.get<Investigation>(`/api/investigations/${id}`),
    enabled: Boolean(id),
  });
}

export function useInvestigationByInsightId(insightId: string | undefined) {
  return useQuery<Investigation>({
    queryKey: ['investigation', 'by-insight', insightId],
    queryFn: () => api.get<Investigation>(`/api/investigations/by-insight/${insightId}`),
    enabled: Boolean(insightId),
  });
}
