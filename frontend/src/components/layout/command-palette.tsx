import { useEffect, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Command } from 'cmdk';
import {
  LayoutDashboard,
  Boxes,
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
  Settings2,
  Bot,
  Plug,
  HardDriveDownload,
  Palette,
  Server,
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
import { cn } from '@/lib/utils';
import { useGlobalSearch } from '@/hooks/use-global-search';
import { useEndpoints } from '@/hooks/use-endpoints';
import { useStacks } from '@/hooks/use-stacks';
import { useSearch } from '@/providers/search-provider';
import { useNlQuery, type NlQueryResult } from '@/hooks/use-nl-query';
import { Search } from 'lucide-react';

interface PageEntry {
  label: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
}

const pages: PageEntry[] = [
  { label: 'Home', to: '/', icon: LayoutDashboard },
  { label: 'Workload Explorer', to: '/workloads', icon: Boxes },
  { label: 'Infrastructure', to: '/infrastructure', icon: Server },
  { label: 'Container Health', to: '/health', icon: HeartPulse },
  { label: 'Image Footprint', to: '/images', icon: PackageOpen },
  { label: 'Network Topology', to: '/topology', icon: Network },
  { label: 'Metrics Dashboard', to: '/metrics', icon: BarChart3 },
  { label: 'Monitor', to: '/ai-monitor', icon: Brain },
  { label: 'Trace Explorer', to: '/traces', icon: GitBranch },
  { label: 'LLM Assistant', to: '/assistant', icon: MessageSquare },
  { label: 'LLM Observability', to: '/llm-observability', icon: Activity },
  { label: 'Remediation', to: '/remediation', icon: Shield },
  { label: 'Security Audit', to: '/security/audit', icon: Shield },
  { label: 'Edge Agent Logs', to: '/edge-logs', icon: FileSearch },
  { label: 'Settings', to: '/settings', icon: Settings },
  { label: 'Webhooks', to: '/webhooks', icon: Webhook },
  { label: 'Users', to: '/users', icon: Users },
];

interface SettingsEntry {
  label: string;
  keywords: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
}

const settingsEntries: SettingsEntry[] = [
  { label: 'General Settings', keywords: 'general cache redis polling interval', to: '/settings?tab=general', icon: Settings2 },
  { label: 'Security Settings', keywords: 'security auth oidc sso password login rbac jwt session', to: '/settings?tab=security', icon: Shield },
  { label: 'AI & LLM Settings', keywords: 'ai llm ollama model prompt anthropic claude openai', to: '/settings?tab=ai', icon: Bot },
  { label: 'Monitoring Settings', keywords: 'monitoring notifications email smtp teams discord telegram alerts', to: '/settings?tab=monitoring', icon: Activity },
  { label: 'Integrations Settings', keywords: 'integrations webhooks elasticsearch portainer api', to: '/settings?tab=integrations', icon: Plug },
  { label: 'Infrastructure Settings', keywords: 'infrastructure backup database postgres timescale', to: '/settings?tab=infrastructure', icon: HardDriveDownload },
  { label: 'Appearance Settings', keywords: 'appearance theme dark light apple catppuccin background animation', to: '/settings?tab=appearance', icon: Palette },
];

function isNaturalLanguageQuery(input: string): boolean {
  const trimmed = input.trim().toLowerCase();
  if (trimmed.length < 5) return false;
  if (/^(what|which|how|show|list|find|are|is|why|where|who|when|compare|help|tell)\b/.test(trimmed)) return true;
  if (trimmed.endsWith('?')) return true;
  if (/\b(using more than|greater than|less than|running|stopped|restarted|unhealthy|memory|cpu)\b/.test(trimmed)) return true;
  return false;
}

export type SearchCategory = 'all' | 'containers' | 'settings';

const categories: { id: SearchCategory; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'containers', label: 'Containers', icon: Package },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function CommandPalette() {
  const navigate = useNavigate();
  const open = useUiStore((s) => s.commandPaletteOpen);
  const setOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const [query, setQuery] = useState('');
  const [includeLogs, setIncludeLogs] = useState(false);
  const [aiResult, setAiResult] = useState<NlQueryResult | null>(null);
  const [activeCategory, setActiveCategory] = useState<SearchCategory>('all');
  const [hoveredCategory, setHoveredCategory] = useState<string | null>(null);
  // Debouncing is now handled inside useGlobalSearch — no local debounce needed.
  const { data, isLoading } = useGlobalSearch(query, open, includeLogs);
  const { data: endpoints } = useEndpoints();
  const { data: allStacksData } = useStacks();
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

      // Only handle "/" shortcut here - Cmd+K is handled in app-layout.tsx
      if (e.key === '/' && !isEditable) {
        e.preventDefault();
        setOpen(true);
      }
    },
    [setOpen]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setAiResult(null);
      setActiveCategory('all');
    }
  }, [open]);

  // Always include logs in search results
  useEffect(() => {
    setIncludeLogs(true);
  }, [activeCategory]);

  const isNl = isNaturalLanguageQuery(query);

  const handleAiQuery = useCallback(() => {
    if (!query.trim() || nlQuery.isPending) return;
    addRecent(query);
    setAiResult(null);
    nlQuery.mutate(query.trim(), {
      onSuccess: (result) => {
        setAiResult(result);
      },
      onError: () => {
        setAiResult({
          action: 'error',
          text: 'Neural services are currently unreachable.',
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
    if (diff < 60_000) return 'Just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
  };

  const allContainers = data?.containers ?? [];
  const allImages = data?.images ?? [];
  const allLogs = data?.logs ?? [];
  const lowerQuery = query.trim().toLowerCase();

  // Filter results based on active category
  const containers = activeCategory === 'all' || activeCategory === 'containers' ? allContainers : [];
  const images = activeCategory === 'all' || activeCategory === 'containers' ? allImages : [];
  const logs = activeCategory === 'all' ? allLogs : [];
  const filteredPages = activeCategory === 'all'
    ? pages
    : activeCategory === 'containers'
      ? pages.filter((p) => p.to === '/workloads' || p.to === '/health' || p.to === '/infrastructure' || p.to === '/images')
      : activeCategory === 'settings'
        ? pages.filter((p) => p.to === '/settings' || p.to === '/users' || p.to === '/webhooks')
        : pages;

  const filteredSettings = activeCategory === 'all' || activeCategory === 'settings' ? settingsEntries : [];

  // Client-side endpoint (node) filtering
  const filteredEndpoints = (activeCategory === 'all' || activeCategory === 'containers') && lowerQuery.length >= 2
    ? (endpoints ?? []).filter((ep) => ep.name.toLowerCase().includes(lowerQuery)).slice(0, 6)
    : [];

  // Client-side stack filtering
  const filteredStacks = (activeCategory === 'all' || activeCategory === 'containers') && lowerQuery.length >= 2
    ? (allStacksData ?? []).filter((s) => s.name.toLowerCase().includes(lowerQuery)).slice(0, 6)
    : [];

  const hasRecent = query.trim().length === 0 && recent.length > 0;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-[8px]"
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />

      {/* Command dialog - Spotlight Style */}
      <div
        className={cn(
          "relative z-[101] w-full max-w-3xl overflow-hidden rounded-[28px] border border-border/50 bg-card/90 backdrop-blur-[45px] shadow-[0_40px_120px_rgba(0,0,0,0.5)]",
          isNl && "border-primary/50 ring-1 ring-primary/30 shadow-[0_0_60px_-12px_rgba(99,102,241,0.3)]"
        )}
      >
            <Command
              className="flex flex-col"
              onKeyDown={(e: React.KeyboardEvent) => {
                if (e.key === 'Escape') {
                  setOpen(false);
                }
                if (e.key === 'Enter' && isNl) {
                  e.preventDefault();
                  e.stopPropagation();
                  handleAiQuery();
                }
              }}
            >
              {/* Unified Search Bar: Logo + Input + Category Buttons in one bar */}
              <div className="relative flex items-center h-[56px] mx-7 mt-5 mb-4 rounded-2xl bg-muted/40">
                {/* Logo */}
                <div className="flex shrink-0 items-center justify-center pl-5 pr-3" data-testid="search-logo">
                  <Search className="h-5 w-5 text-muted-foreground/50" />
                </div>

                {/* Input */}
                <Command.Input
                  placeholder={hoveredCategory ? `Filter by ${hoveredCategory}...` : 'Search or Ask Neural AI...'}
                  className="!h-full !flex-1 !border-0 !bg-transparent !text-base !font-medium !tracking-tight !text-foreground !shadow-none !ring-0 !outline-none placeholder:!text-muted-foreground/50 focus:!ring-0 focus:!border-0 focus:!outline-none focus:!shadow-none"
                  value={query}
                  onValueChange={(v) => { setQuery(v); setAiResult(null); }}
                  autoFocus
                />

                {/* Neural Run Button */}
                {isNl && query.trim().length >= 5 && (
                  <button
                    onClick={handleAiQuery}
                    disabled={nlQuery.isPending}
                    className="flex shrink-0 items-center gap-2 rounded-full bg-primary mr-2 px-5 py-2 text-[11px] font-black uppercase tracking-[0.15em] text-primary-foreground shadow-[0_0_20px_rgba(99,102,241,0.4)] transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
                  >
                    {nlQuery.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    <span>Neural Run</span>
                  </button>
                )}

                {/* Separator line before category buttons */}
                <div className="h-8 w-px bg-border/50 shrink-0" />

                {/* Category Focus Buttons */}
                <div className="flex shrink-0 items-center" data-testid="category-buttons">
                  {categories.map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => setActiveCategory(activeCategory === cat.id ? 'all' : cat.id)}
                      onMouseEnter={() => setHoveredCategory(cat.label)}
                      onMouseLeave={() => setHoveredCategory(null)}
                      title={cat.label}
                      aria-label={`Filter by ${cat.label}`}
                      aria-pressed={activeCategory === cat.id}
                      className={cn(
                        "flex h-[56px] w-[48px] items-center justify-center transition-colors duration-150 motion-reduce:transition-none first:ml-0 last:rounded-r-2xl",
                        activeCategory === cat.id
                          ? "text-primary"
                          : "text-muted-foreground/50 hover:text-muted-foreground"
                      )}
                    >
                      <cat.icon className="h-5 w-5" />
                    </button>
                  ))}
                </div>
              </div>

              {/* Separator */}
              {(query.trim().length > 0 || recent.length > 0) && (
                <div className="mx-7 h-px bg-border/30" />
              )}

              <Command.List className="max-h-[60vh] overflow-y-auto overflow-x-hidden p-4 selection:bg-primary/40">
                {query.trim().length < 2 && !recent.length && (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="mb-6 rounded-[24px] bg-muted/30 p-6 border border-border/20 shadow-inner">
                      <Brain className="h-10 w-10 text-primary/40" />
                    </div>
                    <p className="text-xs font-bold text-muted-foreground/30 uppercase tracking-[0.2em]">Type to search, ask a question, or select a category</p>
                  </div>
                )}

                {/* 1. AI Result - Highest Priority */}
                {nlQuery.isPending && (
                  <div className="m-4 rounded-[24px] bg-primary/5 p-8 border border-primary/20 shadow-lg">
                    <div className="flex items-center gap-6">
                      <div className="relative">
                        <div className="h-10 w-10 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
                        <Sparkles className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 text-primary" />
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-lg font-bold tracking-tight text-primary">Neural processing...</span>
                        <span className="text-xs font-medium text-primary/40 uppercase tracking-widest">Analyzing infrastructure graph</span>
                      </div>
                    </div>
                  </div>
                )}

                {aiResult && (
                  <div className="m-4 overflow-hidden rounded-[24px] bg-primary/10 border border-primary/20 shadow-[0_12px_40px_rgba(0,0,0,0.3)]">
                    {aiResult.action === 'answer' && (
                      <div className="flex items-start gap-6 p-8">
                        <div className="rounded-[20px] bg-primary/20 p-4 text-primary shadow-inner">
                          <Sparkles className="h-8 w-8" />
                        </div>
                        <div className="flex-1 space-y-3">
                          <p className="text-[19px] font-semibold leading-relaxed text-foreground tracking-tight">{aiResult.text}</p>
                          {aiResult.description && (
                            <p className="text-[14px] font-medium leading-relaxed text-muted-foreground">{aiResult.description}</p>
                          )}
                        </div>
                      </div>
                    )}
                    {aiResult.action === 'navigate' && aiResult.page && (
                      <button
                        onClick={() => navigateTo(aiResult.page!)}
                        className="group flex w-full items-center gap-6 p-8 text-left transition-all hover:bg-primary/20"
                      >
                        <div className="rounded-[20px] bg-primary/20 p-4 text-primary group-hover:scale-110 transition-transform">
                          <ArrowRight className="h-8 w-8" />
                        </div>
                        <div className="flex-1">
                          <p className="text-[19px] font-bold text-foreground tracking-tight">{aiResult.description || 'View Insight'}</p>
                          <p className="text-[14px] font-medium text-primary/60">{aiResult.page}</p>
                        </div>
                        <div className="rounded-full bg-muted/50 px-5 py-2 text-[11px] font-black uppercase tracking-[0.2em] text-muted-foreground group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                          Execute
                        </div>
                      </button>
                    )}
                    {aiResult.action === 'error' && (
                      <div className="flex items-center gap-6 p-8 text-base text-destructive font-bold">
                        <AlertCircle className="h-8 w-8" />
                        <span>{aiResult.text}</span>
                      </div>
                    )}
                  </div>
                )}

                {query.trim().length >= 2 && (
                  <>
                    {/* 2. Containers - Essential infrastructure */}
                    {containers.length > 0 && (
                      <Command.Group
                        heading="Infrastructure Units"
                        className="px-2 pb-4 [&_[cmdk-group-heading]]:px-6 [&_[cmdk-group-heading]]:py-4 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-black [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.25em] [&_[cmdk-group-heading]]:text-muted-foreground/30"
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
                              'flex cursor-pointer items-center gap-6 rounded-[18px] px-6 py-4.5 text-[17px] transition-all mb-2',
                              'text-foreground/70 aria-selected:bg-muted/60 aria-selected:text-foreground'
                            )}
                          >
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-muted/30 aria-selected:bg-muted/50 shadow-inner">
                              <Package className="h-6 w-6 opacity-40 aria-selected:opacity-100" />
                            </div>
                            <div className="flex flex-col gap-0.5">
                              <span className="font-bold tracking-tight">{container.name}</span>
                              <span className="text-[13px] font-medium text-muted-foreground/50 aria-selected:text-foreground/70 line-clamp-1">
                                {container.image} • {container.endpointName}
                              </span>
                            </div>
                          </Command.Item>
                        ))}
                      </Command.Group>
                    )}

                    {/* Nodes / Endpoints */}
                    {filteredEndpoints.length > 0 && (
                      <Command.Group
                        heading="Nodes"
                        className="px-2 pb-4 [&_[cmdk-group-heading]]:px-6 [&_[cmdk-group-heading]]:py-4 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-black [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.25em] [&_[cmdk-group-heading]]:text-muted-foreground/30"
                      >
                        {filteredEndpoints.map((ep) => (
                          <Command.Item
                            key={`endpoint-${ep.id}`}
                            value={`node-${ep.name}`}
                            onSelect={() => navigateTo(`/infrastructure?endpoint=${ep.id}`)}
                            className={cn(
                              'flex cursor-pointer items-center gap-6 rounded-[18px] px-6 py-4.5 text-[17px] transition-all mb-2',
                              'text-foreground/70 aria-selected:bg-muted/60 aria-selected:text-foreground'
                            )}
                          >
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-muted/30 aria-selected:bg-muted/50 shadow-inner">
                              <Server className="h-6 w-6 opacity-40 aria-selected:opacity-100" />
                            </div>
                            <div className="flex flex-col gap-0.5">
                              <span className="font-bold tracking-tight">{ep.name}</span>
                              <span className="text-[13px] font-medium text-muted-foreground/50 aria-selected:text-foreground/70">
                                {ep.status === 'up' ? 'Online' : 'Offline'} • {ep.totalContainers} containers • {ep.stackCount} stacks
                              </span>
                            </div>
                          </Command.Item>
                        ))}
                      </Command.Group>
                    )}

                    {/* 3. Navigation - Core pages (filtered by category) */}
                    {filteredPages.length > 0 && (
                      <Command.Group
                        heading="Neural Navigation"
                        className="px-2 pb-4 [&_[cmdk-group-heading]]:px-6 [&_[cmdk-group-heading]]:py-4 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-black [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.25em] [&_[cmdk-group-heading]]:text-muted-foreground/30"
                      >
                        <div className="grid grid-cols-2 gap-2">
                          {filteredPages.map((page) => (
                            <Command.Item
                              key={page.to}
                              value={page.label}
                              onSelect={() => navigateTo(page.to)}
                              className={cn(
                                'flex cursor-pointer items-center gap-4 rounded-[16px] px-5 py-4 text-[15px] transition-all',
                                'text-foreground/60 aria-selected:bg-muted/60 aria-selected:text-foreground'
                              )}
                            >
                              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-muted/30 aria-selected:bg-muted/50">
                                <page.icon className="h-4.5 w-4.5 opacity-40 aria-selected:opacity-100" />
                              </div>
                              <span className="font-bold truncate tracking-tight">{page.label}</span>
                            </Command.Item>
                          ))}
                        </div>
                      </Command.Group>
                    )}

                    {/* Settings tabs - deep links */}
                    {filteredSettings.length > 0 && (
                      <Command.Group
                        heading="Settings"
                        className="px-2 pb-4 [&_[cmdk-group-heading]]:px-6 [&_[cmdk-group-heading]]:py-4 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-black [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.25em] [&_[cmdk-group-heading]]:text-muted-foreground/30"
                      >
                        <div className="grid grid-cols-2 gap-2">
                          {filteredSettings.map((entry) => (
                            <Command.Item
                              key={entry.to}
                              value={`${entry.label} ${entry.keywords}`}
                              onSelect={() => navigateTo(entry.to)}
                              className={cn(
                                'flex cursor-pointer items-center gap-4 rounded-[16px] px-5 py-4 text-[15px] transition-all',
                                'text-foreground/60 aria-selected:bg-muted/60 aria-selected:text-foreground'
                              )}
                            >
                              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-muted/30 aria-selected:bg-muted/50">
                                <entry.icon className="h-4.5 w-4.5 opacity-40 aria-selected:opacity-100" />
                              </div>
                              <span className="font-bold truncate tracking-tight">{entry.label}</span>
                            </Command.Item>
                          ))}
                        </div>
                      </Command.Group>
                    )}

                    {/* 4. Stacks */}
                    {filteredStacks.length > 0 && (
                      <Command.Group
                        heading="Stacks"
                        className="px-2 pb-4 [&_[cmdk-group-heading]]:px-6 [&_[cmdk-group-heading]]:py-4 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-black [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.25em] [&_[cmdk-group-heading]]:text-muted-foreground/30"
                      >
                        {filteredStacks.map((stack) => (
                          <Command.Item
                            key={`stack-${stack.id}`}
                            value={`stack-${stack.name}`}
                            onSelect={() => {
                              onSearchSelect();
                              navigateTo(`/workloads?stack=${stack.name}`);
                            }}
                            className={cn(
                              'flex cursor-pointer items-center gap-6 rounded-[18px] px-6 py-4.5 text-[17px] transition-all mb-2',
                              'text-foreground/70 aria-selected:bg-muted/60 aria-selected:text-foreground'
                            )}
                          >
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-muted/30 aria-selected:bg-muted/50 shadow-inner">
                              <Boxes className="h-6 w-6 opacity-40 aria-selected:opacity-100" />
                            </div>
                            <div className="flex flex-col gap-0.5">
                              <span className="font-bold tracking-tight">{stack.name}</span>
                              <span className="text-[13px] font-medium text-muted-foreground/50 aria-selected:text-foreground/70">
                                {stack.status} • {stack.containerCount ?? 0} containers
                              </span>
                            </div>
                          </Command.Item>
                        ))}
                      </Command.Group>
                    )}

                    {/* 5. Images - Assets */}
                    {images.length > 0 && (
                      <Command.Group
                        heading="Binary Blueprints"
                        className="px-2 pb-4 [&_[cmdk-group-heading]]:px-6 [&_[cmdk-group-heading]]:py-4 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-black [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.25em] [&_[cmdk-group-heading]]:text-muted-foreground/30"
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
                              'flex cursor-pointer items-center gap-6 rounded-[18px] px-6 py-4.5 text-[17px] transition-all mb-2',
                              'text-foreground/70 aria-selected:bg-muted/60 aria-selected:text-foreground'
                            )}
                          >
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-muted/30 aria-selected:bg-muted/50 shadow-inner">
                              <Layers className="h-6 w-6 opacity-40 aria-selected:opacity-100" />
                            </div>
                            <div className="flex flex-col gap-0.5">
                              <span className="font-bold tracking-tight">{image.name}</span>
                              <span className="text-[13px] font-medium text-muted-foreground/50 aria-selected:text-foreground/70">
                                {image.tags[0] || 'untagged'} • {image.endpointName}
                              </span>
                            </div>
                          </Command.Item>
                        ))}
                      </Command.Group>
                    )}
                  </>
                )}

                {/* 6. Recent History */}
                {hasRecent && (
                  <Command.Group
                    heading="Recent Neural Interactions"
                    className="px-2 pb-4 [&_[cmdk-group-heading]]:px-6 [&_[cmdk-group-heading]]:py-4 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-black [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.25em] [&_[cmdk-group-heading]]:text-muted-foreground/30"
                  >
                    {recent.map((item) => (
                      <Command.Item
                        key={item.term}
                        value={item.term}
                        onSelect={() => setQuery(item.term)}
                        className={cn(
                          'flex cursor-pointer items-center gap-6 rounded-[18px] px-6 py-4.5 text-[17px] transition-all mb-2',
                          'text-foreground/70 aria-selected:bg-muted/60 aria-selected:text-foreground'
                        )}
                      >
                        <Clock className="h-6 w-6 shrink-0 opacity-20 aria-selected:opacity-100" />
                        <span className="flex-1 font-semibold tracking-tight">{item.term}</span>
                        <span className="text-[12px] font-black opacity-10 aria-selected:opacity-50 uppercase tracking-widest">
                          {formatRelative(item.lastUsed)}
                        </span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}

                {query.trim().length >= 2 && (
                  <>
                    {/* 7. Logs - High volume data */}
                    {logs.length > 0 && (
                      <Command.Group
                        heading="Neural Log Stream"
                        className="px-2 pb-4 [&_[cmdk-group-heading]]:px-6 [&_[cmdk-group-heading]]:py-4 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-black [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.25em] [&_[cmdk-group-heading]]:text-muted-foreground/30"
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
                              'flex cursor-pointer items-start gap-6 rounded-[18px] px-6 py-4.5 text-[17px] transition-all mb-2',
                              'text-foreground/70 aria-selected:bg-muted/60 aria-selected:text-foreground'
                            )}
                          >
                            <ScrollText className="mt-1 h-6 w-6 shrink-0 opacity-30 aria-selected:opacity-100" />
                            <div className="flex flex-col gap-1">
                              <span className="font-bold tracking-tight">{logItem.containerName}</span>
                              <span className="text-[13px] font-medium leading-relaxed text-muted-foreground/50 aria-selected:text-foreground/70 line-clamp-2">
                                {logItem.message}
                              </span>
                            </div>
                          </Command.Item>
                        ))}
                      </Command.Group>
                    )}
                  </>
                )}

                {query.trim().length >= 2 && !isLoading && !containers.length && !images.length && !filteredStacks.length && !filteredEndpoints.length && !logs.length && (
                  <Command.Empty className="py-28 text-center">
                    <div className="mb-6 flex justify-center">
                      <AlertCircle className="h-12 w-12 text-muted-foreground/20" />
                    </div>
                    <p className="text-xl font-bold text-foreground/60 tracking-tight">No results for "{query}"</p>
                    <p className="mt-2 text-sm font-medium text-muted-foreground/40 uppercase tracking-[0.15em]">Refine search or try Neural Run</p>
                  </Command.Empty>
                )}
              </Command.List>

              {/* Compact Footer */}
              <div className="flex items-center justify-between border-t border-border/20 px-7 py-3.5 bg-muted/10">
                <div className="flex items-center gap-5">
                  <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.15em] text-muted-foreground/30">
                    <kbd className="rounded-[5px] bg-muted/30 px-1.5 py-0.5 font-mono text-muted-foreground/50 border border-border/20 shadow-inner">↑↓</kbd>
                    <span>Traverse</span>
                  </span>
                  <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.15em] text-muted-foreground/30">
                    <kbd className="rounded-[5px] bg-muted/30 px-1.5 py-0.5 font-mono text-muted-foreground/50 border border-border/20 shadow-inner">↵</kbd>
                    <span>Execute</span>
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.15em] text-muted-foreground/30">
                  <span className="text-[9px] opacity-50">Powered by</span>
                  <span className="text-primary/60 tracking-[0.3em]">AI Intelligence</span>
                </div>
              </div>
            </Command>
          </div>
        </div>
  );
}
