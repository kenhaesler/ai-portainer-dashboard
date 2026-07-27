import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { Insight } from '@dashboard/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// Mock modules before importing component
vi.mock('@/features/ai-intelligence/hooks/use-llm-chat', () => ({
  useLlmChat: vi.fn().mockReturnValue({
    messages: [],
    isStreaming: false,
    currentResponse: '',
    activeToolCalls: [],
    statusMessage: null,
    sendMessage: vi.fn(),
    cancelGeneration: vi.fn(),
    clearHistory: vi.fn(),
  }),
}));

vi.mock('@/features/ai-intelligence/hooks/use-llm-models', () => ({
  // Reachable by default; the unconfigured case has its own test.
  useLlmStatus: vi.fn().mockReturnValue({ data: { available: true, disabledReason: null } }),
  useLlmModels: vi.fn().mockReturnValue({
    data: {
      models: [
        { name: 'llama3.2' },
        { name: 'codellama' },
      ],
      default: 'llama3.2',
    },
  }),
}));

vi.mock('@/features/ai-intelligence/hooks/use-mcp', () => ({
  useMcpServers: vi.fn().mockReturnValue({ data: undefined }),
}));

const llmSocketHandlers: Record<string, (...args: unknown[]) => void> = {};
const mockLlmSocket = {
  connected: true,
  emit: vi.fn(),
  on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    llmSocketHandlers[event] = handler;
  }),
  off: vi.fn((event: string) => {
    delete llmSocketHandlers[event];
  }),
};
vi.mock('@/providers/socket-provider', async () => {
  const { useEffect, useState } = await import('react');
  return {
    useSockets: () => ({ llmSocket: mockLlmSocket }),
    // Real implementation against the mocked socket so tests exercise the
    // event subscription path that fixes the stale "Reconnecting" banner.
    useSocketConnected: (socket: typeof mockLlmSocket | null) => {
      const [connected, setConnected] = useState(socket?.connected ?? false);
      useEffect(() => {
        if (!socket) {
          setConnected(false);
          return;
        }
        setConnected(socket.connected);
        const onConnect = () => setConnected(true);
        const onDisconnect = () => setConnected(false);
        socket.on('connect', onConnect);
        socket.on('disconnect', onDisconnect);
        return () => {
          socket.off('connect', onConnect);
          socket.off('disconnect', onDisconnect);
        };
      }, [socket]);
      return connected;
    },
  };
});

