import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useCaptures, type Capture } from '@/features/security/hooks/use-pcap';

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

let mockRole: 'admin' | 'operator' | 'viewer' = 'admin';
vi.mock('@/providers/auth-provider', () => ({
  useAuth: () => ({ role: mockRole, username: 'tester', isAuthenticated: true }),
}));

import PacketCapture, { captureStatusGroup, filterCapturesByGroup } from './packet-capture';

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
    // Derived from "now": started_at feeds formatElapsed(), a
    // wall-clock-relative computation (#1449).
    started_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
    completed_at: new Date(Date.now() - 60 * 1000).toISOString(),
    created_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
    analysis_result: null,
    ...overrides,
  };
}

describe('PacketCapture', () => {
  beforeEach(() => {
    mockRole = 'admin';
    mockUseCaptures.mockReturnValue({
      data: { captures: [] },
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useCaptures>);
  });

  it('shows capture targets without selecting an endpoint first', () => {
    render(<PacketCapture />);
    const input = screen.getByLabelText('Search capture target container');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'api-1' } });
    expect(screen.getByText('api-1')).toBeInTheDocument();
  });

  it('renders one h1 matching the navigation label', () => {
    render(<PacketCapture />);
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent('Packet Capture');
  });

  it('disables Start until a target is selected, and says why', () => {
    render(<PacketCapture />);

    const start = screen.getByRole('button', { name: /start capture/i });
    expect(start).toBeDisabled();
    expect(start).toHaveAttribute('title', 'Select a target container');
    // A disabled primary must not be a faded primary — it has to read as
    // muted surface + muted text.
    expect(start.className).toContain('bg-muted');
    expect(start.className).not.toContain('bg-primary');
    expect(screen.getByText('Select a target container')).toBeInTheDocument();
  });

  it('disables Start for a non-admin and names the reason', () => {
    mockRole = 'viewer';
    render(<PacketCapture />);

    const start = screen.getByRole('button', { name: /start capture/i });
    expect(start).toBeDisabled();
    expect(start).toHaveAttribute('title', 'Requires the admin role');
    expect(screen.getByText('Requires the admin role')).toBeInTheDocument();
  });

  it('shows the first-run guidance when there are no captures at all', () => {
    render(<PacketCapture />);

    // Search-result framing replaced with what an operator needs before their
    // first capture.
    expect(screen.queryByText('No captures found')).not.toBeInTheDocument();
    expect(screen.getByText('No captures yet')).toBeInTheDocument();
    expect(screen.getByText(/docker exec/)).toBeInTheDocument();
    expect(screen.getByText(/pcap volume/)).toBeInTheDocument();
    expect(screen.queryByTestId('data-table')).not.toBeInTheDocument();
  });

  describe('status tabs', () => {
    it('offers four groups and never Complete alongside Succeeded', () => {
      render(<PacketCapture />);

      for (const label of ['All', 'Running', 'Finished', 'Failed']) {
        expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
      }
      expect(screen.queryByRole('button', { name: 'Complete' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Succeeded' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Active' })).not.toBeInTheDocument();
    });

    it('lands both complete and succeeded captures in the same Finished tab', () => {
      mockUseCaptures.mockReturnValue({
        data: {
          captures: [
            makeCapture({ id: 'a-1', container_name: 'done-complete', status: 'complete' }),
            makeCapture({ id: 'b-2', container_name: 'done-succeeded', status: 'succeeded' }),
            makeCapture({ id: 'c-3', container_name: 'broken', status: 'failed' }),
          ],
        },
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useCaptures>);

      render(<PacketCapture />);
      fireEvent.click(screen.getByRole('button', { name: 'Finished' }));

      const table = screen.getByTestId('data-table');
      expect(within(table).getByText('done-complete')).toBeInTheDocument();
      expect(within(table).getByText('done-succeeded')).toBeInTheDocument();
      expect(within(table).queryByText('broken')).not.toBeInTheDocument();
    });

    it('tells the operator where the rest of their history went', () => {
      mockUseCaptures.mockReturnValue({
        data: { captures: [makeCapture({ id: 'a-1', status: 'complete' })] },
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useCaptures>);

      render(<PacketCapture />);
      fireEvent.click(screen.getByRole('button', { name: 'Failed' }));

      expect(screen.getByText('No failed captures')).toBeInTheDocument();
      expect(screen.getByText(/1 capture in history/)).toBeInTheDocument();
      // Not the first-run guidance — there IS history, just not in this tab.
      expect(screen.queryByText('No captures yet')).not.toBeInTheDocument();
    });
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

  it('disables the destructive row actions for a non-admin', () => {
    mockRole = 'viewer';
    mockUseCaptures.mockReturnValue({
      data: { captures: [makeCapture({ id: 'aaaaaaaa-1111', container_name: 'web-1' })] },
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useCaptures>);

    render(<PacketCapture />);
    const table = screen.getByTestId('data-table');

    // Every mutating pcap route is requireRole('admin') on the backend; the
    // page used to show a live Delete/Stop/Analyze to a viewer regardless.
    const gated = within(table).getAllByTitle('Requires the admin role');
    expect(gated.length).toBeGreaterThan(0);
    for (const button of gated) expect(button).toBeDisabled();
    // Download is a read and stays available.
    expect(within(table).getByTitle('Download PCAP')).toBeEnabled();
  });

  // The analysis panel: a confidence badge must reflect what the model said,
  // and say nothing when the model said nothing.
  describe('analysis confidence badge', () => {
    // `analysis_result` is a JSONB column and the pg driver parses it, so the
    // API sends an OBJECT. Using a JSON string here would test a shape the
    // server never returns — which is how a `JSON.parse` on the parsed object
    // went unnoticed while hiding this entire panel.
    function analysisPayload(confidence: number | null) {
      return {
        health_status: 'degraded',
        summary: 'Retransmissions above baseline',
        findings: [],
        confidence_score: confidence,
      };
    }

    function renderWithAnalysis(confidence: number | null, asJsonString = false) {
      const payload = analysisPayload(confidence);
      mockUseCaptures.mockReturnValue({
        data: {
          captures: [
            makeCapture({
              id: 'cap-analysis',
              analysis_result: asJsonString ? JSON.stringify(payload) : payload,
            }),
          ],
        },
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useCaptures>);

      render(<PacketCapture />);
      fireEvent.click(screen.getByTitle('Toggle analysis'));
    }

    it('renders the panel from the parsed-JSONB object the API actually sends', () => {
      renderWithAnalysis(0.82);
      expect(screen.getByText('Retransmissions above baseline')).toBeInTheDocument();
    });

    it('still accepts a JSON string, for tolerance', () => {
      renderWithAnalysis(0.82, true);
      expect(screen.getByText('Retransmissions above baseline')).toBeInTheDocument();
    });

    it('shows the score the model supplied', () => {
      renderWithAnalysis(0.82);
      expect(screen.getByText('Confidence: 82%')).toBeInTheDocument();
    });

    it('omits the badge entirely when the model supplied no score', () => {
      // Not "Confidence: 0%" — `null * 100` is 0, so an unguarded render turns
      // "we do not know" into a confident zero, which is worse than the 50%
      // default this replaced.
      renderWithAnalysis(null);
      expect(screen.getByText('Retransmissions above baseline')).toBeInTheDocument();
      expect(screen.queryByText(/^Confidence:/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Confidence: 0%/)).not.toBeInTheDocument();
    });
  });
});

describe('captureStatusGroup', () => {
  it('folds every in-flight status into one group', () => {
    expect(captureStatusGroup('pending')).toBe('running');
    expect(captureStatusGroup('capturing')).toBe('running');
    expect(captureStatusGroup('processing')).toBe('running');
  });

  // The page's own action logic already treated these as synonyms; the tab row
  // was the only place that pretended they were different.
  it('folds complete and succeeded into one group', () => {
    expect(captureStatusGroup('complete')).toBe('finished');
    expect(captureStatusGroup('succeeded')).toBe('finished');
  });

  it('groups failure on its own', () => {
    expect(captureStatusGroup('failed')).toBe('failed');
  });
});

describe('filterCapturesByGroup', () => {
  const captures = [
    makeCapture({ id: '1', status: 'complete' }),
    makeCapture({ id: '2', status: 'succeeded' }),
    makeCapture({ id: '3', status: 'capturing' }),
    makeCapture({ id: '4', status: 'pending' }),
    makeCapture({ id: '5', status: 'failed' }),
  ];

  it('returns everything for the All tab, untouched', () => {
    expect(filterCapturesByGroup(captures, 'all')).toBe(captures);
  });

  it('narrows to each group', () => {
    expect(filterCapturesByGroup(captures, 'finished').map((c) => c.id)).toEqual(['1', '2']);
    expect(filterCapturesByGroup(captures, 'running').map((c) => c.id)).toEqual(['3', '4']);
    expect(filterCapturesByGroup(captures, 'failed').map((c) => c.id)).toEqual(['5']);
  });
});
