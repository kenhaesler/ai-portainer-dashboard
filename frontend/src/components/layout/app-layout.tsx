import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/providers/auth-provider';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { CommandPalette } from '@/components/layout/command-palette';
import { useUiStore } from '@/stores/ui-store';
import { cn } from '@/lib/utils';

export function AppLayout() {
  const { isAuthenticated } = useAuth();
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div
        className={cn(
          'flex flex-1 flex-col overflow-hidden transition-all duration-300',
          sidebarCollapsed ? 'ml-16' : 'ml-64'
        )}
      >
        <Header />
        <main className="flex-1 overflow-y-auto rounded-tl-2xl border-l border-t border-border bg-background p-6">
          <Outlet />
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}
