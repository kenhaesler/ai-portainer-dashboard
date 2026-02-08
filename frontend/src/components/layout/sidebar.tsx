import { useRef, useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Boxes,
  Ship,
  Layers,
  HeartPulse,
  GitCompareArrows,
  PackageOpen,
  Network,
  Brain,
  BarChart3,
  Shield,
  GitBranch,
  MessageSquare,
  Activity,
  FileBarChart,
  ScrollText,
  FileSearch,
  Radio,
  Settings,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
import { SidebarLogo } from '@/components/icons/sidebar-logo';
import { useUiStore } from '@/stores/ui-store';
import { useThemeStore } from '@/stores/theme-store';
import { useRemediationActions } from '@/hooks/use-remediation';
import { usePrefetch } from '@/hooks/use-prefetch';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';

interface NavItem {
  label: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

export function getSidebarBottomClass(): 'md:bottom-12' {
  return 'md:bottom-12';
}

const navigation: NavGroup[] = [
  {
    title: 'Overview',
    items: [
      { label: 'Home', to: '/', icon: LayoutDashboard },
      { label: 'Workload Explorer', to: '/workloads', icon: Boxes },
      { label: 'Fleet Overview', to: '/fleet', icon: Ship },
      { label: 'Stack Overview', to: '/stacks', icon: Layers },
    ],
  },
  {
    title: 'Containers',
    items: [
      { label: 'Container Health', to: '/health', icon: HeartPulse },
      { label: 'Comparison', to: '/comparison', icon: GitCompareArrows },
      { label: 'Image Footprint', to: '/images', icon: PackageOpen },
      { label: 'Network Topology', to: '/topology', icon: Network },
    ],
  },
  {
    title: 'Intelligence',
    items: [
      { label: 'Metrics Dashboard', to: '/metrics', icon: BarChart3 },
      { label: 'AI Monitor', to: '/ai-monitor', icon: Brain },
      { label: 'Trace Explorer', to: '/traces', icon: GitBranch },
      { label: 'eBPF Coverage', to: '/ebpf-coverage', icon: Radio },
      { label: 'LLM Assistant', to: '/assistant', icon: MessageSquare },
      { label: 'LLM Observability', to: '/llm-observability', icon: Activity },
      { label: 'Remediation', to: '/remediation', icon: Shield },
    ],
  },
  {
    title: 'Operations',
    items: [
      { label: 'Log Viewer', to: '/logs', icon: ScrollText },
      { label: 'Security Audit', to: '/security/audit', icon: Shield },
      { label: 'Edge Agent Logs', to: '/edge-logs', icon: FileSearch },
      { label: 'Packet Capture', to: '/packet-capture', icon: Radio },
      { label: 'Reports', to: '/reports', icon: FileBarChart },
      { label: 'Settings', to: '/settings', icon: Settings },
    ],
  },
];

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

export function Sidebar() {
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const collapsedGroups = useUiStore((s) => s.collapsedGroups);
  const toggleGroup = useUiStore((s) => s.toggleGroup);
  const dashboardBackground = useThemeStore((s) => s.dashboardBackground);
  const { data: pendingActions } = useRemediationActions('pending');
  const pendingCount = pendingActions?.length ?? 0;
  const reducedMotion = useReducedMotion();
  const navRef = useRef<HTMLElement>(null);
  const hasAnimatedBg = dashboardBackground !== 'none';
  const { prefetchContainers, prefetchEndpoints, prefetchDashboard, prefetchImages, prefetchStacks } = usePrefetch();

  const prefetchMap: Record<string, (() => void) | undefined> = {
    '/': prefetchDashboard,
    '/workloads': prefetchContainers,
    '/fleet': prefetchEndpoints,
    '/stacks': prefetchStacks,
    '/health': prefetchContainers,
    '/comparison': prefetchContainers,
    '/images': prefetchImages,
  };

  return (
    <aside
      data-animated-bg={hasAnimatedBg || undefined}
      className={cn(
        'fixed left-4 top-4 bottom-2 z-30 flex flex-col rounded-2xl bg-sidebar-background/80 backdrop-blur-xl shadow-lg ring-1 ring-black/5 dark:ring-white/10 transition-[width,background-color] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
        getSidebarBottomClass(),
        sidebarCollapsed ? 'w-14' : 'w-60'
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
        {navigation.map((group, groupIndex) => {
          const isGroupCollapsed = collapsedGroups[group.title] && !sidebarCollapsed;
          return (
            <div key={group.title} className="mb-2">
              {/* Group header: full title when expanded, thin divider when sidebar collapsed */}
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
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.to === '/'}
                        className={({ isActive }) =>
                          cn(
                            'relative flex items-center gap-3 rounded-md px-2 py-2 text-sm font-medium transition-colors duration-200',
                            isActive
                              ? 'text-sidebar-accent-foreground'
                              : 'text-sidebar-foreground hover:bg-sidebar-background/45 hover:text-sidebar-accent-foreground',
                            sidebarCollapsed && 'justify-center px-0'
                          )
                        }
                        title={sidebarCollapsed ? item.label : undefined}
                        onMouseEnter={prefetchMap[item.to]}
                        onFocus={prefetchMap[item.to]}
                      >
                        {({ isActive }) => (
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
                              {!sidebarCollapsed && (
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
                        )}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          );
        })}
        <ScrollGradient navRef={navRef} />
      </nav>

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
  );
}
