import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// Mock modules before importing component
vi.mock('@/hooks/use-llm-chat', () => ({
  useLlmChat: vi.fn().mockReturnValue({
    messages: [],
    isStreaming: false,
    currentResponse: '',
    activeToolCalls: [],
    sendMessage: vi.fn(),
    cancelGeneration: vi.fn(),
    clearHistory: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-llm-models', () => ({
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

vi.mock('@/hooks/use-mcp', () => ({
  useMcpServers: vi.fn().mockReturnValue({ data: undefined }),
}));

vi.mock('@/providers/socket-provider', () => ({
  useSockets: () => ({ llmSocket: null }),
}));

vi.mock('@/hooks/use-llm-feedback', () => ({
  useSubmitFeedback: () => ({
    mutate: vi.fn(),
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

import LlmAssistantPage from './llm-assistant';
import { useLlmChat } from '@/hooks/use-llm-chat';
import { useLlmModels } from '@/hooks/use-llm-models';

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

  it('renders welcome screen when no messages', () => {
    renderPage();
    expect(screen.getByText('Welcome to Your AI Assistant')).toBeTruthy();
    expect(screen.getByText(/real-time access/)).toBeTruthy();
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
    fireEvent.click(screen.getByRole('button', { name: /Running containers/i }));

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith('Show me all running containers and their resource usage', undefined, 'llama3.2');
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
