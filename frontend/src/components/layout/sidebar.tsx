import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Boxes,
  Ship,
  Layers,
  HeartPulse,
  GitCompareArrows,
  PackageOpen,
  Network,
  Brain,
  BarChart3,
  Shield,
  GitBranch,
  MessageSquare,
  FileSearch,
  Radio,
  Settings,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
import { useUiStore } from '@/stores/ui-store';
import { useRemediationActions } from '@/hooks/use-remediation';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';

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
      { label: 'Comparison', to: '/comparison', icon: GitCompareArrows },
      { label: 'Image Footprint', to: '/images', icon: PackageOpen },
      { label: 'Network Topology', to: '/topology', icon: Network },
    ],
  },
  {
    title: 'Intelligence',
    items: [
      { label: 'AI Monitor', to: '/ai-monitor', icon: Brain },
      { label: 'Metrics Dashboard', to: '/metrics', icon: BarChart3 },
      { label: 'Remediation', to: '/remediation', icon: Shield },
      { label: 'Trace Explorer', to: '/traces', icon: GitBranch },
      { label: 'LLM Assistant', to: '/assistant', icon: MessageSquare },
    ],
  },
  {
    title: 'Operations',
    items: [
      { label: 'Edge Agent Logs', to: '/edge-logs', icon: FileSearch },
      { label: 'Packet Capture', to: '/packet-capture', icon: Radio },
      { label: 'Settings', to: '/settings', icon: Settings },
    ],
  },
];

export function Sidebar() {
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const collapsedGroups = useUiStore((s) => s.collapsedGroups);
  const toggleGroup = useUiStore((s) => s.toggleGroup);
  const { data: pendingActions } = useRemediationActions('pending');
  const pendingCount = pendingActions?.length ?? 0;

  return (
    <aside
      className={cn(
        'fixed left-2 top-2 bottom-2 z-30 flex flex-col rounded-2xl bg-sidebar-background/80 backdrop-blur-xl shadow-lg ring-1 ring-black/5 dark:ring-white/10 transition-all duration-300',
        sidebarCollapsed ? 'w-14' : 'w-60'
      )}
    >
      {/* Brand */}
      <div className="flex h-14 items-center px-4">
        <div className="flex items-center gap-2 overflow-hidden">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <Brain className="h-4 w-4" />
          </div>
          {!sidebarCollapsed && (
            <div className="flex flex-col">
              <span className="truncate text-sm font-semibold text-sidebar-foreground">
                Container-Infrastructure
              </span>
              <span className="text-[10px] text-muted-foreground">powered by ai</span>
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4">
        {navigation.map((group) => {
          const isGroupCollapsed = collapsedGroups[group.title] && !sidebarCollapsed;
          return (
            <div key={group.title} className="mb-2">
              {!sidebarCollapsed && (
                <button
                  onClick={() => toggleGroup(group.title)}
                  className="mb-1 flex w-full items-center justify-between px-4 py-1 text-xs font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
                >
                  <span>{group.title}</span>
                  <ChevronDown
                    className={cn(
                      'h-3 w-3 transition-transform duration-200',
                      isGroupCollapsed && '-rotate-90'
                    )}
                  />
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
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.to === '/'}
                        className={({ isActive }) =>
                          cn(
                            'relative flex items-center gap-3 rounded-md px-2 py-2 text-sm font-medium transition-all duration-200',
                            isActive
                              ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm'
                              : 'text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground',
                            sidebarCollapsed && 'justify-center px-0'
                          )
                        }
                        title={sidebarCollapsed ? item.label : undefined}
                      >
                        {({ isActive }) => (
                          <>
                            {isActive && (
                              <motion.span
                                layoutId="sidebar-active-pill"
                                data-testid="sidebar-active-indicator"
                                className="absolute inset-0 -z-10 rounded-md bg-sidebar-accent shadow-sm"
                                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                              />
                            )}
                            <item.icon className="h-4 w-4 shrink-0" />
                            {!sidebarCollapsed && (
                              <>
                                <span className="truncate">{item.label}</span>
                                {(() => {
                                  const badge = item.to === '/remediation' ? pendingCount : item.badge;
                                  return badge != null && badge > 0 ? (
                                    <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-xs font-medium text-destructive-foreground">
                                      {badge}
                                    </span>
                                  ) : null;
                                })()}
                              </>
                            )}
                          </>
                        )}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <div className="p-2">
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
