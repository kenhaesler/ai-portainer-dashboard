import { useLocation, Link } from 'react-router';
import { Sun, Moon, Search, LogOut, User } from 'lucide-react';
import { useAuth } from '@/providers/auth-provider';
import { useThemeStore } from '@/stores/theme-store';
import { useUiStore } from '@/stores/ui-store';
import { useHeaderContextStore } from '@/stores/header-context-store';
import { cn } from '@/shared/lib/utils';
import { useState, useRef, useEffect, useMemo, type ReactNode } from 'react';
import { ConnectionOrb } from '@/shared/components/ui/connection-orb';
import { breadcrumbLabelForPath } from '@/features/core/lib/navigation-manifest';
import { useContainerDetail } from '@/features/containers/hooks/use-container-detail';

interface Crumb {
  key: string;
  label: string;
  /** Set on every crumb except the last one, which is the current page. */
  path?: string;
  /** Rendered instead of `label` when the crumb resolves live data. */
  node?: ReactNode;
}

/**
 * `navigator.platform` is deprecated and returns `""` in some hardened
 * browsers, which silently rendered `Ctrl+K` to Mac users. Check the modern
 * `userAgentData.platform` first and fall back through the legacy fields.
 */
export function prefersCommandKey(nav: Navigator = navigator): boolean {
  const withData = nav as Navigator & { userAgentData?: { platform?: string } };
  const haystack = [
    withData.userAgentData?.platform ?? '',
    nav.platform ?? '',
    nav.userAgent ?? '',
  ].join(' ');
  return /mac|iphone|ipad|ipod/i.test(haystack);
}

/**
 * Names the container rather than the route template. The breadcrumb used to
 * read the hardcoded "Container Details" while the page's own h1 showed the
 * container name. Shares the containers query with the page below it, so this
 * costs no extra request.
 */
function ContainerCrumb({ endpointId, containerId }: { endpointId: number; containerId: string }) {
  const { data } = useContainerDetail(endpointId, containerId);
  return (
    <span className="truncate font-medium text-foreground" data-testid="header-container-name">
      {data?.name ?? containerId.slice(0, 12)}
    </span>
  );
}

