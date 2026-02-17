import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLlmChat } from './use-llm-chat';

// Mock the socket provider
const mockOn = vi.fn();
const mockOff = vi.fn();
const mockEmit = vi.fn();

const mockSocket = {
  on: mockOn,
  off: mockOff,
  emit: mockEmit,
  connected: true,
};

vi.mock('@/providers/socket-provider', () => ({
  useSockets: () => ({
    llmSocket: mockSocket,
    monitoringSocket: null,
    remediationSocket: null,
    connected: true,
  }),
}));

// Mock crypto.randomUUID
vi.stubGlobal('crypto', {
  randomUUID: () => 'test-uuid-1234',
});

describe('useLlmChat', () => {
  let eventHandlers: Record<string, (...args: unknown[]) => void>;

  beforeEach(() => {
    vi.clearAllMocks();
    eventHandlers = {};
    mockOn.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      eventHandlers[event] = handler;
    });
  });

  it('should initialize with empty state', () => {
    const { result } = renderHook(() => useLlmChat());
    expect(result.current.messages).toEqual([]);
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.currentResponse).toBe('');
    expect(result.current.activeToolCalls).toEqual([]);
  });

  it('should register socket event listeners', () => {
    renderHook(() => useLlmChat());
    expect(mockOn).toHaveBeenCalledWith('chat:start', expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith('chat:chunk', expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith('chat:end', expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith('chat:error', expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith('chat:tool_call', expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith('chat:tool_response_pending', expect.any(Function));
  });

  it('should add user message and emit on sendMessage', () => {
    const { result } = renderHook(() => useLlmChat());

    act(() => {
      result.current.sendMessage('hello');
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].role).toBe('user');
    expect(result.current.messages[0].content).toBe('hello');
    expect(mockEmit).toHaveBeenCalledWith('chat:message', { text: 'hello', context: undefined });
  });

  it('should handle chat:start event', () => {
    const { result } = renderHook(() => useLlmChat());

    act(() => {
      eventHandlers['chat:start']?.();
    });

    expect(result.current.isStreaming).toBe(true);
    expect(result.current.currentResponse).toBe('');
    expect(result.current.activeToolCalls).toEqual([]);
  });

  it('should accumulate chunks during streaming', () => {
    const { result } = renderHook(() => useLlmChat());

    act(() => {
      eventHandlers['chat:start']?.();
    });

    act(() => {
      eventHandlers['chat:chunk']?.('Hello ');
    });

    act(() => {
      eventHandlers['chat:chunk']?.('world');
    });

    expect(result.current.currentResponse).toBe('Hello world');
  });

  it('should finalize message on chat:end', () => {
    const { result } = renderHook(() => useLlmChat());

    act(() => {
      eventHandlers['chat:start']?.();
    });

    act(() => {
      eventHandlers['chat:end']?.({ id: 'msg-1', content: 'Full response' });
    });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.currentResponse).toBe('');
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].role).toBe('assistant');
    expect(result.current.messages[0].content).toBe('Full response');
  });

  it('should avoid blank assistant message when chat:end content is empty', () => {
    const { result } = renderHook(() => useLlmChat());

    act(() => {
      eventHandlers['chat:start']?.();
    });

    act(() => {
      eventHandlers['chat:end']?.({ id: 'msg-empty', content: '' });
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].role).toBe('system');
    expect(result.current.messages[0].content).toContain('empty response');
  });

  it('should handle chat:error event', () => {
    const { result } = renderHook(() => useLlmChat());

    act(() => {
      eventHandlers['chat:start']?.();
    });

    act(() => {
      eventHandlers['chat:error']?.({ message: 'Connection failed' });
    });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].role).toBe('system');
    expect(result.current.messages[0].content).toContain('Connection failed');
  });

  it('should track tool call events', () => {
    const { result } = renderHook(() => useLlmChat());

    act(() => {
      eventHandlers['chat:start']?.();
    });

    act(() => {
      eventHandlers['chat:tool_call']?.({
        tools: ['query_containers'],
        status: 'executing',
      });
    });

    expect(result.current.activeToolCalls).toHaveLength(1);
    expect(result.current.activeToolCalls[0].status).toBe('executing');
    expect(result.current.activeToolCalls[0].tools).toEqual(['query_containers']);
  });

  it('should accumulate multiple tool call events', () => {
    const { result } = renderHook(() => useLlmChat());

    act(() => {
      eventHandlers['chat:start']?.();
    });

    act(() => {
      eventHandlers['chat:tool_call']?.({
        tools: ['query_containers'],
        status: 'executing',
      });
    });

    act(() => {
      eventHandlers['chat:tool_call']?.({
        tools: ['query_containers'],
        status: 'complete',
        results: [{ tool: 'query_containers', success: true }],
      });
    });

    expect(result.current.activeToolCalls).toHaveLength(2);
  });

  it('should clear streamed content on tool_response_pending', () => {
    const { result } = renderHook(() => useLlmChat());

    act(() => {
      eventHandlers['chat:start']?.();
    });

    act(() => {
      eventHandlers['chat:chunk']?.('{"tool_calls":');
    });

    expect(result.current.currentResponse).toBe('{"tool_calls":');

    act(() => {
      eventHandlers['chat:tool_response_pending']?.();
    });

    expect(result.current.currentResponse).toBe('');
  });

  it('should include tool calls in finalized message', () => {
    const { result } = renderHook(() => useLlmChat());

    act(() => {
      eventHandlers['chat:start']?.();
    });

    act(() => {
      eventHandlers['chat:tool_call']?.({
        tools: ['query_containers'],
        status: 'executing',
      });
    });

    act(() => {
      eventHandlers['chat:tool_call']?.({
        tools: ['query_containers'],
        status: 'complete',
        results: [{ tool: 'query_containers', success: true }],
      });
    });

    act(() => {
      eventHandlers['chat:end']?.({ id: 'msg-1', content: 'Here are the containers...' });
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].toolCalls).toHaveLength(2);
    expect(result.current.activeToolCalls).toEqual([]);
  });

  it('should emit chat:cancel on cancelGeneration', () => {
    const { result } = renderHook(() => useLlmChat());

    act(() => {
      eventHandlers['chat:start']?.();
    });

    act(() => {
      result.current.cancelGeneration();
    });

    expect(mockEmit).toHaveBeenCalledWith('chat:cancel');
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.activeToolCalls).toEqual([]);
  });

  it('should emit chat:clear and reset state on clearHistory', () => {
    const { result } = renderHook(() => useLlmChat());

    act(() => {
      result.current.sendMessage('hello');
    });

    act(() => {
      result.current.clearHistory();
    });

    expect(mockEmit).toHaveBeenCalledWith('chat:clear');
    expect(result.current.messages).toEqual([]);
    expect(result.current.activeToolCalls).toEqual([]);
  });

  it('should not send message while streaming', () => {
    const { result } = renderHook(() => useLlmChat());

    act(() => {
      eventHandlers['chat:start']?.();
    });

    const messageCountBefore = result.current.messages.length;

    act(() => {
      result.current.sendMessage('this should not be sent');
    });

    expect(result.current.messages).toHaveLength(messageCountBefore);
  });

  it('should send message with context', () => {
    const { result } = renderHook(() => useLlmChat());
    const context = { containerId: 'abc123', page: 'containers' };

    act(() => {
      result.current.sendMessage('tell me about this container', context);
    });

    expect(mockEmit).toHaveBeenCalledWith('chat:message', {
      text: 'tell me about this container',
      context,
    });
    expect(result.current.messages[0].context).toEqual(context);
  });

  it('should preserve final response after tool call clear-and-restream cycle', () => {
    // Regression test: "Show me all running containers" bug
    // The full flow: stream tool JSON → clear → re-stream final response → finalize
    const { result } = renderHook(() => useLlmChat());

    // 1. Chat starts
    act(() => {
      eventHandlers['chat:start']?.();
    });
    expect(result.current.isStreaming).toBe(true);

    // 2. Iteration 0: LLM streams tool-call JSON
    act(() => {
      eventHandlers['chat:chunk']?.('{"tool_calls": [{"tool": "query_containers"}]}');
    });
    expect(result.current.currentResponse).toBe('{"tool_calls": [{"tool": "query_containers"}]}');

    // 3. Backend detects tool calls and clears streamed content
    act(() => {
      eventHandlers['chat:tool_response_pending']?.();
    });
    expect(result.current.currentResponse).toBe('');

    // 4. Tool execution events
    act(() => {
      eventHandlers['chat:tool_call']?.({
        tools: ['query_containers'],
        status: 'executing',
      });
    });
    act(() => {
      eventHandlers['chat:tool_call']?.({
        tools: ['query_containers'],
        status: 'complete',
        results: [{ tool: 'query_containers', success: true }],
      });
    });
    expect(result.current.activeToolCalls).toHaveLength(2);

    // 5. Iteration 1: LLM streams the final natural language response
    act(() => {
      eventHandlers['chat:chunk']?.('Here are your ');
    });
    act(() => {
      eventHandlers['chat:chunk']?.('running containers...');
    });
    expect(result.current.currentResponse).toBe('Here are your running containers...');

    // 6. Chat ends — message finalized with content and tool calls
    act(() => {
      eventHandlers['chat:end']?.({ id: 'msg-1', content: 'Here are your running containers...' });
    });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.currentResponse).toBe('');
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].content).toBe('Here are your running containers...');
    expect(result.current.messages[0].toolCalls).toHaveLength(2);
  });

  it('should not re-subscribe listeners when tool call events fire', () => {
    renderHook(() => useLlmChat());
    const initialOnCount = mockOn.mock.calls.length;

    // Fire a tool_call event — should NOT cause listener re-subscription
    act(() => {
      eventHandlers['chat:tool_call']?.({
        tools: ['query_containers'],
        status: 'executing',
      });
    });

    // Listener count should not increase (no re-subscription)
    expect(mockOn.mock.calls.length).toBe(initialOnCount);
  });
});
