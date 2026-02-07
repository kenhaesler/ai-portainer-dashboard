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

vi.mock('@/providers/socket-provider', () => ({
  useSockets: () => ({ llmSocket: null }),
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
    fireEvent.click(screen.getByRole('button', { name: 'Show me all running containers' }));

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith('Show me all running containers', undefined, 'llama3.2');
  });
});

describe('normalizeMarkdown', () => {
  // We test the normalizeMarkdown function indirectly through MarkdownContent rendering.
  // The function is not exported, but its effects are visible in the rendered output.

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
