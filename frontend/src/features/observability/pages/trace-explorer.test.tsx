import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/hooks/use-auto-refresh', () => ({
  useAutoRefresh: () => ({ interval: 0, setInterval: vi.fn() }),
}));

vi.mock('@/components/charts/service-map', () => ({
  ServiceMap: () => <div>mock-service-map</div>,
}));

vi.mock('@/components/shared/themed-select', () => ({
  ThemedSelect: ({ value, options, onValueChange, className }: {
    value: string;
    options: Array<{ value: string; label: string }>;
    onValueChange: (value: string) => void;
    className?: string;
  }) => (
    <select className={className} value={value} onChange={(e) => onValueChange(e.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
}));

const mockUseTraces = vi.fn();
const mockUseTrace = vi.fn();
const mockUseServiceMap = vi.fn();
const mockUseTraceSummary = vi.fn();

vi.mock('@/hooks/use-traces', () => ({
  useTraces: (...args: unknown[]) => mockUseTraces(...args),
  useTrace: (...args: unknown[]) => mockUseTrace(...args),
  useServiceMap: (...args: unknown[]) => mockUseServiceMap(...args),
  useTraceSummary: (...args: unknown[]) => mockUseTraceSummary(...args),
}));

import TraceExplorerPage from './trace-explorer';

describe('TraceExplorerPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockUseTraces.mockReturnValue({
      data: {
        traces: [
          {
            trace_id: 'trace-1',
            root_span: 'GET /health',
            duration_ms: 120,
            status: 'ok',
            service_name: 'api',
            start_time: '2026-02-12T10:00:00.000Z',
            trace_source: 'ebpf',
            span_count: 1,
            http_route: '/health',
            container_name: 'api-container',
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    });

    mockUseTrace.mockReturnValue({
      data: {
        traceId: 'trace-1',
        spans: [
          {
            span_id: 'span-1',
            parent_span_id: null,
            name: 'GET /health',
            service_name: 'api',
            start_time: '2026-02-12T10:00:00.000Z',
            duration_ms: 120,
            status: 'ok',
            trace_source: 'ebpf',
            attributes: JSON.stringify({
              endpoint: 'api-gateway',
              'container.name': 'api-container',
              'service.namespace': 'production',
              'service.instance.id': 'instance-a',
              'service.version': '1.8.2',
              'deployment.environment': 'prod',
              'container.id': 'container-abc',
              'k8s.namespace.name': 'payments',
              'k8s.pod.name': 'payments-api-9d7cc',
              'k8s.container.name': 'api',
              'server.address': '10.0.0.24',
              'server.port': 443,
              'client.address': '10.0.0.12',
              'url.full': 'http://api-gateway/health',
              'url.scheme': 'http',
              'network.transport': 'tcp',
              'network.protocol.name': 'http',
              'network.protocol.version': '1.1',
              'net.peer.name': 'api-gateway.internal',
              'net.peer.port': 8080,
              'host.name': 'srv-edge-01',
              'os.type': 'linux',
              'process.pid': 4711,
              'process.executable.name': 'http-echo',
              'process.command_line': '/bin/http-echo --port=8080',
              'telemetry.sdk.name': 'beyla',
              'telemetry.sdk.language': 'go',
              'telemetry.sdk.version': '2.8.5',
              'otel.scope.name': 'github.com/grafana/beyla',
              'otel.scope.version': 'v2.8.5',
            }),
          },
        ],
      },
    });

    mockUseServiceMap.mockReturnValue({ data: { nodes: [], edges: [] } });
    mockUseTraceSummary.mockReturnValue({
      data: {
        totalTraces: 12,
        avgDuration: 85,
        errorRate: 0.2,
        services: 4,
        sourceCounts: {
          http: 3,
          ebpf: 7,
          scheduler: 2,
          unknown: 0,
        },
      },
    });
  });

  it('renders source-scoped counters from summary', () => {
    render(<TraceExplorerPage />);

    expect(screen.getByText('Source counters:')).toBeInTheDocument();
    expect(screen.getByText('eBPF: 7')).toBeInTheDocument();
    expect(screen.getByText('HTTP: 3')).toBeInTheDocument();
    expect(screen.getByText('Scheduler: 2')).toBeInTheDocument();
    expect(screen.getByText('Tip: select a source below to focus this list.')).toBeInTheDocument();
    expect(screen.getByText('Need precision? Filter by HTTP route/status or service and container namespaces.')).toBeInTheDocument();
  });

  it('restores trace source context and span metadata details', () => {
    render(<TraceExplorerPage />);

    expect(screen.getByText('Tip: select a source below to focus this list.')).toBeInTheDocument();
    expect(screen.getByText('Showing all trace sources. Use a source filter to focus on a single ingestion path.')).toBeInTheDocument();
    expect(screen.getByText('eBPF Quick Guide')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /GET \/health/i }));

    expect(screen.getAllByText('endpoint: api-gateway').length).toBeGreaterThan(0);
    expect(screen.getAllByText('container: api-container').length).toBeGreaterThan(0);
    expect(screen.getByText('Service Namespace')).toBeInTheDocument();
    expect(screen.getAllByText('production').length).toBeGreaterThan(0);
    expect(screen.getByText('Service Instance')).toBeInTheDocument();
    expect(screen.getAllByText('instance-a').length).toBeGreaterThan(0);
    expect(screen.getByText('Service Version')).toBeInTheDocument();
    expect(screen.getAllByText('1.8.2').length).toBeGreaterThan(0);
    expect(screen.getByText('Deployment Environment')).toBeInTheDocument();
    expect(screen.getAllByText('prod').length).toBeGreaterThan(0);
    expect(screen.getByText('URL Full')).toBeInTheDocument();
    expect(screen.getAllByText('http://api-gateway/health').length).toBeGreaterThan(0);
    expect(screen.getByText('Network Transport')).toBeInTheDocument();
    expect(screen.getAllByText('tcp').length).toBeGreaterThan(0);
    expect(screen.getByText('Process PID')).toBeInTheDocument();
    expect(screen.getAllByText('4711').length).toBeGreaterThan(0);
    expect(screen.getByText('Telemetry SDK Name')).toBeInTheDocument();
    expect(screen.getAllByText('beyla').length).toBeGreaterThan(0);
  });

  it('applies advanced filters through trace query state', () => {
    render(<TraceExplorerPage />);

    fireEvent.click(screen.getByText('Show advanced filters'));
    fireEvent.change(screen.getByDisplayValue('Exact match'), { target: { value: 'contains' } });
    fireEvent.change(screen.getByPlaceholderText('/api/users/:id'), { target: { value: '/health' } });
    fireEvent.change(screen.getByPlaceholderText('500'), { target: { value: '200' } });
    fireEvent.change(screen.getByLabelText('Service Instance ID'), { target: { value: 'instance-a' } });
    fireEvent.change(screen.getByLabelText('Server Port'), { target: { value: '8443' } });
    fireEvent.change(screen.getByPlaceholderText('http://service:8080/path'), { target: { value: 'http://api-gateway/health' } });
    fireEvent.change(screen.getByPlaceholderText('tcp'), { target: { value: 'tcp' } });
    fireEvent.change(screen.getByPlaceholderText('/bin/http-echo --port 8080'), { target: { value: '/bin/http-echo --port=8080' } });
    fireEvent.change(screen.getByPlaceholderText('beyla'), { target: { value: 'beyla' } });

    const lastCall = mockUseTraces.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(lastCall.httpRoute).toBe('/health');
    expect(lastCall.httpRouteMatch).toBe('contains');
    expect(lastCall.httpStatusCode).toBe(200);
    expect(lastCall.serviceInstanceId).toBe('instance-a');
    expect(lastCall.serverPort).toBe(8443);
    expect(lastCall.urlFull).toBe('http://api-gateway/health');
    expect(lastCall.networkTransport).toBe('tcp');
    expect(lastCall.processCommand).toBe('/bin/http-echo --port=8080');
    expect(lastCall.telemetrySdkName).toBe('beyla');
  });

  it('shows container name alongside source on each trace card', () => {
    render(<TraceExplorerPage />);

    expect(screen.getByText('container: api-container')).toBeInTheDocument();
  });

  it('prefers typed span columns when attributes are sparse', () => {
    mockUseTrace.mockReturnValue({
      data: {
        traceId: 'trace-1',
        spans: [
          {
            span_id: 'span-typed-1',
            parent_span_id: null,
            name: 'GET /typed',
            service_name: 'api',
            start_time: '2026-02-12T10:00:00.000Z',
            duration_ms: 80,
            status: 'ok',
            trace_source: 'ebpf',
            http_route: '/typed-route',
            container_name: 'typed-container',
            service_namespace: 'typed-namespace',
            service_instance_id: 'typed-instance',
            service_version: '9.9.9',
            deployment_environment: 'staging',
            server_address: 'typed-host.internal',
            attributes: '{}',
          },
        ],
      },
    });

    render(<TraceExplorerPage />);

    fireEvent.click(screen.getByRole('button', { name: /GET \/health/i }));

    expect(screen.getAllByText('endpoint: /typed-route').length).toBeGreaterThan(0);
    expect(screen.getAllByText('container: typed-container').length).toBeGreaterThan(0);
    expect(screen.getAllByText('typed-namespace').length).toBeGreaterThan(0);
    expect(screen.getAllByText('typed-instance').length).toBeGreaterThan(0);
    expect(screen.getAllByText('9.9.9').length).toBeGreaterThan(0);
    expect(screen.getAllByText('staging').length).toBeGreaterThan(0);
    expect(screen.getAllByText('typed-host.internal').length).toBeGreaterThan(0);
  });
});