vi.mock('@/features/ai-intelligence/hooks/use-llm-feedback', () => ({
  useSubmitFeedback: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

vi.mock('@/providers/auth-provider', () => ({
  useAuth: vi.fn().mockReturnValue({
    isAuthenticated: true,
    username: 'admin',
    token: 'test-token',
    role: 'viewer',
    login: vi.fn(),
    loginWithToken: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock('@/features/ai-intelligence/hooks/use-prompt-profiles', () => ({
  usePromptProfiles: vi.fn().mockReturnValue({ data: undefined }),
  useSwitchProfile: vi.fn().mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

// The suggestion grid is now generated from live insights, so the HTTP
// boundary is mocked (per CLAUDE.md: mock the call, not the hook wrapping it).
const mockApiGet = vi.fn().mockResolvedValue({ insights: [], total: 0 });
vi.mock('@/shared/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    request: vi.fn(),
  },
}));

import LlmAssistantPage, { suggestionsFromInsights, buildSuggestions } from './llm-assistant';
import { useLlmChat } from '@/features/ai-intelligence/hooks/use-llm-chat';
import { useLlmModels } from '@/features/ai-intelligence/hooks/use-llm-models';
import { useAuth } from '@/providers/auth-provider';
import { usePromptProfiles, useSwitchProfile } from '@/features/ai-intelligence/hooks/use-prompt-profiles';
import { toast } from 'sonner';

function renderPage(initialEntry: string = '/assistant', state?: Record<string, unknown>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[{ pathname: initialEntry, state }]}>
      <QueryClientProvider client={qc}>
        <LlmAssistantPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('LlmAssistantPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // The heading was "Welcome to Your AI Assistant" over "I have real-time
  // access to your entire Docker infrastructure" — a first-person capability
  // claim over six read-only tools.
  it('says the model is unconfigured before the user spends a question finding out', async () => {
    // The page presented a model dropdown, a profile picker and four clickable
    // suggestions on a deployment with no LLM reachable, and revealed the
    // problem only as a red `Error:` pill after the message was sent. It could
    // not tell you it was broken until you used it.
    const { useLlmStatus } = await import('@/features/ai-intelligence/hooks/use-llm-models');
    vi.mocked(useLlmStatus).mockReturnValue({
      data: {
        available: false,
        disabledReason: 'No language model is reachable. Set LLM_API_URL and LLM_API_TOKEN, or configure the endpoint under Settings → AI & LLM.',
      },
    } as ReturnType<typeof useLlmStatus>);

    renderPage();

    expect(screen.getByTestId('assistant-unconfigured')).toBeInTheDocument();
    expect(screen.getByText(/Set LLM_API_URL and LLM_API_TOKEN/)).toBeInTheDocument();
    // And the suggestions that cannot work are not offered.
    expect(screen.queryByTestId('assistant-empty-state')).not.toBeInTheDocument();

    vi.mocked(useLlmStatus).mockReturnValue({
      data: { available: true, disabledReason: null },
    } as ReturnType<typeof useLlmStatus>);
  });

  it('states the contract instead of welcoming the operator', () => {
    renderPage();
    expect(screen.queryByText(/Welcome to Your AI Assistant/)).toBeNull();
    expect(screen.queryByText(/real-time access/)).toBeNull();
    expect(screen.queryByText(/entire Docker infrastructure/)).toBeNull();
    expect(screen.getByText('Ask about a container, a metric or an anomaly')).toBeTruthy();
    expect(
      screen.getByText(/reads containers, metrics, insights, logs and anomalies/i),
    ).toBeTruthy();
    expect(screen.getByText(/cannot start, stop or change anything/i)).toBeTruthy();
  });

  it('titles the page with the navigation manifest label, without a gradient h1', () => {
    renderPage();
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe('Assistant');
    expect(heading.className).not.toContain('bg-clip-text');
    expect(heading.className).not.toContain('gradient');
  });

  // Six suggestions was four plus a pair that existed to fill a third column.
  it('offers exactly four suggestions', () => {
    renderPage();
    const grid = screen.getByTestId('assistant-empty-state');
    const cards = within(grid).getAllByRole('button');
    expect(cards).toHaveLength(4);
    expect(screen.queryByText('Stack overview')).toBeNull();
    expect(screen.queryByText('Network topology')).toBeNull();
  });

  // Every second line used to restate its own title ("Container logs" /
  // "Fetch recent logs for debugging").
  it('shows the exact prompt each suggestion will send', () => {
    renderPage();
    const card = screen.getByRole('button', { name: /Recent restarts/ });
    expect(card.textContent).toContain(
      'Which containers restarted in the last hour, and what do their logs say?',
    );
  });

  it('renders model selector with available models', () => {
    renderPage();
    const select = screen.getByRole('combobox');
    expect(select).toBeTruthy();
    fireEvent.click(select);
    expect(screen.getByRole('option', { name: 'llama3.2' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'codellama' })).toBeTruthy();
  });

  it('hides model selector when no models available', () => {
    vi.mocked(useLlmModels).mockReturnValue({
      data: undefined,
    } as any);

    renderPage();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('renders messages from chat history', () => {
    vi.mocked(useLlmChat).mockReturnValue({
      messages: [
        { id: '1', role: 'user', content: 'Hello', timestamp: new Date().toISOString() },
        { id: '2', role: 'assistant', content: 'Hi there!', timestamp: new Date().toISOString() },
      ],
      isStreaming: false,
      currentResponse: '',
      activeToolCalls: [],
      sendMessage: vi.fn(),
      cancelGeneration: vi.fn(),
      clearHistory: vi.fn(),
    } as any);

    renderPage();
    expect(screen.getByText('Hello')).toBeTruthy();
    expect(screen.getByText('Hi there!')).toBeTruthy();
  });

  it('disables input and model selector while streaming', () => {
    vi.mocked(useLlmChat).mockReturnValue({
      messages: [],
      isStreaming: true,
      currentResponse: 'Generating...',
      activeToolCalls: [],
      sendMessage: vi.fn(),
      cancelGeneration: vi.fn(),
      clearHistory: vi.fn(),
    } as any);

    vi.mocked(useLlmModels).mockReturnValue({
      data: {
        models: [{ name: 'llama3.2' }],
        default: 'llama3.2',
      },
    } as any);

    renderPage();
    const input = screen.getByPlaceholderText('Ask about your infrastructure...');
    expect(input).toHaveProperty('disabled', true);
    const select = screen.getByRole('combobox');
    expect(select).toHaveProperty('disabled', true);
  });

  it('shows stop button during streaming', () => {
    vi.mocked(useLlmChat).mockReturnValue({
      messages: [],
      isStreaming: true,
      currentResponse: 'Some response...',
      activeToolCalls: [],
      sendMessage: vi.fn(),
      cancelGeneration: vi.fn(),
      clearHistory: vi.fn(),
    } as any);

    renderPage();
    expect(screen.getByText('Stop generating')).toBeTruthy();
  });

  it('prefills input when opened from remediation context', () => {
    renderPage('/assistant', { prefillPrompt: 'Explain this remediation action' });
    const input = screen.getByPlaceholderText('Ask about your infrastructure...') as HTMLInputElement;
    expect(input.value).toBe('Explain this remediation action');
  });

  it('sends suggested question immediately when clicked', () => {
    const sendMessage = vi.fn();
    vi.mocked(useLlmChat).mockReturnValue({
      messages: [],
      isStreaming: false,
      currentResponse: '',
      activeToolCalls: [],
      sendMessage,
      cancelGeneration: vi.fn(),
      clearHistory: vi.fn(),
    } as any);

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Busiest container/i }));

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(
      'Which container is using the most CPU and memory right now?',
      undefined,
      'llama3.2',
    );
  });
});

// ---------------------------------------------------------------------------
// Suggestion generation — the grid is built from live insights so it names the
// container that is anomalous right now, not a static demo list.
// ---------------------------------------------------------------------------

describe('suggestionsFromInsights', () => {
  const insight = (over: Partial<Insight>): Insight => ({
    id: 'i1',
    endpoint_id: 1,
    endpoint_name: 'local',
    container_id: 'c1',
    container_name: 'web-api',
    severity: 'warning',
    category: 'anomaly',
    title: 'Memory usage anomaly',
    description: 'memory z=3.7',
    suggested_action: null,
    is_acknowledged: 0,
    created_at: new Date().toISOString(),
    ...over,
  }) as Insight;

  it('returns nothing when there are no insights', () => {
    expect(suggestionsFromInsights([], 4)).toEqual([]);
    expect(suggestionsFromInsights(undefined, 4)).toEqual([]);
  });

  it('names the container and its insight in the prompt', () => {
    const [s] = suggestionsFromInsights([insight({})], 4);
    expect(s.label).toBe('web-api');
    expect(s.prompt).toBe('Why is web-api showing "Memory usage anomaly"? Check its recent metrics and logs.');
  });

  it('puts critical before warning regardless of array order', () => {
    const out = suggestionsFromInsights(
      [
        insight({ id: 'a', container_name: 'redis', severity: 'warning' }),
        insight({ id: 'b', container_name: 'postgres', severity: 'critical' }),
      ],
      4,
    );
    expect(out.map((s) => s.label)).toEqual(['postgres', 'redis']);
  });

  it('spends at most one slot per container', () => {
    const out = suggestionsFromInsights(
      [
        insight({ id: 'a', container_name: 'redis' }),
        insight({ id: 'b', container_name: 'redis', title: 'CPU usage anomaly' }),
      ],
      4,
    );
    expect(out).toHaveLength(1);
  });

  it('skips acknowledged insights and info-level noise', () => {
    const out = suggestionsFromInsights(
      [
        insight({ id: 'a', container_name: 'redis', is_acknowledged: 1 }),
        insight({ id: 'b', container_name: 'nginx', severity: 'info' }),
      ],
      4,
    );
    expect(out).toEqual([]);
  });

  it('skips fleet-wide insights with no container to name', () => {
    expect(suggestionsFromInsights([insight({ container_name: null })], 4)).toEqual([]);
  });

  it('honours the cap', () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map((n) => insight({ id: n, container_name: n }));
    expect(suggestionsFromInsights(many, 3)).toHaveLength(3);
  });
});

describe('buildSuggestions', () => {
  it('always yields four, live incidents first', () => {
    const live = [
      {
        id: 'i1',
        endpoint_id: 1,
        endpoint_name: 'local',
        container_id: 'c1',
        container_name: 'web-api',
        severity: 'critical',
        category: 'anomaly',
        title: 'CPU usage anomaly',
        description: '',
        suggested_action: null,
        is_acknowledged: 0,
        created_at: new Date().toISOString(),
      } as Insight,
    ];
    const out = buildSuggestions(live, false);
    expect(out).toHaveLength(4);
    expect(out[0].label).toBe('web-api');
  });

  it('keeps a kali-mcp entry when the server is connected, still four total', () => {
    const out = buildSuggestions(undefined, true);
    expect(out).toHaveLength(4);
    expect(out.some((s) => s.prompt.includes('kali-mcp'))).toBe(true);
  });

  it('offers no kali-mcp entry when the server is absent', () => {
    const out = buildSuggestions(undefined, false);
    expect(out.some((s) => s.prompt.includes('kali-mcp'))).toBe(false);
  });
});

describe('live-state suggestions in the page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useLlmModels).mockReturnValue({
      data: { models: [{ name: 'llama3.2' }], default: 'llama3.2' },
    } as any);
    vi.mocked(useLlmChat).mockReturnValue({
      messages: [],
      isStreaming: false,
      currentResponse: '',
      activeToolCalls: [],
      statusMessage: null,
      sendMessage: vi.fn(),
      cancelGeneration: vi.fn(),
      clearHistory: vi.fn(),
    } as any);
  });

  it('names the container that is anomalous right now', async () => {
    mockApiGet.mockResolvedValue({
      insights: [
        {
          id: 'i1',
          endpoint_id: 1,
          endpoint_name: 'local',
          container_id: 'c1',
          container_name: 'payments-api',
          severity: 'critical',
          category: 'anomaly',
          title: 'Memory usage anomaly',
          description: '',
          suggested_action: null,
          is_acknowledged: 0,
          created_at: new Date().toISOString(),
        },
      ],
      total: 1,
    });

    renderPage();

    const card = await screen.findByRole('button', { name: /payments-api/ });
    expect(card.textContent).toContain(
      'Why is payments-api showing "Memory usage anomaly"? Check its recent metrics and logs.',
    );
    expect(mockApiGet).toHaveBeenCalledWith('/api/monitoring/insights');
  });

  it('falls back to the baseline four when the insights request fails', async () => {
    mockApiGet.mockRejectedValue(new Error('offline'));

    renderPage();

    const grid = screen.getByTestId('assistant-empty-state');
    expect(within(grid).getAllByRole('button')).toHaveLength(4);
    expect(screen.getByRole('button', { name: /Recent restarts/ })).toBeTruthy();
  });
});

