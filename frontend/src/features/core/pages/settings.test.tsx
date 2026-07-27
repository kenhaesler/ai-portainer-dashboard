import { describe, expect, it, vi, beforeEach, type Mock } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LlmSettingsSection, getRedisSystemInfo } from './settings';

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPut = vi.fn();
const mockSuccess = vi.fn();
const mockError = vi.fn();

vi.mock('@/shared/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    put: (...args: unknown[]) => mockPut(...args),
  },
}));

vi.mock('@/providers/auth-provider', () => ({
  useAuth: () => ({ role: 'admin', user: { username: 'admin' } }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockSuccess(...args),
    error: (...args: unknown[]) => mockError(...args),
    info: vi.fn(),
  },
}));

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('LlmSettingsSection', () => {
  const defaultValues: Record<string, string> = {
    'llm.model': 'gpt-4o-mini',
    'llm.temperature': '0.7',
    'llm.max_tokens': '20000',
    'llm.api_url': 'http://localhost:3000/v1/chat/completions',
    'llm.api_token': '',
    'llm.auth_type': 'bearer',
  };

  // Matches LlmSettingsSectionProps['onChange'].
  type OnSettingChange = (key: string, value: string) => void;
  let onChange: Mock<OnSettingChange>;

  beforeEach(() => {
    vi.clearAllMocks();
    onChange = vi.fn<OnSettingChange>();
    mockGet.mockResolvedValue({
      models: [
        { name: 'gpt-4o-mini', size: 2_000_000_000 },
        { name: 'claude-sonnet-4-5', size: 4_000_000_000 },
      ],
      default: 'gpt-4o-mini',
    });
  });

  it('renders the LLM section heading', async () => {
    render(
      <LlmSettingsSection values={defaultValues} originalValues={defaultValues} onChange={onChange} />,
      { wrapper: createWrapper() },
    );

    expect(screen.getByText('LLM Configuration')).toBeInTheDocument();
  });

  it('renders model dropdown when models are returned by the API', async () => {
    render(
      <LlmSettingsSection values={defaultValues} originalValues={defaultValues} onChange={onChange} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });
  });

  it('falls back to text input when no models available', async () => {
    mockGet.mockRejectedValue(new Error('Connection refused'));

    render(
      <LlmSettingsSection values={defaultValues} originalValues={defaultValues} onChange={onChange} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      const input = screen.getByPlaceholderText(/enter model name/i);
      expect(input).toBeInTheDocument();
    });
  });

  it('shows Scan Models button', async () => {
    render(
      <LlmSettingsSection values={defaultValues} originalValues={defaultValues} onChange={onChange} />,
      { wrapper: createWrapper() },
    );

    expect(screen.getByRole('button', { name: /scan models/i })).toBeInTheDocument();
  });

  it('shows Test Connection button', async () => {
    render(
      <LlmSettingsSection values={defaultValues} originalValues={defaultValues} onChange={onChange} />,
      { wrapper: createWrapper() },
    );

    expect(screen.getByRole('button', { name: /test connection/i })).toBeInTheDocument();
  });

  it('renders the API endpoint URL and token fields', async () => {
    render(
      <LlmSettingsSection values={defaultValues} originalValues={defaultValues} onChange={onChange} />,
      { wrapper: createWrapper() },
    );

    expect(screen.getByLabelText(/api endpoint url/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/api key/i)).toBeInTheDocument();
  });

  it('calls onChange when API endpoint URL is changed', async () => {
    render(
      <LlmSettingsSection values={defaultValues} originalValues={defaultValues} onChange={onChange} />,
      { wrapper: createWrapper() },
    );

    const urlInput = screen.getByLabelText(/api endpoint url/i);
    fireEvent.change(urlInput, { target: { value: 'http://lmstudio:1234' } });
    expect(onChange).toHaveBeenCalledWith('llm.api_url', 'http://lmstudio:1234');
  });

  it('calls onChange when temperature is changed', async () => {
    render(
      <LlmSettingsSection values={defaultValues} originalValues={defaultValues} onChange={onChange} />,
      { wrapper: createWrapper() },
    );

    const tempInput = screen.getByDisplayValue('0.7');
    fireEvent.change(tempInput, { target: { value: '0.5' } });
    expect(onChange).toHaveBeenCalledWith('llm.temperature', '0.5');
  });

  it('shows "Not tested" initially instead of connection error', async () => {
    render(
      <LlmSettingsSection values={defaultValues} originalValues={defaultValues} onChange={onChange} />,
      { wrapper: createWrapper() },
    );

    expect(screen.getByText('Not tested')).toBeInTheDocument();
    expect(screen.queryByText('Connection Failed')).not.toBeInTheDocument();
  });

  it('shows unsaved changes badge when values change', async () => {
    const modifiedValues = { ...defaultValues, 'llm.model': 'claude-sonnet-4-5' };

    render(
      <LlmSettingsSection values={modifiedValues} originalValues={defaultValues} onChange={onChange} />,
      { wrapper: createWrapper() },
    );

    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('blocks test connection when API URL is empty', async () => {
    const emptyUrlValues = {
      ...defaultValues,
      'llm.api_url': '',
      'llm.api_token': 'secret-token',
    };

    render(
      <LlmSettingsSection values={emptyUrlValues} originalValues={emptyUrlValues} onChange={onChange} />,
      { wrapper: createWrapper() },
    );

    fireEvent.click(screen.getByRole('button', { name: /test connection/i }));

    expect(mockError).toHaveBeenCalledWith('Set an API endpoint URL before testing connection');
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('shows live preview of resolved chat-completions URL when bare URL is entered', async () => {
    const bareUrlValues = { ...defaultValues, 'llm.api_url': 'http://lmstudio:1234' };

    render(
      <LlmSettingsSection values={bareUrlValues} originalValues={bareUrlValues} onChange={onChange} />,
      { wrapper: createWrapper() },
    );

    expect(screen.getByText(/Will POST to/i)).toBeInTheDocument();
    expect(screen.getByText('http://lmstudio:1234/v1/chat/completions')).toBeInTheDocument();
  });
});

describe('getRedisSystemInfo', () => {
  it('returns unknown state when cache stats are unavailable', () => {
    expect(getRedisSystemInfo()).toEqual({
      status: 'Unknown',
      details: 'Cache stats unavailable',
      keys: 'N/A',
    });
  });

  it('returns active Redis state when multi-layer cache backend is enabled', () => {
    expect(getRedisSystemInfo({
      backend: 'multi-layer',
      l1Size: 2,
      l2Size: 9,
    })).toEqual({
      status: 'Active',
      details: 'Using Redis + in-memory cache',
      keys: '9',
    });
  });

  it('returns inactive Redis state when backend falls back to memory-only', () => {
    expect(getRedisSystemInfo({
      backend: 'memory-only',
      l1Size: 7,
      l2Size: 0,
    })).toEqual({
      status: 'Inactive (Memory fallback)',
      details: 'Using in-memory cache only',
      keys: 'N/A',
    });
  });
});

describe('Icon theme options', () => {
  it('exports all 4 icon theme options from theme-store', async () => {
    const { iconThemeOptions, DEFAULT_ICON_THEME } = await import('@/stores/theme-store');

    expect(DEFAULT_ICON_THEME).toBe('default');
    expect(iconThemeOptions).toHaveLength(4);
    expect(iconThemeOptions.map((o: { value: string }) => o.value)).toEqual([
      'default',
      'light',
      'bold',
      'duotone',
    ]);
  });
});

describe('Settings tab structure', () => {
  it('validates settings page exports include the new tab-hosted panels', async () => {
    const usersModule = await import('./users');
    const webhooksModule = await import('./webhooks');

    expect(usersModule.UsersPanel).toBeDefined();
    expect(typeof usersModule.UsersPanel).toBe('function');
    expect(webhooksModule.WebhooksPanel).toBeDefined();
    expect(typeof webhooksModule.WebhooksPanel).toBe('function');
  });

  it('re-exports LlmSettingsSection and getRedisSystemInfo from settings.tsx', async () => {
    const settingsModule = await import('./settings');

    expect(settingsModule.LlmSettingsSection).toBeDefined();
    expect(typeof settingsModule.LlmSettingsSection).toBe('function');
    expect(settingsModule.getRedisSystemInfo).toBeDefined();
    expect(typeof settingsModule.getRedisSystemInfo).toBe('function');
  });

  it('exports LLM_SETTING_KEYS from tab-ai-llm', async () => {
    const { LLM_SETTING_KEYS } = await import('@/features/core/components/settings/tab-ai-llm');

    expect(Array.isArray(LLM_SETTING_KEYS)).toBe(true);
    expect(LLM_SETTING_KEYS.length).toBeGreaterThan(0);
    expect(LLM_SETTING_KEYS).toContain('llm.model');
    expect(LLM_SETTING_KEYS).toContain('llm.temperature');
  });
});

// ─────────────────────────────────────────────────────────────────────
// The settings page itself: what commits on its own, and what does not.
// ─────────────────────────────────────────────────────────────────────

describe('SettingsPage — auto-save boundary', () => {
  async function renderSettings(initialEntry = '/settings') {
    const { MemoryRouter } = await import('react-router');
    const SettingsPage = (await import('./settings')).default;
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    return render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <SettingsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/api/settings')) return Promise.resolve([]);
      return Promise.resolve({ entries: [], history: [], notifications: [] });
    });
    mockPut.mockResolvedValue(undefined);
  });

  it('lands on a tab that has settings on it, not the read-only About dump', async () => {
    await renderSettings();

    // Monitoring is the default: its sections render, About does not.
    expect(await screen.findByLabelText('Polling Interval')).toBeInTheDocument();
    expect(screen.queryByTestId('system-information')).not.toBeInTheDocument();
  });

  it('auto-saves an ordinary tuning knob', async () => {
    await renderSettings();

    const input = await screen.findByLabelText('Polling Interval');
    fireEvent.change(input, { target: { value: '45' } });

    await waitFor(
      () => expect(mockPut).toHaveBeenCalledWith('/api/settings/monitoring.polling_interval', expect.objectContaining({ value: '45' })),
      { timeout: 3000 },
    );
  });

  // A guarded edit is a promise: "nothing is applied until you save". Anything
  // that quietly drops it breaks that promise on the tab holding
  // oidc.client_secret and oidc.allow_insecure_transport.
  //
  // These use a NON-EMPTY /api/settings payload on purpose. With the suite's
  // default `[]`, useUpdateSetting's optimistic `old.map(...)` is deep-equal to
  // the previous data, TanStack's structural sharing hands back the same array
  // reference, and the init effect never re-runs — so the interaction under
  // test cannot happen and the test would pass vacuously.
  const settingsRows = [
    { key: 'monitoring.polling_interval', value: '30', category: 'monitoring',
      label: 'Polling Interval', type: 'number', updatedAt: '2026-01-01T00:00:00.000Z' },
    { key: 'monitoring.metric_retention_days', value: '7', category: 'monitoring',
      label: 'Metric Retention', type: 'number', updatedAt: '2026-01-01T00:00:00.000Z' },
  ];

  function serveSettingsRows() {
    mockGet.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/api/settings')) {
        return Promise.resolve(settingsRows.map((r) => ({ ...r })));
      }
      return Promise.resolve({ entries: [], history: [], notifications: [] });
    });
  }

  it('keeps a queued guarded edit when an ordinary knob auto-saves beside it', async () => {
    serveSettingsRows();
    await renderSettings();

    const guarded = await screen.findByLabelText('Metric Retention');
    fireEvent.change(guarded, { target: { value: '1' } });
    expect(await screen.findByTestId('guarded-changes-bar')).toBeInTheDocument();

    // Auto-saving this rewrites the ['settings'] cache, which re-runs the
    // initialise-from-API effect.
    fireEvent.change(await screen.findByLabelText('Polling Interval'), { target: { value: '45' } });
    await waitFor(
      () => expect(mockPut).toHaveBeenCalledWith(
        '/api/settings/monitoring.polling_interval', expect.objectContaining({ value: '45' }),
      ),
      { timeout: 3000 },
    );
    // Let the invalidation-driven refetch land too.
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(screen.getByLabelText('Metric Retention')).toHaveValue(1);
    expect(screen.getByTestId('guarded-changes-bar')).toBeInTheDocument();
    // ...and it is still only queued, never written.
    expect(mockPut).not.toHaveBeenCalledWith(
      '/api/settings/monitoring.metric_retention_days', expect.anything(),
    );
  });

  it('still takes the server value for a key the operator has not touched', async () => {
    // The guard must not freeze the form: only pending edits are preserved.
    serveSettingsRows();
    await renderSettings();

    await screen.findByLabelText('Polling Interval');
    settingsRows[0] = { ...settingsRows[0], value: '90' };
    fireEvent.change(await screen.findByLabelText('Metric Retention'), { target: { value: '1' } });

    await waitFor(() => expect(screen.getByLabelText('Metric Retention')).toHaveValue(1));
    settingsRows[0] = { ...settingsRows[0], value: '30' }; // restore for other tests
  });

  it('never auto-saves a retention window, however long the operator pauses', async () => {
    await renderSettings();

    const input = await screen.findByLabelText('Metric Retention');
    fireEvent.change(input, { target: { value: '1' } });

    // Well past the 700ms debounce.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('offers an explicit, reviewed save naming the value and its consequence', async () => {
    await renderSettings();

    const input = await screen.findByLabelText('Metric Retention');
    fireEvent.change(input, { target: { value: '1' } });

    const bar = await screen.findByTestId('guarded-changes-bar');
    expect(bar).toHaveTextContent('1 change needs review');
    expect(within(bar).getByTestId('guarded-change-monitoring.metric_retention_days'))
      .toHaveTextContent('7 → 1');
    expect(bar).toHaveTextContent(/deletes stored metrics older than the new window/i);

    fireEvent.click(within(bar).getByRole('button', { name: 'Save 1 change' }));

    await waitFor(() =>
      expect(mockPut).toHaveBeenCalledWith('/api/settings/monitoring.metric_retention_days', expect.objectContaining({ value: '1' })),
    );
  });

  it('discards a guarded change without saving it', async () => {
    await renderSettings();

    const input = await screen.findByLabelText('Metric Retention');
    fireEvent.change(input, { target: { value: '1' } });

    const bar = await screen.findByTestId('guarded-changes-bar');
    fireEvent.click(within(bar).getByRole('button', { name: 'Discard' }));

    await waitFor(() => expect(screen.queryByTestId('guarded-changes-bar')).not.toBeInTheDocument());
    expect(mockPut).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Metric Retention')).toHaveValue(7);
  });

  it('keeps Reset mounted after a save clears the change', async () => {
    await renderSettings();

    // Present, and disabled, before anything is edited.
    const reset = await screen.findByRole('button', { name: 'Reset' });
    expect(reset).toBeDisabled();

    const input = screen.getByLabelText('Polling Interval');
    fireEvent.change(input, { target: { value: '45' } });
    await waitFor(() => expect(mockPut).toHaveBeenCalled(), { timeout: 3000 });

    // Auto-save clears `hasChanges`; the control must not unmount with it.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled());
  });

  it('confirms the save at the row that changed, not only in the header', async () => {
    await renderSettings();

    const input = await screen.findByLabelText('Polling Interval');
    fireEvent.change(input, { target: { value: '45' } });

    expect(await screen.findByTestId('setting-saved-monitoring.polling_interval', {}, { timeout: 3000 }))
      .toHaveTextContent('Saved');
  });
});

