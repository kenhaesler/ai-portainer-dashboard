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

export interface TracesOptions {
  from?: string;
  to?: string;
  serviceName?: string;
  source?: string;
  status?: 'ok' | 'error' | 'unset';
  minDuration?: number;
  limit?: number;
  httpMethod?: string;
  httpRoute?: string;
  httpRouteMatch?: 'exact' | 'contains';
  httpStatusCode?: number;
  serviceNamespace?: string;
  serviceNamespaceMatch?: 'exact' | 'contains';
  serviceInstanceId?: string;
  serviceVersion?: string;
  deploymentEnvironment?: string;
  containerId?: string;
  containerName?: string;
  containerNameMatch?: 'exact' | 'contains';
  k8sNamespace?: string;
  k8sNamespaceMatch?: 'exact' | 'contains';
  k8sPodName?: string;
  k8sContainerName?: string;
  serverAddress?: string;
  serverPort?: number;
  clientAddress?: string;
  urlFull?: string;
  urlFullMatch?: 'exact' | 'contains';
  urlScheme?: string;
  networkTransport?: string;
  networkProtocolName?: string;
  networkProtocolVersion?: string;
  netPeerName?: string;
  netPeerNameMatch?: 'exact' | 'contains';
  netPeerPort?: number;
  hostName?: string;
  hostNameMatch?: 'exact' | 'contains';
  osType?: string;
  processPid?: number;
  processExecutableName?: string;
  processExecutableNameMatch?: 'exact' | 'contains';
  processCommand?: string;
  processCommandMatch?: 'exact' | 'contains';
  telemetrySdkName?: string;
  telemetrySdkLanguage?: string;
  telemetrySdkVersion?: string;
  otelScopeName?: string;
  otelScopeVersion?: string;
}

interface ServiceMapNode {
  id: string;
  name: string;
  callCount?: number;
  avgDuration?: number;
  errorRate?: number;
}

interface ServiceMapEdge {
  source: string;
  target: string;
  callCount?: number;
  avgDuration?: number;
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
  sourceCounts?: {
    http: number;
    ebpf: number;
    scheduler: number;
    unknown: number;
  };
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

export function useTraceSummary(options?: Omit<TracesOptions, 'limit'>) {
  return useQuery<TraceSummary>({
    queryKey: ['traces', 'summary', options],
    queryFn: () => api.get<TraceSummary>(
      '/api/traces/summary',
      { params: options as Record<string, string | number | boolean | undefined> }
    ),
  });
}
