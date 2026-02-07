import { useState, useRef, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Send, X, Trash2, Bot, User, AlertCircle, Copy, Check } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { ThemedSelect } from '@/components/shared/themed-select';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import { useLlmChat } from '@/hooks/use-llm-chat';
import { useLlmModels } from '@/hooks/use-llm-models';
import 'highlight.js/styles/tokyo-night-dark.css';

export default function LlmAssistantPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { messages, isStreaming, currentResponse, sendMessage, cancelGeneration, clearHistory } = useLlmChat();
  const { data: modelsData } = useLlmModels();

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
        <div className="flex items-center gap-3">
          {/* Model Selector */}
          {modelsData && modelsData.models.length > 0 && (
            <ThemedSelect
              value={selectedModel}
              onValueChange={(val) => setSelectedModel(val)}
              disabled={isStreaming || isSending}
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
                <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-3 w-full max-w-2xl">
                  {[
                    'What containers are currently running?',
                    'Are there any unhealthy containers?',
                    'Show me resource usage across endpoints',
                    'Help me troubleshoot a container issue'
                  ].map((suggestion, i) => (
                    <button
                      key={i}
                      onClick={() => setInput(suggestion)}
                      className="rounded-lg border border-border/50 bg-background/50 px-4 py-3 text-sm text-left hover:bg-accent hover:border-border transition-colors"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}

            {/* Loading indicator - shown while waiting for response */}
            {isSending && !isStreaming && (
              <div className="flex gap-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="flex-shrink-0">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg">
                    <Bot className="h-5 w-5 text-white" />
                  </div>
                </div>
                <div className="flex-1">
                  <div className="rounded-2xl bg-gradient-to-br from-muted/50 to-muted/30 backdrop-blur-sm p-4 shadow-sm border border-border/50">
                    <div className="flex items-center gap-3">
                      <div className="flex gap-1">
                        <span className="h-2 w-2 rounded-full bg-blue-500 animate-bounce [animation-delay:-0.3s]" />
                        <span className="h-2 w-2 rounded-full bg-blue-500 animate-bounce [animation-delay:-0.15s]" />
                        <span className="h-2 w-2 rounded-full bg-blue-500 animate-bounce" />
                      </div>
                      <span className="text-[13px] text-muted-foreground">Thinking...</span>
                    </div>
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
            <form onSubmit={handleSubmit} className="flex gap-3">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about your infrastructure..."
                disabled={isStreaming || isSending}
                className="flex-1 rounded-xl border border-input bg-background px-4 py-3 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 transition-all"
              />
              <button
                type="submit"
                disabled={!input.trim() || isStreaming || isSending}
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

interface MessageBubbleProps {
  message: {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: string;
  };
}

function MessageBubble({ message }: MessageBubbleProps) {
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
        <p className={`text-xs text-muted-foreground px-1 ${isUser ? 'text-right' : ''}`}>
          {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  );
}

/**
 * Post-process raw LLM output to normalize inconsistent markdown.
 * Local models often produce malformed markdown that breaks rendering.
 */
function normalizeMarkdown(raw: string): string {
  let text = raw;

  // Fix code blocks: normalize ```language to have a newline after the opening fence
  text = text.replace(/```(\w+)([^\n])/g, '```$1\n$2');

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
            const codeContent = String(children).replace(/\n$/, '');
            const isCodeBlock = match !== null;

            return isCodeBlock ? (
              <CodeBlock code={codeContent} language={match?.[1]} />
            ) : (
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

function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
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
        <code className={`language-${language || 'text'} text-xs`}>{code}</code>
      </pre>
    </div>
  );
}
