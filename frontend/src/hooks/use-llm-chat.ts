import { useState, useEffect, useCallback } from 'react';
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

  useEffect(() => {
    if (!llmSocket) return;

    const handleChatStart = () => {
      setIsStreaming(true);
      setCurrentResponse('');
      setActiveToolCalls([]);
    };

    const handleChatChunk = (chunk: string) => {
      setCurrentResponse((prev) => prev + chunk);
    };

    const handleChatEnd = (data: { id: string; content: string }) => {
      setIsStreaming(false);
      const assistantMessage: ChatMessage = {
        id: data.id,
        role: 'assistant',
        content: data.content,
        timestamp: new Date().toISOString(),
        toolCalls: activeToolCalls.length > 0 ? [...activeToolCalls] : undefined,
      };
      setMessages((prev) => [...prev, assistantMessage]);
      setCurrentResponse('');
      setActiveToolCalls([]);
    };

    const handleChatError = (error: { message: string }) => {
      setIsStreaming(false);
      setCurrentResponse('');
      setActiveToolCalls([]);
      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'system',
        content: `Error: ${error.message}`,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    };

    const handleToolCall = (event: ToolCallEvent) => {
      setActiveToolCalls((prev) => [...prev, event]);
    };

    const handleToolResponsePending = () => {
      // The LLM produced a tool call on the first iteration — clear the streamed
      // tool-call JSON so the final natural language response replaces it
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
  }, [llmSocket, activeToolCalls]);

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
