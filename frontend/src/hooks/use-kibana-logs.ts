import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface KibanaLogsOptions {
  query?: string;
  index?: string;
  startTime?: string;
  endTime?: string;
  size?: number;
  sort?: string;
  fields?: string[];
}

interface LogEntry {
  id: string;
  timestamp: string;
  level: string;
  message: string;
  source: string;
  fields: Record<string, unknown>;
}

interface KibanaLogsResult {
  hits: LogEntry[];
  total: number;
  took: number;
}

export function useKibanaLogs(options: KibanaLogsOptions) {
  return useQuery<KibanaLogsResult>({
    queryKey: ['kibana-logs', options],
    queryFn: async () => {
      const response = await api.get('/api/logs/search', { params: options });
      return response.data;
    },
    enabled: Boolean(options.query),
  });
}
