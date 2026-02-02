import { useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Command } from 'cmdk';
import {
  LayoutDashboard,
  Boxes,
  Ship,
  HeartPulse,
  ScrollText,
  PackageOpen,
  Network,
  Brain,
  BarChart3,
  Shield,
  GitBranch,
  MessageSquare,
  FileSearch,
  Settings,
  RefreshCw,
  Palette,
} from 'lucide-react';
import { useUiStore } from '@/stores/ui-store';
import { useThemeStore } from '@/stores/theme-store';
import { cn } from '@/lib/utils';

interface PageEntry {
  label: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
}

const pages: PageEntry[] = [
  { label: 'Home', to: '/', icon: LayoutDashboard },
  { label: 'Workload Explorer', to: '/workloads', icon: Boxes },
  { label: 'Fleet Overview', to: '/fleet', icon: Ship },
  { label: 'Container Health', to: '/health', icon: HeartPulse },
  { label: 'Container Logs', to: '/container-logs', icon: ScrollText },
  { label: 'Image Footprint', to: '/images', icon: PackageOpen },
  { label: 'Network Topology', to: '/topology', icon: Network },
  { label: 'AI Monitor', to: '/ai-monitor', icon: Brain },
  { label: 'Metrics Dashboard', to: '/metrics', icon: BarChart3 },
  { label: 'Remediation', to: '/remediation', icon: Shield },
  { label: 'Trace Explorer', to: '/traces', icon: GitBranch },
  { label: 'LLM Assistant', to: '/assistant', icon: MessageSquare },
  { label: 'Edge Agent Logs', to: '/edge-logs', icon: FileSearch },
  { label: 'Settings', to: '/settings', icon: Settings },
];

export function CommandPalette() {
  const navigate = useNavigate();
  const open = useUiStore((s) => s.commandPaletteOpen);
  const setOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const { theme, setTheme } = useThemeStore();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(!open);
      }
    },
    [open, setOpen]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const navigateTo = (path: string) => {
    navigate(path);
    setOpen(false);
  };

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark';
    setTheme(next);
    setOpen(false);
  };

  const refresh = () => {
    window.location.reload();
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50"
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />

      {/* Command dialog */}
      <div className="relative z-50 w-full max-w-lg overflow-hidden rounded-xl border border-border bg-popover shadow-2xl">
        <Command
          className="flex flex-col"
          onKeyDown={(e: React.KeyboardEvent) => {
            if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
        >
          <div className="flex items-center border-b border-border px-3">
            <Command.Input
              placeholder="Type a command or search..."
              className={cn(
                'flex h-12 w-full bg-transparent py-3 text-sm text-foreground outline-none',
                'placeholder:text-muted-foreground'
              )}
              autoFocus
            />
          </div>

          <Command.List className="max-h-72 overflow-y-auto p-2">
            <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
              No results found.
            </Command.Empty>

            <Command.Group
              heading="Pages"
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
            >
              {pages.map((page) => (
                <Command.Item
                  key={page.to}
                  value={page.label}
                  onSelect={() => navigateTo(page.to)}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm',
                    'text-foreground aria-selected:bg-accent aria-selected:text-accent-foreground'
                  )}
                >
                  <page.icon className="h-4 w-4 text-muted-foreground" />
                  {page.label}
                </Command.Item>
              ))}
            </Command.Group>

            <Command.Separator className="my-1 h-px bg-border" />

            <Command.Group
              heading="Quick Actions"
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
            >
              <Command.Item
                value="Refresh page"
                onSelect={refresh}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm',
                  'text-foreground aria-selected:bg-accent aria-selected:text-accent-foreground'
                )}
              >
                <RefreshCw className="h-4 w-4 text-muted-foreground" />
                Refresh Page
              </Command.Item>
              <Command.Item
                value="Toggle theme"
                onSelect={toggleTheme}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm',
                  'text-foreground aria-selected:bg-accent aria-selected:text-accent-foreground'
                )}
              >
                <Palette className="h-4 w-4 text-muted-foreground" />
                Toggle Theme
                <span className="ml-auto text-xs text-muted-foreground">
                  Current: {theme}
                </span>
              </Command.Item>
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
