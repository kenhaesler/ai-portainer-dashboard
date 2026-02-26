import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/lib/api';

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
    queryFn: () => {
      const { fields, ...rest } = options;
      const params: Record<string, string | number | boolean | undefined> = {
        ...rest,
        fields: fields?.join(','),
      };
      return api.get<KibanaLogsResult>('/api/logs/search', { params });
    },
    enabled: Boolean(options.query),
  });
}
