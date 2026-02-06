import { useState, useEffect, useCallback } from 'react';
import { useSockets } from '@/providers/socket-provider';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  context?: Record<string, unknown>;
}

interface ChatContext {
  containerId?: string;
  endpointId?: number;
  page?: string;
  selectedData?: unknown;
  [key: string]: unknown;
}

export function useLlmChat() {
  const { llmSocket } = useSockets();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentResponse, setCurrentResponse] = useState('');

  useEffect(() => {
    if (!llmSocket) return;

    const handleChatStart = () => {
      setIsStreaming(true);
      setCurrentResponse('');
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
      };
      setMessages((prev) => [...prev, assistantMessage]);
      setCurrentResponse('');
    };

    const handleChatError = (error: { message: string }) => {
      setIsStreaming(false);
      setCurrentResponse('');
      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'system',
        content: `Error: ${error.message}`,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    };

    llmSocket.on('chat:start', handleChatStart);
    llmSocket.on('chat:chunk', handleChatChunk);
    llmSocket.on('chat:end', handleChatEnd);
    llmSocket.on('chat:error', handleChatError);

    return () => {
      llmSocket.off('chat:start', handleChatStart);
      llmSocket.off('chat:chunk', handleChatChunk);
      llmSocket.off('chat:end', handleChatEnd);
      llmSocket.off('chat:error', handleChatError);
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
  }, [llmSocket, isStreaming]);

  const clearHistory = useCallback(() => {
    if (!llmSocket) return;
    llmSocket.emit('chat:clear');
    setMessages([]);
    setCurrentResponse('');
  }, [llmSocket]);

  return {
    messages,
    isStreaming,
    currentResponse,
    sendMessage,
    cancelGeneration,
    clearHistory,
  };
}
