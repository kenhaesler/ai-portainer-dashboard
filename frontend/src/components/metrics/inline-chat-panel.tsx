import { useState, useRef, useEffect, useCallback } from 'react';
import { Bot, Send, X, User, AlertCircle, Wrench, CheckCircle2, XCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import { useLlmChat, type ToolCallEvent } from '@/hooks/use-llm-chat';
import { cn } from '@/lib/utils';

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  query_containers: 'Querying containers',
  get_container_metrics: 'Fetching metrics',
  list_insights: 'Loading insights',
  get_container_logs: 'Reading logs',
  list_anomalies: 'Checking anomalies',
  navigate_to: 'Generating link',
  query_traces: 'Searching traces',
  get_trace_details: 'Loading trace',
  get_trace_stats: 'Trace statistics',
};

interface ContainerContext {
  containerId: string;
  containerName: string;
  endpointId: number;
  endpointName?: string;
  timeRange: string;
  cpuAvg?: number;
  memoryAvg?: number;
}

interface InlineChatPanelProps {
  open: boolean;
  onClose: () => void;
  context: ContainerContext;
}

const SUGGESTED_QUESTIONS = [
  'Why is CPU usage high?',
  'Show recent error logs',
  'Any anomalies detected?',
  'Is memory trending up?',
];

