import { useState, useEffect, useCallback, useRef } from 'react';
import { useSockets } from '@/providers/socket-provider';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  context?: Record<string, unknown>;
  toolCalls?: ToolCallEvent[];
}

interface ChatContext {
  containerId?: string;
  endpointId?: number;
  page?: string;
  selectedData?: unknown;
  [key: string]: unknown;
}

export interface ToolCallEvent {
  tools: string[];
  status: 'executing' | 'complete';
  results?: Array<{
    tool: string;
    success: boolean;
    error?: string;
  }>;
}

export function useLlmChat() {
  const { llmSocket } = useSockets();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentResponse, setCurrentResponse] = useState('');
  const [activeToolCalls, setActiveToolCalls] = useState<ToolCallEvent[]>([]);

  // Use a ref to track tool calls so that socket listeners don't need to be
  // torn down and re-subscribed every time a tool_call event fires.
  const toolCallsRef = useRef<ToolCallEvent[]>([]);

  useEffect(() => {
    if (!llmSocket) return;

    const handleChatStart = () => {
      setIsStreaming(true);
      setCurrentResponse('');
      setActiveToolCalls([]);
      toolCallsRef.current = [];
    };

    const handleChatChunk = (chunk: string) => {
      setCurrentResponse((prev) => prev + chunk);
    };

    const handleChatEnd = (data: { id: string; content: string }) => {
      setIsStreaming(false);
      const snapshotToolCalls = toolCallsRef.current;
      const assistantMessage: ChatMessage = {
        id: data.id,
        role: 'assistant',
        content: data.content,
        timestamp: new Date().toISOString(),
        toolCalls: snapshotToolCalls.length > 0 ? [...snapshotToolCalls] : undefined,
      };
      setMessages((prev) => [...prev, assistantMessage]);
      setCurrentResponse('');
      setActiveToolCalls([]);
      toolCallsRef.current = [];
    };

    const handleChatError = (error: { message: string }) => {
      setIsStreaming(false);
      setCurrentResponse('');
      setActiveToolCalls([]);
      toolCallsRef.current = [];
      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'system',
        content: `Error: ${error.message}`,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    };

    const handleToolCall = (event: ToolCallEvent) => {
      toolCallsRef.current = [...toolCallsRef.current, event];
      setActiveToolCalls((prev) => [...prev, event]);
    };

    const handleToolResponsePending = () => {
      // The LLM produced a tool call — clear the streamed tool-call JSON
      // so the next iteration's natural language response replaces it
      setCurrentResponse('');
    };

    llmSocket.on('chat:start', handleChatStart);
    llmSocket.on('chat:chunk', handleChatChunk);
    llmSocket.on('chat:end', handleChatEnd);
    llmSocket.on('chat:error', handleChatError);
    llmSocket.on('chat:tool_call', handleToolCall);
    llmSocket.on('chat:tool_response_pending', handleToolResponsePending);

    return () => {
      llmSocket.off('chat:start', handleChatStart);
      llmSocket.off('chat:chunk', handleChatChunk);
      llmSocket.off('chat:end', handleChatEnd);
      llmSocket.off('chat:error', handleChatError);
      llmSocket.off('chat:tool_call', handleToolCall);
      llmSocket.off('chat:tool_response_pending', handleToolResponsePending);
    };
  }, [llmSocket]);

  const sendMessage = useCallback(
    (text: string, context?: ChatContext, model?: string) => {
      if (!llmSocket || isStreaming) return;

      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: text,
        timestamp: new Date().toISOString(),
        context: context as Record<string, unknown>,
      };

      setMessages((prev) => [...prev, userMessage]);
      llmSocket.emit('chat:message', { text, context, model });
    },
    [llmSocket, isStreaming]
  );

  const cancelGeneration = useCallback(() => {
    if (!llmSocket || !isStreaming) return;
    llmSocket.emit('chat:cancel');
    setIsStreaming(false);
    setCurrentResponse('');
    setActiveToolCalls([]);
  }, [llmSocket, isStreaming]);

  const clearHistory = useCallback(() => {
    if (!llmSocket) return;
    llmSocket.emit('chat:clear');
    setMessages([]);
    setCurrentResponse('');
    setActiveToolCalls([]);
  }, [llmSocket]);

  return {
    messages,
    isStreaming,
    currentResponse,
    activeToolCalls,
    sendMessage,
    cancelGeneration,
    clearHistory,
  };
}
