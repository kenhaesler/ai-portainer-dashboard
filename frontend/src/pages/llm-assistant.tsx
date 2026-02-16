import { useState, useRef, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Send, X, Trash2, Bot, User, AlertCircle, Copy, Check, Wrench, CheckCircle2, XCircle, Layers, WifiOff, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { ThemedSelect } from '@/components/shared/themed-select';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import { useLlmChat, type ToolCallEvent } from '@/hooks/use-llm-chat';
import { useSockets } from '@/providers/socket-provider';
import { useLlmModels } from '@/hooks/use-llm-models';
import { getModelUseCase } from '@/components/settings/model-use-cases';
import { useMcpServers } from '@/hooks/use-mcp';
import { usePromptProfiles, useSwitchProfile } from '@/hooks/use-prompt-profiles';
import { useAuth } from '@/providers/auth-provider';
import { LlmFeedbackButtons } from '@/components/shared/llm-feedback-buttons';
import { ShimmerText } from '@/components/shared/shimmer-text';
import { toast } from 'sonner';

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  query_containers: 'Querying containers',
  get_container_metrics: 'Fetching metrics',
  list_insights: 'Loading insights',
  get_container_logs: 'Reading logs',
  list_anomalies: 'Checking anomalies',
  navigate_to: 'Generating link',
};

interface Suggestion {
  label: string;
  description: string;
  prompt: string;
}

const INFRA_SUGGESTIONS: Suggestion[] = [
  { label: 'Running containers', description: 'List all running containers with status and ports', prompt: 'Show me all running containers and their resource usage' },
  { label: 'Anomaly detection', description: 'Check for critical insights or anomalies', prompt: 'Are there any critical insights or anomalies across my infrastructure?' },
  { label: 'Resource metrics', description: 'CPU and memory usage for the busiest container', prompt: 'Which container is using the most CPU and memory right now?' },
  { label: 'Container logs', description: 'Fetch recent logs for debugging', prompt: 'Show me recent logs for the backend service' },
];

const MCP_SUGGESTIONS: Suggestion[] = [
  { label: 'Network scan', description: 'Use kali-mcp to discover open ports on a target', prompt: 'Use the kali-mcp to run a quick nmap port scan against the web-platform stack' },
  { label: 'Security recon', description: 'Use kali-mcp to identify services and OS fingerprints', prompt: 'Use the kali-mcp to run a service version scan with nmap -sV on the web-frontend container' },
];

const FALLBACK_SUGGESTIONS: Suggestion[] = [
  { label: 'Stack overview', description: 'Summarize stacks, services, and health', prompt: 'Give me an overview of all my Docker stacks and their health status' },
  { label: 'Network topology', description: 'Describe container network connections', prompt: 'Describe the network topology and which containers can communicate' },
];

function useSuggestions(mcpServers?: import('@/hooks/use-mcp').McpServer[]): Suggestion[] {
  const hasKaliMcp = mcpServers?.some(s => s.name.toLowerCase().includes('kali') && s.connected);
  const mcpPart = hasKaliMcp ? MCP_SUGGESTIONS : FALLBACK_SUGGESTIONS;
  return [...INFRA_SUGGESTIONS, ...mcpPart];
}

