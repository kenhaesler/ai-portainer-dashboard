import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  operationName: string;
  serviceName: string;
  startTime: string;
  duration: number;
  status: 'ok' | 'error' | 'unset';
  attributes?: Record<string, unknown>;
}

interface Trace {
  traceId: string;
  spans: Span[];
  rootSpan: Span;
  duration: number;
  services: string[];
  startTime: string;
  status: 'ok' | 'error' | 'unset';
}

interface TracesOptions {
  from?: string;
  to?: string;
  serviceName?: string;
  source?: string;
  status?: 'ok' | 'error' | 'unset';
  minDuration?: number;
  limit?: number;
}

interface ServiceMapNode {
  id: string;
  name: string;
  type?: string;
  callCount?: number;
  avgDuration?: number;
  errorRate?: number;
  metrics?: {
    requestRate: number;
    errorRate: number;
    avgLatency: number;
  };
}

interface ServiceMapEdge {
  source: string;
  target: string;
  callCount?: number;
  avgDuration?: number;
  requestRate?: number;
  errorRate?: number;
  avgLatency?: number;
}

interface ServiceMap {
  nodes: ServiceMapNode[];
  edges: ServiceMapEdge[];
}

interface TraceSummary {
  totalTraces: number;
  avgDuration: number;
  errorRate: number;
  services: number;
  topOperations: Array<{
    name: string;
    count: number;
    avgDuration: number;
  }>;
}

export function useTraces(options?: TracesOptions) {
  return useQuery<Trace[]>({
    queryKey: ['traces', options],
    queryFn: () => api.get<Trace[]>(
      '/api/traces',
      { params: options as Record<string, string | number | boolean | undefined> }
    ),
  });
}

export function useTrace(traceId: string | undefined) {
  return useQuery<Trace>({
    queryKey: ['traces', traceId],
    queryFn: () => api.get<Trace>(`/api/traces/${traceId}`),
    enabled: Boolean(traceId),
  });
}

export function useServiceMap(options?: TracesOptions) {
  return useQuery<ServiceMap>({
    queryKey: ['traces', 'service-map', options],
    queryFn: () => api.get<ServiceMap>(
      '/api/traces/service-map',
      { params: options as Record<string, string | number | boolean | undefined> }
    ),
  });
}

export function useTraceSummary(options?: Pick<TracesOptions, 'from' | 'to'>) {
  return useQuery<TraceSummary>({
    queryKey: ['traces', 'summary', options],
    queryFn: () => api.get<TraceSummary>(
      '/api/traces/summary',
      { params: options as Record<string, string | number | boolean | undefined> }
    ),
  });
}
