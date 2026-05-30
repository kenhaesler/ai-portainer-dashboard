import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockApiGet = vi.fn();
const mockMutateAsync = vi.fn();
const mockSuccess = vi.fn();
const mockError = vi.fn();

vi.mock('@/shared/lib/api', () => ({
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

vi.mock('@/features/core/hooks/use-settings', () => ({
  useSettings: () => ({ data: [], isLoading: false }),
  useUpdateSetting: () => ({
    mutateAsync: (...args: unknown[]) => mockMutateAsync(...args),
  }),
  useDeleteSetting: () => ({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
  }),
}));

const mockSwitchProfileAsync = vi.fn();
vi.mock('@/features/ai-intelligence/hooks/use-prompt-profiles', () => ({
  usePromptProfiles: () => ({
    data: {
      profiles: [
        { id: 'default', name: 'Default', description: 'Standard balanced prompts', isBuiltIn: true, prompts: {}, createdAt: '2025-01-01', updatedAt: '2025-01-01' },
        { id: 'security-audit', name: 'Security Audit', description: 'Security focus', isBuiltIn: true, prompts: {}, createdAt: '2025-01-01', updatedAt: '2025-01-01' },
      ],
      activeProfileId: 'default',
    },
    isLoading: false,
  }),
  useCreateProfile: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateProfile: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteProfile: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDuplicateProfile: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSwitchProfile: () => ({ mutateAsync: (...args: unknown[]) => mockSwitchProfileAsync(...args), isPending: false }),
  useExportProfile: () => ({ mutate: vi.fn(), isPending: false }),
  useImportPreview: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useImportApply: () => ({ mutate: vi.fn(), isPending: false }),
}));

const mockTestPromptMutate = vi.fn();
vi.mock('@/features/ai-intelligence/hooks/use-llm-models', () => ({
  useLlmModels: () => ({
    data: {
      models: [
        { name: 'llama3.2', size: 2_000_000_000 },
        { name: 'codellama', size: 4_000_000_000 },
      ],
      default: 'llama3.2',
    },
  }),
  useLlmTestPrompt: () => ({
    mutate: (...args: unknown[]) => mockTestPromptMutate(...args),
    isPending: false,
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

  it('shows Test Prompt button when accordion is expanded', async () => {
    render(
      <AiPromptsTab values={defaultValues} onChange={onChange} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText('Chat Assistant')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Chat Assistant'));

    await waitFor(() => {
      expect(screen.getByText('Test Prompt')).toBeInTheDocument();
    });
  });

  it('clicking Test Prompt calls mutate with feature and prompt', async () => {
    render(
      <AiPromptsTab values={defaultValues} onChange={onChange} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText('Chat Assistant')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Chat Assistant'));

    await waitFor(() => {
      expect(screen.getByText('Test Prompt')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Test Prompt'));

    expect(mockTestPromptMutate).toHaveBeenCalledTimes(1);
    const [payload] = mockTestPromptMutate.mock.calls[0];
    expect(payload.feature).toBe('chat_assistant');
    expect(payload.systemPrompt).toBe('You are a helpful assistant.');
  });

  it('shows test results panel after clicking Test Prompt', async () => {
    render(
      <AiPromptsTab values={defaultValues} onChange={onChange} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText('Chat Assistant')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Chat Assistant'));

    await waitFor(() => {
      expect(screen.getByText('Test Prompt')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Test Prompt'));

    await waitFor(() => {
      expect(screen.getByText('Test Results')).toBeInTheDocument();
    });
  });

  it('uses draft (unsaved) prompt for testing', async () => {
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

    // Modify the prompt first
    const textarea = screen.getByDisplayValue('You are a helpful assistant.');
    fireEvent.change(textarea, { target: { value: 'Custom test prompt' } });

    // Now test - should use the modified draft value
    fireEvent.click(screen.getByText('Test Prompt'));

    const [payload] = mockTestPromptMutate.mock.calls[0];
    expect(payload.systemPrompt).toBe('Custom test prompt');
  });

  it('renders profile selector with Active Profile label', async () => {
    render(
      <AiPromptsTab values={defaultValues} onChange={onChange} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText('Active Profile:')).toBeInTheDocument();
    });
  });

  it('shows New and Duplicate buttons', async () => {
    render(
      <AiPromptsTab values={defaultValues} onChange={onChange} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText('New')).toBeInTheDocument();
      expect(screen.getByText('Duplicate')).toBeInTheDocument();
    });
  });

  it('does not show Delete button for built-in profile', async () => {
    render(
      <AiPromptsTab values={defaultValues} onChange={onChange} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText('Active Profile:')).toBeInTheDocument();
    });

    // Default is a built-in profile, so Delete should not be shown
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
  });

  it('opens New Profile dialog on click', async () => {
    render(
      <AiPromptsTab values={defaultValues} onChange={onChange} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText('New')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('New'));

    await waitFor(() => {
      expect(screen.getByText('Create New Profile')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('My Custom Profile')).toBeInTheDocument();
    });
  });

  it('opens Duplicate dialog on click', async () => {
    render(
      <AiPromptsTab values={defaultValues} onChange={onChange} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText('Duplicate')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Duplicate'));

    await waitFor(() => {
      expect(screen.getByText(/Duplicate "Default"/)).toBeInTheDocument();
    });
  });
});
