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
  const hasSearchResults = query.trim().length >= 2 && (
    containers.length + images.length + stacks.length + logs.length > 0
  );

  const toggleTheme = () => {
    const next = theme === 'apple-dark' ? 'apple-light' : theme === 'apple-light' ? 'system' : 'apple-dark';
    setTheme(next);
    setOpen(false);
  };

  const refresh = () => {
    window.location.reload();
    setOpen(false);
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
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
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className={cn(
              "relative z-50 w-full max-w-xl overflow-hidden rounded-2xl border bg-card/70 backdrop-blur-2xl shadow-[0_0_50px_-12px_rgba(0,0,0,0.5)]",
              isNl && "border-primary/30 ring-1 ring-primary/20 shadow-[0_0_40px_-12px_rgba(99,102,241,0.2)]"
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
              <div className="relative flex items-center border-b border-border/50 px-4">
                <div className="flex h-14 w-full items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                    {isNl ? (
                      <Sparkles className="h-5 w-5 text-primary animate-pulse" />
                    ) : (
                      <FileSearch className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                  <Command.Input
                    placeholder="Ask AI or search your infrastructure..."
                    className={cn(
                      'h-full w-full bg-transparent text-base text-foreground outline-none',
                      'placeholder:text-muted-foreground/60'
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
                        className="flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
                      >
                        {nlQuery.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Sparkles className="h-3 w-3" />
                        )}
                        <span>Ask AI</span>
                        <kbd className="ml-1 hidden font-mono text-[10px] opacity-70 md:inline">⌘↵</kbd>
                      </button>
                    )}
                    <button 
                      onClick={() => setOpen(false)}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
                    >
                      <kbd className="text-[10px] font-mono">ESC</kbd>
                    </button>
                  </div>
                </div>
              </div>

              {/* Options Bar */}
              <div className="flex items-center justify-between bg-muted/30 px-4 py-2 border-b border-border/40">
                <label className="flex cursor-pointer items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground">
                  <input
                    type="checkbox"
                    checked={includeLogs}
                    onChange={(e) => setIncludeLogs(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-border accent-primary"
                  />
                  <span>Search across logs</span>
                </label>
                
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    <kbd className="rounded bg-muted px-1 py-0.5 font-mono">↑↓</kbd>
                    <span>Move</span>
                  </span>
                  <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    <kbd className="rounded bg-muted px-1 py-0.5 font-mono">↵</kbd>
                    <span>Select</span>
                  </span>
                </div>
              </div>

              <Command.List className="max-h-[60vh] overflow-y-auto overflow-x-hidden p-2">
                {query.trim().length < 2 && !recent.length && (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <div className="mb-4 rounded-full bg-muted p-4">
                      <LayoutDashboard className="h-8 w-8 text-muted-foreground/40" />
                    </div>
                    <p className="text-sm font-medium text-foreground">Start typing to search...</p>
                    <p className="text-xs text-muted-foreground">Search containers, images, stacks, or ask AI a question.</p>
                  </div>
                )}

                {/* AI Loading State */}
                {nlQuery.isPending && (
                  <div className="m-2 rounded-xl bg-primary/5 p-4 border border-primary/10">
                    <div className="flex items-center gap-3 text-sm text-primary">
                      <div className="relative">
                        <Sparkles className="h-5 w-5 animate-pulse" />
                        <motion.div 
                          className="absolute inset-0 h-5 w-5 animate-ping rounded-full bg-primary/20"
                          initial={false}
                        />
                      </div>
                      <span className="font-medium">AI is analyzing your infrastructure...</span>
                    </div>
                  </div>
                )}

                {/* AI Result */}
                {aiResult && (
                  <motion.div 
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="m-2 overflow-hidden rounded-xl border border-primary/20 bg-primary/5"
                  >
                    {aiResult.action === 'answer' && (
                      <div className="flex items-start gap-3 p-4">
                        <div className="rounded-lg bg-primary/20 p-2 text-primary">
                          <Sparkles className="h-5 w-5" />
                        </div>
                        <div className="flex-1 space-y-2">
                          <p className="text-sm font-semibold leading-relaxed text-foreground">{aiResult.text}</p>
                          {aiResult.description && (
                            <p className="text-xs leading-relaxed text-muted-foreground/80">{aiResult.description}</p>
                          )}
                        </div>
                      </div>
                    )}
                    {aiResult.action === 'navigate' && aiResult.page && (
                      <button
                        onClick={() => navigateTo(aiResult.page!)}
                        className="flex w-full items-center gap-4 p-4 text-left transition-colors hover:bg-primary/10"
                      >
                        <div className="rounded-lg bg-primary/20 p-2 text-primary">
                          <ArrowRight className="h-5 w-5" />
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-bold text-foreground">{aiResult.description || 'View result'}</p>
                          <p className="text-xs text-primary/70">{aiResult.page}</p>
                        </div>
                        <div className="rounded-full bg-background/50 px-2 py-1 text-[10px] font-bold uppercase tracking-tight text-primary">
                          Jump to page
                        </div>
                      </button>
                    )}
                    {aiResult.action === 'error' && (
                      <div className="flex items-center gap-3 p-4 text-sm text-destructive">
                        <AlertCircle className="h-5 w-5" />
                        <span className="font-medium">{aiResult.text}</span>
                      </div>
                    )}
                  </motion.div>
                )}

                {query.trim().length >= 2 && !isLoading && !containers.length && !images.length && !stacks.length && !logs.length && (
                  <Command.Empty className="py-12 text-center">
                    <div className="mb-3 flex justify-center">
                      <AlertCircle className="h-8 w-8 text-muted-foreground/30" />
                    </div>
                    <p className="text-sm font-medium">No results found for "{query}"</p>
                    <p className="text-xs text-muted-foreground">Try a different search term or ask AI.</p>
                  </Command.Empty>
                )}

                {hasRecent && (
                  <Command.Group
                    heading="Recent Searches"
                    className="p-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-muted-foreground/60"
                  >
                    {recent.map((item) => (
                      <Command.Item
                        key={item.term}
                        value={item.term}
                        onSelect={() => setQuery(item.term)}
                        className={cn(
                          'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
                          'text-foreground aria-selected:bg-primary/10 aria-selected:text-primary'
                        )}
                      >
                        <Clock className="h-4 w-4 shrink-0 opacity-60" />
                        <span className="flex-1 font-medium">{item.term}</span>
                        <span className="text-[10px] font-medium text-muted-foreground opacity-60">
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
                        className="p-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-muted-foreground/60"
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
                              'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                              'text-foreground aria-selected:bg-primary/10 aria-selected:text-primary'
                            )}
                          >
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted/50">
                              <Package className="h-4 w-4 opacity-70" />
                            </div>
                            <div className="flex flex-col">
                              <span className="font-semibold">{container.name}</span>
                              <span className="text-[11px] text-muted-foreground line-clamp-1">
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
                        className="p-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-muted-foreground/60"
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
                              'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                              'text-foreground aria-selected:bg-primary/10 aria-selected:text-primary'
                            )}
                          >
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted/50">
                              <Layers className="h-4 w-4 opacity-70" />
                            </div>
                            <div className="flex flex-col">
                              <span className="font-semibold">{image.name}</span>
                              <span className="text-[11px] text-muted-foreground">
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
                        className="p-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-muted-foreground/60"
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
                              'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                              'text-foreground aria-selected:bg-primary/10 aria-selected:text-primary'
                            )}
                          >
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted/50">
                              <Boxes className="h-4 w-4 opacity-70" />
                            </div>
                            <div className="flex flex-col">
                              <span className="font-semibold">{stack.name}</span>
                              <span className="text-[11px] text-muted-foreground">
                                {stack.status} • Endpoint {stack.endpointId}
                              </span>
                            </div>
                          </Command.Item>
                        ))}
                      </Command.Group>
                    )}

                    {logs.length > 0 && (
                      <Command.Group
                        heading="Log Entries"
                        className="p-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-muted-foreground/60"
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
                              'flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                              'text-foreground aria-selected:bg-primary/10 aria-selected:text-primary'
                            )}
                          >
                            <ScrollText className="mt-1 h-4 w-4 shrink-0 opacity-60" />
                            <div className="flex flex-col">
                              <span className="font-bold">{logItem.containerName}</span>
                              <span className="text-[11px] leading-normal text-muted-foreground/80 line-clamp-2">
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
                  className="p-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-muted-foreground/60"
                >
                  {pages.map((page) => (
                    <Command.Item
                      key={page.to}
                      value={page.label}
                      onSelect={() => navigateTo(page.to)}
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                        'text-foreground aria-selected:bg-primary/10 aria-selected:text-primary'
                      )}
                    >
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted/30">
                        <page.icon className="h-3.5 w-3.5 opacity-70" />
                      </div>
                      <span className="font-medium">{page.label}</span>
                    </Command.Item>
                  ))}
                </Command.Group>

                <Command.Group
                  heading="System"
                  className="p-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-muted-foreground/60"
                >
                  <Command.Item
                    value="Refresh page"
                    onSelect={refresh}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                      'text-foreground aria-selected:bg-primary/10 aria-selected:text-primary'
                    )}
                  >
                    <RefreshCw className="h-3.5 w-3.5 shrink-0 opacity-60" />
                    <span className="font-medium">Refresh Workspace</span>
                  </Command.Item>
                  <Command.Item
                    value="Toggle theme"
                    onSelect={toggleTheme}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                      'text-foreground aria-selected:bg-primary/10 aria-selected:text-primary'
                    )}
                  >
                    <Palette className="h-3.5 w-3.5 shrink-0 opacity-60" />
                    <div className="flex flex-1 items-center justify-between">
                      <span className="font-medium">Cycle UI Theme</span>
                      <span className="text-[10px] font-bold text-muted-foreground/60">{theme}</span>
                    </div>
                  </Command.Item>
                </Command.Group>
              </Command.List>
            </Command>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
