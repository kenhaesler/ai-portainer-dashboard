import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface NlQueryResult {
  action: 'navigate' | 'answer' | 'error';
  page?: string;
  text?: string;
  description?: string;
}

export function useNlQuery() {
  return useMutation<NlQueryResult, Error, string>({
    mutationFn: (query: string) =>
      api.post<NlQueryResult>('/api/llm/query', { query }),
  });
}
