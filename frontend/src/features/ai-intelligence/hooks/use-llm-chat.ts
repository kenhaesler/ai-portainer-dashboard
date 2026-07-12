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

export interface ChatStatusEvent {
  message: string;
  phase: 'init' | 'context' | 'model' | 'generating';
}

// chat:chunk events arrive per streamed token; flushing each one to state
// re-renders the whole conversation per token. Chunks accumulate in a ref
// and flush to state at most once per interval instead (#1494).
const CHUNK_FLUSH_INTERVAL_MS = 50;

export function useLlmChat() {
  const { llmSocket } = useSockets();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentResponse, setCurrentResponse] = useState('');
  const [activeToolCalls, setActiveToolCalls] = useState<ToolCallEvent[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const streamedResponseRef = useRef('');
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPendingFlush = useCallback(() => {
    if (flushTimerRef.current !== null) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }, []);

  // Use a ref to track tool calls so that socket listeners don't need to be
  // torn down and re-subscribed every time a tool_call event fires.
  const toolCallsRef = useRef<ToolCallEvent[]>([]);

  useEffect(() => {
    if (!llmSocket) return;

    const handleChatStart = () => {
      cancelPendingFlush();
      setIsStreaming(true);
      setStatusMessage(null);
      setCurrentResponse('');
      setActiveToolCalls([]);
      toolCallsRef.current = [];
      streamedResponseRef.current = '';
    };

    const handleChatStatus = (data: ChatStatusEvent) => {
      setStatusMessage(data.message);
    };

    const handleChatChunk = (chunk: string) => {
      streamedResponseRef.current += chunk;
      // Trailing timer: the first chunk in an interval schedules a flush;
      // subsequent chunks just accumulate in the ref until it fires.
      if (flushTimerRef.current === null) {
        flushTimerRef.current = setTimeout(() => {
          flushTimerRef.current = null;
          setCurrentResponse(streamedResponseRef.current);
        }, CHUNK_FLUSH_INTERVAL_MS);
      }
    };

    const handleChatEnd = (data: { id: string; content: string }) => {
      // The finalized content reads streamedResponseRef synchronously, so a
      // pending flush carries no extra text — just cancel it.
      cancelPendingFlush();
      setIsStreaming(false);
      setStatusMessage(null);
      const snapshotToolCalls = toolCallsRef.current;
      const finalizedContent = (data.content || streamedResponseRef.current).trim();
      if (finalizedContent) {
        const assistantMessage: ChatMessage = {
          id: data.id,
          role: 'assistant',
          content: finalizedContent,
          timestamp: new Date().toISOString(),
          toolCalls: snapshotToolCalls.length > 0 ? [...snapshotToolCalls] : undefined,
        };
        setMessages((prev) => [...prev, assistantMessage]);
      } else {
        const fallbackMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'system',
          content: 'Error: Assistant returned an empty response. Please retry.',
          timestamp: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, fallbackMessage]);
      }
      setCurrentResponse('');
      setActiveToolCalls([]);
      toolCallsRef.current = [];
      streamedResponseRef.current = '';
    };

    const handleChatError = (error: { message: string }) => {
      cancelPendingFlush();
      setIsStreaming(false);
      setStatusMessage(null);
      setCurrentResponse('');
      setActiveToolCalls([]);
      toolCallsRef.current = [];
      streamedResponseRef.current = '';
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
      cancelPendingFlush();
      streamedResponseRef.current = '';
      setCurrentResponse('');
    };

    llmSocket.on('chat:start', handleChatStart);
    llmSocket.on('chat:chunk', handleChatChunk);
    llmSocket.on('chat:end', handleChatEnd);
    llmSocket.on('chat:error', handleChatError);
    llmSocket.on('chat:status', handleChatStatus);
    llmSocket.on('chat:tool_call', handleToolCall);
    llmSocket.on('chat:tool_response_pending', handleToolResponsePending);

    return () => {
      cancelPendingFlush();
      llmSocket.off('chat:start', handleChatStart);
      llmSocket.off('chat:chunk', handleChatChunk);
      llmSocket.off('chat:end', handleChatEnd);
      llmSocket.off('chat:error', handleChatError);
      llmSocket.off('chat:status', handleChatStatus);
      llmSocket.off('chat:tool_call', handleToolCall);
      llmSocket.off('chat:tool_response_pending', handleToolResponsePending);
    };
  }, [llmSocket, cancelPendingFlush]);

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
    cancelPendingFlush();
    llmSocket.emit('chat:cancel');
    setIsStreaming(false);
    setStatusMessage(null);
    setCurrentResponse('');
    setActiveToolCalls([]);
  }, [llmSocket, isStreaming, cancelPendingFlush]);

  const clearHistory = useCallback(() => {
    if (!llmSocket) return;
    cancelPendingFlush();
    llmSocket.emit('chat:clear');
    setMessages([]);
    setStatusMessage(null);
    setCurrentResponse('');
    setActiveToolCalls([]);
  }, [llmSocket, cancelPendingFlush]);

  return {
    messages,
    isStreaming,
    currentResponse,
    activeToolCalls,
    statusMessage,
    sendMessage,
    cancelGeneration,
    clearHistory,
  };
}