describe('SettingsPage — finding one of 107 keys', () => {
  async function renderSettings() {
    const { MemoryRouter } = await import('react-router');
    const SettingsPage = (await import('./settings')).default;
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    return render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/settings']}>
          <SettingsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/api/settings')) return Promise.resolve([]);
      return Promise.resolve({ entries: [], history: [], notifications: [] });
    });
    mockPut.mockResolvedValue(undefined);
  });

  it('searches across tabs and names the tab each match lives on', async () => {
    await renderSettings();

    fireEvent.change(await screen.findByLabelText('Search settings'), {
      target: { value: 'raw metrics' },
    });

    const results = await screen.findByTestId('settings-search-results');
    expect(within(results).getByText('Raw Metrics Retention (days)')).toBeInTheDocument();
    expect(within(results).getByText('Infrastructure')).toBeInTheDocument();
  });

  it('switches to the owning tab when a result is picked', async () => {
    await renderSettings();

    fireEvent.change(await screen.findByLabelText('Search settings'), {
      target: { value: 'raw metrics' },
    });
    fireEvent.click(await screen.findByText('Raw Metrics Retention (days)'));

    // The Infrastructure tab is now mounted, and the search panel has closed.
    expect(await screen.findByTestId('setting-row-infrastructure.metrics_raw_retention_days'))
      .toBeInTheDocument();
    expect(screen.queryByTestId('settings-search-results')).not.toBeInTheDocument();
  });

  it('says what to try instead when nothing matches', async () => {
    await renderSettings();

    fireEvent.change(await screen.findByLabelText('Search settings'), {
      target: { value: 'zzzzz' },
    });

    const results = await screen.findByTestId('settings-search-results');
    expect(results).toHaveTextContent(/No setting matches/i);
    expect(results).toHaveTextContent(/retention/i);
  });
});
