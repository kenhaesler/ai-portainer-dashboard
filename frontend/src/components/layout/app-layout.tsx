import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Navigate, Outlet, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { useAuth } from '@/providers/auth-provider';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { MobileBottomNav } from '@/components/layout/mobile-bottom-nav';
import { CommandPalette } from '@/components/layout/command-palette';
import { KeyboardShortcutsOverlay } from '@/components/shared/keyboard-shortcuts-overlay';
import { useUiStore } from '@/stores/ui-store';
import { useThemeStore, themeOptions } from '@/stores/theme-store';
import { cn } from '@/lib/utils';
import { useKeyboardShortcut } from '@/hooks/use-keyboard-shortcut';
import { useKeyChord } from '@/hooks/use-key-chord';
import type { ChordBinding } from '@/hooks/use-key-chord';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

function getRouteDepth(pathname: string): number {
  return pathname.split('/').filter(Boolean).length;
}

export function AppLayout() {
  const { isAuthenticated } = useAuth();
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const { commandPaletteOpen, setCommandPaletteOpen } = useUiStore();
  const setSidebarCollapsed = useUiStore((s) => s.setSidebarCollapsed);
  const { theme, setTheme } = useThemeStore();
  const navigate = useNavigate();
  const location = useLocation();
  const navigationType = useNavigationType();
  const reducedMotion = useReducedMotion();
  const [direction, setDirection] = useState(1);
  const previousDepthRef = useRef(getRouteDepth(location.pathname));
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

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

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar — hidden on mobile */}
      <div className="hidden md:block">
        <Sidebar />
      </div>
      <div
        className={cn(
          'flex flex-1 flex-col overflow-hidden transition-all duration-300',
          'md:ml-[4.5rem]',
          !sidebarCollapsed && 'md:ml-[16rem]',
        )}
      >
        <Header />
        <main className="flex-1 overflow-y-auto p-3 pb-20 md:p-4 md:pb-4">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location.pathname}
              className="h-full"
              custom={direction}
              initial={reducedMotion ? false : 'initial'}
              animate="animate"
              exit="exit"
              variants={{
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
        </main>
      </div>
      {/* Mobile bottom nav — visible only on mobile */}
      <MobileBottomNav />
      <CommandPalette />
      <KeyboardShortcutsOverlay
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />
    </div>
  );
}