export function InlineChatPanel({ open, onClose, context }: InlineChatPanelProps) {
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const {
    messages,
    isStreaming,
    currentResponse,
    activeToolCalls,
    sendMessage,
    cancelGeneration,
    clearHistory,
  } = useLlmChat();

  // Build rich context for the LLM
  const chatContext = useCallback(() => ({
    containerId: context.containerId,
    endpointId: context.endpointId,
    page: 'metrics-dashboard',
    containerName: context.containerName,
    timeRange: context.timeRange,
    currentMetrics: {
      cpuAvg: context.cpuAvg,
      memoryAvg: context.memoryAvg,
    },
  }), [context]);

  // Focus input when panel opens
  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => inputRef.current?.focus(), 200);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // Clear chat session when panel closes
  useEffect(() => {
    if (!open && messages.length > 0) {
      clearHistory();
    }
  }, [open, messages.length, clearHistory]);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentResponse, isSending]);

  // Clear sending flag when streaming starts
  useEffect(() => {
    if (isStreaming) setIsSending(false);
  }, [isStreaming]);

  // Refocus input after streaming ends
  useEffect(() => {
    if (!isStreaming && !isSending && open) {
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [isStreaming, isSending, open]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming || isSending) return;
    setIsSending(true);
    sendMessage(input.trim(), chatContext());
    setInput('');
  }, [input, isStreaming, isSending, sendMessage, chatContext]);

  const handleSuggestionClick = useCallback((suggestion: string) => {
    if (isStreaming || isSending) return;
    setIsSending(true);
    sendMessage(suggestion, chatContext());
  }, [isStreaming, isSending, sendMessage, chatContext]);

  if (!open) return null;

  return (
    <div
      data-testid="inline-chat-panel"
      className={cn(
        'fixed bottom-3 right-3 z-50 flex w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/75 backdrop-blur-xl shadow-2xl shadow-black/25',
        'h-[min(680px,calc(100vh-6.5rem))] max-h-[calc(100vh-6.5rem)] md:bottom-5 md:right-5 md:w-[420px] lg:w-[460px]',
        'animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-4 duration-200',
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/60 bg-card/60 px-4 py-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
            <Bot className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">Ask AI</p>
            <p className="text-xs text-muted-foreground truncate">
              {context.containerName}
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
          aria-label="Close chat panel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-4 overflow-y-auto bg-background/40 p-4">
        {/* Empty state with suggestions */}
        {messages.length === 0 && !isStreaming && !isSending && (
          <div className="flex flex-col items-center text-center pt-8">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
              <Bot className="h-7 w-7 text-primary" />
            </div>
            <p className="mt-4 text-sm font-medium">
              Ask anything about {context.containerName}
            </p>
            <p className="mt-1 text-xs text-muted-foreground max-w-[280px]">
              I have access to metrics, logs, anomalies, and traces for this container.
            </p>
            <div className="mt-5 flex flex-col gap-2 w-full">
              {SUGGESTED_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => handleSuggestionClick(q)}
                  className="rounded-lg border border-border/60 bg-card/70 px-3 py-2 text-left text-xs transition-colors hover:bg-muted/70"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Message list */}
        {messages.map((msg) => (
          <CompactMessage key={msg.id} message={msg} />
        ))}

        {/* Thinking indicator */}
        {isSending && !isStreaming && (
          <div className="flex gap-3">
            <BotAvatar />
            <div className="rounded-xl bg-muted/50 p-3 border border-border/50">
              <div className="flex items-center gap-2">
                <LoadingDots />
                <span className="text-xs text-muted-foreground">Thinking...</span>
              </div>
            </div>
          </div>
        )}

        {/* Tool call indicator */}
        {isStreaming && activeToolCalls.length > 0 && !currentResponse && (
          <div className="flex gap-3">
            <BotAvatar />
            <div className="rounded-xl bg-muted/50 p-3 border border-border/50">
              <CompactToolIndicator events={activeToolCalls} />
            </div>
          </div>
        )}

        {/* Streaming response */}
        {isStreaming && currentResponse && (
          <div className="flex gap-3">
            <BotAvatar />
            <div className="flex-1 space-y-2">
              <div className="rounded-xl bg-muted/50 p-3 border border-border/50">
                <CompactMarkdown content={currentResponse} />
              </div>
              <button
                onClick={cancelGeneration}
                className="inline-flex items-center gap-1 rounded-md bg-destructive/10 border border-destructive/20 px-2 py-1 text-[11px] font-medium text-destructive hover:bg-destructive/20 transition-colors"
              >
                <X className="h-3 w-3" />
                Stop
              </button>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-border/60 bg-card/65 p-3">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about this container..."
            disabled={isStreaming || isSending}
            className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 transition-all"
          />
          <button
            type="submit"
            disabled={!input.trim() || isStreaming || isSending}
            className="inline-flex items-center justify-center rounded-lg border border-primary/30 bg-primary text-primary-foreground p-2 shadow-sm transition-all hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Send message"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}

function BotAvatar() {
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
      <Bot className="h-3.5 w-3.5" />
    </div>
  );
}

function LoadingDots() {
  return (
    <div className="flex gap-1">
      <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-bounce [animation-delay:-0.3s]" />
      <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-bounce [animation-delay:-0.15s]" />
      <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-bounce" />
    </div>
  );
}

interface CompactMessageProps {
  message: {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    toolCalls?: ToolCallEvent[];
  };
}

function CompactMessage({ message }: CompactMessageProps) {
  if (message.role === 'system') {
    return (
      <div className="flex justify-center">
        <div className="inline-flex items-center gap-1.5 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-1.5 text-xs text-destructive">
          <AlertCircle className="h-3 w-3" />
          {message.content}
        </div>
      </div>
    );
  }

  const isUser = message.role === 'user';
  const toolsUsed = message.toolCalls
    ? [...new Set(message.toolCalls.flatMap((tc) => tc.tools))]
    : [];

  return (
    <div className={cn('flex gap-3', isUser && 'flex-row-reverse')}>
      <div className="shrink-0">
        {isUser ? (
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600">
            <User className="h-3.5 w-3.5 text-white" />
          </div>
        ) : (
          <BotAvatar />
        )}
      </div>
      <div className={cn('flex-1 space-y-1.5', isUser && 'max-w-[85%]')}>
        {toolsUsed.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {toolsUsed.map((tool) => (
              <span
                key={tool}
                className="inline-flex items-center gap-0.5 rounded bg-purple-500/10 border border-purple-500/20 px-1.5 py-0.5 text-[10px] font-medium text-purple-600 dark:text-purple-400"
              >
                <Wrench className="h-2.5 w-2.5" />
                {tool.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        )}
        <div
          className={cn(
            'rounded-xl p-3 text-[13px]',
            isUser
              ? 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white ml-auto border border-emerald-400/20'
              : 'bg-muted/50 border border-border/50',
          )}
        >
          {isUser ? (
            <p className="leading-relaxed whitespace-pre-wrap">{message.content}</p>
          ) : (
            <CompactMarkdown content={message.content} />
          )}
        </div>
      </div>
    </div>
  );
}

function CompactToolIndicator({ events }: { events: ToolCallEvent[] }) {
  return (
    <div className="space-y-1.5">
      {events.map((event, i) => (
        <div key={i} className="flex items-center gap-1.5">
          {event.status === 'executing' ? (
            <>
              <LoadingDots />
              <Wrench className="h-3 w-3 text-purple-500" />
              <span className="text-[11px] text-muted-foreground">
                {event.tools.map((t) => TOOL_DISPLAY_NAMES[t] || t).join(', ')}...
              </span>
            </>
          ) : (
            <>
              {event.results?.every((r) => r.success) ? (
                <CheckCircle2 className="h-3 w-3 text-emerald-500" />
              ) : (
                <XCircle className="h-3 w-3 text-red-500" />
              )}
              <span className="text-[11px] text-muted-foreground">
                {event.tools.map((t) => TOOL_DISPLAY_NAMES[t] || t).join(', ')} — done
              </span>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function normalizeMarkdown(raw: string): string {
  let text = raw;
  text = text.replace(/```(\w+)([^\n])/g, '```$1\n$2');
  const fenceCount = (text.match(/```/g) || []).length;
  if (fenceCount % 2 !== 0) text += '\n```';
  text = text.replace(/^(#{1,6})([^\s#])/gm, '$1 $2');
  text = text.replace(/^(\s*[-*+])([^\s])/gm, '$1 $2');
  text = text.replace(/^(\s*\d+\.)([^\s])/gm, '$1 $2');
  text = text.replace(/\n{4,}/g, '\n\n\n');
  return text;
}

function CompactMarkdown({ content }: { content: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none prose-p:text-[13px] prose-p:leading-relaxed prose-p:my-1 prose-headings:text-sm prose-headings:font-semibold prose-pre:bg-zinc-900 prose-pre:text-xs prose-code:text-[11px] prose-li:text-[13px] prose-td:text-[12px] prose-th:text-[11px]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {normalizeMarkdown(content)}
      </ReactMarkdown>
    </div>
  );
}
