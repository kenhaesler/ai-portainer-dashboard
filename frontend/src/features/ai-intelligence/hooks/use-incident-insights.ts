import { useQueries } from '@tanstack/react-query';
import type { Insight } from '@dashboard/contracts';
import { api } from '@/shared/lib/api';

// The related-insights payload is a plain Insight row (#1509 — was a
// hand-maintained copy that drifted from the shared contract).
export type IncidentInsight = Insight;

interface IncidentDetailResponse {
  id: string;
  relatedInsights: IncidentInsight[];
}

export interface UseIncidentInsightsResult {
  insights: IncidentInsight[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}

/**
 * Fetch the related insights for one or more incidents in parallel.
 *
 * Used by the incident-groups view to render the underlying events when a
 * row is expanded. Multiple incidents on the same (signature, container) pair
 * may share insights; results are deduped by insight.id and ordered by
 * created_at DESC (most-recent first).
 */
export function useIncidentInsights(ids: string[]): UseIncidentInsightsResult {
  const queries = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['incident-detail', id],
      queryFn: () => api.get<IncidentDetailResponse>(`/api/incidents/${id}`),
      retry: false,
    })),
  });

  if (ids.length === 0) {
    return { insights: [], isLoading: false, isError: false, error: null };
  }

  const isLoading = queries.some((q) => q.isLoading);
  // Treat as fully errored only if every query errored — partial success still surfaces results.
  const isError = queries.length > 0 && queries.every((q) => q.isError);
  const firstError = queries.find((q) => q.error)?.error as Error | undefined;

  const seen = new Set<string>();
  const insights: IncidentInsight[] = [];
  for (const q of queries) {
    for (const ins of q.data?.relatedInsights ?? []) {
      if (seen.has(ins.id)) continue;
      seen.add(ins.id);
      insights.push(ins);
    }
  }
  insights.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));

  return { insights, isLoading, isError, error: firstError ?? null };
}
