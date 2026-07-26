import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation, useNavigate, useNavigationType, useOutlet } from 'react-router-dom';
import { useAuth } from '@/providers/auth-provider';
import { Sidebar } from '@/features/core/components/layout/sidebar';
import { Header } from '@/features/core/components/layout/header';
import { MobileBottomNav } from '@/features/core/components/layout/mobile-bottom-nav';
import { CommandPalette } from '@/features/core/components/layout/command-palette';
import { KeyboardShortcutsOverlay } from '@/shared/components/ui/keyboard-shortcuts-overlay';
import { DashboardBackground } from '@/features/core/components/layout/dashboard-background';
import { useUiStore } from '@/stores/ui-store';
import { useThemeStore, themeOptions } from '@/stores/theme-store';
import { cn } from '@/shared/lib/utils';
import { useKeyboardShortcut } from '@/shared/hooks/use-keyboard-shortcut';
import { useEntrancePlayed } from '@/shared/hooks/use-entrance-played';
import { useKeyChord } from '@/shared/hooks/use-key-chord';
import type { ChordBinding } from '@/shared/hooks/use-key-chord';
import { AnimatePresence, m, useReducedMotion } from 'framer-motion';
import { ErrorBoundary } from '@/shared/components/feedback/error-boundary';
import {
  breadcrumbLabelForPath,
  NAV_CHORDS,
} from '@/features/core/lib/navigation-manifest';

/**
 * Catches render errors thrown by the active page so one failing route
 * degrades to an inline error card instead of unmounting the whole shell
 * (sidebar + header). It sits BELOW AppLayout in the tree, so the chrome
 * survives, and renders inside the route-keyed wrapper, so it resets
 * automatically on navigation. (#1420)
 */
function PageBoundary({ children }: { children: ReactNode }) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}

/**
 * Freezes the Outlet content at mount-time so that during AnimatePresence exit
 * the old route's component stays rendered instead of being replaced by the
 * incoming route. This prevents double-mounting of heavy pages (like Image
 * Footprint) which causes conflicting animations and stalls mode="wait".
 */
function FrozenOutlet() {
  const currentOutlet = useOutlet();
  const [outlet] = useState(currentOutlet);
  return outlet;
}

function getRouteDepth(pathname: string): number {
  return pathname.split('/').filter(Boolean).length;
}

/**
 * `g`-chord key assignments, re-exported for existing importers.
 *
 * The definition lives in the navigation manifest alongside the destinations it
 * points at. It was briefly declared here, which created a cycle: the keyboard
 * shortcuts overlay needs the chords to label itself, and this module imports
 * that overlay — so `NAV_CHORDS` read as `undefined` at module-init time
 * whenever the graph was entered through the router.
 */
export { NAV_CHORDS };

/**
 * True between 768px and 1023px. At 820px the full 256px sidebar spent ~37%
 * of the viewport on navigation, which is why the workloads table showed two
 * columns there. The 64px icon rail (with its tooltips) already existed;
 * this just switches to it automatically and gives 192px back.
 */
export function useTabletRail(): boolean {
  const [isRail, setIsRail] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(min-width: 768px) and (max-width: 1023px)');
    const update = () => setIsRail(mql.matches);
    update();
    mql.addEventListener?.('change', update);
    return () => mql.removeEventListener?.('change', update);
  }, []);

  return isRail;
}

