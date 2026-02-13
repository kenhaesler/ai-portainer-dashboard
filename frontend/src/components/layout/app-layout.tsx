import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Navigate, Outlet, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { useAuth } from '@/providers/auth-provider';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { MobileBottomNav } from '@/components/layout/mobile-bottom-nav';
import { CommandPalette } from '@/components/layout/command-palette';
import { ActivityFeed } from '@/components/shared/activity-feed';
import { KeyboardShortcutsOverlay } from '@/components/shared/keyboard-shortcuts-overlay';
import { DashboardBackground } from '@/components/layout/dashboard-background';
import { useUiStore } from '@/stores/ui-store';
import { useThemeStore, themeOptions } from '@/stores/theme-store';
import { cn } from '@/lib/utils';
import { useKeyboardShortcut } from '@/hooks/use-keyboard-shortcut';
import { useEntrancePlayed } from '@/hooks/use-entrance-played';
import { useKeyChord } from '@/hooks/use-key-chord';
import type { ChordBinding } from '@/hooks/use-key-chord';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

function getRouteDepth(pathname: string): number {
  return pathname.split('/').filter(Boolean).length;
}

export function getDesktopMainPaddingClass(): 'md:pb-12' {
  return 'md:pb-12';
}

export function AppLayout() {
  const { isAuthenticated } = useAuth();
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const potatoMode = useUiStore((s) => s.potatoMode);
  const { commandPaletteOpen, setCommandPaletteOpen } = useUiStore();
  const setSidebarCollapsed = useUiStore((s) => s.setSidebarCollapsed);
  const { theme, setTheme, dashboardBackground } = useThemeStore();
  const hasAnimatedBg = dashboardBackground !== 'none' && !potatoMode;
  const navigate = useNavigate();
  const location = useLocation();
  const navigationType = useNavigationType();
  const reducedMotion = useReducedMotion();
  const disableVisualMotion = reducedMotion || potatoMode;
  const [direction, setDirection] = useState(1);
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

  // Vim-style g+key chord navigation
  const chordBindings: ChordBinding[] = useMemo(
    () => [
      { keys: 'gh', action: () => navigate('/'), label: 'Go to Home' },
      { keys: 'gw', action: () => navigate('/workloads'), label: 'Go to Workloads' },
      { keys: 'gf', action: () => navigate('/fleet'), label: 'Go to Fleet' },
      { keys: 'gl', action: () => navigate('/health'), label: 'Go to Health' },
      { keys: 'gi', action: () => navigate('/images'), label: 'Go to Images' },
      { keys: 'gn', action: () => navigate('/topology'), label: 'Go to Network Topology' },
      { keys: 'ga', action: () => navigate('/ai-monitor'), label: 'Go to AI Monitor' },
      { keys: 'gm', action: () => navigate('/metrics'), label: 'Go to Metrics' },
      { keys: 'gr', action: () => navigate('/remediation'), label: 'Go to Remediation' },
      { keys: 'ge', action: () => navigate('/traces'), label: 'Go to Trace Explorer' },
      { keys: 'gx', action: () => navigate('/assistant'), label: 'Go to LLM Assistant' },
      { keys: 'go', action: () => navigate('/edge-logs'), label: 'Go to Edge Logs' },
      { keys: 'gv', action: () => navigate('/logs'), label: 'Go to Log Viewer' },
      { keys: 'gs', action: () => navigate('/settings'), label: 'Go to Settings' },
    ],
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
      setCommandPaletteOpen(!commandPaletteOpen);
    },
    [commandPaletteOpen],
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
    <motion.div
      data-animated-bg={hasAnimatedBg || undefined}
      data-potato-mode={potatoMode || undefined}
      className="relative flex h-screen overflow-hidden bg-background"
      initial={showEntrance ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      transition={{ duration: showEntrance ? 0.3 : 0 }}
    >
      <DashboardBackground />
      {/* Sidebar — hidden on mobile, spring entrance from left */}
      <motion.div
        className="hidden md:block"
        initial={showEntrance ? { x: -80, opacity: 0 } : false}
        animate={{ x: 0, opacity: 1 }}
        transition={
          showEntrance
            ? { type: 'spring', stiffness: 260, damping: 25, delay: 0.1 }
            : { duration: 0 }
        }
      >
        <Sidebar />
      </motion.div>
      <div
        className={cn(
          'relative z-10 flex flex-1 flex-col overflow-hidden transition-all duration-300',
          'md:ml-[4.5rem]',
          !sidebarCollapsed && 'md:ml-[16rem]',
        )}
      >
        {/* Header — drops in from top */}
        <motion.div
          initial={showEntrance ? { y: -20, opacity: 0 } : false}
          animate={{ y: 0, opacity: 1 }}
          transition={
            showEntrance
              ? { duration: 0.3, ease: [0.32, 0.72, 0, 1], delay: 0.2 }
              : { duration: 0 }
          }
        >
          <Header />
        </motion.div>

        {/* Main content — fades in from bottom */}
        <motion.main
          className={cn(
            'flex-1 overflow-y-auto p-3 pb-36 md:p-4',
            getDesktopMainPaddingClass(),
          )}
          initial={showEntrance ? { y: 12, opacity: 0 } : false}
          animate={{ y: 0, opacity: 1 }}
          transition={
            showEntrance
              ? { duration: 0.35, ease: [0.32, 0.72, 0, 1], delay: 0.3 }
              : { duration: 0 }
          }
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location.pathname}
              className="h-auto"
              custom={direction}
              initial={disableVisualMotion ? false : 'initial'}
              animate={disableVisualMotion ? undefined : 'animate'}
              exit={disableVisualMotion ? undefined : 'exit'}
              variants={disableVisualMotion ? undefined : {
                initial: (currentDirection: number) => ({
                  opacity: 0,
                  x: currentDirection > 0 ? 24 : -24,
                }),
                animate: {
                  opacity: 1,
                  x: 0,
                  transition: { duration: 0.24, ease: [0.32, 0.72, 0, 1] },
                },
                exit: (currentDirection: number) => ({
                  opacity: 0,
                  x: currentDirection > 0 ? -18 : 18,
                  transition: { duration: 0.2, ease: [0.32, 0.72, 0, 1] },
                }),
              }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </motion.main>
      </div>
      {/* Mobile bottom nav — visible only on mobile */}
      <MobileBottomNav />
      <CommandPalette />
      <ActivityFeed />
      <KeyboardShortcutsOverlay
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />
    </motion.div>
  );
}
