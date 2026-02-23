import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface NlQueryResult {
  action: 'navigate' | 'answer' | 'filter' | 'error';
  page?: string;
  text?: string;
  description?: string;
  filters?: Record<string, string>;
  containerNames?: string[];
}

export function useNlQuery() {
  return useMutation<NlQueryResult, Error, string>({
    mutationFn: (query: string) =>
      api.post<NlQueryResult>('/api/llm/query', { query }),
  });
}
