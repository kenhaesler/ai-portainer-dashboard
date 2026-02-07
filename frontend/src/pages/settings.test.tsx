import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DefaultLandingPagePreference, LlmSettingsSection, getRedisSystemInfo } from './settings';

const mockGet = vi.fn();
const mockPatch = vi.fn();
const mockPost = vi.fn();
const mockSuccess = vi.fn();
const mockError = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    patch: (...args: unknown[]) => mockPatch(...args),
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

describe('DefaultLandingPagePreference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({ defaultLandingPage: '/workloads' });
    mockPatch.mockResolvedValue({ defaultLandingPage: '/workloads' });
  });

  it('loads and renders saved landing page preference', async () => {
    render(<DefaultLandingPagePreference />);

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/api/settings/preferences');
    });

    expect(screen.getByLabelText('Default Landing Page')).toHaveTextContent('Workload Explorer');
  });

  it('saves updated landing page preference', async () => {
    render(<DefaultLandingPagePreference />);

    await waitFor(() => {
      expect(screen.getByLabelText('Default Landing Page')).toHaveTextContent('Workload Explorer');
    });

    fireEvent.click(screen.getByLabelText('Default Landing Page'));
    fireEvent.click(screen.getByRole('option', { name: 'AI Monitor' }));
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith('/api/settings/preferences', { defaultLandingPage: '/ai-monitor' });
      expect(mockSuccess).toHaveBeenCalledWith('Default landing page updated');
    });
  });
});

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
    'llm.model': 'llama3.2',
    'llm.temperature': '0.7',
    'llm.ollama_url': 'http://ollama:11434',
    'llm.max_tokens': '2048',
    'llm.custom_endpoint_enabled': 'false',
    'llm.custom_endpoint_url': '',
    'llm.custom_endpoint_token': '',
  };

  let onChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    onChange = vi.fn();
    // Default: useLlmModels returns models
    mockGet.mockResolvedValue({
      models: [
        { name: 'llama3.2', size: 2_000_000_000 },
        { name: 'mistral', size: 4_000_000_000 },
      ],
      default: 'llama3.2',
    });
  });

  it('renders the LLM section heading', async () => {
    render(
      <LlmSettingsSection values={defaultValues} originalValues={defaultValues} onChange={onChange} />,
      { wrapper: createWrapper() },
    );

    expect(screen.getByText('LLM / Ollama')).toBeInTheDocument();
  });

  it('renders model dropdown populated from API', async () => {
    render(
      <LlmSettingsSection values={defaultValues} originalValues={defaultValues} onChange={onChange} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      const select = screen.getByRole('combobox');
      expect(select).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('combobox'));
    expect(screen.getByRole('option', { name: /llama3.2/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /mistral/i })).toBeInTheDocument();
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

  it('does not show custom endpoint fields when disabled', async () => {
    render(
      <LlmSettingsSection values={defaultValues} originalValues={defaultValues} onChange={onChange} />,
      { wrapper: createWrapper() },
    );

    expect(screen.queryByLabelText(/api endpoint url/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/api key/i)).not.toBeInTheDocument();
  });

  it('shows custom endpoint fields when enabled', async () => {
    const customValues = { ...defaultValues, 'llm.custom_endpoint_enabled': 'true' };

    render(
      <LlmSettingsSection values={customValues} originalValues={customValues} onChange={onChange} />,
      { wrapper: createWrapper() },
    );

    expect(screen.getByLabelText(/api endpoint url/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/api key/i)).toBeInTheDocument();
  });

  it('calls onChange when custom endpoint toggle is clicked', async () => {
    render(
      <LlmSettingsSection values={defaultValues} originalValues={defaultValues} onChange={onChange} />,
      { wrapper: createWrapper() },
    );

    fireEvent.click(screen.getByRole('button', { name: /toggle custom api endpoint/i }));
    expect(onChange).toHaveBeenCalledWith('llm.custom_endpoint_enabled', 'true');
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

  it('shows requires restart badge when values change', async () => {
    const modifiedValues = { ...defaultValues, 'llm.model': 'mistral' };

    render(
      <LlmSettingsSection values={modifiedValues} originalValues={defaultValues} onChange={onChange} />,
      { wrapper: createWrapper() },
    );

    expect(screen.getByText('Requires restart')).toBeInTheDocument();
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
