import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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

const authState = vi.hoisted(() => ({ role: 'admin' as 'admin' | 'operator' | 'viewer' }));

vi.mock('@/providers/auth-provider', () => ({
  useAuth: () => ({
    role: authState.role,
    username: 'ops',
    isAuthenticated: true,
    token: 'token',
    login: vi.fn(),
    loginWithToken: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock('@/features/containers/hooks/use-endpoints', () => ({
  useEndpoints: () => ({ data: [{ id: 1, name: 'docker-dev-1' }] }),
}));

const mutationSpies = vi.hoisted(() => ({
  approve: vi.fn(),
  reject: vi.fn(),
  execute: vi.fn(),
  refetch: vi.fn(),
}));

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
    refetch: mutationSpies.refetch,
    isFetching: false,
  }),
  useApproveAction: () => ({ mutate: mutationSpies.approve, isPending: false, variables: undefined }),
  useRejectAction: () => ({ mutate: mutationSpies.reject, isPending: false, variables: undefined }),
  useExecuteAction: () => ({ mutate: mutationSpies.execute, isPending: false, variables: undefined }),
}));

const autoRefreshOptions = vi.hoisted(() => ({ onTick: undefined as (() => void) | undefined }));

vi.mock('@/shared/hooks/use-auto-refresh', () => ({
  useAutoRefresh: (_interval: number, opts?: { onTick?: () => void }) => {
    autoRefreshOptions.onTick = opts?.onTick;
    return { interval: 30, setRefreshInterval: vi.fn(), setInterval: vi.fn() };
  },
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

  it('names the action, the container and the endpoint in the accessible title', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Execute/ }));

    // Radix wires the title as the dialog's accessible name. A fixed
    // "Execute Remediation Action" rendered identically for every row.
    const dialog = screen.getByRole('dialog', { name: 'Run Stop Container on api-service now' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('docker-dev-1')).toBeInTheDocument();
    // The consequence, not "perform the suggested operation".
    expect(screen.getByText(/does not start again on its own/)).toBeInTheDocument();
  });

  it('quotes the rationale the decision rests on, labelled by its source', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Execute/ }));

    expect(screen.getByText('LLM analysis')).toBeInTheDocument();
    expect(
      screen.getAllByText(/Connection pool leak is exhausting memory over time\./).length,
    ).toBeGreaterThan(0);
  });

  it('uses the destructive confirm styling for a container-stopping action', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Execute/ }));

    const confirm = screen.getByRole('button', { name: 'Stop Container' });
    expect(confirm.className).toContain('bg-destructive');
  });

  it('keeps the confirm non-destructive for an investigate-only action', () => {
    remediationState.actions = [{
      ...remediationState.pendingAction,
      status: 'approved',
      action_type: 'INVESTIGATE',
    }];
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Execute/ }));

    const confirm = screen.getByRole('button', { name: 'Investigate' });
    expect(confirm.className).not.toContain('bg-destructive');
    expect(screen.getByText(/nothing on the container changes/i)).toBeInTheDocument();
  });

  it('passes the action id and a human label to the mutation', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Execute/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop Container' }));

    expect(mutationSpies.execute).toHaveBeenCalledWith(
      { actionId: 'action-1', label: 'Stop Container on api-service' },
      expect.anything(),
    );
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

describe('RemediationPage — approve and reject are decisions, not one clicks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.role = 'admin';
    remediationState.actions = [remediationState.pendingAction];
  });

  it('confirms before approving instead of mutating straight from onClick', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    expect(mutationSpies.approve).not.toHaveBeenCalled();
    expect(
      screen.getByRole('dialog', { name: 'Approve Stop Container on api-service' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Nothing runs until you press Execute/)).toBeInTheDocument();
  });

  it('collects a rejection reason and posts it with the rejection', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Nightly import still running' },
    });
    const dialog = screen.getByTestId('remediation-decision-dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));

    expect(mutationSpies.reject).toHaveBeenCalledWith(
      {
        actionId: 'action-1',
        label: 'Stop Container on api-service',
        reason: 'Nightly import still running',
      },
      expect.anything(),
    );
  });
});

