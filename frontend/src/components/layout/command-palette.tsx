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
  { label: 'Home', to: '/', icon: LayoutDashboard },
  { label: 'Workload Explorer', to: '/workloads', icon: Boxes },
  { label: 'Fleet Overview', to: '/fleet', icon: Ship },
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

function isNaturalLanguageQuery(input: string): boolean {
  const trimmed = input.trim().toLowerCase();
  if (trimmed.length < 5) return false;
  if (/^(what|which|how|show|list|find|are|is|why|where|who|when|compare|help|tell)\b/.test(trimmed)) return true;
  if (trimmed.endsWith('?')) return true;
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
    }
  }, [open]);

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
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-[8px]"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />

          {/* Command dialog - macOS Tahoe Style */}
          <motion.div
            initial={{ opacity: 0, scale: 0.98, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -10 }}
            transition={{ type: "spring", damping: 28, stiffness: 350 }}
            className={cn(
              "relative z-[101] w-full max-w-2xl overflow-hidden rounded-[28px] border border-white/10 bg-[#1c1c1e]/85 backdrop-blur-[45px] shadow-[0_40px_120px_rgba(0,0,0,0.8)]",
              isNl && "border-primary/50 ring-1 ring-primary/30 shadow-[0_0_60px_-12px_rgba(99,102,241,0.3)]"
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
              {/* Search Header - High Density */}
              <div className="relative flex items-center px-10">
                <div className="flex h-[72px] w-full items-center gap-5">
                  <div className="flex shrink-0 items-center justify-center">
                    {isNl ? (
                      <Sparkles className="h-6 w-6 text-primary animate-pulse" />
                    ) : (
                      <div className="relative">
                        <FileSearch className="h-6 w-6 text-white/30" />
                        <motion.div 
                          className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-primary/50 blur-[2px]"
                          animate={{ opacity: [0.4, 0.9, 0.4] }}
                          transition={{ duration: 2, repeat: Infinity }}
                        />
                      </div>
                    )}
                  </div>
                  <Command.Input
                    placeholder="Search or Ask Neural AI..."
                    className={cn(
                      'h-full w-full bg-transparent text-xl font-medium tracking-tight text-white outline-none',
                      'placeholder:text-white/10'
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
                  
                  <div className="flex items-center gap-4">
                    {isNl && query.trim().length >= 5 && (
                      <button
                        onClick={handleAiQuery}
                        disabled={nlQuery.isPending}
                        className="flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-[11px] font-black uppercase tracking-[0.15em] text-white shadow-[0_0_20px_rgba(99,102,241,0.4)] transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
                      >
                        {nlQuery.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="h-3.5 w-3.5" />
                        )}
                        <span>Neural Run</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Separator - Even more subtle */}
              {(query.trim().length > 0 || recent.length > 0) && (
                <div className="mx-10 h-px bg-white/[0.05]" />
              )}

              <Command.List className="max-h-[60vh] overflow-y-auto overflow-x-hidden p-4 selection:bg-primary/40">
                {query.trim().length < 2 && !recent.length && (
                  <div className="flex flex-col items-center justify-center py-28 text-center">
                    <motion.div 
                      initial={{ scale: 0.9, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className="mb-8 rounded-[32px] bg-white/[0.03] p-8 border border-white/5 shadow-inner"
                    >
                      <Brain className="h-16 w-16 text-primary/40" />
                    </motion.div>
                    <p className="text-2xl font-bold tracking-tight text-white/80">Neural Search</p>
                    <p className="mt-2 text-sm font-bold text-white/20 uppercase tracking-[0.3em]">AI-Powered Infrastructure Intelligence</p>
                  </div>
                )}

                {/* 1. AI Result - Highest Priority */}
                {nlQuery.isPending && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="m-4 rounded-[24px] bg-primary/5 p-8 border border-primary/20 shadow-lg"
                  >
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
                  </motion.div>
                )}

                {aiResult && (
                  <motion.div 
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="m-4 overflow-hidden rounded-[24px] bg-primary/10 border border-primary/20 shadow-[0_12px_40px_rgba(0,0,0,0.3)]"
                  >
                    {aiResult.action === 'answer' && (
                      <div className="flex items-start gap-6 p-8">
                        <div className="rounded-[20px] bg-primary/20 p-4 text-primary shadow-inner">
                          <Sparkles className="h-8 w-8" />
                        </div>
                        <div className="flex-1 space-y-3">
                          <p className="text-[19px] font-semibold leading-relaxed text-white tracking-tight">{aiResult.text}</p>
                          {aiResult.description && (
                            <p className="text-[14px] font-medium leading-relaxed text-white/40">{aiResult.description}</p>
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
                          <p className="text-[19px] font-bold text-white tracking-tight">{aiResult.description || 'View Insight'}</p>
                          <p className="text-[14px] font-medium text-primary/60">{aiResult.page}</p>
                        </div>
                        <div className="rounded-full bg-white/10 px-5 py-2 text-[11px] font-black uppercase tracking-[0.2em] text-white/50 group-hover:bg-primary group-hover:text-white transition-colors">
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
                  </motion.div>
                )}

                {query.trim().length >= 2 && (
                  <>
                    {/* 2. Containers - Essential infrastructure */}
                    {containers.length > 0 && (
                      <Command.Group
                        heading="Infrastructure Units"
                        className="px-2 pb-4 [&_[cmdk-group-heading]]:px-6 [&_[cmdk-group-heading]]:py-4 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-black [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.25em] [&_[cmdk-group-heading]]:text-white/10"
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
                              'text-white/70 aria-selected:bg-primary aria-selected:text-white aria-selected:shadow-2xl aria-selected:shadow-primary/30'
                            )}
                          >
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-white/[0.03] aria-selected:bg-white/20 shadow-inner">
                              <Package className="h-6 w-6 opacity-40 aria-selected:opacity-100" />
                            </div>
                            <div className="flex flex-col gap-0.5">
                              <span className="font-bold tracking-tight">{container.name}</span>
                              <span className="text-[13px] font-medium text-white/20 aria-selected:text-white/60 line-clamp-1">
                                {container.image} • {container.endpointName}
                              </span>
                            </div>
                          </Command.Item>
                        ))}
                      </Command.Group>
                    )}

                    {/* 3. Navigation - Core pages */}
                    <Command.Group
                      heading="Neural Navigation"
                      className="px-2 pb-4 [&_[cmdk-group-heading]]:px-6 [&_[cmdk-group-heading]]:py-4 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-black [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.25em] [&_[cmdk-group-heading]]:text-white/10"
                    >
                      <div className="grid grid-cols-2 gap-2">
                        {pages.map((page) => (
                          <Command.Item
                            key={page.to}
                            value={page.label}
                            onSelect={() => navigateTo(page.to)}
                            className={cn(
                              'flex cursor-pointer items-center gap-4 rounded-[16px] px-5 py-4 text-[15px] transition-all',
                              'text-white/60 aria-selected:bg-primary aria-selected:text-white aria-selected:shadow-xl aria-selected:shadow-primary/20'
                            )}
                          >
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-white/[0.03] aria-selected:bg-white/20">
                              <page.icon className="h-4.5 w-4.5 opacity-40 aria-selected:opacity-100" />
                            </div>
                            <span className="font-bold truncate tracking-tight">{page.label}</span>
                          </Command.Item>
                        ))}
                      </div>
                    </Command.Group>

                    {/* 4. Stacks - High level groupings */}
                    {stacks.length > 0 && (
                      <Command.Group
                        heading="Resource Stacks"
                        className="px-2 pb-4 [&_[cmdk-group-heading]]:px-6 [&_[cmdk-group-heading]]:py-4 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-black [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.25em] [&_[cmdk-group-heading]]:text-white/10"
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
                              'flex cursor-pointer items-center gap-6 rounded-[18px] px-6 py-4.5 text-[17px] transition-all mb-2',
                              'text-white/70 aria-selected:bg-primary aria-selected:text-white aria-selected:shadow-2xl aria-selected:shadow-primary/30'
                            )}
                          >
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-white/[0.03] aria-selected:bg-white/20 shadow-inner">
                              <Boxes className="h-6 w-6 opacity-40 aria-selected:opacity-100" />
                            </div>
                            <div className="flex flex-col gap-0.5">
                              <span className="font-bold tracking-tight">{stack.name}</span>
                              <span className="text-[13px] font-medium text-white/20 aria-selected:text-white/70">
                                {stack.status} • Endpoint {stack.endpointId}
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
                        className="px-2 pb-4 [&_[cmdk-group-heading]]:px-6 [&_[cmdk-group-heading]]:py-4 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-black [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.25em] [&_[cmdk-group-heading]]:text-white/10"
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
                              'text-white/70 aria-selected:bg-primary aria-selected:text-white aria-selected:shadow-2xl aria-selected:shadow-primary/30'
                            )}
                          >
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-white/[0.03] aria-selected:bg-white/20 shadow-inner">
                              <Layers className="h-6 w-6 opacity-40 aria-selected:opacity-100" />
                            </div>
                            <div className="flex flex-col gap-0.5">
                              <span className="font-bold tracking-tight">{image.name}</span>
                              <span className="text-[13px] font-medium text-white/20 aria-selected:text-white/60">
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
                    className="px-2 pb-4 [&_[cmdk-group-heading]]:px-6 [&_[cmdk-group-heading]]:py-4 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-black [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.25em] [&_[cmdk-group-heading]]:text-white/10"
                  >
                    {recent.map((item) => (
                      <Command.Item
                        key={item.term}
                        value={item.term}
                        onSelect={() => setQuery(item.term)}
                        className={cn(
                          'flex cursor-pointer items-center gap-6 rounded-[18px] px-6 py-4.5 text-[17px] transition-all mb-2',
                          'text-white/70 aria-selected:bg-primary aria-selected:text-white aria-selected:shadow-2xl aria-selected:shadow-primary/30'
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
                        className="px-2 pb-4 [&_[cmdk-group-heading]]:px-6 [&_[cmdk-group-heading]]:py-4 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-black [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.25em] [&_[cmdk-group-heading]]:text-white/10"
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
                              'text-white/70 aria-selected:bg-primary aria-selected:text-white aria-selected:shadow-2xl aria-selected:shadow-primary/30'
                            )}
                          >
                            <ScrollText className="mt-1 h-6 w-6 shrink-0 opacity-30 aria-selected:opacity-100" />
                            <div className="flex flex-col gap-1">
                              <span className="font-bold tracking-tight">{logItem.containerName}</span>
                              <span className="text-[13px] font-medium leading-relaxed text-white/20 aria-selected:text-white/70 line-clamp-2">
                                {logItem.message}
                              </span>
                            </div>
                          </Command.Item>
                        ))}
                      </Command.Group>
                    )}
                  </>
                )}

                {/* 8. System Controller */}
                <Command.Group
                  heading="Neural Controller"
                  className="px-2 pb-4 [&_[cmdk-group-heading]]:px-6 [&_[cmdk-group-heading]]:py-4 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-black [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.25em] [&_[cmdk-group-heading]]:text-white/10"
                >
                  <Command.Item
                    value="Refresh page"
                    onSelect={refresh}
                    className={cn(
                      'flex cursor-pointer items-center gap-6 rounded-[18px] px-6 py-4.5 text-[17px] transition-all mb-2',
                      'text-white/70 aria-selected:bg-primary aria-selected:text-white aria-selected:shadow-2xl aria-selected:shadow-primary/30'
                    )}
                  >
                    <RefreshCw className="h-6 w-6 shrink-0 opacity-20 aria-selected:opacity-100" />
                    <span className="font-bold tracking-tight text-white/80">Reload Neural Workspace</span>
                  </Command.Item>
                  <Command.Item
                    value="Toggle theme"
                    onSelect={toggleTheme}
                    className={cn(
                      'flex cursor-pointer items-center gap-6 rounded-[18px] px-6 py-4.5 text-[17px] transition-all mb-2',
                      'text-white/70 aria-selected:bg-primary aria-selected:text-white aria-selected:shadow-2xl aria-selected:shadow-primary/30'
                    )}
                  >
                    <Palette className="h-6 w-6 shrink-0 opacity-20 aria-selected:opacity-100" />
                    <div className="flex flex-1 items-center justify-between">
                      <span className="font-bold tracking-tight text-white/80">Neural Atmosphere</span>
                      <span className="text-[11px] font-black uppercase tracking-widest text-white/20 aria-selected:text-white/60">{theme}</span>
                    </div>
                  </Command.Item>
                </Command.Group>

                {query.trim().length >= 2 && !isLoading && !containers.length && !images.length && !stacks.length && !logs.length && (
                  <Command.Empty className="py-28 text-center">
                    <div className="mb-6 flex justify-center">
                      <AlertCircle className="h-12 w-12 text-white/10" />
                    </div>
                    <p className="text-xl font-bold text-white/60 tracking-tight">No results for "{query}"</p>
                    <p className="mt-2 text-sm font-medium text-white/20 uppercase tracking-[0.15em]">Refine search or try Neural Run</p>
                  </Command.Empty>
                )}
              </Command.List>

              {/* High-End Footer */}
              <div className="flex items-center justify-between border-t border-white/5 px-8 py-5 bg-white/[0.01]">
                <div className="flex items-center gap-6">
                  <span className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.15em] text-white/15">
                    <kbd className="rounded-[6px] bg-white/5 px-2 py-1 font-mono text-white/30 border border-white/5 shadow-inner">↑↓</kbd>
                    <span>Traverse</span>
                  </span>
                  <span className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.15em] text-white/15">
                    <kbd className="rounded-[6px] bg-white/5 px-2 py-1 font-mono text-white/30 border border-white/5 shadow-inner">↵</kbd>
                    <span>Execute</span>
                  </span>
                </div>
                <div className="flex items-center gap-2.5 text-[11px] font-black uppercase tracking-[0.15em] text-white/15">
                  <span className="text-[10px] opacity-50">Powered by</span>
                  <span className="text-primary/60 tracking-[0.3em]">AI Intelligence</span>
                </div>
              </div>
            </Command>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
