import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ObservedDestinationsPanel } from './observed-destinations-panel';

const mockApiGet = vi.fn();

vi.mock('@/shared/lib/api', () => ({
  api: {
    get: (path: string, init?: { params?: Record<string, unknown> }) =>
      mockApiGet(path, init?.params),
  },
}));

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('ObservedDestinationsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the empty-state callout when no destinations are returned', async () => {
    mockApiGet.mockResolvedValue({ destinations: [] });

    renderWithProviders(<ObservedDestinationsPanel />);

    await waitFor(() => {
      expect(screen.getByTestId('no-trace-data-callout')).toBeInTheDocument();
    });
  });

  it('renders destination rows with verdict badges', async () => {
    mockApiGet.mockResolvedValue({
      destinations: [
        {
          peer: '10.0.0.5',
          port: 443,
          callCount: 17,
          firstSeen: '2026-05-14T11:00:00Z',
          lastSeen: '2026-05-14T12:00:00Z',
          verdict: 'allow',
          reason: 'RFC1918',
        },
        {
          peer: 'api.evil.example.com',
          port: 443,
          callCount: 3,
          firstSeen: '2026-05-14T11:30:00Z',
          lastSeen: '2026-05-14T11:45:00Z',
          verdict: 'warn',
          reason: null,
        },
      ],
    });

    renderWithProviders(<ObservedDestinationsPanel />);

    await waitFor(() => {
      expect(screen.getByText('10.0.0.5')).toBeInTheDocument();
      expect(screen.getByText('api.evil.example.com')).toBeInTheDocument();
    });
    expect(screen.getByText('allow')).toBeInTheDocument();
    expect(screen.getByText('warn')).toBeInTheDocument();
    expect(screen.getByText('17')).toBeInTheDocument();
  });

  it('renders the rows inside the shared DataTable', async () => {
    mockApiGet.mockResolvedValue({
      destinations: [
        {
          peer: '10.0.0.5',
          port: 443,
          callCount: 17,
          firstSeen: '2026-05-14T11:00:00Z',
          lastSeen: '2026-05-14T12:00:00Z',
          verdict: 'allow',
          reason: 'RFC1918',
        },
      ],
    });

    renderWithProviders(<ObservedDestinationsPanel />);

    await waitFor(() => {
      expect(screen.getByTestId('data-table')).toBeInTheDocument();
    });
    // Column headers carried over from the hand-rolled table.
    expect(screen.getByText('Peer')).toBeInTheDocument();
    expect(screen.getByText('Calls')).toBeInTheDocument();
    expect(screen.getByText('Verdict')).toBeInTheDocument();
    // Row rendered through the shared table.
    expect(screen.getByTestId('table-row-0')).toBeInTheDocument();
  });

  it('passes endpointId to the API when provided', async () => {
    mockApiGet.mockResolvedValue({ destinations: [] });

    renderWithProviders(<ObservedDestinationsPanel endpointId={42} />);

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith(
        '/api/security/observed-destinations',
        { endpointId: 42 },
      );
    });
  });
});
