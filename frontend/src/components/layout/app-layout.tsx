import { Navigate, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '@/providers/auth-provider';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { MobileBottomNav } from '@/components/layout/mobile-bottom-nav';
import { CommandPalette } from '@/components/layout/command-palette';
import { useUiStore } from '@/stores/ui-store';
import { cn } from '@/lib/utils';
import { useKeyboardShortcut } from '@/hooks/use-keyboard-shortcut';

export function AppLayout() {
  const { isAuthenticated } = useAuth();
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const { commandPaletteOpen, setCommandPaletteOpen } = useUiStore();
  const navigate = useNavigate();

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
    () => {
      navigate('/');
    },
    []
  );

  useKeyboardShortcut(
    { key: 'w', ctrlKey: true, shiftKey: true },
    () => {
      navigate('/workloads');
    },
    []
  );

  useKeyboardShortcut(
    { key: 'f', ctrlKey: true, shiftKey: true },
    () => {
      navigate('/fleet');
    },
    []
  );

  useKeyboardShortcut(
    { key: 's', ctrlKey: true, shiftKey: true },
    () => {
      navigate('/stacks');
    },
    []
  );

  useKeyboardShortcut(
    { key: 'l', ctrlKey: true, shiftKey: true },
    () => {
      navigate('/health');
    },
    []
  );

  useKeyboardShortcut(
    { key: 'i', ctrlKey: true, shiftKey: true },
    () => {
      navigate('/images');
    },
    []
  );

  useKeyboardShortcut(
    { key: 't', ctrlKey: true, shiftKey: true },
    () => {
      navigate('/topology');
    },
    []
  );

  useKeyboardShortcut(
    { key: 'a', ctrlKey: true, shiftKey: true },
    () => {
      navigate('/ai-monitor');
    },
    []
  );

  useKeyboardShortcut(
    { key: 'm', ctrlKey: true, shiftKey: true },
    () => {
      navigate('/metrics');
    },
    []
  );

  useKeyboardShortcut(
    { key: 'r', ctrlKey: true, shiftKey: true },
    () => {
      navigate('/remediation');
    },
    []
  );

  useKeyboardShortcut(
    { key: 'e', ctrlKey: true, shiftKey: true },
    () => {
      navigate('/traces');
    },
    []
  );

  useKeyboardShortcut(
    { key: 'x', ctrlKey: true, shiftKey: true },
    () => {
      navigate('/assistant');
    },
    []
  );

  useKeyboardShortcut(
    { key: 'g', ctrlKey: true, shiftKey: true },
    () => {
      navigate('/edge-logs');
    },
    []
  );

  useKeyboardShortcut(
    { key: 'S', ctrlKey: true, shiftKey: true },
    () => {
      navigate('/settings');
    },
    []
  );

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
          <Outlet />
        </main>
      </div>
      {/* Mobile bottom nav — visible only on mobile */}
      <MobileBottomNav />
      <CommandPalette />
    </div>
  );
}