describe('LLM Profile Selector', () => {
  const mockProfiles = [
    { id: 'default', name: 'Default', description: 'Built-in profile', isBuiltIn: true, prompts: {}, createdAt: '', updatedAt: '' },
    { id: 'custom-1', name: 'Security Focus', description: 'Security oriented', isBuiltIn: false, prompts: {}, createdAt: '', updatedAt: '' },
    { id: 'custom-2', name: 'Verbose', description: 'Detailed responses', isBuiltIn: false, prompts: {}, createdAt: '', updatedAt: '' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders profile selector for admin users', () => {
    vi.mocked(useAuth).mockReturnValue({
      isAuthenticated: true,
      username: 'admin',
      token: 'test-token',
      role: 'admin',
      login: vi.fn(),
      loginWithToken: vi.fn(),
      logout: vi.fn(),
    });
    vi.mocked(usePromptProfiles).mockReturnValue({
      data: { profiles: mockProfiles, activeProfileId: 'default' },
    } as any);

    renderPage();

    // Should have two comboboxes: profile selector + model selector
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBe(2);

    // Open the profile selector (first combobox)
    fireEvent.click(selects[0]);
    expect(screen.getByRole('option', { name: /Default/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: /Security Focus/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: /Verbose/ })).toBeTruthy();
  });

  it('hides profile selector for non-admin users', () => {
    vi.mocked(useAuth).mockReturnValue({
      isAuthenticated: true,
      username: 'viewer-user',
      token: 'test-token',
      role: 'viewer',
      login: vi.fn(),
      loginWithToken: vi.fn(),
      logout: vi.fn(),
    });
    vi.mocked(usePromptProfiles).mockReturnValue({
      data: { profiles: mockProfiles, activeProfileId: 'default' },
    } as any);

    renderPage();

    // Only one combobox: model selector (no profile selector)
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBe(1);
  });

  it('calls switchProfile on selection change', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ success: true, activeProfileId: 'custom-1' });
    vi.mocked(useAuth).mockReturnValue({
      isAuthenticated: true,
      username: 'admin',
      token: 'test-token',
      role: 'admin',
      login: vi.fn(),
      loginWithToken: vi.fn(),
      logout: vi.fn(),
    });
    vi.mocked(usePromptProfiles).mockReturnValue({
      data: { profiles: mockProfiles, activeProfileId: 'default' },
    } as any);
    vi.mocked(useSwitchProfile).mockReturnValue({
      mutateAsync,
      isPending: false,
    } as any);

    renderPage();

    const selects = screen.getAllByRole('combobox');
    fireEvent.click(selects[0]);
    fireEvent.click(screen.getByRole('option', { name: /Security Focus/ }));

    expect(mutateAsync).toHaveBeenCalledWith({ id: 'custom-1' });
  });

  it('shows active profile as selected', () => {
    vi.mocked(useAuth).mockReturnValue({
      isAuthenticated: true,
      username: 'admin',
      token: 'test-token',
      role: 'admin',
      login: vi.fn(),
      loginWithToken: vi.fn(),
      logout: vi.fn(),
    });
    vi.mocked(usePromptProfiles).mockReturnValue({
      data: { profiles: mockProfiles, activeProfileId: 'custom-1' },
    } as any);

    renderPage();

    const selects = screen.getAllByRole('combobox');
    // The profile selector trigger should display the active profile name
    expect(selects[0].textContent).toContain('Security Focus');
  });

  it('disables profile selector while streaming', () => {
    vi.mocked(useAuth).mockReturnValue({
      isAuthenticated: true,
      username: 'admin',
      token: 'test-token',
      role: 'admin',
      login: vi.fn(),
      loginWithToken: vi.fn(),
      logout: vi.fn(),
    });
    vi.mocked(usePromptProfiles).mockReturnValue({
      data: { profiles: mockProfiles, activeProfileId: 'default' },
    } as any);
    vi.mocked(useLlmChat).mockReturnValue({
      messages: [],
      isStreaming: true,
      currentResponse: 'Generating...',
      activeToolCalls: [],
      sendMessage: vi.fn(),
      cancelGeneration: vi.fn(),
      clearHistory: vi.fn(),
    } as any);

    renderPage();

    const selects = screen.getAllByRole('combobox');
    expect(selects[0]).toHaveProperty('disabled', true);
  });

  it('marks built-in profiles with diamond marker', () => {
    vi.mocked(useAuth).mockReturnValue({
      isAuthenticated: true,
      username: 'admin',
      token: 'test-token',
      role: 'admin',
      login: vi.fn(),
      loginWithToken: vi.fn(),
      logout: vi.fn(),
    });
    vi.mocked(usePromptProfiles).mockReturnValue({
      data: { profiles: mockProfiles, activeProfileId: 'default' },
    } as any);
    vi.mocked(useLlmChat).mockReturnValue({
      messages: [],
      isStreaming: false,
      currentResponse: '',
      activeToolCalls: [],
      sendMessage: vi.fn(),
      cancelGeneration: vi.fn(),
      clearHistory: vi.fn(),
    } as any);

    renderPage();

    const selects = screen.getAllByRole('combobox');
    fireEvent.click(selects[0]);

    // Built-in profile should have the diamond marker
    const defaultOption = screen.getByRole('option', { name: /Default/ });
    expect(defaultOption.textContent).toContain('✦');

    // Custom profiles should NOT have the marker
    const customOption = screen.getByRole('option', { name: /Security Focus/ });
    expect(customOption.textContent).not.toContain('✦');
  });
});

