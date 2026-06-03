import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useCaptures, type Capture } from '@/features/security/hooks/use-pcap';
import { useEndpoints } from '@/features/containers/hooks/use-endpoints';
import { useContainers } from '@/features/containers/hooks/use-containers';
import { useStacks } from '@/features/containers/hooks/use-stacks';

vi.mock('@/features/containers/hooks/use-endpoints', () => ({
  useEndpoints: vi.fn().mockReturnValue({
    data: [{ id: 1, name: 'local' }],
  }),
  useEndpointCapabilities: vi.fn().mockReturnValue({
    capabilities: { exec: true, realtimeLogs: true, liveStats: true, immediateActions: true },
    isEdgeAsync: false,
    endpoint: undefined,
  }),
}));

vi.mock('@/features/containers/hooks/use-containers', () => ({
  useContainers: vi.fn().mockReturnValue({
    data: [
      { id: 'c1', name: 'api-1', image: 'api:1', state: 'running', status: 'Up', endpointId: 1, endpointName: 'local', ports: [], created: 0, networks: [], labels: { 'com.docker.compose.project': 'alpha' } },
      { id: 'c2', name: 'worker-1', image: 'worker:1', state: 'running', status: 'Up', endpointId: 1, endpointName: 'local', ports: [], created: 0, networks: [], labels: { 'com.docker.compose.project': 'alpha' } },
      { id: 'c4', name: 'beta-api-1', image: 'beta:1', state: 'running', status: 'Up', endpointId: 1, endpointName: 'local', ports: [], created: 0, networks: [], labels: { 'com.docker.compose.project': 'beta' } },
      { id: 'c3', name: 'standalone-1', image: 'std:1', state: 'running', status: 'Up', endpointId: 1, endpointName: 'local', ports: [], created: 0, networks: [], labels: {} },
    ],
  }),
}));

vi.mock('@/features/containers/hooks/use-stacks', () => ({
  useStacks: vi.fn().mockReturnValue({
    data: [
      { id: 1, name: 'alpha', endpointId: 1, type: 1, status: 'active', envCount: 0 },
      { id: 2, name: 'beta', endpointId: 1, type: 1, status: 'active', envCount: 0 },
    ],
  }),
}));

vi.mock('@/features/security/hooks/use-pcap', () => ({
  useCaptures: vi.fn().mockReturnValue({
    data: { captures: [] },
    refetch: vi.fn(),
  }),
  useStartCapture: vi.fn().mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  }),
  useStopCapture: vi.fn().mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  }),
  useDeleteCapture: vi.fn().mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  }),
  useAnalyzeCapture: vi.fn().mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    variables: undefined,
  }),
  downloadCapture: vi.fn(),
}));

vi.mock('@/shared/lib/api', () => ({
  api: {
    getToken: vi.fn().mockReturnValue(null),
  },
}));

import PacketCapture from './packet-capture';

const mockUseCaptures = vi.mocked(useCaptures);

function makeCapture(overrides: Partial<Capture> = {}): Capture {
  return {
    id: 'cap-12345678-abcd',
    endpoint_id: 1,
    container_id: 'c1',
    container_name: 'api-1',
    status: 'complete',
    filter: 'port 80',
    duration_seconds: 60,
    max_packets: null,
    capture_file: '/tmp/cap.pcap',
    file_size_bytes: 2048,
    packet_count: 10,
    protocol_stats: null,
    exec_id: null,
    error_message: null,
    started_at: '2026-05-29T10:00:00.000Z',
    completed_at: '2026-05-29T10:01:00.000Z',
    created_at: '2026-05-29T10:00:00.000Z',
    analysis_result: null,
    ...overrides,
  };
}