export function Header() {
  const location = useLocation();
  const { username, logout } = useAuth();
  const { theme, toggleTheme, dashboardBackground } = useThemeStore();
  const setCommandPaletteOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const potatoMode = useUiStore((s) => s.potatoMode);
  const setPotatoMode = useUiStore((s) => s.setPotatoMode);
  const metricsContainerName = useHeaderContextStore((s) => s.metricsContainerName);
  const hasAnimatedBg = dashboardBackground !== 'none';
  const [appBuildRef, setAppBuildRef] = useState(
    import.meta.env.DEV
      ? (
        import.meta.env.VITE_GIT_COMMIT
        || import.meta.env.VITE_APP_COMMIT
        || import.meta.env.VITE_BUILD_NUMBER
        || 'dev'
      )
      : (
        import.meta.env.VITE_BUILD_NUMBER
        || import.meta.env.VITE_GIT_COMMIT
        || import.meta.env.VITE_APP_COMMIT
        || ''
      )
  );
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const isMacKeyboard = useMemo(() => prefersCommandKey(), []);

  // Check if the current route is a container detail page
  const containerDetailMatch = location.pathname.match(/^\/containers\/(\d+)\/([a-f0-9]+)$/);

  // Every label comes from the one route manifest — the header used to keep
  // its own 13-entry copy of a 20-route list, so 7 routes fell through to the
  // literal "Dashboard" and rendered "Dashboard / Dashboard".
  const currentLabel = breadcrumbLabelForPath(location.pathname);

  let breadcrumbs: Crumb[];
  if (containerDetailMatch) {
    breadcrumbs = [
      { key: '/', label: 'Home', path: '/' },
      { key: '/workloads', label: 'Workloads', path: '/workloads' },
      {
        key: location.pathname,
        label: 'Container',
        node: (
          <ContainerCrumb
            endpointId={Number(containerDetailMatch[1])}
            containerId={containerDetailMatch[2]}
          />
        ),
      },
    ];
  } else {
    breadcrumbs = [
      { key: '/', label: 'Home', path: '/' },
      ...(location.pathname !== '/'
        ? [{
          key: location.pathname,
          // A genuinely unknown path is the 404 route; say so rather than
          // naming some other page.
          label: currentLabel ?? 'Page not found',
        }]
        : []),
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

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    let isMounted = true;
    fetch('/__commit')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { commit?: string } | null) => {
        if (!isMounted) return;
        if (data?.commit) setAppBuildRef(data.commit);
      })
      .catch(() => undefined);
    return () => {
      isMounted = false;
    };
  }, []);

  const buildChannel = import.meta.env.DEV ? 'DEV' : 'BUILD';
  const normalizedBuildRef = appBuildRef.trim();
  const buildToken = normalizedBuildRef
    && normalizedBuildRef.toLowerCase() !== 'dev'
    && normalizedBuildRef.toLowerCase() !== 'build'
    ? normalizedBuildRef.slice(0, 16).toLowerCase()
    : '';
  const buildBadge = buildToken ? `${buildChannel} ${buildToken}` : buildChannel;

  return (
    <header
      data-testid="header"
      data-animated-bg={hasAnimatedBg || undefined}
      className="relative z-40 mx-2 mt-2 flex h-12 shrink-0 items-center justify-between gap-2 rounded-2xl bg-sidebar-background/80 backdrop-blur-xl shadow-lg ring-1 ring-black/5 dark:ring-white/10 px-2 md:mx-4 md:mt-4 md:px-4"
    >
      {/* Breadcrumbs — must be able to shrink, or at ~820px it pushes the
          right-hand cluster (including the only route to Log out) off-screen. */}
      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-sm"
      >
        {breadcrumbs.map((crumb, index) => (
          <span key={crumb.key} className="flex min-w-0 items-center gap-1.5">
            {index > 0 && (
              <span className="text-muted-foreground">/</span>
            )}
            {index === breadcrumbs.length - 1 ? (
              crumb.node ?? (
                <span className="truncate font-medium text-foreground">
                  {crumb.label}
                </span>
              )
            ) : (
              <Link
                to={crumb.path ?? '/'}
                className="truncate text-muted-foreground transition-colors hover:text-foreground"
              >
                {crumb.label}
              </Link>
            )}
          </span>
        ))}
        {metricsContainerName && (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="text-muted-foreground">/</span>
            <span className="truncate font-medium text-foreground" data-testid="header-context-name">
              {metricsContainerName}
            </span>
          </span>
        )}
        {(appBuildRef || buildChannel) && (
          <span
            className="ml-2 hidden shrink-0 items-center rounded-full border border-border/60 bg-muted/60 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground md:inline-flex"
            aria-label={`Build ${buildBadge}`}
            title={`Build ${buildBadge}`}
          >
            {buildBadge}
          </span>
        )}
      </nav>

      {/* Right-side actions */}
      <div className="flex shrink-0 items-center gap-2">
        {/* Command palette trigger */}
        <button
          type="button"
          onClick={() => setCommandPaletteOpen(true)}
          aria-label="Search"
          className="flex items-center gap-2 rounded-xl bg-muted/50 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted"
        >
          <Search className="h-4 w-4" />
          <kbd className="pointer-events-none hidden select-none rounded-md bg-background/80 px-1.5 py-0.5 font-mono text-xs sm:inline-block">
            {isMacKeyboard ? '⌘' : 'Ctrl+'}K
          </kbd>
        </button>

        {/* Theme toggle — pill switch between two configured themes */}
        {(() => {
          const isDark = useThemeStore.getState().resolvedTheme() === 'dark';
          return (
            <button
              data-testid="theme-toggle"
              onClick={toggleTheme}
              className="relative flex h-8 w-14 items-center justify-between rounded-full bg-muted px-1.5 transition-colors"
              aria-label={`Switch to ${isDark ? 'light' : 'dark'} theme`}
            >
              <span
                className={cn(
                  'absolute h-5 w-5 rounded-full bg-background shadow-sm transition-all duration-200',
                  isDark ? 'left-[calc(100%-1.625rem)]' : 'left-1.5'
                )}
              />
              <Sun className={cn(
                'relative z-10 h-3.5 w-3.5 transition-colors',
                isDark ? 'text-muted-foreground' : 'text-amber-500'
              )} />
              <Moon className={cn(
                'relative z-10 h-3.5 w-3.5 transition-colors',
                isDark ? 'text-blue-400' : 'text-muted-foreground'
              )} />
            </button>
          );
        })()}

        {/* Connection status orb */}
        <ConnectionOrb />

        {/* User menu */}
        <div ref={userMenuRef} className="relative">
          <button
            data-testid="user-menu-trigger"
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm transition-colors hover:bg-muted/50"
          >
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <User className="h-3.5 w-3.5" />
            </div>
            <span className="hidden font-medium sm:inline">
              {username || 'User'}
            </span>
          </button>

          {userMenuOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 w-60 rounded-md border border-border bg-popover p-1 shadow-lg">
              <div className="px-2 py-1.5 text-sm text-muted-foreground">
                Signed in as <span className="font-medium text-foreground">{username}</span>
              </div>
              <div className="my-1 h-px bg-border" />
              {/* Potato mode: a real performance switch, previously an
                  unlabelled emoji in the header cluster. */}
              <button
                type="button"
                role="switch"
                aria-checked={Boolean(potatoMode)}
                aria-label={`Potato mode ${potatoMode ? 'on' : 'off'}`}
                data-testid="potato-mode-toggle"
                onClick={() => setPotatoMode(Boolean(!potatoMode))}
                className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
              >
                <span aria-hidden="true" className="leading-5">🥔</span>
                <span className="flex flex-col">
                  <span className="font-medium text-foreground">Potato mode</span>
                  <span className="text-xs text-muted-foreground">
                    Stops all animation and the gradient background.
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    'ml-auto shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
                    potatoMode
                      ? 'bg-primary/10 text-primary'
                      : 'bg-muted text-muted-foreground'
                  )}
                >
                  {potatoMode ? 'On' : 'Off'}
                </span>
              </button>
              <div className="my-1 h-px bg-border" />
              <button
                data-testid="logout-button"
                onClick={() => {
                  setUserMenuOpen(false);
                  logout();
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-destructive transition-colors hover:bg-accent"
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