describe('CodeBlock rendering', () => {
  beforeEach(() => {
    vi.mocked(useLlmModels).mockReturnValue({
      data: { models: [{ name: 'llama3.2' }], default: 'llama3.2' },
    } as any);
  });

  it('renders code block text with light color on dark background', () => {
    vi.mocked(useLlmChat).mockReturnValue({
      messages: [
        { id: '1', role: 'assistant', content: '```bash\necho hello\n```', timestamp: new Date().toISOString() },
      ],
      isStreaming: false,
      currentResponse: '',
      activeToolCalls: [],
      sendMessage: vi.fn(),
      cancelGeneration: vi.fn(),
      clearHistory: vi.fn(),
    } as any);

    const { container } = renderPage();
    const codeEl = container.querySelector('pre code');
    expect(codeEl).toBeTruthy();
    expect(codeEl!.className).toContain('text-zinc-100');
  });

  it('applies syntax highlighting via rehype-highlight', () => {
    vi.mocked(useLlmChat).mockReturnValue({
      messages: [
        { id: '1', role: 'assistant', content: '```js\nconst x = 1;\n```', timestamp: new Date().toISOString() },
      ],
      isStreaming: false,
      currentResponse: '',
      activeToolCalls: [],
      sendMessage: vi.fn(),
      cancelGeneration: vi.fn(),
      clearHistory: vi.fn(),
    } as any);

    const { container } = renderPage();
    // rehype-highlight adds hljs class and produces <span> elements with hljs-* classes
    const codeEl = container.querySelector('pre code');
    expect(codeEl).toBeTruthy();
    const highlightedSpans = codeEl!.querySelectorAll('span[class*="hljs-"]');
    expect(highlightedSpans.length).toBeGreaterThan(0);
  });

  it('shows language label in code block header', () => {
    vi.mocked(useLlmChat).mockReturnValue({
      messages: [
        { id: '1', role: 'assistant', content: '```python\nprint("hi")\n```', timestamp: new Date().toISOString() },
      ],
      isStreaming: false,
      currentResponse: '',
      activeToolCalls: [],
      sendMessage: vi.fn(),
      cancelGeneration: vi.fn(),
      clearHistory: vi.fn(),
    } as any);

    renderPage();
    expect(screen.getByText('python')).toBeTruthy();
  });
});