export function AppLayout() {
  const { isAuthenticated } = useAuth();
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const potatoMode = useUiStore((s) => s.potatoMode);
  // Per-field selectors (#1529): a whole-store subscription re-rendered the
  // entire app shell on every ui-store write (sidebar group toggles, page
  // view-mode changes) that AppLayout never reads.
  const commandPaletteOpen = useUiStore((s) => s.commandPaletteOpen);
  const setCommandPaletteOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const setSidebarCollapsed = useUiStore((s) => s.setSidebarCollapsed);
  const { theme, setTheme, dashboardBackground } = useThemeStore();
  const hasAnimatedBg = dashboardBackground !== 'none' && !potatoMode;
  const navigate = useNavigate();
  const location = useLocation();
  const navigationType = useNavigationType();
  const reducedMotion = useReducedMotion();
  const disableVisualMotion = reducedMotion || potatoMode;
  const [direction, setDirection] = useState(1);
  const tabletRail = useTabletRail();
  const railMode = sidebarCollapsed || tabletRail;
  const previousDepthRef = useRef(getRouteDepth(location.pathname));
  const { hasPlayed, markPlayed } = useEntrancePlayed();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // Skip entrance on click/keypress
  useEffect(() => {
    if (hasPlayed || disableVisualMotion) return;

    const skipEntrance = () => markPlayed();
    window.addEventListener('click', skipEntrance, { once: true });
    window.addEventListener('keydown', skipEntrance, { once: true });

    // Auto-mark played after entrance completes (1200ms)
    const timer = setTimeout(markPlayed, 1200);

    return () => {
      window.removeEventListener('click', skipEntrance);
      window.removeEventListener('keydown', skipEntrance);
      clearTimeout(timer);
    };
  }, [disableVisualMotion, hasPlayed, markPlayed]);

  // Vim-style g+key chord navigation. Only the key assignment lives here —
  // the destination's name comes from the route manifest, so the overlay can
  // never disagree with the sidebar about what a page is called.
  const chordBindings: ChordBinding[] = useMemo(
    () =>
      NAV_CHORDS.map(([keys, path]) => ({
        keys,
        action: () => navigate(path),
        label: `Go to ${breadcrumbLabelForPath(path) ?? path}`,
      })),
    [navigate],
  );

  useKeyChord(chordBindings);

  // Quick action: ? to toggle shortcuts overlay
  const handleQuickKeys = useCallback(
    (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const isEditable =
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.isContentEditable);
      if (isEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.key;

      if (key === '?') {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
        return;
      }

      // Don't fire quick actions when overlays are open
      if (shortcutsOpen || commandPaletteOpen) return;

      if (key === 'r') {
        e.preventDefault();
        // Dispatch a custom event that page components can listen for
        window.dispatchEvent(new CustomEvent('keyboard:refresh'));
        return;
      }

      if (key === 't') {
        e.preventDefault();
        const currentIdx = themeOptions.findIndex((o) => o.value === theme);
        const nextIdx = (currentIdx + 1) % themeOptions.length;
        setTheme(themeOptions[nextIdx].value);
        return;
      }

      if (key === '[') {
        e.preventDefault();
        setSidebarCollapsed(true);
        return;
      }

      if (key === ']') {
        e.preventDefault();
        setSidebarCollapsed(false);
        return;
      }
    },
    [shortcutsOpen, commandPaletteOpen, theme, setTheme, setSidebarCollapsed],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleQuickKeys);
    return () => window.removeEventListener('keydown', handleQuickKeys);
  }, [handleQuickKeys]);

  // Command palette: Cmd+K / Ctrl+K
  useKeyboardShortcut(
    [{ key: 'k', metaKey: true }, { key: 'k', ctrlKey: true }],
    () => {
      // Read fresh value from store to avoid stale closure
      const currentOpen = useUiStore.getState().commandPaletteOpen;
      setCommandPaletteOpen(!currentOpen);
    },
    [setCommandPaletteOpen],
  );

  // Page transition direction
  useEffect(() => {
    const currentDepth = getRouteDepth(location.pathname);
    if (navigationType === 'POP') {
      setDirection(-1);
    } else {
      setDirection(currentDepth >= previousDepthRef.current ? 1 : -1);
    }
    previousDepthRef.current = currentDepth;
  }, [location.pathname, navigationType]);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Whether to show entrance animation (first visit this session, no reduced motion)
  const showEntrance = !hasPlayed && !disableVisualMotion;

  return (
    <m.div
      data-animated-bg={hasAnimatedBg || undefined}
      data-potato-mode={potatoMode || undefined}
      className="relative flex h-screen overflow-hidden bg-background"
      initial={showEntrance ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      transition={{ duration: showEntrance ? 0.3 : 0 }}
    >
      <DashboardBackground />
      {/* Sidebar — hidden on mobile, spring entrance from left */}
      <m.div
        className="hidden md:block"
        initial={showEntrance ? { x: -80, opacity: 0 } : false}
        animate={{ x: 0, opacity: 1 }}
        transition={
          showEntrance
            ? { type: 'spring', stiffness: 260, damping: 25, delay: 0.1 }
            : { duration: 0 }
        }
      >
        <Sidebar forceRail={tabletRail} />
      </m.div>
      <div
        data-testid="app-content"
        className={cn(
          'relative z-10 flex flex-1 flex-col overflow-hidden',
          !disableVisualMotion && 'transition-all duration-300',
          railMode ? 'md:ml-[calc(64px+2rem)]' : 'md:ml-[calc(256px+2rem)]',
        )}
      >
        {/* Header — drops in from top */}
        <m.div
          initial={showEntrance ? { y: -20, opacity: 0 } : false}
          animate={{ y: 0, opacity: 1 }}
          transition={
            showEntrance
              ? { duration: 0.3, ease: [0.32, 0.72, 0, 1], delay: 0.2 }
              : { duration: 0 }
          }
        >
          <Header />
        </m.div>

        {/* Main content — fades in from bottom */}
        <m.main
          className="flex-1 overflow-y-auto p-3 pb-36 md:p-4"
          initial={showEntrance ? { y: 12, opacity: 0 } : false}
          animate={{ y: 0, opacity: 1 }}
          transition={
            showEntrance
              ? { duration: 0.35, ease: [0.32, 0.72, 0, 1], delay: 0.3 }
              : { duration: 0 }
          }
        >
          {disableVisualMotion ? (
            <div key={location.pathname} className="h-auto">
              <PageBoundary>
                <Outlet />
              </PageBoundary>
            </div>
          ) : (
            <AnimatePresence mode="wait" initial={false}>
              <m.div
                key={location.pathname}
                className="h-auto"
                custom={direction}
                initial="initial"
                animate="animate"
                exit="exit"
                variants={{
                  initial: (currentDirection: number) => ({
                    opacity: 0,
                    x: currentDirection > 0 ? 16 : -16,
                  }),
                  animate: {
                    opacity: 1,
                    x: 0,
                    transition: { duration: 0.12, ease: [0.32, 0.72, 0, 1] },
                  },
                  exit: (currentDirection: number) => ({
                    opacity: 0,
                    x: currentDirection > 0 ? -12 : 12,
                    transition: { duration: 0.1, ease: [0.32, 0.72, 0, 1] },
                  }),
                }}
              >
                <PageBoundary>
                  <FrozenOutlet />
                </PageBoundary>
              </m.div>
            </AnimatePresence>
          )}
        </m.main>
      </div>
      {/* Mobile bottom nav — visible only on mobile */}
      <MobileBottomNav />
      <CommandPalette />
      <KeyboardShortcutsOverlay
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />
    </m.div>
  );
}
