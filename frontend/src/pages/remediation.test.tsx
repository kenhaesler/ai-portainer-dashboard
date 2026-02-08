import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import RemediationPage from './remediation';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@/hooks/use-remediation', () => ({
  useRemediationActions: () => ({
    data: [{
      id: 'action-1',
      action_type: 'STOP_CONTAINER',
      status: 'pending',
      container_id: 'container-1',
      endpoint_id: 1,
      rationale: JSON.stringify({
        root_cause: 'Connection pool leak is exhausting memory over time.',
        severity: 'critical',
        recommended_actions: [
          {
            action: 'Restart container to recover service',
            priority: 'high',
            rationale: 'Immediately reclaims leaked memory',
          },
        ],
        log_analysis: 'Repeated pool exhaustion warnings precede malloc failures.',
        confidence_score: 0.82,
      }),
      suggested_by: 'AI Monitor',
      created_at: '2026-02-06T00:00:00Z',
    }],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    isFetching: false,
  }),
  useApproveAction: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
  useRejectAction: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
  useExecuteAction: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
}));

vi.mock('@/hooks/use-auto-refresh', () => ({
  useAutoRefresh: () => ({ interval: 30, setInterval: vi.fn() }),
}));

vi.mock('@/providers/socket-provider', () => ({
  useSockets: () => ({
    remediationSocket: { on: vi.fn(), off: vi.fn() },
  }),
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <RemediationPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('RemediationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders structured remediation analysis from rationale JSON', () => {
    renderPage();
    expect(screen.getByText('Critical')).toBeInTheDocument();
    expect(screen.getByText('Confidence: 82%')).toBeInTheDocument();
    expect(screen.getByText(/Root Cause:/i)).toBeInTheDocument();
    expect(screen.getByText(/Connection pool leak is exhausting memory over time\./)).toBeInTheDocument();
    expect(screen.getByText(/HIGH:/)).toBeInTheDocument();
  });

  it('routes Discuss with AI with context', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Discuss with AI/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/assistant', expect.objectContaining({
      state: expect.objectContaining({
        source: 'remediation',
        actionId: 'action-1',
      }),
    }));
  });
});
