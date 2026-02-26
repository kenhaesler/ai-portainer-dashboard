import { memo, useState, useRef, useEffect, useCallback } from 'react';
import { Bot, Send, X, User, AlertCircle, Wrench, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import { useLlmChat, type ToolCallEvent } from '@/features/ai-intelligence/hooks/use-llm-chat';
import { LlmFeedbackButtons } from '@/shared/components/llm-feedback-buttons';
import { cn } from '@/shared/lib/utils';

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

export const InlineChatPanel = memo(function InlineChatPanel({ open, onClose, context }: InlineChatPanelProps) {
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const {
    messages,
    isStreaming,
    currentResponse,
    activeToolCalls,
    statusMessage,
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
  }, [open]);  

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

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  if (!open) return null;

  return (
    <div
      data-testid="inline-chat-panel"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onKeyDown={handleKeyDown}
    >
      {/* Backdrop */}
      <div
        data-testid="chat-backdrop"
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Dialog panel */}
      <div
        role="dialog"
        aria-label="Ask AI"
        className="relative z-50 flex w-full max-w-lg flex-col rounded-xl border bg-popover/95 backdrop-blur-xl shadow-2xl animate-in fade-in-0 zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-purple-600">
              <Bot className="h-4 w-4 text-white" />
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
            className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Close chat panel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Messages */}
        <div className="max-h-[50vh] overflow-y-auto p-4 space-y-4">
          {/* Empty state with suggestions */}
          {messages.length === 0 && !isStreaming && !isSending && (
            <div className="flex flex-col items-center text-center pt-8">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500/10 to-purple-500/10 border border-blue-500/20">
                <Bot className="h-7 w-7 text-blue-500" />
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
                    className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-xs text-left hover:bg-muted transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Message list */}
          {messages.map((msg, index) => (
            <CompactMessage
              key={msg.id}
              message={msg}
              userQuery={
                msg.role === 'assistant' && index > 0 && messages[index - 1].role === 'user'
                  ? messages[index - 1].content
                  : undefined
              }
            />
          ))}

          {/* Thinking indicator */}
          {isSending && !isStreaming && (
            <CompactThinkingIndicator statusMessage={statusMessage} />
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
        <div className="border-t bg-background/80 rounded-b-xl p-3">
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
              className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-blue-600 to-purple-600 p-2 text-white shadow-sm transition-all hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Send message"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
});

function BotAvatar() {
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-purple-600">
      <Bot className="h-3.5 w-3.5 text-white" />
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

function CompactThinkingIndicator({ statusMessage }: { statusMessage: string | null }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setElapsed((prev) => prev + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex gap-3" data-testid="compact-thinking-indicator">
      <BotAvatar />
      <div className="rounded-xl bg-muted/50 p-3 border border-border/50">
        <div className="flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin" />
          <span className="text-xs text-muted-foreground">{statusMessage || 'Thinking...'}</span>
          <span className="text-[10px] text-muted-foreground/60 tabular-nums">{elapsed}s</span>
        </div>
        {elapsed >= 15 && (
          <p className="mt-1.5 text-[10px] text-muted-foreground/60">
            Model may be loading...
          </p>
        )}
      </div>
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
  userQuery?: string;
}

function CompactMessage({ message, userQuery }: CompactMessageProps) {
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
        {!isUser && (
          <LlmFeedbackButtons
            feature="chat_assistant"
            messageId={message.id}
            responsePreview={message.content.slice(0, 2000)}
            userQuery={userQuery?.slice(0, 1000)}
            compact
          />
        )}
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
