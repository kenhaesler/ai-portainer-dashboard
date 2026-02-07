import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Boxes,
  HeartPulse,
  Brain,
  MoreHorizontal,
  X,
  Ship,
  Layers,
  GitCompareArrows,
  PackageOpen,
  Network,
  BarChart3,
  Shield,
  GitBranch,
  MessageSquare,
  FileSearch,
  Radio,
  Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface MobileNavItem {
  label: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
}

const primaryNav: MobileNavItem[] = [
  { label: 'Home', to: '/', icon: LayoutDashboard },
  { label: 'Workloads', to: '/workloads', icon: Boxes },
  { label: 'Health', to: '/health', icon: HeartPulse },
  { label: 'AI Monitor', to: '/ai-monitor', icon: Brain },
];

const secondaryNav: MobileNavItem[] = [
  { label: 'Fleet', to: '/fleet', icon: Ship },
  { label: 'Stacks', to: '/stacks', icon: Layers },
  { label: 'Comparison', to: '/comparison', icon: GitCompareArrows },
  { label: 'Images', to: '/images', icon: PackageOpen },
  { label: 'Topology', to: '/topology', icon: Network },
  { label: 'Metrics', to: '/metrics', icon: BarChart3 },
  { label: 'Remediation', to: '/remediation', icon: Shield },
  { label: 'Traces', to: '/traces', icon: GitBranch },
  { label: 'Assistant', to: '/assistant', icon: MessageSquare },
  { label: 'Edge Logs', to: '/edge-logs', icon: FileSearch },
  { label: 'Packet Capture', to: '/packet-capture', icon: Radio },
  { label: 'Settings', to: '/settings', icon: Settings },
];

function NavButton({ item, onClick }: { item: MobileNavItem; onClick?: () => void }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      onClick={onClick}
      className={({ isActive }) =>
        cn(
          'flex flex-col items-center gap-0.5 px-2 py-1.5 text-[10px] font-medium transition-colors min-w-[56px]',
          isActive
            ? 'text-primary'
            : 'text-muted-foreground',
        )
      }
    >
      <item.icon className="h-5 w-5" />
      <span className="truncate">{item.label}</span>
    </NavLink>
  );
}

export function MobileBottomNav() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  // Check if current route is in secondary nav
  const isSecondaryActive = secondaryNav.some((item) => item.to === location.pathname);

  return (
    <>
      {/* More Drawer overlay */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* More Drawer */}
      <div
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 transform transition-transform duration-300 ease-out md:hidden',
          drawerOpen ? 'translate-y-0' : 'translate-y-full',
        )}
      >
        <div className="rounded-t-2xl bg-background/95 backdrop-blur-xl shadow-2xl ring-1 ring-black/5 dark:ring-white/10">
          {/* Drawer handle */}
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <span className="text-sm font-semibold">More Pages</span>
            <button
              onClick={() => setDrawerOpen(false)}
              className="rounded-md p-1 hover:bg-muted"
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Secondary nav grid */}
          <div className="grid grid-cols-4 gap-1 p-3 max-h-[60vh] overflow-y-auto">
            {secondaryNav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setDrawerOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'flex flex-col items-center gap-1 rounded-xl p-3 text-xs font-medium transition-colors',
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-muted',
                  )
                }
              >
                <item.icon className="h-6 w-6" />
                <span className="text-center leading-tight">{item.label}</span>
              </NavLink>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Navigation Bar */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t bg-background/95 backdrop-blur-xl pb-safe-comfort md:hidden"
        role="navigation"
        aria-label="Mobile navigation"
      >
        {primaryNav.map((item) => (
          <NavButton key={item.to} item={item} />
        ))}
        <button
          onClick={() => setDrawerOpen(!drawerOpen)}
          className={cn(
            'flex flex-col items-center gap-0.5 px-2 py-1.5 text-[10px] font-medium transition-colors min-w-[56px]',
            isSecondaryActive || drawerOpen
              ? 'text-primary'
              : 'text-muted-foreground',
          )}
          aria-label="More pages"
        >
          <MoreHorizontal className="h-5 w-5" />
          <span>More</span>
        </button>
      </nav>
    </>
  );
}
