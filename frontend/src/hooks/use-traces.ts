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
  service?: string;
  operation?: string;
  minDuration?: number;
  maxDuration?: number;
  limit?: number;
  startTime?: string;
  endTime?: string;
}

interface ServiceMapNode {
  id: string;
  name: string;
  type: string;
  metrics: {
    requestRate: number;
    errorRate: number;
    avgLatency: number;
  };
}

interface ServiceMapEdge {
  source: string;
  target: string;
  requestRate: number;
  errorRate: number;
  avgLatency: number;
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

export function useServiceMap() {
  return useQuery<ServiceMap>({
    queryKey: ['traces', 'service-map'],
    queryFn: () => api.get<ServiceMap>('/api/traces/service-map'),
  });
}

export function useTraceSummary() {
  return useQuery<TraceSummary>({
    queryKey: ['traces', 'summary'],
    queryFn: () => api.get<TraceSummary>('/api/traces/summary'),
  });
}
