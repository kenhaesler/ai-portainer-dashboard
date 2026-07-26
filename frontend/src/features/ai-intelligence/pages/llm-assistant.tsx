import { memo, useState, useRef, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Send, X, Trash2, Bot, User, AlertCircle, Copy, Check, Wrench, CheckCircle2, XCircle, Layers, WifiOff, Loader2 } from 'lucide-react';
import type { Insight } from '@dashboard/contracts';
import { ContextBanner, type ContextBannerData } from '@/shared/components/layout/context-banner';
import { ConfirmDialog } from '@/shared/components/feedback/confirm-dialog';
import ReactMarkdown, { type Components } from 'react-markdown';
import { ThemedSelect } from '@/shared/components/ui/themed-select';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import { useLlmChat, type ToolCallEvent } from '@/features/ai-intelligence/hooks/use-llm-chat';
import { useSockets, useSocketConnected } from '@/providers/socket-provider';
import { useLlmModels } from '@/features/ai-intelligence/hooks/use-llm-models';
import { getModelUseCase } from '@/features/core/components/settings/model-use-cases';
import { useMcpServers } from '@/features/ai-intelligence/hooks/use-mcp';
import { usePromptProfiles, useSwitchProfile } from '@/features/ai-intelligence/hooks/use-prompt-profiles';
import { useAuth } from '@/providers/auth-provider';
import { LlmFeedbackButtons } from '@/shared/components/data-display/llm-feedback-buttons';
import { ShimmerText } from '@/shared/components/feedback/shimmer-text';
import { PageHeader } from '@/shared/components/layout/page-header';
import { api } from '@/shared/lib/api';
import { STALE_TIMES } from '@/shared/lib/query-constants';
import { toast } from 'sonner';

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  query_containers: 'Querying containers',
  get_container_metrics: 'Fetching metrics',
  list_insights: 'Loading insights',
  get_container_logs: 'Reading logs',
  list_anomalies: 'Checking anomalies',
  navigate_to: 'Generating link',
};

/**
 * A starter prompt. `label` is the short handle; `prompt` is the exact text
 * that will be sent — and it is what the card's second line shows. The old
 * shape carried a separate `description` that restated the label ("Container
 * logs" / "Fetch recent logs for debugging"), so the second line never
 * changed what the operator would click, and could be truncated on top.
 */
interface Suggestion {
  label: string;
  prompt: string;
}

/**
 * The four an operator types at 3am, in the absence of anything anomalous.
 *
 * Four, not six: the previous grid was four real suggestions plus a pair
 * ("Stack overview", "Network topology") that existed to fill the third
 * column of a `lg:grid-cols-3` whenever the optional kali MCP server was
 * absent — the array was literally named `FALLBACK_SUGGESTIONS`.
 */
const BASELINE_SUGGESTIONS: Suggestion[] = [
  { label: 'Recent restarts', prompt: 'Which containers restarted in the last hour, and what do their logs say?' },
  { label: 'Busiest container', prompt: 'Which container is using the most CPU and memory right now?' },
  { label: 'Open anomalies', prompt: 'List the anomalies detected in the last 24 hours, newest first.' },
  { label: 'Recent errors', prompt: 'Show the most recent error-level log lines across all containers.' },
];

const MCP_SUGGESTION: Suggestion = {
  label: 'Port scan',
  prompt: 'Use the kali-mcp to run a quick nmap port scan against the web-platform stack',
};

const SUGGESTION_COUNT = 4;

/** Insight severities worth interrupting someone about, most urgent first. */
const ACTIONABLE_SEVERITIES = ['critical', 'warning'] as const;

/**
 * Turn the fleet's open insights into prompts that name the container which is
 * misbehaving *now*. One per container, most severe first, so the grid does
 * not spend two of its four slots on the same workload.
 */
