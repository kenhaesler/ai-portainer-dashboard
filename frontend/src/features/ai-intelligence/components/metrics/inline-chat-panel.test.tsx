import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InlineChatPanel } from './inline-chat-panel';

const mockSendMessage = vi.fn();
const mockCancelGeneration = vi.fn();
const mockClearHistory = vi.fn();

vi.mock('@/features/ai-intelligence/hooks/use-llm-chat', () => ({
  useLlmChat: vi.fn().mockReturnValue({
    messages: [],
    isStreaming: false,
    currentResponse: '',
    activeToolCalls: [],
    statusMessage: null,
    sendMessage: (...args: unknown[]) => mockSendMessage(...args),
    cancelGeneration: (...args: unknown[]) => mockCancelGeneration(...args),
    clearHistory: (...args: unknown[]) => mockClearHistory(...args),
  }),
}));

vi.mock('@/features/ai-intelligence/hooks/use-llm-feedback', () => ({
  useSubmitFeedback: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Minimal mock for react-markdown (renders children as text)
vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));
vi.mock('rehype-highlight', () => ({ default: () => {} }));
vi.mock('remark-gfm', () => ({ default: () => {} }));

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

const defaultContext = {
  containerId: 'abc123',
  containerName: 'web-backend',
  endpointId: 1,
  endpointName: 'production',
  timeRange: '1h',
  cpuAvg: 45.2,
  memoryAvg: 62.8,
};

describe('InlineChatPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when closed', () => {
    render(
      <InlineChatPanel open={false} onClose={vi.fn()} context={defaultContext} />,
      { wrapper: createWrapper() },
    );
    expect(screen.queryByTestId('inline-chat-panel')).not.toBeInTheDocument();
  });

  it('renders panel when open', () => {
    render(
      <InlineChatPanel open={true} onClose={vi.fn()} context={defaultContext} />,
      { wrapper: createWrapper() },
    );
    expect(screen.getByTestId('inline-chat-panel')).toBeInTheDocument();
    expect(screen.getByText('Ask AI')).toBeInTheDocument();
    expect(screen.getByText('web-backend')).toBeInTheDocument();
  });

  it('shows suggested questions when no messages', () => {
    render(
      <InlineChatPanel open={true} onClose={vi.fn()} context={defaultContext} />,
      { wrapper: createWrapper() },
    );
    expect(screen.getByText('Why is CPU usage high?')).toBeInTheDocument();
    expect(screen.getByText('Show recent error logs')).toBeInTheDocument();
    expect(screen.getByText('Any anomalies detected?')).toBeInTheDocument();
    expect(screen.getByText('Is memory trending up?')).toBeInTheDocument();
  });

  it('sends message with container context on suggestion click', () => {
    render(
      <InlineChatPanel open={true} onClose={vi.fn()} context={defaultContext} />,
      { wrapper: createWrapper() },
    );

    fireEvent.click(screen.getByText('Why is CPU usage high?'));

    expect(mockSendMessage).toHaveBeenCalledWith(
      'Why is CPU usage high?',
      expect.objectContaining({
        containerId: 'abc123',
        containerName: 'web-backend',
        endpointId: 1,
        page: 'metrics-dashboard',
        timeRange: '1h',
      }),
    );
  });

  it('sends user input with context on form submit', () => {
    render(
      <InlineChatPanel open={true} onClose={vi.fn()} context={defaultContext} />,
      { wrapper: createWrapper() },
    );

    const input = screen.getByPlaceholderText('Ask about this container...');
    fireEvent.change(input, { target: { value: 'What is the peak memory?' } });
    fireEvent.submit(input.closest('form')!);

    expect(mockSendMessage).toHaveBeenCalledWith(
      'What is the peak memory?',
      expect.objectContaining({
        containerId: 'abc123',
        containerName: 'web-backend',
      }),
    );
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <InlineChatPanel open={true} onClose={onClose} context={defaultContext} />,
      { wrapper: createWrapper() },
    );

    fireEvent.click(screen.getByLabelText('Close chat panel'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when Escape key is pressed', () => {
    const onClose = vi.fn();
    render(
      <InlineChatPanel open={true} onClose={onClose} context={defaultContext} />,
      { wrapper: createWrapper() },
    );

    fireEvent.keyDown(screen.getByTestId('inline-chat-panel'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    render(
      <InlineChatPanel open={true} onClose={onClose} context={defaultContext} />,
      { wrapper: createWrapper() },
    );

    fireEvent.click(screen.getByTestId('chat-backdrop'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders as a dialog with accessible label', () => {
    render(
      <InlineChatPanel open={true} onClose={vi.fn()} context={defaultContext} />,
      { wrapper: createWrapper() },
    );

    expect(screen.getByRole('dialog', { name: 'Ask AI' })).toBeInTheDocument();
  });

  it('does not send empty messages', () => {
    render(
      <InlineChatPanel open={true} onClose={vi.fn()} context={defaultContext} />,
      { wrapper: createWrapper() },
    );

    const input = screen.getByPlaceholderText('Ask about this container...');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.submit(input.closest('form')!);

    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('renders messages from chat hook', async () => {
    const { useLlmChat } = await import('@/features/ai-intelligence/hooks/use-llm-chat');
    vi.mocked(useLlmChat).mockReturnValue({
      messages: [
        { id: '1', role: 'user', content: 'Hello', timestamp: new Date().toISOString() },
        { id: '2', role: 'assistant', content: 'Hi! I can help with web-backend.', timestamp: new Date().toISOString() },
      ],
      isStreaming: false,
      currentResponse: '',
      activeToolCalls: [],
      statusMessage: null,
      sendMessage: mockSendMessage,
      cancelGeneration: mockCancelGeneration,
      clearHistory: mockClearHistory,
    });

    render(
      <InlineChatPanel open={true} onClose={vi.fn()} context={defaultContext} />,
      { wrapper: createWrapper() },
    );

    expect(screen.getByText('Hello')).toBeInTheDocument();
    // The assistant message goes through markdown, check testid
    expect(screen.getAllByTestId('markdown')).toHaveLength(1);
  });

  it('shows stop button during streaming', async () => {
    const { useLlmChat } = await import('@/features/ai-intelligence/hooks/use-llm-chat');
    vi.mocked(useLlmChat).mockReturnValue({
      messages: [],
      isStreaming: true,
      currentResponse: 'Analyzing the container...',
      activeToolCalls: [],
      statusMessage: null,
      sendMessage: mockSendMessage,
      cancelGeneration: mockCancelGeneration,
      clearHistory: mockClearHistory,
    });

    render(
      <InlineChatPanel open={true} onClose={vi.fn()} context={defaultContext} />,
      { wrapper: createWrapper() },
    );

    const stopButton = screen.getByText('Stop');
    expect(stopButton).toBeInTheDocument();

    fireEvent.click(stopButton);
    expect(mockCancelGeneration).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Design-critique fixes: the panel opted out of the theme system alongside the
// full-page assistant, and spoke in the first person about capabilities it
// does not have.
// ---------------------------------------------------------------------------

describe('InlineChatPanel presentation', () => {
  // `vi.clearAllMocks()` clears calls but keeps implementations, and the
  // preceding block leaves `useLlmChat` returning a streaming session — so the
  // empty state would never render here without an explicit reset.
  beforeEach(async () => {
    vi.clearAllMocks();
    const { useLlmChat } = await import('@/features/ai-intelligence/hooks/use-llm-chat');
    vi.mocked(useLlmChat).mockReturnValue({
      messages: [],
      isStreaming: false,
      currentResponse: '',
      activeToolCalls: [],
      statusMessage: null,
      sendMessage: mockSendMessage,
      cancelGeneration: mockCancelGeneration,
      clearHistory: mockClearHistory,
    });
  });

  it('states what it reads instead of claiming access in the first person', () => {
    render(
      <InlineChatPanel open={true} onClose={vi.fn()} context={defaultContext} />,
      { wrapper: createWrapper() },
    );
    expect(screen.queryByText(/I have access to/)).toBeNull();
    expect(
      screen.getByText(/Reads metrics, logs, anomalies and traces for this container/),
    ).toBeInTheDocument();
    expect(screen.getByText(/cannot change anything/)).toBeInTheDocument();
  });

  it('uses theme tokens for its chrome rather than blue/purple gradients', () => {
    const { container } = render(
      <InlineChatPanel open={true} onClose={vi.fn()} context={defaultContext} />,
      { wrapper: createWrapper() },
    );
    const html = container.innerHTML;
    expect(html).not.toMatch(/from-blue-\d+/);
    expect(html).not.toMatch(/to-purple-\d+/);
    expect(html).not.toMatch(/from-emerald-\d+/);
  });

  it('gives the send button the primary token, not a gradient', () => {
    render(
      <InlineChatPanel open={true} onClose={vi.fn()} context={defaultContext} />,
      { wrapper: createWrapper() },
    );
    const send = screen.getByRole('button', { name: 'Send message' });
    expect(send.className).toContain('bg-primary');
    expect(send.className).not.toContain('gradient');
  });

  // Green means healthy in this palette; the operator's own message is the one
  // thing on screen they already know, so it gets the quietest treatment.
  it('renders the user message on a muted surface, not in status green', async () => {
    const { useLlmChat } = await import('@/features/ai-intelligence/hooks/use-llm-chat');
    vi.mocked(useLlmChat).mockReturnValue({
      messages: [{ id: '1', role: 'user', content: 'Why is CPU spiking?', timestamp: '' }],
      isStreaming: false,
      currentResponse: '',
      activeToolCalls: [],
      statusMessage: null,
      sendMessage: mockSendMessage,
      cancelGeneration: mockCancelGeneration,
      clearHistory: mockClearHistory,
    });

    render(
      <InlineChatPanel open={true} onClose={vi.fn()} context={defaultContext} />,
      { wrapper: createWrapper() },
    );

    const bubble = screen.getByText('Why is CPU spiking?').closest('div');
    expect(bubble?.className).toContain('bg-muted');
    expect(bubble?.className).not.toContain('emerald');
  });
});
