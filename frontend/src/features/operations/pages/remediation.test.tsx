import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

const remediationState = vi.hoisted(() => {
  const pendingAction = {
    id: 'action-1',
    action_type: 'STOP_CONTAINER',
    status: 'pending',
    container_id: 'container-1',
    container_name: 'api-service',
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
      analysis_source: 'llm-analysis',
    }),
    suggested_by: 'AI Monitor',
    created_at: '2026-02-06T00:00:00Z',
  };
  return { pendingAction, actions: [pendingAction] as Array<Record<string, unknown>> };
});

vi.mock('@/features/operations/hooks/use-remediation', () => ({
  useRemediationActions: () => ({
    data: remediationState.actions,
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

vi.mock('@/shared/hooks/use-auto-refresh', () => ({
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

  it('renders the actions inside the shared DataTable', () => {
    renderPage();
    expect(screen.getByTestId('data-table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Action Type' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Actions' })).toBeInTheDocument();
  });

  it('shows container name and hides action/container ids from row display', () => {
    renderPage();
    expect(screen.getByText('api-service')).toBeInTheDocument();
    expect(screen.queryByText('ID: containe')).not.toBeInTheDocument();
    expect(screen.queryByText('action-1')).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'ID' })).not.toBeInTheDocument();
  });

  it('renders structured remediation analysis from rationale JSON', () => {
    renderPage();
    expect(screen.getByRole('columnheader', { name: 'Analysis Summary' })).toBeInTheDocument();
    expect(screen.getByText('Critical')).toBeInTheDocument();
    expect(screen.getByText('Confidence: 82%')).toBeInTheDocument();
    expect(screen.getByText(/Root Cause:/i)).toBeInTheDocument();
    expect(screen.getByText(/Connection pool leak is exhausting memory over time\./)).toBeInTheDocument();
    expect(screen.getByText(/HIGH:/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument();
  });

  it('toggles analysis expansion for long rationale content', () => {
    renderPage();
    const toggle = screen.getByRole('button', { name: 'Show more' });
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument();
  });

  it('routes Discuss with AI with context', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Discuss with AI/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/assistant', expect.objectContaining({
      state: expect.objectContaining({
        source: 'remediation',
        actionId: 'action-1',
        prefillPrompt: expect.stringContaining('Container: api-service'),
      }),
    }));
  });
});

describe('RemediationPage — nullable confidence/severity and rationale provenance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    remediationState.actions = [remediationState.pendingAction];
  });

  /** Replace the fixture's rationale, keeping every other field intact. */
  function withRationale(rationale: string) {
    remediationState.actions = [{ ...remediationState.pendingAction, rationale }];
  }

  it('still renders the analysis when confidence_score and severity are null', () => {
    withRationale(JSON.stringify({
      root_cause: 'Connection pool leak is exhausting memory over time.',
      severity: null,
      recommended_actions: [],
      log_analysis: '',
      confidence_score: null,
      analysis_source: 'llm-analysis',
    }));
    renderPage();

    // The structured view is used, not the raw-JSON prose fallback.
    expect(screen.getByText(/Root Cause:/i)).toBeInTheDocument();
    expect(screen.getByText(/Connection pool leak is exhausting memory over time\./)).toBeInTheDocument();
    expect(screen.queryByText(/"root_cause"/)).not.toBeInTheDocument();
  });

  it('omits the confidence badge when the model supplied no score', () => {
    withRationale(JSON.stringify({
      root_cause: 'Cause without a score.',
      severity: 'warning',
      recommended_actions: [],
      log_analysis: '',
      confidence_score: null,
    }));
    renderPage();

    expect(screen.getByText('Warning')).toBeInTheDocument();
    expect(screen.queryByText(/Confidence:/)).not.toBeInTheDocument();
  });

  it('omits the severity badge when the model supplied no severity', () => {
    withRationale(JSON.stringify({
      root_cause: 'Cause without a severity.',
      severity: null,
      recommended_actions: [],
      log_analysis: '',
      confidence_score: 0.4,
    }));
    renderPage();

    expect(screen.getByText('Confidence: 40%')).toBeInTheDocument();
    for (const label of ['Critical', 'Warning', 'Info']) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });

  it('rejects a present-but-wrong-typed confidence_score', () => {
    withRationale(JSON.stringify({
      root_cause: 'Cause with a bad score.',
      severity: 'warning',
      recommended_actions: [],
      log_analysis: '',
      confidence_score: 'high',
    }));
    renderPage();

    // Falls back to prose, so the structured Root Cause label is absent.
    expect(screen.queryByText(/Root Cause:/i)).not.toBeInTheDocument();
  });

  it('labels a non-JSON rationale as a pattern match, not AI', () => {
    withRationale(
      'Container may be experiencing memory pressure. Check memory limits and usage patterns before taking action.',
    );
    renderPage();

    expect(screen.getByText('Pattern match')).toBeInTheDocument();
    expect(screen.queryByText('AI Monitor')).not.toBeInTheDocument();
  });

  it('labels an llm-analysis rationale with the stored suggester', () => {
    renderPage();
    expect(screen.getByText('AI Monitor')).toBeInTheDocument();
    expect(screen.queryByText('Pattern match')).not.toBeInTheDocument();
  });

  it('asserts no provenance when a parsed analysis omits analysis_source', () => {
    withRationale(JSON.stringify({
      root_cause: 'Cause from an older stored payload.',
      severity: 'info',
      recommended_actions: [],
      log_analysis: '',
      confidence_score: 0.5,
    }));
    renderPage();

    // Stored suggester is shown as-is; nothing claims a bot produced it.
    expect(screen.getByText('AI Monitor')).toBeInTheDocument();
    expect(screen.queryByText('Pattern match')).not.toBeInTheDocument();
  });
});

describe('RemediationPage — execute confirmation dialog (#1539)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    remediationState.actions = [{ ...remediationState.pendingAction, status: 'approved' }];
  });

  afterEach(() => {
    remediationState.actions = [remediationState.pendingAction];
  });

  it('opens an accessible modal dialog with title and description', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Execute/ }));

    // Radix wires the title as the dialog's accessible name.
    const dialog = screen.getByRole('dialog', { name: 'Execute Remediation Action' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText(/perform the suggested operation/)).toBeInTheDocument();
  });

  it('closes the dialog on Escape', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Execute/ }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});