export function suggestionsFromInsights(insights: Insight[] | undefined, max: number): Suggestion[] {
  if (!insights || insights.length === 0) return [];
  const seen = new Set<string>();
  const out: Suggestion[] = [];

  for (const severity of ACTIONABLE_SEVERITIES) {
    for (const insight of insights) {
      if (out.length >= max) return out;
      if (insight.severity !== severity) continue;
      if (insight.is_acknowledged) continue;
      const container = insight.container_name;
      if (!container || seen.has(container)) continue;
      seen.add(container);
      out.push({
        label: container,
        prompt: `Why is ${container} showing "${insight.title}"? Check its recent metrics and logs.`,
      });
    }
  }
  return out;
}

/**
 * Live open insights, sharing `useMonitoring`'s query key so arriving from
 * Health costs no extra request.
 */
function useOpenInsights() {
  return useQuery<{ insights: Insight[]; total: number }>({
    queryKey: ['monitoring', 'insights'],
    queryFn: () => api.get<{ insights: Insight[]; total: number }>('/api/monitoring/insights'),
    staleTime: STALE_TIMES.SHORT,
    retry: false,
  });
}

export function buildSuggestions(
  insights: Insight[] | undefined,
  hasKaliMcp: boolean,
): Suggestion[] {
  const live = suggestionsFromInsights(insights, hasKaliMcp ? SUGGESTION_COUNT - 1 : SUGGESTION_COUNT);
  const tail = hasKaliMcp ? [MCP_SUGGESTION, ...BASELINE_SUGGESTIONS] : BASELINE_SUGGESTIONS;
  return [...live, ...tail].slice(0, SUGGESTION_COUNT);
}

function useSuggestions(mcpServers?: import('@/features/ai-intelligence/hooks/use-mcp').McpServer[]): Suggestion[] {
  const hasKaliMcp = !!mcpServers?.some(s => s.name.toLowerCase().includes('kali') && s.connected);
  const { data } = useOpenInsights();
  return buildSuggestions(data?.insights, hasKaliMcp);
}

/** State passed via React Router location.state when navigating to this page */
interface LlmAssistantLocationState {
  prefillPrompt?: string;
  source?: string;
  actionId?: string;
  containerName?: string;
  containerSummary?: string;
}