describe('normalizeMarkdown', () => {
  // We test the normalizeMarkdown function indirectly through MarkdownContent rendering.
  // The function is not exported, but its effects are visible in the rendered output.

  it('strips <think> blocks from thinking models', () => {
    vi.mocked(useLlmChat).mockReturnValue({
      messages: [
        { id: '1', role: 'assistant', content: '<think>I need to analyze the containers...</think>All containers are healthy.', timestamp: new Date().toISOString() },
      ],
      isStreaming: false,
      currentResponse: '',
      activeToolCalls: [],
      sendMessage: vi.fn(),
      cancelGeneration: vi.fn(),
      clearHistory: vi.fn(),
    } as any);

    vi.mocked(useLlmModels).mockReturnValue({
      data: { models: [{ name: 'llama3.2' }], default: 'llama3.2' },
    } as any);

    renderPage();
    expect(screen.getByText('All containers are healthy.')).toBeTruthy();
    expect(screen.queryByText(/I need to analyze/)).toBeNull();
  });

  it('strips <thinking> blocks from thinking models', () => {
    vi.mocked(useLlmChat).mockReturnValue({
      messages: [
        { id: '1', role: 'assistant', content: '<thinking>Reasoning about metrics</thinking>CPU usage is 45%.', timestamp: new Date().toISOString() },
      ],
      isStreaming: false,
      currentResponse: '',
      activeToolCalls: [],
      sendMessage: vi.fn(),
      cancelGeneration: vi.fn(),
      clearHistory: vi.fn(),
    } as any);

    vi.mocked(useLlmModels).mockReturnValue({
      data: { models: [{ name: 'llama3.2' }], default: 'llama3.2' },
    } as any);

    renderPage();
    expect(screen.getByText('CPU usage is 45%.')).toBeTruthy();
    expect(screen.queryByText(/Reasoning about metrics/)).toBeNull();
  });

  it('renders headers without space correctly', () => {
    vi.mocked(useLlmChat).mockReturnValue({
      messages: [
        { id: '1', role: 'assistant', content: '#Title\n##Subtitle', timestamp: new Date().toISOString() },
      ],
      isStreaming: false,
      currentResponse: '',
      activeToolCalls: [],
      sendMessage: vi.fn(),
      cancelGeneration: vi.fn(),
      clearHistory: vi.fn(),
    } as any);

    vi.mocked(useLlmModels).mockReturnValue({
      data: { models: [{ name: 'llama3.2' }], default: 'llama3.2' },
    } as any);

    renderPage();
    // normalizeMarkdown adds space: "#Title" → "# Title"
    // react-markdown renders it as an h1
    expect(screen.getByText('Title')).toBeTruthy();
    expect(screen.getByText('Subtitle')).toBeTruthy();
  });

  it('renders list items without space correctly', () => {
    vi.mocked(useLlmChat).mockReturnValue({
      messages: [
        { id: '1', role: 'assistant', content: '-item one\n-item two', timestamp: new Date().toISOString() },
      ],
      isStreaming: false,
      currentResponse: '',
      activeToolCalls: [],
      sendMessage: vi.fn(),
      cancelGeneration: vi.fn(),
      clearHistory: vi.fn(),
    } as any);

    vi.mocked(useLlmModels).mockReturnValue({
      data: { models: [{ name: 'llama3.2' }], default: 'llama3.2' },
    } as any);

    renderPage();
    // normalizeMarkdown adds space: "-item one" → "- item one"
    expect(screen.getByText('item one')).toBeTruthy();
    expect(screen.getByText('item two')).toBeTruthy();
  });
});

