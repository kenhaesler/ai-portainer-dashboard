import { useEffect, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Command } from 'cmdk';
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
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50"
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />

      {/* Command dialog */}
      <div className="relative z-50 w-full max-w-lg overflow-hidden rounded-xl border border-border bg-popover shadow-2xl">
        <Command
          className="flex flex-col"
          onKeyDown={(e: React.KeyboardEvent) => {
            if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
        >
          <div className="mx-1 mt-2 flex items-center px-1">
            <Command.Input
              placeholder="Search or ask a question about your infrastructure..."
              className={cn(
                'flex h-12 w-full rounded-full bg-transparent px-4 py-3 text-sm text-foreground outline-none',
                'placeholder:text-muted-foreground'
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
            {isNl && query.trim().length >= 5 && (
              <button
                onClick={handleAiQuery}
                disabled={nlQuery.isPending}
                className="ml-2 flex-shrink-0 inline-flex items-center gap-1.5 rounded-md bg-gradient-to-r from-blue-600 to-purple-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {nlQuery.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Sparkles className="h-3 w-3" />
                )}
                Ask AI
              </button>
            )}
          </div>
          <div className="mx-3 mb-1 flex items-center">
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={includeLogs}
                onChange={(e) => setIncludeLogs(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-border accent-primary"
              />
              <ScrollText className="h-3 w-3" />
              Search logs
            </label>
          </div>

          {/* AI Result */}
          {aiResult && (
            <div className="border-b border-border px-3 py-3">
              {aiResult.action === 'answer' && (
                <div className="flex items-start gap-2.5">
                  <Sparkles className="h-4 w-4 mt-0.5 flex-shrink-0 text-purple-500" />
                  <div className="flex-1 space-y-1">
                    <p className="text-sm font-medium text-foreground">{aiResult.text}</p>
                    {aiResult.description && (
                      <p className="text-xs text-muted-foreground">{aiResult.description}</p>
                    )}
                  </div>
                </div>
              )}
              {aiResult.action === 'navigate' && aiResult.page && (
                <button
                  onClick={() => navigateTo(aiResult.page!)}
                  className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-sm text-foreground hover:bg-accent transition-colors"
                >
                  <Sparkles className="h-4 w-4 flex-shrink-0 text-purple-500" />
                  <div className="flex-1 text-left">
                    <p className="font-medium">{aiResult.description || 'Go to page'}</p>
                    <p className="text-xs text-muted-foreground">{aiResult.page}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </button>
              )}
              {aiResult.action === 'error' && (
                <div className="flex items-center gap-2.5 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  <span>{aiResult.text}</span>
                </div>
              )}
            </div>
          )}

          {nlQuery.isPending && (
            <div className="border-b border-border px-3 py-3">
              <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-purple-500" />
                <span>Asking AI about your infrastructure...</span>
              </div>
            </div>
          )}

          <Command.List className="max-h-72 overflow-y-auto p-2">
            {query.trim().length < 2 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Type at least 2 characters to search.
              </div>
            ) : (
              <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
                {isLoading ? 'Searching...' : 'No results found.'}
              </Command.Empty>
            )}

            {/* Keyboard shortcuts hint */}
            <div className="mb-2 flex items-center justify-center gap-4 border-b border-border pb-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono">↑↓</kbd>
                navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono">↵</kbd>
                select
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono">⌘↵</kbd>
                ask AI
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono">esc</kbd>
                close
              </span>
            </div>

            {hasRecent && (
              <>
                <Command.Group
                  heading="Recent"
                  className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
                >
                  {recent.map((item) => (
                    <Command.Item
                      key={item.term}
                      value={item.term}
                      onSelect={() => setQuery(item.term)}
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm',
                        'text-foreground aria-selected:bg-accent aria-selected:text-accent-foreground'
                      )}
                    >
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span className="flex-1">{item.term}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatRelative(item.lastUsed)}
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              </>
            )}

            {query.trim().length >= 2 && (
              <>
                {containers.length > 0 && (
                  <Command.Group
                    heading="Containers"
                    className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
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
                          'flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm',
                          'text-foreground aria-selected:bg-accent aria-selected:text-accent-foreground'
                        )}
                      >
                        <Package className="h-4 w-4 text-muted-foreground" />
                        <div className="flex flex-col">
                          <span>{container.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {container.image} • {container.endpointName}
                          </span>
                        </div>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}

                {images.length > 0 && (
                  <>
                    <Command.Separator className="my-1 h-px bg-border" />
                    <Command.Group
                      heading="Images"
                      className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
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
                            'flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm',
                            'text-foreground aria-selected:bg-accent aria-selected:text-accent-foreground'
                          )}
                        >
                          <Layers className="h-4 w-4 text-muted-foreground" />
                          <div className="flex flex-col">
                            <span>{image.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {image.tags[0] || 'untagged'} • {image.endpointName || `Endpoint ${image.endpointId}`}
                            </span>
                          </div>
                        </Command.Item>
                      ))}
                    </Command.Group>
                  </>
                )}

                {stacks.length > 0 && (
                  <>
                    <Command.Separator className="my-1 h-px bg-border" />
                    <Command.Group
                      heading="Stacks"
                      className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
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
                            'flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm',
                            'text-foreground aria-selected:bg-accent aria-selected:text-accent-foreground'
                          )}
                        >
                          <Boxes className="h-4 w-4 text-muted-foreground" />
                          <div className="flex flex-col">
                            <span>{stack.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {stack.status} • Endpoint {stack.endpointId}
                            </span>
                          </div>
                        </Command.Item>
                      ))}
                    </Command.Group>
                  </>
                )}

                {logs.length > 0 && (
                  <>
                    <Command.Separator className="my-1 h-px bg-border" />
                    <Command.Group
                      heading="Logs"
                      className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
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
                            'flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 text-sm',
                            'text-foreground aria-selected:bg-accent aria-selected:text-accent-foreground'
                          )}
                        >
                          <ScrollText className="mt-0.5 h-4 w-4 text-muted-foreground" />
                          <div className="flex flex-col">
                            <span className="font-medium">{logItem.containerName}</span>
                            <span className="text-xs text-muted-foreground">
                              {logItem.message}
                            </span>
                          </div>
                        </Command.Item>
                      ))}
                    </Command.Group>
                  </>
                )}
              </>
            )}

            {(hasRecent || hasSearchResults) && (
              <Command.Separator className="my-1 h-px bg-border" />
            )}

            <Command.Group
              heading="Pages"
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
            >
              {pages.map((page) => (
                <Command.Item
                  key={page.to}
                  value={page.label}
                  onSelect={() => navigateTo(page.to)}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm',
                    'text-foreground aria-selected:bg-accent aria-selected:text-accent-foreground'
                  )}
                >
                  <page.icon className="h-4 w-4 text-muted-foreground" />
                  {page.label}
                </Command.Item>
              ))}
            </Command.Group>

            <Command.Separator className="my-1 h-px bg-border" />

            <Command.Group
              heading="Quick Actions"
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
            >
              <Command.Item
                value="Refresh page"
                onSelect={refresh}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm',
                  'text-foreground aria-selected:bg-accent aria-selected:text-accent-foreground'
                )}
              >
                <RefreshCw className="h-4 w-4 text-muted-foreground" />
                Refresh Page
              </Command.Item>
              <Command.Item
                value="Toggle theme"
                onSelect={toggleTheme}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm',
                  'text-foreground aria-selected:bg-accent aria-selected:text-accent-foreground'
                )}
              >
                <Palette className="h-4 w-4 text-muted-foreground" />
                Toggle Theme
                <span className="ml-auto text-xs text-muted-foreground">
                  Current: {theme}
                </span>
              </Command.Item>
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
