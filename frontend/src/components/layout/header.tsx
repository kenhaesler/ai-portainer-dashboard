import { useLocation } from 'react-router-dom';
import { Sun, Moon, Search, LogOut, User } from 'lucide-react';
import { useAuth } from '@/providers/auth-provider';
import { useThemeStore } from '@/stores/theme-store';
import { useUiStore } from '@/stores/ui-store';
import { cn } from '@/lib/utils';
import { useState, useRef, useEffect } from 'react';

const routeLabels: Record<string, string> = {
  '/': 'Home',
  '/workloads': 'Workload Explorer',
  '/fleet': 'Fleet Overview',
  '/stacks': 'Stack Overview',
  '/health': 'Container Health',
  '/images': 'Image Footprint',
  '/topology': 'Network Topology',
  '/ai-monitor': 'AI Monitor',
  '/metrics': 'Metrics Dashboard',
  '/remediation': 'Remediation',
  '/traces': 'Trace Explorer',
  '/assistant': 'LLM Assistant',
  '/edge-logs': 'Edge Agent Logs',
  '/settings': 'Settings',
};


export function Header() {
  const location = useLocation();
  const { username, logout } = useAuth();
  const { theme, setTheme } = useThemeStore();
  const setCommandPaletteOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Check if the current route is a container detail page
  const containerDetailMatch = location.pathname.match(/^\/containers\/(\d+)\/([a-f0-9]+)$/);

  let currentLabel = routeLabels[location.pathname] || 'Dashboard';
  let breadcrumbs = [
    { label: 'Dashboard', path: '/' },
    ...(location.pathname !== '/'
      ? [{ label: currentLabel, path: location.pathname }]
      : []),
  ];

  // Handle dynamic container detail breadcrumbs
  if (containerDetailMatch) {
    breadcrumbs = [
      { label: 'Dashboard', path: '/' },
      { label: 'Workload Explorer', path: '/workloads' },
      { label: 'Container Details', path: location.pathname },
    ];
  }

  // Close user menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        userMenuRef.current &&
        !userMenuRef.current.contains(event.target as Node)
      ) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header className="mx-2 mt-2 flex h-12 shrink-0 items-center justify-between rounded-2xl bg-background/80 backdrop-blur-xl shadow-lg ring-1 ring-black/5 dark:ring-white/10 px-4">
      {/* Breadcrumbs */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm">
        {breadcrumbs.map((crumb, index) => (
          <span key={crumb.path} className="flex items-center gap-1.5">
            {index > 0 && (
              <span className="text-muted-foreground">/</span>
            )}
            <span
              className={cn(
                index === breadcrumbs.length - 1
                  ? 'font-medium text-foreground'
                  : 'text-muted-foreground'
              )}
            >
              {crumb.label}
            </span>
          </span>
        ))}
      </nav>

      {/* Right-side actions */}
      <div className="flex items-center gap-2">
        {/* Command palette trigger */}
        <button
          onClick={() => setCommandPaletteOpen(true)}
          className="flex items-center gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <Search className="h-4 w-4" />
          <span className="hidden sm:inline">Search...</span>
          <kbd className="pointer-events-none hidden select-none rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs sm:inline-block">
            {navigator.platform.includes('Mac') ? '\u2318' : 'Ctrl+'}K
          </kbd>
        </button>

        {/* Theme toggle - pill style */}
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="relative flex h-8 w-16 items-center rounded-full bg-muted p-1 transition-colors"
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        >
          <span
            className={cn(
              'absolute h-6 w-6 rounded-full bg-background shadow-sm transition-all duration-200',
              theme === 'dark' ? 'translate-x-8' : 'translate-x-0'
            )}
          />
          <Sun className={cn(
            'relative z-10 h-4 w-4 transition-colors',
            theme === 'dark' ? 'text-muted-foreground' : 'text-amber-500'
          )} />
          <Moon className={cn(
            'relative z-10 ml-auto h-4 w-4 transition-colors',
            theme === 'dark' ? 'text-blue-400' : 'text-muted-foreground'
          )} />
        </button>

        {/* User menu */}
        <div ref={userMenuRef} className="relative">
          <button
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
          >
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <User className="h-3.5 w-3.5" />
            </div>
            <span className="hidden font-medium sm:inline">
              {username || 'User'}
            </span>
          </button>

          {userMenuOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-md border border-border bg-popover p-1 shadow-lg">
              <div className="px-2 py-1.5 text-sm text-muted-foreground">
                Signed in as <span className="font-medium text-foreground">{username}</span>
              </div>
              <div className="my-1 h-px bg-border" />
              <button
                onClick={() => {
                  setUserMenuOpen(false);
                  logout();
                }}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive transition-colors hover:bg-accent"
              >
                <LogOut className="h-4 w-4" />
                Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