describe('ThinkingIndicator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useLlmModels).mockReturnValue({
      data: { models: [{ name: 'llama3.2' }], default: 'llama3.2' },
    } as any);
  });

  it('shows thinking indicator with default text when no status message', () => {
    vi.mocked(useLlmChat).mockReturnValue({
      messages: [
        { id: '1', role: 'user', content: 'Hello', timestamp: new Date().toISOString() },
      ],
      isStreaming: false,
      currentResponse: '',
      activeToolCalls: [],
      statusMessage: null,
      sendMessage: vi.fn(),
      cancelGeneration: vi.fn(),
      clearHistory: vi.fn(),
    } as any);

    // Simulate isSending state by rendering with messages and triggering send
    renderPage();

    // The component shows the thinking indicator when isSending=true && !isStreaming
    // Since we can't set isSending directly, we test the ThinkingIndicator indirectly
    // by checking the testid appears when form is submitted
  });

  it('shows dynamic status message from backend', () => {
    vi.mocked(useLlmChat).mockReturnValue({
      messages: [],
      isStreaming: false,
      currentResponse: '',
      activeToolCalls: [],
      statusMessage: 'Loading model llama3.2...',
      sendMessage: vi.fn(),
      cancelGeneration: vi.fn(),
      clearHistory: vi.fn(),
    } as any);

    renderPage();
    // Status message is rendered inside ThinkingIndicator, which only shows when isSending
    // We verify the hook returns statusMessage correctly
  });

  it('shows cancel button during thinking state', () => {
    vi.mocked(useLlmChat).mockReturnValue({
      messages: [],
      isStreaming: false,
      currentResponse: '',
      activeToolCalls: [],
      statusMessage: null,
      sendMessage: vi.fn(),
      cancelGeneration: vi.fn(),
      clearHistory: vi.fn(),
    } as any);

    renderPage();
    // The cancel button is part of ThinkingIndicator, visible during isSending state
  });
});

