import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockApiGet = vi.fn();
const mockMutateAsync = vi.fn();
const mockSuccess = vi.fn();
const mockError = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

const mockPost = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockSuccess(...args),
    error: (...args: unknown[]) => mockError(...args),
    info: vi.fn(),
  },
}));

vi.mock('@/hooks/use-settings', () => ({
  useSettings: () => ({ data: [], isLoading: false }),
  useUpdateSetting: () => ({
    mutateAsync: (...args: unknown[]) => mockMutateAsync(...args),
  }),
}));

vi.mock('@/hooks/use-llm-models', () => ({
  useLlmModels: () => ({
    data: {
      models: [
        { name: 'llama3.2', size: 2_000_000_000 },
        { name: 'codellama', size: 4_000_000_000 },
      ],
      default: 'llama3.2',
    },
  }),
}));

import { AiPromptsTab } from './settings';

const MOCK_FEATURES = [
  {
    key: 'chat_assistant',
    label: 'Chat Assistant',
    description: 'Main AI chat for infrastructure questions',
    defaultPrompt: 'You are a helpful assistant.',
  },
  {
    key: 'anomaly_explainer',
    label: 'Anomaly Explainer',
    description: 'Explains detected container anomalies',
    defaultPrompt: 'You are an anomaly explainer.',
  },
];

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('AiPromptsTab', () => {
  const defaultValues: Record<string, string> = {
    'llm.ollama_url': 'http://host.docker.internal:11434',
    'llm.model': 'llama3.2',
  };
  let onChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    onChange = vi.fn();
    mockApiGet.mockResolvedValue({ features: MOCK_FEATURES });
    mockMutateAsync.mockResolvedValue({ success: true });
  });

  it('renders loading skeleton initially', () => {
    // Never resolve the API call
    mockApiGet.mockReturnValue(new Promise(() => {}));

    render(
      <AiPromptsTab values={defaultValues} onChange={onChange} />,
      { wrapper: createWrapper() },
    );

    // Skeleton pulse elements
    const skeletons = document.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('renders feature accordion items after loading', async () => {
    render(
      <AiPromptsTab values={defaultValues} onChange={onChange} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText('Chat Assistant')).toBeInTheDocument();
      expect(screen.getByText('Anomaly Explainer')).toBeInTheDocument();
    });
  });

  it('shows description text', async () => {
    render(
      <AiPromptsTab values={defaultValues} onChange={onChange} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText(/Customize the system prompt/)).toBeInTheDocument();
    });
  });

  it('shows token count badges', async () => {
    render(
      <AiPromptsTab values={defaultValues} onChange={onChange} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      // Each feature has a token badge in the accordion header
      const tokenBadges = screen.getAllByText(/~\d+ tokens/);
      expect(tokenBadges.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('expands accordion and shows prompt textarea', async () => {
    render(
      <AiPromptsTab values={defaultValues} onChange={onChange} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText('Chat Assistant')).toBeInTheDocument();
    });

    // Click to expand
    fireEvent.click(screen.getByText('Chat Assistant'));

    await waitFor(() => {
      expect(screen.getByText('System Prompt')).toBeInTheDocument();
      expect(screen.getByText('Model Override')).toBeInTheDocument();
      expect(screen.getByText('Temperature Override')).toBeInTheDocument();
    });
  });

  it('shows Expand All / Collapse All buttons', async () => {
    render(
      <AiPromptsTab values={defaultValues} onChange={onChange} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText('Expand All')).toBeInTheDocument();
      expect(screen.getByText('Collapse All')).toBeInTheDocument();
    });
  });

  it('expand all opens all features', async () => {
    render(
      <AiPromptsTab values={defaultValues} onChange={onChange} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText('Expand All')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Expand All'));

    await waitFor(() => {
      // Both features should show their description text in expanded state
      expect(screen.getByText('Main AI chat for infrastructure questions')).toBeInTheDocument();
      expect(screen.getByText('Explains detected container anomalies')).toBeInTheDocument();
    });
  });

  it('editing prompt shows unsaved badge and save bar', async () => {
    render(
      <AiPromptsTab values={defaultValues} onChange={onChange} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText('Chat Assistant')).toBeInTheDocument();
    });

    // Expand the feature
    fireEvent.click(screen.getByText('Chat Assistant'));

    await waitFor(() => {
      expect(screen.getByDisplayValue('You are a helpful assistant.')).toBeInTheDocument();
    });

    // Edit the prompt
    const textarea = screen.getByDisplayValue('You are a helpful assistant.');
    fireEvent.change(textarea, { target: { value: 'Custom prompt' } });

    await waitFor(() => {
      expect(screen.getByText('unsaved')).toBeInTheDocument();
      expect(screen.getByText('Save & Apply')).toBeInTheDocument();
      expect(screen.getByText('Discard')).toBeInTheDocument();
    });
  });

  it('discard reverts changes', async () => {
    render(
      <AiPromptsTab values={defaultValues} onChange={onChange} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText('Chat Assistant')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Chat Assistant'));

    await waitFor(() => {
      expect(screen.getByDisplayValue('You are a helpful assistant.')).toBeInTheDocument();
    });

    const textarea = screen.getByDisplayValue('You are a helpful assistant.');
    fireEvent.change(textarea, { target: { value: 'Modified prompt' } });

    await waitFor(() => {
      expect(screen.getByText('Discard')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Discard'));

    await waitFor(() => {
      expect(screen.getByDisplayValue('You are a helpful assistant.')).toBeInTheDocument();
    });
  });

  it('save calls updateSetting for changed keys', async () => {
    render(
      <AiPromptsTab values={defaultValues} onChange={onChange} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText('Chat Assistant')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Chat Assistant'));

    await waitFor(() => {
      expect(screen.getByDisplayValue('You are a helpful assistant.')).toBeInTheDocument();
    });

    const textarea = screen.getByDisplayValue('You are a helpful assistant.');
    fireEvent.change(textarea, { target: { value: 'New custom prompt' } });

    await waitFor(() => {
      expect(screen.getByText('Save & Apply')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Save & Apply'));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        key: 'prompts.chat_assistant.system_prompt',
        value: 'New custom prompt',
        category: 'prompts',
        showToast: false,
      });
    });
  });

  it('reset to default restores original prompt', async () => {
    render(
      <AiPromptsTab values={defaultValues} onChange={onChange} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText('Chat Assistant')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Chat Assistant'));

    await waitFor(() => {
      expect(screen.getByDisplayValue('You are a helpful assistant.')).toBeInTheDocument();
    });

    // Modify first
    const textarea = screen.getByDisplayValue('You are a helpful assistant.');
    fireEvent.change(textarea, { target: { value: 'Modified' } });

    // Now reset
    fireEvent.click(screen.getByText('Reset to Default'));

    await waitFor(() => {
      expect(screen.getByDisplayValue('You are a helpful assistant.')).toBeInTheDocument();
    });
  });

  it('handles API error gracefully on load', async () => {
    mockApiGet.mockRejectedValue(new Error('Network error'));

    render(
      <AiPromptsTab values={defaultValues} onChange={onChange} />,
      { wrapper: createWrapper() },
    );

    // Should render empty state without crashing
    await waitFor(() => {
      expect(screen.getByText(/Customize the system prompt/)).toBeInTheDocument();
    });
  });
});
