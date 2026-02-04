import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Boxes,
  Ship,
  Layers,
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
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useUiStore } from '@/stores/ui-store';
import { cn } from '@/lib/utils';

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
      { label: 'Image Footprint', to: '/images', icon: PackageOpen },
      { label: 'Network Topology', to: '/topology', icon: Network },
    ],
  },
  {
    title: 'Intelligence',
    items: [
      { label: 'AI Monitor', to: '/ai-monitor', icon: Brain },
      { label: 'Metrics Dashboard', to: '/metrics', icon: BarChart3 },
      { label: 'Remediation', to: '/remediation', icon: Shield, badge: 3 },
      { label: 'Trace Explorer', to: '/traces', icon: GitBranch },
      { label: 'LLM Assistant', to: '/assistant', icon: MessageSquare },
    ],
  },
  {
    title: 'Operations',
    items: [
      { label: 'Edge Agent Logs', to: '/edge-logs', icon: FileSearch },
      { label: 'Settings', to: '/settings', icon: Settings },
    ],
  },
];

export function Sidebar() {
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);

  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-30 flex flex-col border-r border-sidebar-border bg-sidebar-background transition-all duration-300',
        sidebarCollapsed ? 'w-16' : 'w-64'
      )}
    >
      {/* Brand */}
      <div className="flex h-14 items-center border-b border-sidebar-border px-4">
        <div className="flex items-center gap-2 overflow-hidden">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <Brain className="h-4 w-4" />
          </div>
          {!sidebarCollapsed && (
            <span className="truncate text-sm font-semibold text-sidebar-foreground">
              AI Portainer
            </span>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-4">
        {navigation.map((group) => (
          <div key={group.title} className="mb-4">
            {!sidebarCollapsed && (
              <h3 className="mb-1 px-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {group.title}
              </h3>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) =>
                      cn(
                        'group flex items-center gap-3 rounded-md px-2 py-2 text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                          : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                        sidebarCollapsed && 'justify-center px-0'
                      )
                    }
                    title={sidebarCollapsed ? item.label : undefined}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    {!sidebarCollapsed && (
                      <>
                        <span className="truncate">{item.label}</span>
                        {item.badge != null && item.badge > 0 && (
                          <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-xs font-medium text-destructive-foreground">
                            {item.badge}
                          </span>
                        )}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* Collapse toggle */}
      <div className="border-t border-sidebar-border p-2">
        <button
          onClick={toggleSidebar}
          className="flex w-full items-center justify-center rounded-md p-2 text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {sidebarCollapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </button>
      </div>
    </aside>
  );
}