export default function LlmAssistantPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [contextBanner, setContextBanner] = useState<ContextBannerData | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { messages, isStreaming, currentResponse, activeToolCalls, statusMessage, sendMessage, cancelGeneration, clearHistory } = useLlmChat();
  const { llmSocket } = useSockets();
  const isLlmConnected = useSocketConnected(llmSocket);
  const { data: modelsData } = useLlmModels();
  const { data: mcpServers } = useMcpServers();
  const { role } = useAuth();
  const isAdmin = role === 'admin';
  const { data: profileData } = usePromptProfiles();
  const switchProfile = useSwitchProfile();

  const profiles = profileData?.profiles ?? [];
  const activeProfileId = profileData?.activeProfileId ?? 'default';

  const handleProfileSwitch = async (id: string) => {
    if (id === activeProfileId) return;
    await switchProfile.mutateAsync({ id });
    toast.success('Profile switched', {
      description: 'AI prompts updated. New messages will use the new profile.',
    });
  };

  const suggestions = useSuggestions(mcpServers);

  useEffect(() => {
    const state = location.state as LlmAssistantLocationState | null;
    if (!state) return;

    // Show context banner when arriving from another page with context data
    if (state.source) {
      setContextBanner({
        source: state.source,
        containerName: state.containerName,
        containerSummary: state.containerSummary,
      });
    }

    // Pre-fill the input with the prompt if provided
    if (state.prefillPrompt) {
      setInput(state.prefillPrompt);
    }

    // Clear navigation state so the banner/input don't re-appear on refresh
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate]);

  // Set default model when models load
  useEffect(() => {
    if (modelsData?.default && !selectedModel) {
      setSelectedModel(modelsData.default);
    }
  }, [modelsData, selectedModel]);

  // Instant scroll while streaming: smooth scrolling on every batched chunk
  // flush thrashes layout. Smooth is reserved for message boundaries, and
  // reduced-motion users always get instant jumps.
  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    messagesEndRef.current?.scrollIntoView({
      behavior: reduceMotion || isStreaming ? 'auto' : 'smooth',
    });
  }, [messages, currentResponse, isSending, isStreaming]);

  // Clear sending state when streaming starts
  useEffect(() => {
    if (isStreaming) {
      setIsSending(false);
    }
  }, [isStreaming]);

  // Restore input focus when streaming ends
  useEffect(() => {
    if (!isStreaming && !isSending) {
      // Small delay to ensure disabled state is cleared before focusing
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [isStreaming, isSending]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming || isSending) return;

    setIsSending(true);
    sendMessage(input.trim(), undefined, selectedModel || undefined);
    setInput('');
  }, [input, isStreaming, isSending, sendMessage, selectedModel]);

  const handleSuggestedQuestionClick = useCallback((suggestion: string) => {
    if (isStreaming || isSending) return;

    setIsSending(true);
    sendMessage(suggestion, undefined, selectedModel || undefined);
    setInput('');
  }, [isStreaming, isSending, sendMessage, selectedModel]);

  const handleClear = () => {
    setShowClearConfirm(true);
  };

  const selectedUseCase = selectedModel ? getModelUseCase(selectedModel) : null;

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col space-y-4">
      {/* The one page-header shape. This page used to be the only gradient-
          filled h1 in the product, titled "AI Assistant" while the sidebar and
          breadcrumb said "LLM Assistant". The title now matches the navigation
          manifest, and the subtitle slot carries live state (which model is
          selected and what it is good at) instead of a tagline. */}
      <PageHeader
        title="Assistant"
        subtitle={
          selectedUseCase && (
            <span className="flex items-center gap-2">
              <span
                className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${selectedUseCase.color}`}
                style={{ backgroundColor: 'color-mix(in srgb, currentColor 10%, transparent)', borderColor: 'color-mix(in srgb, currentColor 25%, transparent)' }}
              >
                {selectedUseCase.label}
              </span>
              <span className="text-[11px] text-muted-foreground">{selectedUseCase.description}</span>
            </span>
          )
        }
        actions={
          <>
            {/* Profile Selector (admin-only) */}
            {isAdmin && profiles.length > 0 && (
              <div className="flex items-center gap-1.5">
                <Layers className="h-4 w-4 text-muted-foreground" />
                <ThemedSelect
                  value={activeProfileId}
                  onValueChange={(val) => void handleProfileSwitch(val)}
                  disabled={isStreaming || isSending || switchProfile.isPending}
                  options={profiles.map((p) => ({
                    value: p.id,
                    label: `${p.name}${p.isBuiltIn ? ' ✦' : ''}`,
                  }))}
                />
              </div>
            )}
            {/* Model Selector. `min-w-[200px]` unconditionally pushed this off
                the right edge of a 390px viewport. */}
            {modelsData && modelsData.models.length > 0 && (
              <ThemedSelect
                value={selectedModel}
                onValueChange={(val) => setSelectedModel(val)}
                disabled={isStreaming || isSending}
                className="min-w-[9rem] sm:min-w-[200px]"
                options={modelsData.models.map((model) => ({
                  value: model.name,
                  label: model.name,
                }))}
              />
            )}
            <button
              onClick={handleClear}
              disabled={messages.length === 0}
              className="inline-flex items-center gap-2 rounded-lg border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm transition-all hover:bg-accent hover:shadow disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Trash2 className="h-4 w-4" />
              Clear History
            </button>
          </>
        }
      />

      {/* Context banner — shown when arriving via "Discuss with AI" from another page */}
      {contextBanner && (
        <ContextBanner
          data={contextBanner}
          onDismiss={() => setContextBanner(null)}
        />
      )}

      {/* Chat Container */}
      <div className="flex-1 overflow-hidden rounded-xl border bg-gradient-to-b from-card to-card/50 shadow-xl backdrop-blur-sm">
        <div className="flex h-full flex-col">
          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Anchored to the top of the scroll area, not centred in it: with
                `justify-center` inside `h-[calc(100vh-8rem)]` the heading and
                the icon sat above the container's top edge on a 390px
                viewport, so the first visible text was mid-sentence. */}
            {messages.length === 0 && !isStreaming && (
              <div className="flex flex-col items-center text-center" data-testid="assistant-empty-state">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
                  <Bot className="h-7 w-7 text-primary" />
                </div>
                <h2 className="mt-4 text-lg font-semibold">Ask about a container, a metric or an anomaly</h2>
                {/* States the contract rather than claiming one. Six tools, all
                    read-only — not "real-time access to your entire Docker
                    infrastructure". */}
                <p className="mt-2 max-w-md text-sm text-muted-foreground">
                  It reads containers, metrics, insights, logs and anomalies. It cannot start, stop or change anything.
                </p>
                <div className="mt-6 grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
                  {suggestions.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => handleSuggestedQuestionClick(s.prompt)}
                      disabled={isStreaming || isSending}
                      className="flex flex-col gap-1 rounded-lg border border-border/50 bg-background/50 px-4 py-3 text-left text-sm transition-colors hover:border-border hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="font-medium text-foreground">{s.label}</span>
                      {/* The prompt itself, so the result is predictable. */}
                      <span className="text-xs text-muted-foreground">{s.prompt}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((message, index) => (
              <MessageBubble
                key={message.id}
                message={message}
                userQuery={
                  message.role === 'assistant' && index > 0 && messages[index - 1].role === 'user'
                    ? messages[index - 1].content
                    : undefined
                }
              />
            ))}

            {/* Loading indicator - shown while waiting for response */}
            {isSending && !isStreaming && (
              <ThinkingIndicator
                statusMessage={statusMessage}
                onCancel={() => {
                  setIsSending(false);
                  llmSocket?.emit('chat:cancel');
                }}
              />
            )}

            {/* Tool call indicator */}
            {isStreaming && activeToolCalls.length > 0 && !currentResponse && (
              <div className="flex gap-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="flex-shrink-0">
                  <BotAvatar />
                </div>
                <div className="flex-1">
                  <div className="rounded-2xl bg-gradient-to-br from-muted/50 to-muted/30 backdrop-blur-sm p-4 shadow-sm border border-border/50">
                    <ToolCallIndicator events={activeToolCalls} />
                  </div>
                </div>
              </div>
            )}

            {/* Streaming response */}
            {isStreaming && currentResponse && (
              <div className="flex gap-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="flex-shrink-0">
                  <BotAvatar />
                </div>
                <div className="flex-1 space-y-3">
                  <div className="rounded-2xl bg-gradient-to-br from-muted/50 to-muted/30 backdrop-blur-sm p-4 shadow-sm border border-border/50">
                    <MarkdownContent content={currentResponse} />
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={cancelGeneration}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/20 transition-colors"
                    >
                      <X className="h-3 w-3" />
                      Stop generating
                    </button>
                    <div className="flex items-center gap-2">
                      <TypingDots />
                      <span className="text-xs text-muted-foreground">Generating response</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="border-t bg-background/80 backdrop-blur-sm p-4">
            {!isLlmConnected && (
              <div className="flex items-center gap-2 mb-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                <WifiOff className="h-3.5 w-3.5 flex-shrink-0" />
                <span>Reconnecting to AI service...</span>
              </div>
            )}
            <form onSubmit={handleSubmit} className="flex gap-3">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about your infrastructure..."
                disabled={isStreaming || isSending || !isLlmConnected}
                className="flex-1 rounded-xl border border-input bg-background px-4 py-3 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 transition-all"
              />
              <button
                type="submit"
                disabled={!input.trim() || isStreaming || isSending || !isLlmConnected}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send className="h-4 w-4" />
                Send
              </button>
            </form>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={showClearConfirm}
        onConfirm={() => { clearHistory(); setShowClearConfirm(false); }}
        onCancel={() => setShowClearConfirm(false)}
        title="Clear Chat History"
        description="Clear all chat history? This action cannot be undone."
        confirmLabel="Clear History"
        variant="danger"
      />
    </div>
  );
}

/**
 * The one assistant mark on this page. There used to be two identical robot
 * glyphs in purple gradient tiles on the same empty screen — 48px in the
 * header and 80px in the hero, the latter behind an `animate-pulse` blurred
 * glow — plus four more copies of the same tile inlined through the message
 * list. Themed, so it follows all 16 themes instead of assuming a dark one.
 */
function BotAvatar() {
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
      <Bot className="h-5 w-5 text-primary" />
    </div>
  );
}

/** Three-dot typing rhythm, shared by every "still working" affordance here. */
function TypingDots() {
  return (
    <div className="flex gap-1" aria-hidden>
      <span className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce [animation-delay:-0.3s]" />
      <span className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce [animation-delay:-0.15s]" />
      <span className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce" />
    </div>
  );
}

function ThinkingIndicator({ statusMessage, onCancel }: { statusMessage: string | null; onCancel: () => void }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setElapsed((prev) => prev + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const displayStatus = statusMessage || 'Thinking...';
  const showSlowWarning = elapsed >= 15;

  return (
    <div className="flex gap-4 animate-in fade-in slide-in-from-bottom-2 duration-300" data-testid="thinking-indicator">
      <div className="flex-shrink-0">
        <BotAvatar />
      </div>
      <div className="flex-1 space-y-2">
        <div className="rounded-2xl bg-gradient-to-br from-muted/50 to-muted/30 backdrop-blur-sm p-4 shadow-sm border border-border/50">
          <div className="flex items-center gap-3">
            <Loader2 className="h-4 w-4 text-primary animate-spin" />
            <ShimmerText className="text-[13px]">{displayStatus}</ShimmerText>
            <span className="text-xs text-muted-foreground tabular-nums ml-auto">{elapsed}s</span>
          </div>
          {showSlowWarning && (
            <p className="mt-2 text-xs text-muted-foreground">
              This is taking longer than usual. The model may be loading for the first time.
            </p>
          )}
        </div>
        <button
          onClick={onCancel}
          className="inline-flex items-center gap-1.5 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/20 transition-colors"
        >
          <X className="h-3 w-3" />
          Stop generating
        </button>
      </div>
    </div>
  );
}

interface MessageBubbleProps {
  message: {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: string;
    toolCalls?: ToolCallEvent[];
  };
  userQuery?: string;
}

// Memoized so completed history bubbles do not re-render (and re-parse
// their markdown) on every streamed-chunk flush of the page (#1494).
// Message objects are immutable once appended, so shallow compare suffices.
const MessageBubble = memo(function MessageBubble({ message, userQuery }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  if (isSystem) {
    return (
      <div className="flex justify-center animate-in fade-in slide-in-from-bottom-2 duration-300">
        <div className="inline-flex items-center gap-2 rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-2.5 text-sm text-destructive shadow-sm">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>{message.content}</span>
        </div>
      </div>
    );
  }

  // Collect unique tools used across all tool call events
  const toolsUsed = message.toolCalls
    ? [...new Set(message.toolCalls.flatMap(tc => tc.tools))]
    : [];

  return (
    <div className={`flex gap-4 animate-in fade-in slide-in-from-bottom-2 duration-300 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className="flex-shrink-0">
        {isUser ? (
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-muted">
            <User className="h-5 w-5 text-muted-foreground" />
          </div>
        ) : (
          <BotAvatar />
        )}
      </div>
      <div className={`flex-1 space-y-2 ${isUser ? 'max-w-[80%]' : ''}`}>
        {toolsUsed.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-1">
            {toolsUsed.map((tool) => (
              <span
                key={tool}
                className="inline-flex items-center gap-1 rounded-md bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 text-[11px] font-medium text-purple-600 dark:text-purple-400"
              >
                <Wrench className="h-3 w-3" />
                {tool.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        )}
        <div className={`rounded-2xl p-4 shadow-sm ${
          isUser
            ? 'bg-muted/60 text-foreground ml-auto border border-border'
            : 'bg-gradient-to-br from-muted/50 to-muted/30 backdrop-blur-sm border border-border/50'
        }`}>
          {isUser ? (
            <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{message.content}</p>
          ) : (
            <MarkdownContent content={message.content} />
          )}
        </div>
        <div className={`flex items-center gap-3 px-1 ${isUser ? 'justify-end' : ''}`}>
          <p className="text-xs text-muted-foreground">
            {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
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
    </div>
  );
});

function ToolCallIndicator({ events }: { events: ToolCallEvent[] }) {
  return (
    <div className="space-y-2">
      {events.map((event, i) => (
        <div key={i} className="flex items-center gap-2">
          {event.status === 'executing' ? (
            <>
              <TypingDots />
              <Wrench className="h-3.5 w-3.5 text-purple-500" />
              <span className="text-[13px] text-muted-foreground">
                {event.tools.map(t => TOOL_DISPLAY_NAMES[t] || t).join(', ')}...
              </span>
            </>
          ) : (
            <>
              {event.results?.every(r => r.success) ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <XCircle className="h-3.5 w-3.5 text-red-500" />
              )}
              <span className="text-[13px] text-muted-foreground">
                {event.tools.map(t => TOOL_DISPLAY_NAMES[t] || t).join(', ')} — done
              </span>
            </>
          )}
        </div>
      ))}
      {events.length > 0 && events[events.length - 1].status === 'complete' && (
        <div className="flex items-center gap-2 mt-1">
          <TypingDots />
          <span className="text-[13px] text-muted-foreground">Generating response with results...</span>
        </div>
      )}
    </div>
  );
}

/**
 * Post-process raw LLM output to normalize inconsistent markdown.
 * Local models often produce malformed markdown that breaks rendering.
 */
function normalizeMarkdown(raw: string): string {
  // Strip thinking blocks from reasoning models (frontend fallback — backend
  // strips these during streaming, but this catches any that slip through)
  let text = raw
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
    .replace(/<think(?:ing)?>[\s\S]*$/gi, '');

  // Fix code blocks: if language tag and code are on the same line separated by space,
  // split them. The space delimiter prevents greedy backtracking from eating into the
  // language name (e.g., "```bash\n" was incorrectly split into "```bas\nh" by the old regex).
  text = text.replace(/^(```\w+) +(.+)$/gm, '$1\n$2');

  // Fix unclosed code fences — count triple backticks, if odd close the last one
  const fenceCount = (text.match(/```/g) || []).length;
  if (fenceCount % 2 !== 0) {
    text += '\n```';
  }

  // Fix headers: ensure space after # (e.g., "#Title" → "# Title")
  text = text.replace(/^(#{1,6})([^\s#])/gm, '$1 $2');

  // Fix list items: ensure space after bullet markers (e.g., "-item" → "- item")
  text = text.replace(/^(\s*[-*+])([^\s])/gm, '$1 $2');

  // Fix numbered lists (e.g., "1.item" → "1. item")
  text = text.replace(/^(\s*\d+\.)([^\s])/gm, '$1 $2');

  // Normalize excessive blank lines (more than 2 consecutive → 2)
  text = text.replace(/\n{4,}/g, '\n\n\n');

  return text;
}

// Hoisted to module scope so memoized markdown renders are not defeated by
// fresh plugin arrays / components objects created on every render (#1494).
const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeHighlight];

const MARKDOWN_COMPONENTS: Components = {
  h1: ({ children }) => <h1 className="mb-3 pb-2 border-b border-border text-lg">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-4 mb-2 pb-1.5 border-b border-border/50 text-base">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-3 mb-1.5 text-sm font-semibold">{children}</h3>,
  ul: ({ children }) => <ul className="space-y-0.5 my-2">{children}</ul>,
  ol: ({ children }) => <ol className="space-y-0.5 my-2">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed text-[13px]">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-primary bg-primary/5 pl-4 py-2 my-2 italic text-[13px]">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto">
      <table className="min-w-full divide-y divide-border rounded-lg border border-border overflow-hidden">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-muted/50">{children}</thead>
  ),
  th: ({ children }) => (
    <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-4 py-2 text-[13px] border-t border-border">{children}</td>
  ),
  code({ className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || '');
    const isCodeBlock = match !== null;

    if (isCodeBlock) {
      // Extract plain text for the copy button
      const plainText = extractText(children).replace(/\n$/, '');
      return (
        <CodeBlock plainText={plainText} language={match?.[1]}>
          {children}
        </CodeBlock>
      );
    }

    return (
      <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-mono border border-border/50" {...props}>
        {children}
      </code>
    );
  },
};

// Memoized (content-keyed) — ReactMarkdown re-parses on every render, so a
// bail-out here is what stops streaming from re-parsing finished messages.
const MarkdownContent = memo(function MarkdownContent({ content }: { content: string }) {
  const normalizedContent = normalizeMarkdown(content);

  return (
    <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:font-semibold prose-headings:tracking-tight prose-h1:text-lg prose-h2:text-base prose-h3:text-sm prose-p:text-[13px] prose-p:leading-relaxed prose-pre:bg-zinc-900 prose-pre:shadow-lg prose-code:text-primary prose-li:text-[13px] prose-td:text-[13px] prose-th:text-xs">
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={MARKDOWN_COMPONENTS}
      >
        {normalizedContent}
      </ReactMarkdown>
    </div>
  );
});

/** Recursively extract plain text from React children (for clipboard copy). */
function extractText(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (typeof node === 'object' && 'props' in node) {
    return extractText((node as React.ReactElement<{ children?: React.ReactNode }>).props.children);
  }
  return '';
}

/**
 * Deliberately the one surface on this page that does NOT follow the theme.
 *
 * `highlight.js/styles/github-dark.css` is imported globally at the top of
 * this file and styles `.hljs` itself with a near-black background and token
 * colours tuned for it (`#79c0ff` on white is ~1.9:1). Swapping this chrome to
 * `bg-muted` would put a light frame around a block that keeps painting itself
 * dark from inside — strictly worse than the current, self-consistent dark
 * code surface. Making it theme-aware means shipping a light/dark pair of
 * highlight.js stylesheets scoped by theme class in `index.css`, which is a
 * global-stylesheet change, not a class swap here.
 */
function CodeBlock({ plainText, language, children }: { plainText: string; language?: string; children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(plainText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="group relative my-4">
      <div className="flex items-center justify-between rounded-t-lg bg-zinc-800 px-4 py-2 border-b border-zinc-700">
        <span className="text-xs font-medium text-zinc-400">{language || 'code'}</span>
        <button
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 rounded-md bg-zinc-700 px-2.5 py-1.5 text-xs font-medium text-zinc-300 opacity-0 transition-all group-hover:opacity-100 hover:bg-zinc-600"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              Copy
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto rounded-b-lg bg-zinc-900 p-4 !mt-0 shadow-lg border border-zinc-800">
        <code className={`language-${language || 'text'} text-xs text-zinc-100`}>{children}</code>
      </pre>
    </div>
  );
}
