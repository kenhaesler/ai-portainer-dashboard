import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { MoreHorizontal, X } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { useHarborEnabled } from '@/features/security/hooks/use-harbor-vulnerabilities';
import {
  mobilePrimaryDestinations,
  mobileDrawerDestinations,
  mobileLabel,
  type NavDestination,
} from '@/features/core/lib/navigation-manifest';

function NavButton({ item, onClick }: { item: NavDestination; onClick?: () => void }) {
  return (
    <NavLink
      to={item.path}
      end={item.path === '/'}
      onClick={onClick}
      className={({ isActive }) =>
        cn(
          // 10px was below the legible floor for a control label.
          'flex flex-col items-center gap-0.5 px-2 py-2 text-xs font-medium transition-colors min-w-[56px]',
          isActive
            ? 'text-primary'
            : 'text-muted-foreground',
        )
      }
    >
      <item.icon className="h-5 w-5" />
      <span className="truncate">{mobileLabel(item)}</span>
    </NavLink>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled])';

export function MobileBottomNav() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();
  const { data: harborEnabled } = useHarborEnabled();
  const drawerRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);

  const primaryNav = mobilePrimaryDestinations;
  // Derived from the manifest, not curated. The hand-written list left the
  // whole Security group and the Log Viewer unreachable from a phone.
  const secondaryNav = mobileDrawerDestinations({
    harborEnabled: harborEnabled?.enabled === true,
  });

  const isSecondaryActive = secondaryNav.some((item) => item.path === location.pathname);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    openerRef.current?.focus();
  }, []);

  // Escape + focus trap: without them a keyboard or switch user could open
  // the drawer and had no way to close it.
  useEffect(() => {
    if (!drawerOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDrawer();
        return;
      }
      if (event.key !== 'Tab') return;
      const root = drawerRef.current;
      if (!root) return;
      const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey && (active === first || !root.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    drawerRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen, closeDrawer]);

  return (
    <>
      {/* More Drawer scrim — a real button so it is reachable without a mouse */}
      {drawerOpen && (
        <button
          type="button"
          data-testid="mobile-drawer-scrim"
          aria-label="Close menu"
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
          onClick={closeDrawer}
        />
      )}

      {/* More Drawer */}
      {drawerOpen && (
        <div
          ref={drawerRef}
          role="dialog"
          aria-modal="true"
          aria-label="More pages"
          className="fixed inset-x-0 bottom-0 z-50 md:hidden"
        >
          <div className="rounded-t-2xl bg-background/95 backdrop-blur-xl shadow-2xl ring-1 ring-black/5 dark:ring-white/10">
            {/* Drawer handle */}
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <span className="text-sm font-semibold">More Pages</span>
              <button
                type="button"
                onClick={closeDrawer}
                className="rounded-md p-1 hover:bg-muted"
                aria-label="Close more pages"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Secondary nav grid */}
            <div className="grid grid-cols-4 gap-1 p-3 max-h-[60vh] overflow-y-auto">
              {secondaryNav.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
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
      )}

      {/* Bottom Navigation Bar */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t bg-background/95 backdrop-blur-xl pb-safe-comfort md:hidden"
        role="navigation"
        aria-label="Mobile navigation"
      >
        {primaryNav.map((item) => (
          <NavButton key={item.path} item={item} />
        ))}
        <button
          type="button"
          ref={openerRef}
          onClick={() => setDrawerOpen((open) => !open)}
          aria-expanded={drawerOpen}
          className={cn(
            'flex flex-col items-center gap-0.5 px-2 py-2 text-xs font-medium transition-colors min-w-[56px]',
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