describe('PacketCapture', () => {
  it('shows capture targets without selecting an endpoint first', () => {
    render(<PacketCapture />);
    const input = screen.getByLabelText('Search capture target container');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'api-1' } });
    expect(screen.getByText('api-1')).toBeInTheDocument();
  });

  it('disables Start until a target is selected', () => {
    render(<PacketCapture />);
    expect(screen.getByRole('button', { name: /start capture/i })).toBeDisabled();
  });

  it('shows the empty state when there are no captures', () => {
    mockUseCaptures.mockReturnValue({ data: { captures: [] }, refetch: vi.fn() } as unknown as ReturnType<typeof useCaptures>);
    render(<PacketCapture />);

    expect(screen.getByText('No captures found')).toBeInTheDocument();
    expect(screen.queryByTestId('data-table')).not.toBeInTheDocument();
  });

  it('renders the capture history in a DataTable with column headers and row data', () => {
    mockUseCaptures.mockReturnValue({
      data: {
        captures: [
          makeCapture({ id: 'aaaaaaaa-1111', container_name: 'web-1', filter: 'tcp', file_size_bytes: 1024 }),
        ],
      },
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useCaptures>);

    render(<PacketCapture />);

    const table = screen.getByTestId('data-table');
    expect(table).toBeInTheDocument();

    // Headers preserved from the original hand-rolled table
    expect(within(table).getByText('Container')).toBeInTheDocument();
    expect(within(table).getByText('Status')).toBeInTheDocument();
    expect(within(table).getByText('Filter')).toBeInTheDocument();
    expect(within(table).getByText('File Size')).toBeInTheDocument();
    expect(within(table).getByText('Created')).toBeInTheDocument();
    expect(within(table).getByText('Actions')).toBeInTheDocument();

    // Row content + cell formatting preserved
    expect(within(table).getByText('web-1')).toBeInTheDocument();
    expect(within(table).getByText('aaaaaaaa')).toBeInTheDocument();
    expect(within(table).getByText('tcp')).toBeInTheDocument();
    expect(within(table).getByText('1 KB')).toBeInTheDocument();

    // Download + delete actions available for a completed capture with a file
    expect(within(table).getByTitle('Download PCAP')).toBeInTheDocument();
    expect(within(table).getByTitle('Delete capture')).toBeInTheDocument();
  });

  it('passes the history search term to useCaptures', async () => {
    render(<PacketCapture />);
    fireEvent.change(screen.getByLabelText('Search capture history'), { target: { value: 'web' } });
    await waitFor(() =>
      expect(mockUseCaptures).toHaveBeenCalledWith(expect.objectContaining({ search: 'web' })),
    );
  });

  it('shows the endpoint name in the history table', () => {
    mockUseCaptures.mockReturnValue({
      data: { captures: [makeCapture({ endpoint_id: 1, container_name: 'web-1' })] },
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useCaptures>);
    render(<PacketCapture />);
    expect(screen.getByText('local')).toBeInTheDocument();
  });
});

// ── Empty / unavailable fleet (#1420) ───────────────────────────────────────

describe('PacketCapture — empty/unavailable fleet (#1420)', () => {
  it('renders without throwing when endpoints, containers and stacks return empty arrays', () => {
    vi.mocked(useEndpoints).mockReturnValue({ data: [], isLoading: false } as any);
    vi.mocked(useContainers).mockReturnValue({ data: [], isLoading: false } as any);
    vi.mocked(useStacks).mockReturnValue({ data: [], isLoading: false } as any);

    expect(() => render(<PacketCapture />)).not.toThrow();
    expect(screen.getByRole('heading', { name: /Packet Capture/i })).toBeInTheDocument();
  });

  it('renders without throwing when endpoints, containers and stacks return undefined', () => {
    vi.mocked(useEndpoints).mockReturnValue({ data: undefined, isLoading: false } as any);
    vi.mocked(useContainers).mockReturnValue({ data: undefined, isLoading: false } as any);
    vi.mocked(useStacks).mockReturnValue({ data: undefined, isLoading: false } as any);

    expect(() => render(<PacketCapture />)).not.toThrow();
    expect(screen.getByRole('heading', { name: /Packet Capture/i })).toBeInTheDocument();
  });
});
