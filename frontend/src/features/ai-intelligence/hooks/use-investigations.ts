import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { InvestigationStatus, RecommendedAction, InvestigationWithInsight } from '@dashboard/contracts';
import { api } from '@/shared/lib/api';
import { useSockets } from '@/providers/socket-provider';

// Canonical wire shapes live in @dashboard/contracts (#1509). The list/detail
// endpoints return the investigation joined with its insight metadata, i.e.
// contracts' `InvestigationWithInsight`. Re-exported under the historical names
// so existing call sites keep working.
export type { InvestigationStatus, RecommendedAction };
export type Investigation = InvestigationWithInsight;

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
