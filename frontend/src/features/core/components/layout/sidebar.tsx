import { useRef, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Boxes,
  Server,
  HeartPulse,
  PackageOpen,
  Network,
  BarChart3,
  Shield,
  ShieldAlert,
  GitBranch,
  MessageSquare,
  Activity,
  FileBarChart,
  ScrollText,
  FileSearch,
  Radio,
  Bug,
  Settings,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { SidebarLogo } from '@/shared/components/icons/sidebar-logo';
import { useUiStore } from '@/stores/ui-store';
import { useThemeStore } from '@/stores/theme-store';
import { useRemediationActions } from '@/features/operations/hooks/use-remediation';
import { useHarborEnabled } from '@/features/security/hooks/use-harbor-vulnerabilities';
import { usePrefetch } from '@/shared/hooks/use-prefetch';
import { cn } from '@/shared/lib/utils';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';

interface NavItem {
  label: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
  /** When true, the item is hidden from the sidebar. */
  hidden?: boolean;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

// Grouped by operator intent: what's running -> is it healthy -> why ->
// ask the AI -> security posture -> act. Remediation is the one mutating
// workflow and lives alone under Operations to keep the observer-first
// separation between looking and acting. Settings is pinned separately
// (see `settingsItem`), out of the themed groups.
const navigation: NavGroup[] = [
  {
    title: 'Overview',
    items: [
      { label: 'Home', to: '/', icon: LayoutDashboard },
      { label: 'Workload Explorer', to: '/workloads', icon: Boxes },
      { label: 'Infrastructure', to: '/infrastructure', icon: Server },
      { label: 'Image Footprint', to: '/images', icon: PackageOpen },
    ],
  },
  {
    title: 'Monitoring',
    items: [
      { label: 'Health & Monitoring', to: '/health', icon: HeartPulse },
      { label: 'Metrics Dashboard', to: '/metrics', icon: BarChart3 },
    ],
  },
  {
    title: 'Diagnostics',
    items: [
      { label: 'Trace Explorer', to: '/traces', icon: GitBranch },
      { label: 'eBPF Coverage', to: '/ebpf-coverage', icon: Bug },
      { label: 'Network Topology', to: '/topology', icon: Network },
      { label: 'Packet Capture', to: '/packet-capture', icon: Radio },
      { label: 'Log Viewer', to: '/logs', icon: ScrollText },
      { label: 'Edge Agent Logs', to: '/edge-logs', icon: FileSearch },
    ],
  },
  {
    title: 'Intelligence',
    items: [
      { label: 'LLM Assistant', to: '/assistant', icon: MessageSquare },
      { label: 'LLM Observability', to: '/llm-observability', icon: Activity },
    ],
  },
  {
    title: 'Security',
    items: [
      { label: 'Security Audit', to: '/security/audit', icon: Shield },
      { label: 'Vulnerabilities', to: '/security/vulnerabilities', icon: ShieldAlert },
    ],
  },
  {
    title: 'Operations',
    items: [
      { label: 'Remediation', to: '/remediation', icon: Shield },
      { label: 'Reports', to: '/reports', icon: FileBarChart },
    ],
  },
];

// Pinned at the foot of the sidebar, separated from the themed groups.
const settingsItem: NavItem = { label: 'Settings', to: '/settings', icon: Settings };

function AnimatedBadge({ count }: { count: number }) {
  const prevCountRef = useRef(count);
  const [animate, setAnimate] = useState(false);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (count !== prevCountRef.current && count > 0) {
      setAnimate(true);
      const timer = setTimeout(() => setAnimate(false), 300);
      prevCountRef.current = count;
      return () => clearTimeout(timer);
    }
    prevCountRef.current = count;
  }, [count]);

  if (count <= 0) return null;

  return (
    <motion.span
      className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-xs font-medium text-destructive-foreground"
      animate={
        animate && !reducedMotion
          ? { scale: [1, 1.3, 1] }
          : { scale: 1 }
      }
      transition={{ duration: 0.3, ease: 'easeOut' }}
      data-testid="sidebar-badge"
    >
      {count}
    </motion.span>
  );
}

function ScrollGradient({ navRef }: { navRef: React.RefObject<HTMLElement | null> }) {
  const [showBottom, setShowBottom] = useState(false);

  useEffect(() => {
    const el = navRef.current;
    if (!el) return;

    const check = () => {
      const hasOverflow = el.scrollHeight > el.clientHeight;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
      setShowBottom(hasOverflow && !atBottom);
    };

    check();
    el.addEventListener('scroll', check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);

    return () => {
      el.removeEventListener('scroll', check);
      ro.disconnect();
    };
  }, [navRef]);

  if (!showBottom) return null;

  return (
    <div
      className="pointer-events-none absolute bottom-12 left-0 right-0 h-8 bg-gradient-to-t from-sidebar-background/40 to-transparent"
      aria-hidden="true"
      data-testid="scroll-gradient"
    />
  );
}