describe('RemediationPage — accountability columns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.role = 'admin';
  });

  afterEach(() => {
    remediationState.actions = [remediationState.pendingAction];
  });

  it('shows who approved a decided action', () => {
    remediationState.actions = [{
      ...remediationState.pendingAction,
      status: 'completed',
      approved_by: 'simon',
      execution_result: 'Container stopped in 412ms',
    }];
    renderPage();

    expect(screen.getByRole('columnheader', { name: 'Decision' })).toBeInTheDocument();
    expect(screen.getByText('simon')).toBeInTheDocument();
    expect(screen.getByText(/Container stopped in 412ms/)).toBeInTheDocument();
  });

  it('shows the failure reason on a failed row instead of only the word Failed', () => {
    remediationState.actions = [{
      ...remediationState.pendingAction,
      status: 'failed',
      approved_by: 'simon',
      execution_result: 'Portainer returned 409: container is restarting',
    }];
    renderPage();

    expect(screen.getByText(/Portainer returned 409: container is restarting/)).toBeInTheDocument();
  });

  it('shows the rejecter and their stored reason', () => {
    remediationState.actions = [{
      ...remediationState.pendingAction,
      status: 'rejected',
      rejected_by: 'simon',
      rejection_reason: 'Nightly import still running',
    }];
    renderPage();

    expect(screen.getByText(/Rejected by/)).toBeInTheDocument();
    expect(screen.getByText(/Nightly import still running/)).toBeInTheDocument();
  });

  it('says the approver is missing rather than inventing one', () => {
    remediationState.actions = [{ ...remediationState.pendingAction, status: 'completed' }];
    renderPage();

    expect(screen.getByText('No approver recorded')).toBeInTheDocument();
  });
});

describe('RemediationPage — role gate and header', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    remediationState.actions = [remediationState.pendingAction];
  });

  afterEach(() => {
    authState.role = 'admin';
  });

  it('hides the decision controls from a non-admin and says why', () => {
    authState.role = 'operator';
    renderPage();

    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
    expect(screen.getByText(/require the admin role/)).toBeInTheDocument();
    // Read-only paths stay available.
    expect(screen.getByRole('button', { name: /Discuss with AI/ })).toBeInTheDocument();
  });

  it('renders one PageHeader whose subtitle carries the pending count', () => {
    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Remediation' })).toBeInTheDocument();
    expect(screen.getByTestId('page-header-subtitle')).toHaveTextContent(
      '1 action awaiting approval · nothing runs without you',
    );
    expect(screen.queryByText(/self-healing/i)).not.toBeInTheDocument();
  });

  it('drops the KPI tiles that restated the filter chips', () => {
    renderPage();

    expect(screen.queryByText('Pending Approval')).not.toBeInTheDocument();
    // The chips keep the counts and stay clickable.
    expect(screen.getByRole('button', { name: /Pending/ })).toBeInTheDocument();
  });

  it('does not credit AI for an empty queue fed by a keyword rule table', () => {
    remediationState.actions = [];
    try {
      renderPage();
      expect(screen.getByText('No actions queued')).toBeInTheDocument();
      expect(screen.queryByText(/AI monitoring/i)).not.toBeInTheDocument();
      expect(screen.getByText(/monitoring pipeline raises an insight/)).toBeInTheDocument();
    } finally {
      remediationState.actions = [remediationState.pendingAction];
    }
  });

  it('wires the auto-refresh interval to an actual refetch', () => {
    renderPage();

    expect(autoRefreshOptions.onTick).toBeTypeOf('function');
    mutationSpies.refetch.mockClear();
    autoRefreshOptions.onTick?.();
    expect(mutationSpies.refetch).toHaveBeenCalled();
  });
});
