import { useEffect, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Command } from 'cmdk';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  Boxes,
  Ship,
  HeartPulse,
  PackageOpen,
  Network,
  Brain,
  BarChart3,
  Shield,
  GitBranch,
  MessageSquare,
  Activity,
  FileSearch,
  Webhook,
  Users,
  Settings,
  RefreshCw,
  Palette,
  Package,
  Layers,
  ScrollText,
  Clock,
  Sparkles,
  Loader2,
  ArrowRight,
  AlertCircle,
} from 'lucide-react';
import { useUiStore } from '@/stores/ui-store';
import { useThemeStore } from '@/stores/theme-store';
import { cn } from '@/lib/utils';
import { useGlobalSearch } from '@/hooks/use-global-search';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useSearch } from '@/providers/search-provider';
import { useNlQuery, type NlQueryResult } from '@/hooks/use-nl-query';

interface PageEntry {
  label: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
}

const pages: PageEntry[] = [
  { label: 'AI Home', to: '/', icon: LayoutDashboard },
  { label: 'AI Workload Explorer', to: '/workloads', icon: Boxes },
  { label: 'AI Fleet Overview', to: '/fleet', icon: Ship },
  { label: 'AI Container Health', to: '/health', icon: HeartPulse },
  { label: 'AI Image Footprint', to: '/images', icon: PackageOpen },
  { label: 'AI Network Topology', to: '/topology', icon: Network },
  { label: 'AI Metrics Dashboard', to: '/metrics', icon: BarChart3 },
  { label: 'AI Monitor', to: '/ai-monitor', icon: Brain },
  { label: 'AI Trace Explorer', to: '/traces', icon: GitBranch },
  { label: 'AI LLM Assistant', to: '/assistant', icon: MessageSquare },
  { label: 'AI LLM Observability', to: '/llm-observability', icon: Activity },
  { label: 'AI Remediation', to: '/remediation', icon: Shield },
  { label: 'AI Security Audit', to: '/security/audit', icon: Shield },
  { label: 'AI Edge Agent Logs', to: '/edge-logs', icon: FileSearch },
  { label: 'AI Settings', to: '/settings', icon: Settings },
  { label: 'Webhooks', to: '/webhooks', icon: Webhook },
  { label: 'Users', to: '/users', icon: Users },
];

/** Heuristic: detect if input looks like a natural language question rather than a name search */
function isNaturalLanguageQuery(input: string): boolean {
  const trimmed = input.trim().toLowerCase();
  if (trimmed.length < 5) return false;
  // Starts with question words
  if (/^(what|which|how|show|list|find|are|is|why|where|who|when|compare|help|tell)\b/.test(trimmed)) return true;
  // Ends with a question mark
  if (trimmed.endsWith('?')) return true;
  // Contains question-like phrases
  if (/\b(using more than|greater than|less than|running|stopped|restarted|unhealthy|memory|cpu)\b/.test(trimmed)) return true;
  return false;
}