function NavLink({
  item,
  isActive,
  collapsed,
  reducedMotion,
  pendingCount,
  onPrefetch,
  onNavigate,
}: {
  item: NavItem;
  isActive: boolean;
  collapsed: boolean;
  reducedMotion: boolean | null;
  pendingCount: number;
  onPrefetch?: () => void;
  onNavigate: () => void;
}) {
  const link = (
    <button
      type="button"
      className={cn(
        'relative flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm font-medium transition-colors duration-200',
        isActive
          ? 'text-sidebar-accent-foreground'
          : 'text-sidebar-foreground hover:bg-sidebar-background/45 hover:text-sidebar-accent-foreground',
        collapsed && 'justify-center px-0'
      )}
      onMouseEnter={onPrefetch}
      onFocus={onPrefetch}
      onClick={onNavigate}
    >
      <>
        {isActive && (
          <motion.span
            layoutId="sidebar-active-pill"
            data-testid="sidebar-active-indicator"
            className="absolute inset-0 -z-10 rounded-md bg-sidebar-background/55 shadow-sm ring-1 ring-sidebar-border/60 backdrop-blur-sm"
            transition={
              reducedMotion
                ? { duration: 0 }
                : { type: 'spring', stiffness: 400, damping: 30 }
            }
          />
        )}
        <motion.span
          className="shrink-0"
          layout={!reducedMotion}
          transition={
            reducedMotion
              ? { duration: 0 }
              : { type: 'spring', stiffness: 300, damping: 25 }
          }
        >
          <item.icon className="h-4 w-4" />
        </motion.span>
        <AnimatePresence>
          {!collapsed && (
            <motion.span
              className="flex flex-1 items-center gap-1 truncate"
              initial={reducedMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={
                reducedMotion
                  ? { duration: 0 }
                  : { duration: 0.1, ease: 'easeOut' }
              }
            >
              <span className="truncate">{item.label}</span>
              {item.to === '/remediation' ? (
                <AnimatedBadge count={pendingCount} />
              ) : item.badge != null && item.badge > 0 ? (
                <AnimatedBadge count={item.badge} />
              ) : null}
            </motion.span>
          )}
        </AnimatePresence>
      </>
    </button>
  );

  return (
    <li>
      {collapsed ? (
        <TooltipPrimitive.Root>
          <TooltipPrimitive.Trigger asChild>{link}</TooltipPrimitive.Trigger>
          <TooltipPrimitive.Portal>
            <TooltipPrimitive.Content
              side="right"
              sideOffset={8}
              className="z-50 rounded-md bg-popover px-3 py-1.5 text-xs font-medium text-popover-foreground shadow-md"
            >
              {item.label}
              <TooltipPrimitive.Arrow className="fill-popover" />
            </TooltipPrimitive.Content>
          </TooltipPrimitive.Portal>
        </TooltipPrimitive.Root>
      ) : (
        link
      )}
    </li>
  );
}

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const collapsedGroups = useUiStore((s) => s.collapsedGroups);
  const toggleGroup = useUiStore((s) => s.toggleGroup);
  const potatoMode = useUiStore((s) => s.potatoMode);
  const dashboardBackground = useThemeStore((s) => s.dashboardBackground);
  const { data: pendingActions } = useRemediationActions('pending');
  const pendingCount = pendingActions?.length ?? 0;
  const { data: harborEnabled } = useHarborEnabled();
  const reducedMotion = useReducedMotion();
  const navRef = useRef<HTMLElement>(null);
  const hasAnimatedBg = dashboardBackground !== 'none';
  const { prefetchContainers, prefetchEndpoints, prefetchDashboard, prefetchImages, prefetchStacks } = usePrefetch();

  // Wrap prefetch in requestIdleCallback to avoid blocking hover interactions
  const idlePrefetch = (fn: (() => void) | undefined) => {
    if (!fn) return undefined;
    return () => {
      if ('requestIdleCallback' in window) {
        requestIdleCallback(() => fn());
      } else {
        setTimeout(fn, 0);
      }
    };
  };

  const prefetchMap: Record<string, (() => void) | undefined> = {
    '/': idlePrefetch(prefetchDashboard),
    '/workloads': idlePrefetch(prefetchContainers),
    '/infrastructure': idlePrefetch(() => { prefetchEndpoints(); prefetchStacks(); }),
    '/health': idlePrefetch(prefetchContainers),
    '/images': idlePrefetch(prefetchImages),
  };

  // Compute effective nav — hide items that are feature-gated
  const effectiveNavigation = navigation.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      if (item.to === '/security/vulnerabilities') {
        return harborEnabled?.enabled === true;
      }
      return !item.hidden;
    }),
  }));

  const isItemActive = (to: string) =>
    to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);

  const handleNavigate = (to: string) => {
    if (to === '/') {
      window.location.assign('/');
      return;
    }
    navigate(to, { state: { source: 'sidebar-nav', ts: Date.now() } });
  };

  return (
    <TooltipPrimitive.Provider delayDuration={200}>
      <aside
        data-testid="sidebar"
        data-animated-bg={hasAnimatedBg || undefined}
        className={cn(
          'fixed left-4 top-4 bottom-4 z-30 flex flex-col rounded-2xl bg-sidebar-background/80 backdrop-blur-xl shadow-lg ring-1 ring-black/5 dark:ring-white/10',
          !potatoMode && 'transition-[width,background-color] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
          sidebarCollapsed ? 'w-16' : 'w-64'
        )}
      >
        {/* Brand */}
        <div className="flex h-14 items-center px-4">
          <div className="flex items-center gap-2 overflow-hidden">
            <motion.div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground"
              layout={!reducedMotion}
              transition={
                reducedMotion
                  ? { duration: 0 }
                  : { type: 'spring', stiffness: 300, damping: 25 }
              }
            >
              <SidebarLogo />
            </motion.div>
            <AnimatePresence>
              {!sidebarCollapsed && (
                <motion.div
                  className="flex flex-col"
                  initial={reducedMotion ? false : { opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  transition={
                    reducedMotion
                      ? { duration: 0 }
                      : { duration: 0.15, ease: 'easeOut' }
                  }
                >
                  <span className="truncate text-sm font-semibold text-sidebar-foreground">
                    Docker Insights
                  </span>
                  <span className="text-[10px] text-muted-foreground">powered by AI</span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Navigation */}
        <nav ref={navRef} className="relative flex-1 overflow-y-auto py-4">
          {effectiveNavigation.map((group, groupIndex) => {
            const isGroupCollapsed = collapsedGroups[group.title] && !sidebarCollapsed;
            return (
              <div key={group.title} className="mb-2">
                {sidebarCollapsed ? (
                  groupIndex > 0 ? (
                    <div className="mx-3 my-2 h-px bg-border/50" role="separator" />
                  ) : null
                ) : (
                  <button
                    onClick={() => toggleGroup(group.title)}
                    className="mb-1 flex w-full items-center justify-between border-b border-border/20 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <span>{group.title}</span>
                    <motion.span
                      animate={{ rotate: isGroupCollapsed ? -90 : 0 }}
                      transition={
                        reducedMotion
                          ? { duration: 0 }
                          : { duration: 0.2, ease: 'easeOut' }
                      }
                    >
                      <ChevronDown className="h-3 w-3" />
                    </motion.span>
                  </button>
                )}
                <div
                  className={cn(
                    'grid transition-all duration-200 ease-in-out',
                    isGroupCollapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'
                  )}
                >
                  <ul className="space-y-0.5 overflow-hidden px-2">
                    {group.items.map((item) => (
                      <NavLink
                        key={item.to}
                        item={item}
                        isActive={isItemActive(item.to)}
                        collapsed={sidebarCollapsed}
                        reducedMotion={reducedMotion}
                        pendingCount={pendingCount}
                        onPrefetch={prefetchMap[item.to]}
                        onNavigate={() => handleNavigate(item.to)}
                      />
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
          <ScrollGradient navRef={navRef} />
        </nav>

        {/* Settings — pinned at the foot, separated from the themed groups */}
        <div className="border-t border-border/30 px-2 pt-2">
          <ul className="space-y-0.5">
            <NavLink
              item={settingsItem}
              isActive={isItemActive(settingsItem.to)}
              collapsed={sidebarCollapsed}
              reducedMotion={reducedMotion}
              pendingCount={pendingCount}
              onNavigate={() => handleNavigate(settingsItem.to)}
            />
          </ul>
        </div>

        {/* Collapse toggle */}
        <div className="p-2">
          <button
            onClick={toggleSidebar}
            className="flex w-full items-center justify-center rounded-md p-2 text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <motion.span
              animate={{ rotate: sidebarCollapsed ? 0 : 180 }}
              transition={
                reducedMotion
                  ? { duration: 0 }
                  : { type: 'spring', stiffness: 300, damping: 25 }
              }
            >
              <ChevronRight className="h-4 w-4" />
            </motion.span>
          </button>
        </div>
      </aside>
    </TooltipPrimitive.Provider>
  );
}
