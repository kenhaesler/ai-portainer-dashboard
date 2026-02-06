import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface LlmModel {
  name: string;
  size?: number;
  modified?: string;
}

interface LlmModelsResponse {
  models: LlmModel[];
  default: string;
}

export function useLlmModels() {
  return useQuery<LlmModelsResponse>({
    queryKey: ['llm-models'],
    queryFn: () => api.get<LlmModelsResponse>('/api/llm/models'),
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 1,
  });
}
