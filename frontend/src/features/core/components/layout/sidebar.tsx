import { useRef, useEffect, useState } from 'react';
import { useLocation, Link } from 'react-router';
import { ChevronRight, ChevronDown } from 'lucide-react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { SidebarLogo } from '@/shared/components/icons/sidebar-logo';
import { useUiStore } from '@/stores/ui-store';
import { useThemeStore } from '@/stores/theme-store';
import { useRemediationActions } from '@/features/operations/hooks/use-remediation';
import { useHarborEnabled } from '@/features/security/hooks/use-harbor-vulnerabilities';
import { usePrefetch } from '@/shared/hooks/use-prefetch';
import { cn } from '@/shared/lib/utils';
import {
  sidebarNavigation,
  pinnedNavDestinations,
  type NavDestination,
} from '@/features/core/lib/navigation-manifest';
import { m, AnimatePresence, useReducedMotion } from 'framer-motion';
import { PRODUCT_NAME } from '@/shared/lib/product';

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
    <m.span
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
    </m.span>
  );
}

/**
 * Scroll affordance for the nav. The previous cue was an 8px
 * `from-sidebar-background/40` fade — invisible on the eight light themes,
 * which meant two whole groups could sit below the fold at 1440x900 with
 * nothing on screen saying so. This uses a full-opacity fade, a hard rule at
 * the cut line and a chevron, so the cue survives every theme.
 */
function ScrollCue({ navRef }: { navRef: React.RefObject<HTMLElement | null> }) {
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
      className="pointer-events-none sticky bottom-0 left-0 right-0 -mt-10 flex h-10 items-end justify-center border-b border-sidebar-border bg-gradient-to-t from-sidebar-background via-sidebar-background/85 to-transparent"
      aria-hidden="true"
      data-testid="scroll-gradient"
    >
      <ChevronDown className="mb-0.5 h-3.5 w-3.5 text-muted-foreground" />
    </div>
  );
}

function NavItemLink({
  item,
  isActive,
  collapsed,
  reducedMotion,
  pendingCount,
  onPrefetch,
}: {
  item: NavDestination;
  isActive: boolean;
  collapsed: boolean;
  reducedMotion: boolean | null;
  pendingCount: number;
  onPrefetch?: () => void;
}) {
  // A real anchor, not a <button>: middle-click, Cmd-click to a new tab and
  // the hover status-bar preview are the core power-user navigation gestures
  // and none of them exist without an href.
  const link = (
    <Link
      to={item.path}
      state={{ source: 'sidebar-nav' }}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'relative flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm font-medium transition-colors duration-200',
        isActive
          ? 'text-sidebar-accent-foreground'
          : 'text-sidebar-foreground hover:bg-sidebar-background/45 hover:text-sidebar-accent-foreground',
        collapsed && 'justify-center px-0'
      )}
      onMouseEnter={onPrefetch}
      onFocus={onPrefetch}
    >
      <>
        {isActive && (
          <m.span
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
        <m.span
          className="shrink-0"
          layout={!reducedMotion}
          transition={
            reducedMotion
              ? { duration: 0 }
              : { type: 'spring', stiffness: 300, damping: 25 }
          }
        >
          <item.icon className="h-4 w-4" />
        </m.span>
        <AnimatePresence>
          {!collapsed && (
            <m.span
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
              {item.path === '/remediation' ? (
                <AnimatedBadge count={pendingCount} />
              ) : null}
            </m.span>
          )}
        </AnimatePresence>
      </>
    </Link>
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

/**
 * @param forceRail Collapse to the 64px icon rail regardless of the stored
 * preference. AppLayout sets this between 768px and 1023px, where a 256px
 * sidebar costs a third of the viewport.
 */
export function Sidebar({ forceRail = false }: { forceRail?: boolean } = {}) {
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

  const collapsed = sidebarCollapsed || forceRail;

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

  const navigation = sidebarNavigation({ harborEnabled: harborEnabled?.enabled === true });

  const isItemActive = (to: string) =>
    to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);

  return (
    <TooltipPrimitive.Provider delayDuration={200}>
      <aside
        data-testid="sidebar"
        data-animated-bg={hasAnimatedBg || undefined}
        className={cn(
          'fixed left-4 top-4 bottom-4 z-30 flex flex-col rounded-2xl bg-sidebar-background/80 backdrop-blur-xl shadow-lg ring-1 ring-black/5 dark:ring-white/10',
          !potatoMode && 'transition-[width,background-color] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
          collapsed ? 'w-16' : 'w-64'
        )}
      >
        {/* Brand */}
        <div className="flex h-14 items-center px-4">
          <div className="flex items-center gap-2 overflow-hidden">
            <m.div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground"
              layout={!reducedMotion}
              transition={
                reducedMotion
                  ? { duration: 0 }
                  : { type: 'spring', stiffness: 300, damping: 25 }
              }
            >
              <SidebarLogo />
            </m.div>
            <AnimatePresence>
              {!collapsed && (
                <m.div
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
                    {PRODUCT_NAME}
                  </span>
                </m.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Navigation */}
        <nav ref={navRef} aria-label="Primary" className="relative flex-1 overflow-y-auto py-4">
          {navigation.map((group, groupIndex) => {
            const isGroupCollapsed = collapsedGroups[group.title] && !collapsed;
            return (
              <div key={group.title} className="mb-2">
                {collapsed ? (
                  groupIndex > 0 ? (
                    <div className="mx-3 my-2 h-px bg-border/50" role="separator" />
                  ) : null
                ) : (
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.title)}
                    aria-expanded={!isGroupCollapsed}
                    className="mb-1 flex w-full items-center justify-between border-b border-border/20 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <span>{group.title}</span>
                    <m.span
                      animate={{ rotate: isGroupCollapsed ? -90 : 0 }}
                      transition={
                        reducedMotion
                          ? { duration: 0 }
                          : { duration: 0.2, ease: 'easeOut' }
                      }
                    >
                      <ChevronDown className="h-3 w-3" />
                    </m.span>
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
                      <NavItemLink
                        key={item.path}
                        item={item}
                        isActive={isItemActive(item.path)}
                        collapsed={collapsed}
                        reducedMotion={reducedMotion}
                        pendingCount={pendingCount}
                        onPrefetch={prefetchMap[item.path]}
                      />
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
          <ScrollCue navRef={navRef} />
        </nav>

        {/* Settings — pinned at the foot, separated from the themed groups */}
        <div className="border-t border-border/30 px-2 pt-2">
          <ul className="space-y-0.5">
            {pinnedNavDestinations.map((item) => (
              <NavItemLink
                key={item.path}
                item={item}
                isActive={isItemActive(item.path)}
                collapsed={collapsed}
                reducedMotion={reducedMotion}
                pendingCount={pendingCount}
              />
            ))}
          </ul>
        </div>

        {/* Collapse toggle — hidden when the viewport forces the rail */}
        {!forceRail && (
          <div className="p-2">
            <button
              type="button"
              onClick={toggleSidebar}
              className="flex w-full items-center justify-center rounded-md p-2 text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <m.span
                animate={{ rotate: collapsed ? 0 : 180 }}
                transition={
                  reducedMotion
                    ? { duration: 0 }
                    : { type: 'spring', stiffness: 300, damping: 25 }
                }
              >
                <ChevronRight className="h-4 w-4" />
              </m.span>
            </button>
          </div>
        )}
      </aside>
    </TooltipPrimitive.Provider>
  );
}
