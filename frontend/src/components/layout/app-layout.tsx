import { useEffect, useRef, useState } from 'react';
import { Navigate, Outlet, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { useAuth } from '@/providers/auth-provider';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { MobileBottomNav } from '@/components/layout/mobile-bottom-nav';
import { CommandPalette } from '@/components/layout/command-palette';
import { useUiStore } from '@/stores/ui-store';
import { cn } from '@/lib/utils';
import { useKeyboardShortcut } from '@/hooks/use-keyboard-shortcut';
import { useEntrancePlayed } from '@/hooks/use-entrance-played';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

function getRouteDepth(pathname: string): number {
  return pathname.split('/').filter(Boolean).length;
}

export function AppLayout() {
  const { isAuthenticated } = useAuth();
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const { commandPaletteOpen, setCommandPaletteOpen } = useUiStore();
  const navigate = useNavigate();
  const location = useLocation();
  const navigationType = useNavigationType();
  const reducedMotion = useReducedMotion();
  const [direction, setDirection] = useState(1);
  const previousDepthRef = useRef(getRouteDepth(location.pathname));
  const { hasPlayed, markPlayed } = useEntrancePlayed();

  // Skip entrance on click/keypress
  useEffect(() => {
    if (hasPlayed || reducedMotion) return;

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
  }, [hasPlayed, markPlayed, reducedMotion]);

  // Keyboard Shortcuts
  useKeyboardShortcut(
    [{ key: 'k', metaKey: true }, { key: 'k', ctrlKey: true }],
    () => {
      setCommandPaletteOpen(!commandPaletteOpen);
    },
    [commandPaletteOpen]
  );

  useKeyboardShortcut(
    { key: 'h', ctrlKey: true, shiftKey: true },
    () => { navigate('/'); },
    []
  );

  useKeyboardShortcut(
    { key: 'w', ctrlKey: true, shiftKey: true },
    () => { navigate('/workloads'); },
    []
  );

  useKeyboardShortcut(
    { key: 'f', ctrlKey: true, shiftKey: true },
    () => { navigate('/fleet'); },
    []
  );

  useKeyboardShortcut(
    { key: 's', ctrlKey: true, shiftKey: true },
    () => { navigate('/stacks'); },
    []
  );

  useKeyboardShortcut(
    { key: 'l', ctrlKey: true, shiftKey: true },
    () => { navigate('/health'); },
    []
  );

  useKeyboardShortcut(
    { key: 'i', ctrlKey: true, shiftKey: true },
    () => { navigate('/images'); },
    []
  );

  useKeyboardShortcut(
    { key: 't', ctrlKey: true, shiftKey: true },
    () => { navigate('/topology'); },
    []
  );

  useKeyboardShortcut(
    { key: 'a', ctrlKey: true, shiftKey: true },
    () => { navigate('/ai-monitor'); },
    []
  );

  useKeyboardShortcut(
    { key: 'm', ctrlKey: true, shiftKey: true },
    () => { navigate('/metrics'); },
    []
  );

  useKeyboardShortcut(
    { key: 'r', ctrlKey: true, shiftKey: true },
    () => { navigate('/remediation'); },
    []
  );

  useKeyboardShortcut(
    { key: 'e', ctrlKey: true, shiftKey: true },
    () => { navigate('/traces'); },
    []
  );

  useKeyboardShortcut(
    { key: 'x', ctrlKey: true, shiftKey: true },
    () => { navigate('/assistant'); },
    []
  );

  useKeyboardShortcut(
    { key: 'g', ctrlKey: true, shiftKey: true },
    () => { navigate('/edge-logs'); },
    []
  );

  useKeyboardShortcut(
    { key: 'S', ctrlKey: true, shiftKey: true },
    () => { navigate('/settings'); },
    []
  );

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
  const showEntrance = !hasPlayed && !reducedMotion;

  return (
    <motion.div
      className="flex h-screen overflow-hidden bg-background"
      initial={showEntrance ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      transition={{ duration: showEntrance ? 0.3 : 0 }}
    >
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
          'flex flex-1 flex-col overflow-hidden transition-all duration-300',
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
          className="flex-1 overflow-y-auto p-3 pb-20 md:p-4 md:pb-4"
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
        </motion.main>
      </div>
      {/* Mobile bottom nav — visible only on mobile */}
      <MobileBottomNav />
      <CommandPalette />
    </motion.div>
  );
}