describe('Connection status indicator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useLlmModels).mockReturnValue({
      data: { models: [{ name: 'llama3.2' }], default: 'llama3.2' },
    } as any);
  });

  it('shows reconnecting banner when socket is disconnected', () => {
    mockLlmSocket.connected = false;

    renderPage();
    expect(screen.getByText('Reconnecting to AI service...')).toBeTruthy();

    // Restore for other tests
    mockLlmSocket.connected = true;
  });

  it('hides reconnecting banner when socket is connected', () => {
    mockLlmSocket.connected = true;

    renderPage();
    expect(screen.queryByText('Reconnecting to AI service...')).toBeNull();
  });

  it('disables input when socket is disconnected', () => {
    mockLlmSocket.connected = false;

    renderPage();
    const input = screen.getByPlaceholderText('Ask about your infrastructure...');
    expect(input).toHaveProperty('disabled', true);

    // Restore for other tests
    mockLlmSocket.connected = true;
  });

  // Regression: previously the page read `llmSocket.connected` directly during
  // render. socket.io mutates that flag asynchronously, so when the LLM socket
  // connected after the first paint (e.g. after the monitoring socket already
  // flipped the SocketProvider's aggregated `connected` state to true), the
  // banner stayed stuck on "Reconnecting to AI service..." even though the
  // socket was healthy and chat worked. The fix subscribes to the socket's
  // own `connect` event so the page re-renders on the namespace's transition.
  it('clears reconnecting banner when socket connects after initial render', async () => {
    mockLlmSocket.connected = false;

    renderPage();
    expect(screen.getByText('Reconnecting to AI service...')).toBeTruthy();

    // Simulate socket.io emitting the connect event on this namespace.
    mockLlmSocket.connected = true;
    await act(async () => {
      llmSocketHandlers['connect']?.();
    });

    expect(screen.queryByText('Reconnecting to AI service...')).toBeNull();
  });

  describe('ContextBanner (Discuss with AI navigation)', () => {
    it('shows context banner when arriving with source in location state', () => {
      renderPage('/assistant', { source: 'remediation', containerName: 'web-api' });
      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(screen.getByText('From Remediation')).toBeInTheDocument();
      expect(screen.getByText('web-api')).toBeInTheDocument();
    });

    it('shows containerSummary in context banner', () => {
      renderPage('/assistant', {
        source: 'remediation',
        containerName: 'backend',
        containerSummary: 'CPU usage is critically high',
      });
      expect(screen.getByText('CPU usage is critically high')).toBeInTheDocument();
    });

    it('does not show context banner when no source in location state', () => {
      renderPage('/assistant', { prefillPrompt: 'Hello' });
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('does not show context banner when no location state', () => {
      renderPage('/assistant');
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('prefills input from location state prefillPrompt', () => {
      renderPage('/assistant', { prefillPrompt: 'Why is nginx crashing?' });
      const input = screen.getByPlaceholderText('Ask about your infrastructure...') as HTMLInputElement;
      expect(input.value).toBe('Why is nginx crashing?');
    });

    it('dismisses context banner when X button is clicked', () => {
      renderPage('/assistant', { source: 'remediation', containerName: 'redis' });
      expect(screen.getByRole('status')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss context banner' }));
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Issue #1050 — clear-history modal flow + chat send/receive coverage.
//
// Depends on #1019 (CLOSED): `window.confirm()` was replaced with the
// `ConfirmDialog` Radix modal, so we exercise it via accessible role/name
// queries instead of stubbing `window.confirm`. The LLM transport is mocked
// at the `useLlmChat` hook boundary (matches the pattern used above and
// project CLAUDE.md guidance to "keep mocks close to the boundary").
// ---------------------------------------------------------------------------

describe('Clear history flow (#1050)', () => {
  const sampleMessages = [
    { id: 'u1', role: 'user' as const, content: 'Hello', timestamp: new Date().toISOString() },
    { id: 'a1', role: 'assistant' as const, content: 'Hi there!', timestamp: new Date().toISOString() },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockLlmSocket.connected = true;
    vi.mocked(useLlmModels).mockReturnValue({
      data: { models: [{ name: 'llama3.2' }], default: 'llama3.2' },
    } as any);
  });

  it('opens the confirm dialog when Clear History button is clicked', () => {
    vi.mocked(useLlmChat).mockReturnValue({
      messages: sampleMessages,
      isStreaming: false,
      currentResponse: '',
      activeToolCalls: [],
      statusMessage: null,
      sendMessage: vi.fn(),
      cancelGeneration: vi.fn(),
      clearHistory: vi.fn(),
    } as any);

    renderPage();

    // No dialog before clicking.
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Clear History/i }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText('Clear Chat History')).toBeInTheDocument();
    expect(
      within(dialog).getByText(/Clear all chat history\? This action cannot be undone\./i),
    ).toBeInTheDocument();
  });

  it('calls clearHistory and closes the dialog when confirming', () => {
    const clearHistory = vi.fn();
    vi.mocked(useLlmChat).mockReturnValue({
      messages: sampleMessages,
      isStreaming: false,
      currentResponse: '',
      activeToolCalls: [],
      statusMessage: null,
      sendMessage: vi.fn(),
      cancelGeneration: vi.fn(),
      clearHistory,
    } as any);

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Clear History/i }));

    const dialog = screen.getByRole('dialog');
    // The dialog has its own "Clear History" confirm button — scope to the dialog
    // so we don't accidentally re-click the header trigger.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear History' }));

    expect(clearHistory).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('preserves messages and does not call clearHistory when Cancel is clicked', () => {
    const clearHistory = vi.fn();
    vi.mocked(useLlmChat).mockReturnValue({
      messages: sampleMessages,
      isStreaming: false,
      currentResponse: '',
      activeToolCalls: [],
      statusMessage: null,
      sendMessage: vi.fn(),
      cancelGeneration: vi.fn(),
      clearHistory,
    } as any);

    renderPage();
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Hi there!')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Clear History/i }));

    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(clearHistory).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    // Messages still rendered after cancel.
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Hi there!')).toBeInTheDocument();
  });
});

describe('Chat send/receive flow (#1050)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLlmSocket.connected = true;
    vi.mocked(useLlmModels).mockReturnValue({
      data: { models: [{ name: 'llama3.2' }], default: 'llama3.2' },
    } as any);
  });

  it('sends the typed message to the LLM transport on submit', () => {
    const sendMessage = vi.fn();
    vi.mocked(useLlmChat).mockReturnValue({
      messages: [],
      isStreaming: false,
      currentResponse: '',
      activeToolCalls: [],
      statusMessage: null,
      sendMessage,
      cancelGeneration: vi.fn(),
      clearHistory: vi.fn(),
    } as any);

    renderPage();

    const input = screen.getByPlaceholderText('Ask about your infrastructure...') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'How many containers are running?' } });
    expect(input.value).toBe('How many containers are running?');

    fireEvent.click(screen.getByRole('button', { name: /Send/i }));

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(
      'How many containers are running?',
      undefined,
      'llama3.2',
    );
    // Input is cleared after submit.
    expect(input.value).toBe('');
  });

  it('renders an assistant response returned by the LLM transport', () => {
    vi.mocked(useLlmChat).mockReturnValue({
      messages: [
        { id: 'u1', role: 'user', content: 'Status?', timestamp: new Date().toISOString() },
        {
          id: 'a1',
          role: 'assistant',
          content: 'All containers healthy.',
          timestamp: new Date().toISOString(),
        },
      ],
      isStreaming: false,
      currentResponse: '',
      activeToolCalls: [],
      statusMessage: null,
      sendMessage: vi.fn(),
      cancelGeneration: vi.fn(),
      clearHistory: vi.fn(),
    } as any);

    renderPage();

    expect(screen.getByText('Status?')).toBeInTheDocument();
    expect(screen.getByText('All containers healthy.')).toBeInTheDocument();
  });

  it('shows the loading indicator after submit while waiting for the response', () => {
    const sendMessage = vi.fn();
    vi.mocked(useLlmChat).mockReturnValue({
      // `isSending` is local to the page and toggles on submit. The
      // ThinkingIndicator renders while isSending && !isStreaming.
      messages: [],
      isStreaming: false,
      currentResponse: '',
      activeToolCalls: [],
      statusMessage: 'Loading model llama3.2...',
      sendMessage,
      cancelGeneration: vi.fn(),
      clearHistory: vi.fn(),
    } as any);

    renderPage();

    // No indicator before submit.
    expect(screen.queryByTestId('thinking-indicator')).toBeNull();

    const input = screen.getByPlaceholderText('Ask about your infrastructure...');
    fireEvent.change(input, { target: { value: 'ping' } });
    fireEvent.click(screen.getByRole('button', { name: /Send/i }));

    // Indicator appears between submit and response receipt.
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('thinking-indicator')).toBeInTheDocument();
  });

  it('renders a system error message when the LLM transport surfaces an error', () => {
    // The page renders messages with role === 'system' as a destructive
    // alert bubble inside the chat (see MessageBubble). The hook is the
    // boundary that emits these on transport errors, so we mock that state.
    vi.mocked(useLlmChat).mockReturnValue({
      messages: [
        { id: 'u1', role: 'user', content: 'List anomalies', timestamp: new Date().toISOString() },
        {
          id: 'sys-err',
          role: 'system',
          content: 'Error: failed to reach the AI service. Please try again.',
          timestamp: new Date().toISOString(),
        },
      ],
      isStreaming: false,
      currentResponse: '',
      activeToolCalls: [],
      statusMessage: null,
      sendMessage: vi.fn(),
      cancelGeneration: vi.fn(),
      clearHistory: vi.fn(),
    } as any);

    renderPage();

    expect(
      screen.getByText('Error: failed to reach the AI service. Please try again.'),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Design-critique fixes: this was the one page in the product that opted out
// of the theme system, and it decorated hardest at the moment of least
// information.
// ---------------------------------------------------------------------------

describe('Assistant presentation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLlmSocket.connected = true;
    mockApiGet.mockResolvedValue({ insights: [], total: 0 });
    vi.mocked(useLlmModels).mockReturnValue({
      data: { models: [{ name: 'llama3.2' }], default: 'llama3.2' },
    } as any);
    vi.mocked(useLlmChat).mockReturnValue({
      messages: [],
      isStreaming: false,
      currentResponse: '',
      activeToolCalls: [],
      statusMessage: null,
      sendMessage: vi.fn(),
      cancelGeneration: vi.fn(),
      clearHistory: vi.fn(),
    } as any);
    vi.mocked(usePromptProfiles).mockReturnValue({ data: undefined } as any);
    vi.mocked(useAuth).mockReturnValue({
      isAuthenticated: true,
      username: 'admin',
      token: 'test-token',
      role: 'viewer',
      login: vi.fn(),
      loginWithToken: vi.fn(),
      logout: vi.fn(),
    });
  });

  it('uses no blue/purple/emerald gradients in its chrome', () => {
    const { container } = renderPage();
    const html = container.innerHTML;
    expect(html).not.toMatch(/from-blue-\d+/);
    expect(html).not.toMatch(/to-purple-\d+/);
    expect(html).not.toMatch(/from-emerald-\d+/);
  });

  it('gives Send the primary token with no hover scale or coloured shadow', () => {
    renderPage();
    const send = screen.getByRole('button', { name: /Send/i });
    expect(send.className).toContain('bg-primary');
    expect(send.className).not.toContain('gradient');
    expect(send.className).not.toContain('hover:scale');
    expect(send.className).not.toContain('shadow-blue');
  });

  // Two identical robot glyphs on one empty screen — 48px in the header and
  // 80px in the hero behind an animate-pulse glow.
  it('shows one assistant mark on the empty screen, with no pulse glow', () => {
    const { container } = renderPage();
    expect(container.querySelectorAll('.lucide-bot')).toHaveLength(1);
    expect(container.querySelector('.animate-pulse')).toBeNull();
  });

  // Green means healthy in this palette; it should not also mean "you typed
  // this". The user's own message gets the quietest treatment available.
  it('renders the user message on a muted surface, not in status green', () => {
    vi.mocked(useLlmChat).mockReturnValue({
      messages: [{ id: 'u1', role: 'user', content: 'Why is redis restarting?', timestamp: new Date().toISOString() }],
      isStreaming: false,
      currentResponse: '',
      activeToolCalls: [],
      statusMessage: null,
      sendMessage: vi.fn(),
      cancelGeneration: vi.fn(),
      clearHistory: vi.fn(),
    } as any);

    renderPage();
    const bubble = screen.getByText('Why is redis restarting?').closest('div');
    expect(bubble?.className).toContain('bg-muted');
    expect(bubble?.className).not.toContain('emerald');
  });

  // The model selector's unconditional min-w-[200px] was clipped off a 390px
  // viewport by a header row that could not wrap.
  it('lets the model selector shrink below sm and the header wrap', () => {
    renderPage();
    const select = screen.getByRole('combobox');
    expect(select.className).toContain('min-w-[9rem]');
    expect(select.className).toContain('sm:min-w-[200px]');
    expect(select.className).not.toMatch(/(^|\s)min-w-\[200px\]/);
    expect(screen.getByTestId('page-header').className).toContain('flex-wrap');
  });

  it('names the cancel affordance the same in both states', () => {
    renderPage();
    const input = screen.getByPlaceholderText('Ask about your infrastructure...');
    fireEvent.change(input, { target: { value: 'ping' } });
    fireEvent.click(screen.getByRole('button', { name: /Send/i }));

    // Was "Cancel" here and "Stop generating" once the stream started.
    expect(screen.getByTestId('thinking-indicator').textContent).toContain('Stop generating');
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('drops the only exclamation mark in the app operational copy', () => {
    vi.mocked(useLlmChat).mockReturnValue({
      messages: [
        { id: '1', role: 'assistant', content: '```bash\necho hello\n```', timestamp: new Date().toISOString() },
      ],
      isStreaming: false,
      currentResponse: '',
      activeToolCalls: [],
      statusMessage: null,
      sendMessage: vi.fn(),
      cancelGeneration: vi.fn(),
      clearHistory: vi.fn(),
    } as any);

    // jsdom ships no clipboard implementation.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Copy/i }));
    expect(writeText).toHaveBeenCalledWith('echo hello');
    expect(screen.getByText('Copied')).toBeTruthy();
    expect(screen.queryByText('Copied!')).toBeNull();
  });
});
