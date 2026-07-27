import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Issue #1494 — streaming performance regression tests.
//
// Every render of ReactMarkdown is a full remark/rehype re-parse of that
// message, so this suite replaces react-markdown with a counting stub and
// asserts that streamed-chunk flushes only re-render the streaming bubble,
// never the completed history bubbles (MessageBubble/MarkdownContent are
// memoized with module-scope plugin arrays + components map).
// ---------------------------------------------------------------------------

const markdownRenderSpy = vi.fn();
vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => {
    markdownRenderSpy(children);
    return <div data-testid="markdown">{children}</div>;
  },
}));
vi.mock('rehype-highlight', () => ({ default: () => {} }));
vi.mock('remark-gfm', () => ({ default: () => {} }));

vi.mock('@/features/ai-intelligence/hooks/use-llm-chat', () => ({
  useLlmChat: vi.fn(),
}));

vi.mock('@/features/ai-intelligence/hooks/use-llm-models', () => ({
  useLlmModels: vi.fn().mockReturnValue({ data: undefined }),
  useLlmStatus: vi.fn().mockReturnValue({ data: { available: true, disabledReason: null } }),
}));

vi.mock('@/features/ai-intelligence/hooks/use-mcp', () => ({
  useMcpServers: vi.fn().mockReturnValue({ data: undefined }),
}));

vi.mock('@/providers/socket-provider', () => ({
  useSockets: () => ({ llmSocket: { connected: true, emit: vi.fn(), on: vi.fn(), off: vi.fn() } }),
  useSocketConnected: () => true,
}));

vi.mock('@/features/ai-intelligence/hooks/use-llm-feedback', () => ({
  useSubmitFeedback: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/providers/auth-provider', () => ({
  useAuth: vi.fn().mockReturnValue({
    isAuthenticated: true,
    username: 'viewer-user',
    token: 'test-token',
    role: 'viewer',
    login: vi.fn(),
    loginWithToken: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock('@/features/ai-intelligence/hooks/use-prompt-profiles', () => ({
  usePromptProfiles: vi.fn().mockReturnValue({ data: undefined }),
  useSwitchProfile: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import LlmAssistantPage from './llm-assistant';
import { useLlmChat } from '@/features/ai-intelligence/hooks/use-llm-chat';

const baseChat = {
  messages: [],
  isStreaming: false,
  currentResponse: '',
  activeToolCalls: [],
  statusMessage: null,
  sendMessage: vi.fn(),
  cancelGeneration: vi.fn(),
  clearHistory: vi.fn(),
};

// Same object references across rerenders — mirrors production, where the
// messages array is referentially stable while chunks stream.
const historyMessages = [
  { id: 'u1', role: 'user' as const, content: 'Question?', timestamp: new Date().toISOString() },
  { id: 'a1', role: 'assistant' as const, content: 'Old answer', timestamp: new Date().toISOString() },
];

function pageTree() {
  return (
    <MemoryRouter initialEntries={['/assistant']}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <LlmAssistantPage />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

function stubMatchMedia(reducedMotion: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: query.includes('prefers-reduced-motion') ? reducedMotion : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

describe('LLM assistant streaming performance (#1494)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore the global setup default (reduced motion on).
    stubMatchMedia(true);
  });

  it('does not re-parse history markdown when the streamed response grows', () => {
    vi.mocked(useLlmChat).mockReturnValue({
      ...baseChat,
      messages: historyMessages,
      isStreaming: true,
      currentResponse: 'chunk one',
    } as any);

    const { rerender } = render(pageTree());

    // Initial render parses the history assistant bubble + the streaming bubble.
    expect(markdownRenderSpy).toHaveBeenCalledTimes(2);
    markdownRenderSpy.mockClear();

    // Simulate the next batched chunk flush: only currentResponse changes.
    vi.mocked(useLlmChat).mockReturnValue({
      ...baseChat,
      messages: historyMessages,
      isStreaming: true,
      currentResponse: 'chunk one chunk two',
    } as any);
    rerender(pageTree());

    // Only the streaming bubble re-parsed; the history bubble bailed out.
    expect(markdownRenderSpy).toHaveBeenCalledTimes(1);
    expect(markdownRenderSpy).toHaveBeenCalledWith(expect.stringContaining('chunk one chunk two'));
  });

  it('re-parses a history bubble when its content actually changes', () => {
    vi.mocked(useLlmChat).mockReturnValue({
      ...baseChat,
      messages: historyMessages,
    } as any);

    const { rerender } = render(pageTree());
    markdownRenderSpy.mockClear();

    vi.mocked(useLlmChat).mockReturnValue({
      ...baseChat,
      messages: [
        historyMessages[0],
        { ...historyMessages[1], content: 'Edited answer' },
      ],
    } as any);
    rerender(pageTree());

    expect(markdownRenderSpy).toHaveBeenCalledTimes(1);
    expect(markdownRenderSpy).toHaveBeenCalledWith(expect.stringContaining('Edited answer'));
  });

  it('scrolls instantly (no smooth thrash) while streaming', () => {
    stubMatchMedia(false);
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView');

    vi.mocked(useLlmChat).mockReturnValue({
      ...baseChat,
      messages: historyMessages,
      isStreaming: true,
      currentResponse: 'streaming...',
    } as any);

    render(pageTree());

    expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'auto' });
  });

  it('scrolls smoothly on message boundaries when not streaming', () => {
    stubMatchMedia(false);
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView');

    vi.mocked(useLlmChat).mockReturnValue({
      ...baseChat,
      messages: historyMessages,
    } as any);

    render(pageTree());

    expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'smooth' });
  });

  it('never smooth-scrolls when the user prefers reduced motion', () => {
    stubMatchMedia(true);
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView');

    vi.mocked(useLlmChat).mockReturnValue({
      ...baseChat,
      messages: historyMessages,
    } as any);

    render(pageTree());

    expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'auto' });
  });
});
