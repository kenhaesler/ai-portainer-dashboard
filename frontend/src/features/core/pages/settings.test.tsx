import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LlmSettingsSection, getRedisSystemInfo } from './settings';

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockSuccess = vi.fn();
const mockError = vi.fn();

vi.mock('@/shared/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
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

  let onChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    onChange = vi.fn();
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