export function CommandPalette() {
  const navigate = useNavigate();
  const open = useUiStore((s) => s.commandPaletteOpen);
  const setOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const { theme, setTheme } = useThemeStore();
  const [query, setQuery] = useState('');
  const [includeLogs, setIncludeLogs] = useState(false);
  const [aiResult, setAiResult] = useState<NlQueryResult | null>(null);
  const debouncedQuery = useDebouncedValue(query, 250);
  const { data, isLoading } = useGlobalSearch(debouncedQuery, open, includeLogs);
  const { recent, addRecent } = useSearch();
  const nlQuery = useNlQuery();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const activeElement = document.activeElement as HTMLElement | null;
      const isEditable = !!activeElement && (
        activeElement.tagName === 'INPUT' ||
        activeElement.tagName === 'TEXTAREA' ||
        activeElement.isContentEditable
      );

      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(!open);
      }
      if (e.key === '/' && !isEditable) {
        e.preventDefault();
        setOpen(true);
      }
    },
    [open, setOpen]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setAiResult(null);
    }
  }, [open]);

  const isNl = isNaturalLanguageQuery(query);

  const handleAiQuery = useCallback(() => {
    if (!query.trim() || nlQuery.isPending) return;
    addRecent(query);
    setAiResult(null);
    nlQuery.mutate(query.trim(), {
      onSuccess: (result) => {
        if (result.action === 'navigate' && result.page) {
          setAiResult(result);
        } else {
          setAiResult(result);
        }
      },
      onError: () => {
        setAiResult({
          action: 'error',
          text: 'AI queries are currently unavailable.',
        });
      },
    });
  }, [query, nlQuery, addRecent]);

  const navigateTo = (path: string) => {
    navigate(path);
    setOpen(false);
  };

  const onSearchSelect = () => {
    addRecent(query);
    setOpen(false);
  };

  const formatRelative = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
  };

  const containers = data?.containers ?? [];
  const images = data?.images ?? [];
  const stacks = data?.stacks ?? [];
  const logs = data?.logs ?? [];
  const hasRecent = query.trim().length === 0 && recent.length > 0;

  const toggleTheme = () => {
    const next = theme === 'apple-dark' ? 'apple-light' : theme === 'apple-light' ? 'system' : 'apple-dark';
    setTheme(next);
    setOpen(false);
  };

  const refresh = () => {
    window.location.reload();
    setOpen(false);
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />

          {/* Command dialog */}
          <motion.div
            initial={{ opacity: 0, scale: 0.98, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -5 }}
            transition={{ type: "spring", damping: 30, stiffness: 400 }}
            className={cn(
              "relative z-[101] w-full max-w-2xl overflow-hidden rounded-[20px] border border-white/10 bg-[#1c1c1e]/80 backdrop-blur-[32px] shadow-[0_24px_80px_rgba(0,0,0,0.6)]",
              isNl && "border-primary/40 ring-1 ring-primary/20"
            )}
          >
            <Command
              className="flex flex-col"
              onKeyDown={(e: React.KeyboardEvent) => {
                if (e.key === 'Escape') {
                  setOpen(false);
                }
              }}
            >
              <div className="relative flex items-center px-4">
                <div className="flex h-[72px] w-full items-center gap-4">
                  <div className="flex shrink-0 items-center justify-center">
                    {isNl ? (
                      <Sparkles className="h-6 w-6 text-primary animate-pulse" />
                    ) : (
                      <FileSearch className="h-6 w-6 text-white/40" />
                    )}
                  </div>
                  <Command.Input
                    placeholder="Search or ask AI..."
                    className={cn(
                      'h-full w-full bg-transparent text-xl font-medium text-white outline-none',
                      'placeholder:text-white/20'
                    )}
                    value={query}
                    onValueChange={(v) => { setQuery(v); setAiResult(null); }}
                    onKeyDown={(e: React.KeyboardEvent) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && isNl) {
                        e.preventDefault();
                        handleAiQuery();
                      }
                    }}
                    autoFocus
                  />
                  
                  <div className="flex items-center gap-2">
                    {isNl && query.trim().length >= 5 && (
                      <button
                        onClick={handleAiQuery}
                        disabled={nlQuery.isPending}
                        className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-bold text-white shadow-lg transition-all hover:brightness-110 active:scale-95 disabled:opacity-50"
                      >
                        {nlQuery.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Sparkles className="h-4 w-4" />
                        )}
                        <span>Ask AI</span>
                        <kbd className="ml-1 hidden font-mono text-[10px] opacity-70 md:inline">⌘↵</kbd>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Separator Line */}
              {(query.trim().length > 0 || recent.length > 0) && (
                <div className="mx-4 h-px bg-white/5" />
              )}

              <Command.List className="max-h-[65vh] overflow-y-auto overflow-x-hidden p-2 selection:bg-primary/30">
                {query.trim().length < 2 && !recent.length && (
                  <div className="flex flex-col items-center justify-center py-20 text-center">
                    <div className="mb-4 rounded-full bg-white/5 p-4">
                      <LayoutDashboard className="h-10 w-10 text-white/20" />
                    </div>
                    <p className="text-lg font-semibold text-white/60">Spotlight Search</p>
                    <p className="text-sm text-white/30">Search containers, metrics, and logs with AI</p>
                  </div>
                )}

                {/* AI Loading State */}
                {nlQuery.isPending && (
                  <div className="m-2 rounded-[14px] bg-primary/5 p-5 border border-primary/10">
                    <div className="flex items-center gap-4 text-sm text-primary">
                      <div className="relative">
                        <Sparkles className="h-6 w-6 animate-pulse" />
                        <motion.div 
                          className="absolute inset-0 h-6 w-6 animate-ping rounded-full bg-primary/20"
                          initial={false}
                        />
                      </div>
                      <span className="font-bold tracking-tight">AI is analyzing your infrastructure...</span>
                    </div>
                  </div>
                )}

                {/* AI Result */}
                {aiResult && (
                  <motion.div 
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="m-2 overflow-hidden rounded-[14px] bg-primary/10 border border-primary/20"
                  >
                    {aiResult.action === 'answer' && (
                      <div className="flex items-start gap-4 p-5">
                        <div className="rounded-full bg-primary/20 p-2.5 text-primary">
                          <Sparkles className="h-6 w-6" />
                        </div>
                        <div className="flex-1 space-y-2">
                          <p className="text-base font-medium leading-relaxed text-white">{aiResult.text}</p>
                          {aiResult.description && (
                            <p className="text-xs font-medium leading-relaxed text-white/40">{aiResult.description}</p>
                          )}
                        </div>
                      </div>
                    )}
                    {aiResult.action === 'navigate' && aiResult.page && (
                      <button
                        onClick={() => navigateTo(aiResult.page!)}
                        className="flex w-full items-center gap-4 p-5 text-left transition-colors hover:bg-primary/20"
                      >
                        <div className="rounded-full bg-primary/20 p-2.5 text-primary">
                          <ArrowRight className="h-6 w-6" />
                        </div>
                        <div className="flex-1">
                          <p className="text-base font-bold text-white">{aiResult.description || 'View result'}</p>
                          <p className="text-xs font-medium text-primary/60">{aiResult.page}</p>
                        </div>
                        <div className="rounded-full bg-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-white/60">
                          Jump
                        </div>
                      </button>
                    )}
                    {aiResult.action === 'error' && (
                      <div className="flex items-center gap-4 p-5 text-sm text-destructive font-medium">
                        <AlertCircle className="h-6 w-6" />
                        <span>{aiResult.text}</span>
                      </div>
                    )}
                  </motion.div>
                )}

                {query.trim().length >= 2 && !isLoading && !containers.length && !images.length && !stacks.length && !logs.length && (
                  <Command.Empty className="py-20 text-center">
                    <div className="mb-4 flex justify-center">
                      <AlertCircle className="h-10 w-10 text-white/10" />
                    </div>
                    <p className="text-base font-semibold text-white/60">No results found for "{query}"</p>
                    <p className="text-sm text-white/30">Try a different search term or ask AI.</p>
                  </Command.Empty>
                )}

                {hasRecent && (
                  <Command.Group
                    heading="Recent"
                    className="p-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.15em] [&_[cmdk-group-heading]]:text-white/20"
                  >
                    {recent.map((item) => (
                      <Command.Item
                        key={item.term}
                        value={item.term}
                        onSelect={() => setQuery(item.term)}
                        className={cn(
                          'flex cursor-pointer items-center gap-4 rounded-[10px] px-3 py-2.5 text-sm transition-none',
                          'text-white aria-selected:bg-primary aria-selected:text-white'
                        )}
                      >
                        <Clock className="h-5 w-5 shrink-0 opacity-40 aria-selected:opacity-100" />
                        <span className="flex-1 font-medium">{item.term}</span>
                        <span className="text-[11px] font-medium opacity-30 aria-selected:opacity-70">
                          {formatRelative(item.lastUsed)}
                        </span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}

                {query.trim().length >= 2 && (
                  <>
                    {containers.length > 0 && (
                      <Command.Group
                        heading="Containers"
                        className="p-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.15em] [&_[cmdk-group-heading]]:text-white/20"
                      >
                        {containers.map((container) => (
                          <Command.Item
                            key={container.id}
                            value={`container-${container.name}`}
                            onSelect={() => {
                              onSearchSelect();
                              navigateTo(`/containers/${container.endpointId}/${container.id}?tab=overview`);
                            }}
                            className={cn(
                              'flex cursor-pointer items-center gap-4 rounded-[10px] px-3 py-2.5 text-sm transition-none',
                              'text-white aria-selected:bg-primary aria-selected:text-white'
                            )}
                          >
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-white/5 aria-selected:bg-white/20">
                              <Package className="h-5 w-5 opacity-60 aria-selected:opacity-100" />
                            </div>
                            <div className="flex flex-col">
                              <span className="font-bold">{container.name}</span>
                              <span className="text-[12px] font-medium text-white/40 aria-selected:text-white/70 line-clamp-1">
                                {container.image} • {container.endpointName}
                              </span>
                            </div>
                          </Command.Item>
                        ))}
                      </Command.Group>
                    )}

                    {images.length > 0 && (
                      <Command.Group
                        heading="Images"
                        className="p-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.15em] [&_[cmdk-group-heading]]:text-white/20"
                      >
                        {images.map((image) => (
                          <Command.Item
                            key={`${image.id}-${image.endpointId}`}
                            value={`image-${image.name}`}
                            onSelect={() => {
                              onSearchSelect();
                              navigateTo('/images');
                            }}
                            className={cn(
                              'flex cursor-pointer items-center gap-4 rounded-[10px] px-3 py-2.5 text-sm transition-none',
                              'text-white aria-selected:bg-primary aria-selected:text-white'
                            )}
                          >
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-white/5 aria-selected:bg-white/20">
                              <Layers className="h-5 w-5 opacity-60 aria-selected:opacity-100" />
                            </div>
                            <div className="flex flex-col">
                              <span className="font-bold">{image.name}</span>
                              <span className="text-[12px] font-medium text-white/40 aria-selected:text-white/70">
                                {image.tags[0] || 'untagged'} • {image.endpointName || `Endpoint ${image.endpointId}`}
                              </span>
                            </div>
                          </Command.Item>
                        ))}
                      </Command.Group>
                    )}

                    {stacks.length > 0 && (
                      <Command.Group
                        heading="Stacks"
                        className="p-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.15em] [&_[cmdk-group-heading]]:text-white/20"
                      >
                        {stacks.map((stack) => (
                          <Command.Item
                            key={stack.id}
                            value={`stack-${stack.name}`}
                            onSelect={() => {
                              onSearchSelect();
                              navigateTo('/stacks');
                            }}
                            className={cn(
                              'flex cursor-pointer items-center gap-4 rounded-[10px] px-3 py-2.5 text-sm transition-none',
                              'text-white aria-selected:bg-primary aria-selected:text-white'
                            )}
                          >
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-white/5 aria-selected:bg-white/20">
                              <Boxes className="h-5 w-5 opacity-60 aria-selected:opacity-100" />
                            </div>
                            <div className="flex flex-col">
                              <span className="font-bold">{stack.name}</span>
                              <span className="text-[12px] font-medium text-white/40 aria-selected:text-white/70">
                                {stack.status} • Endpoint {stack.endpointId}
                              </span>
                            </div>
                          </Command.Item>
                        ))}
                      </Command.Group>
                    )}

                    {logs.length > 0 && (
                      <Command.Group
                        heading="Logs"
                        className="p-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.15em] [&_[cmdk-group-heading]]:text-white/20"
                      >
                        {logs.map((logItem) => (
                          <Command.Item
                            key={logItem.id}
                            value={`log-${logItem.id}`}
                            onSelect={() => {
                              onSearchSelect();
                              navigateTo(`/containers/${logItem.endpointId}/${logItem.containerId}?tab=logs`);
                            }}
                            className={cn(
                              'flex cursor-pointer items-start gap-4 rounded-[10px] px-3 py-2.5 text-sm transition-none',
                              'text-white aria-selected:bg-primary aria-selected:text-white'
                            )}
                          >
                            <ScrollText className="mt-1 h-5 w-5 shrink-0 opacity-40 aria-selected:opacity-100" />
                            <div className="flex flex-col">
                              <span className="font-bold">{logItem.containerName}</span>
                              <span className="text-[12px] font-medium leading-normal text-white/40 aria-selected:text-white/70 line-clamp-2">
                                {logItem.message}
                              </span>
                            </div>
                          </Command.Item>
                        ))}
                      </Command.Group>
                    )}
                  </>
                )}

                <Command.Group
                  heading="Navigation"
                  className="p-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.15em] [&_[cmdk-group-heading]]:text-white/20"
                >
                  {pages.map((page) => (
                    <Command.Item
                      key={page.to}
                      value={page.label}
                      onSelect={() => navigateTo(page.to)}
                      className={cn(
                        'flex cursor-pointer items-center gap-4 rounded-[10px] px-3 py-2.5 text-sm transition-none',
                        'text-white aria-selected:bg-primary aria-selected:text-white'
                      )}
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-white/5 aria-selected:bg-white/20">
                        <page.icon className="h-4 w-4 opacity-50 aria-selected:opacity-100" />
                      </div>
                      <span className="font-bold">{page.label}</span>
                    </Command.Item>
                  ))}
                </Command.Group>

                <Command.Group
                  heading="System"
                  className="p-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.15em] [&_[cmdk-group-heading]]:text-white/20"
                >
                  <Command.Item
                    value="Refresh page"
                    onSelect={refresh}
                    className={cn(
                      'flex cursor-pointer items-center gap-4 rounded-[10px] px-3 py-2.5 text-sm transition-none',
                      'text-white aria-selected:bg-primary aria-selected:text-white'
                    )}
                  >
                    <RefreshCw className="h-4 w-4 shrink-0 opacity-40 aria-selected:opacity-100" />
                    <span className="font-bold">Refresh Page</span>
                  </Command.Item>
                  <Command.Item
                    value="Toggle theme"
                    onSelect={toggleTheme}
                    className={cn(
                      'flex cursor-pointer items-center gap-4 rounded-[10px] px-3 py-2.5 text-sm transition-none',
                      'text-white aria-selected:bg-primary aria-selected:text-white'
                    )}
                  >
                    <Palette className="h-4 w-4 shrink-0 opacity-40 aria-selected:opacity-100" />
                    <div className="flex flex-1 items-center justify-between">
                      <span className="font-bold">Cycle Theme</span>
                      <span className="text-[10px] font-bold text-white/30 aria-selected:text-white/60">{theme}</span>
                    </div>
                  </Command.Item>
                </Command.Group>
              </Command.List>

              {/* Footer / Shortcuts */}
              <div className="flex items-center justify-between border-t border-white/5 px-4 py-3 bg-white/[0.02]">
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-white/20">
                    <kbd className="rounded-[4px] bg-white/10 px-1.5 py-0.5 font-mono text-white/40">↑↓</kbd>
                    <span>Browse</span>
                  </span>
                  <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-white/20">
                    <kbd className="rounded-[4px] bg-white/10 px-1.5 py-0.5 font-mono text-white/40">↵</kbd>
                    <span>Open</span>
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-white/20">
                  <kbd className="rounded-[4px] bg-white/10 px-1.5 py-0.5 font-mono text-white/40">⌘K</kbd>
                  <span>Search</span>
                </div>
              </div>
            </Command>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