export default function LlmAssistantPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { messages, isStreaming, currentResponse, activeToolCalls, statusMessage, sendMessage, cancelGeneration, clearHistory } = useLlmChat();
  const { llmSocket } = useSockets();
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
    const state = location.state as { prefillPrompt?: string } | null;
    if (!state?.prefillPrompt) return;
    setInput(state.prefillPrompt);
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate]);

  // Set default model when models load
  useEffect(() => {
    if (modelsData?.default && !selectedModel) {
      setSelectedModel(modelsData.default);
    }
  }, [modelsData, selectedModel]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, currentResponse, isSending]);

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
    if (window.confirm('Clear all chat history?')) {
      clearHistory();
    }
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg shadow-blue-500/20">
            <Bot className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-400 dark:to-purple-400 bg-clip-text text-transparent">
              AI Assistant
            </h1>
            <p className="text-sm text-muted-foreground">
              Your intelligent infrastructure companion
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-3">
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
            {/* Model Selector */}
            {modelsData && modelsData.models.length > 0 && (
              <ThemedSelect
                value={selectedModel}
                onValueChange={(val) => setSelectedModel(val)}
                disabled={isStreaming || isSending}
                className="min-w-[200px]"
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
          </div>
          {selectedModel && (() => {
            const useCase = getModelUseCase(selectedModel);
            return (
              <div className="flex items-center justify-end gap-2">
                <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${useCase.color}`} style={{ backgroundColor: 'color-mix(in srgb, currentColor 10%, transparent)', borderColor: 'color-mix(in srgb, currentColor 25%, transparent)' }}>
                  {useCase.label}
                </span>
                <span className="text-[11px] text-muted-foreground whitespace-nowrap">{useCase.description}</span>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Chat Container */}
      <div className="flex-1 overflow-hidden rounded-xl border bg-gradient-to-b from-card to-card/50 shadow-xl backdrop-blur-sm">
        <div className="flex h-full flex-col">
          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {messages.length === 0 && !isStreaming && (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="relative">
                  <div className="absolute inset-0 animate-pulse rounded-full bg-gradient-to-r from-blue-500 to-purple-600 opacity-20 blur-2xl" />
                  <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg">
                    <Bot className="h-10 w-10 text-white" />
                  </div>
                </div>
                <h3 className="mt-6 text-xl font-semibold">Welcome to Your AI Assistant</h3>
                <p className="mt-2 text-sm text-muted-foreground max-w-md">
                  I have real-time access to your entire Docker infrastructure. Ask me about containers, stacks, resources, or troubleshooting.
                </p>
                <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 w-full max-w-3xl">
                  {suggestions.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => handleSuggestedQuestionClick(s.prompt)}
                      disabled={isStreaming || isSending}
                      className="rounded-lg border border-border/50 bg-background/50 px-4 py-3 text-sm text-left hover:bg-accent hover:border-border transition-colors disabled:cursor-not-allowed disabled:opacity-50 flex flex-col gap-1"
                    >
                      <span className="font-medium text-foreground">{s.label}</span>
                      <span className="text-xs text-muted-foreground line-clamp-2">{s.description}</span>
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
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg">
                    <Bot className="h-5 w-5 text-white" />
                  </div>
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
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg">
                    <Bot className="h-5 w-5 text-white" />
                  </div>
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
                      <div className="flex gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-bounce [animation-delay:-0.3s]" />
                        <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-bounce [animation-delay:-0.15s]" />
                        <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-bounce" />
                      </div>
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
            {!llmSocket?.connected && (
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
                disabled={isStreaming || isSending || !llmSocket?.connected}
                className="flex-1 rounded-xl border border-input bg-background px-4 py-3 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 transition-all"
              />
              <button
                type="submit"
                disabled={!input.trim() || isStreaming || isSending || !llmSocket?.connected}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-6 py-3 text-sm font-medium text-white shadow-lg shadow-blue-500/25 transition-all hover:shadow-xl hover:shadow-blue-500/30 hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
              >
                <Send className="h-4 w-4" />
                Send
              </button>
            </form>
          </div>
        </div>
      </div>
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
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg">
          <Bot className="h-5 w-5 text-white" />
        </div>
      </div>
      <div className="flex-1 space-y-2">
        <div className="rounded-2xl bg-gradient-to-br from-muted/50 to-muted/30 backdrop-blur-sm p-4 shadow-sm border border-border/50">
          <div className="flex items-center gap-3">
            <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
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
          Cancel
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

function MessageBubble({ message, userQuery }: MessageBubbleProps) {
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
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl shadow-lg ${
          isUser
            ? 'bg-gradient-to-br from-emerald-500 to-teal-600'
            : 'bg-gradient-to-br from-blue-500 to-purple-600'
        }`}>
          {isUser ? (
            <User className="h-5 w-5 text-white" />
          ) : (
            <Bot className="h-5 w-5 text-white" />
          )}
        </div>
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
            ? 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white ml-auto border border-emerald-400/20'
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
}

function ToolCallIndicator({ events }: { events: ToolCallEvent[] }) {
  return (
    <div className="space-y-2">
      {events.map((event, i) => (
        <div key={i} className="flex items-center gap-2">
          {event.status === 'executing' ? (
            <>
              <div className="flex gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-purple-500 animate-bounce [animation-delay:-0.3s]" />
                <span className="h-1.5 w-1.5 rounded-full bg-purple-500 animate-bounce [animation-delay:-0.15s]" />
                <span className="h-1.5 w-1.5 rounded-full bg-purple-500 animate-bounce" />
              </div>
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
          <div className="flex gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-bounce [animation-delay:-0.3s]" />
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-bounce [animation-delay:-0.15s]" />
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-bounce" />
          </div>
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

function MarkdownContent({ content }: { content: string }) {
  const normalizedContent = normalizeMarkdown(content);

  return (
    <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:font-semibold prose-headings:tracking-tight prose-h1:text-lg prose-h2:text-base prose-h3:text-sm prose-p:text-[13px] prose-p:leading-relaxed prose-pre:bg-zinc-900 prose-pre:shadow-lg prose-code:text-blue-600 dark:prose-code:text-blue-400 prose-li:text-[13px] prose-td:text-[13px] prose-th:text-xs">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          h1: ({ children }) => <h1 className="mb-3 pb-2 border-b border-border text-lg">{children}</h1>,
          h2: ({ children }) => <h2 className="mt-4 mb-2 pb-1.5 border-b border-border/50 text-base">{children}</h2>,
          h3: ({ children }) => <h3 className="mt-3 mb-1.5 text-sm font-semibold">{children}</h3>,
          ul: ({ children }) => <ul className="space-y-0.5 my-2">{children}</ul>,
          ol: ({ children }) => <ol className="space-y-0.5 my-2">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed text-[13px]">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-blue-500 bg-blue-500/5 pl-4 py-2 my-2 italic text-[13px]">
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
        }}
      >
        {normalizedContent}
      </ReactMarkdown>
    </div>
  );
}

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
              Copied!
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
