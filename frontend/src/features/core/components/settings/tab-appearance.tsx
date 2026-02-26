import {
  Monitor,
  Moon,
  Palette,
  Sparkles,
  Sun,
} from 'lucide-react';
import {
  useThemeStore,
  themeOptions,
  dashboardBackgroundOptions,
  iconThemeOptions,
  DEFAULT_THEME,
  DEFAULT_DASHBOARD_BACKGROUND,
  DEFAULT_TOGGLE_THEMES,
  DEFAULT_ICON_THEME,
  DEFAULT_FAVICON_ICON,
  DEFAULT_SIDEBAR_ICON,
  DEFAULT_LOGIN_ICON,
  type Theme,
} from '@/stores/theme-store';
import { ICON_SETS } from '@/components/icons/icon-sets';
import { ThemedSelect } from '@/components/shared/themed-select';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useCallback } from 'react';

function ThemeIcon({ theme }: { theme: Theme }) {
  if (theme === 'system') return <Monitor className="h-4 w-4" />;
  if (theme === 'apple-light' || theme === 'nordic-frost' || theme === 'sandstone-dusk') return <Sun className="h-4 w-4" />;
  if (theme === 'apple-dark') return <Sparkles className="h-4 w-4" />;
  if (theme === 'hyperpop-chaos') return <Sparkles className="h-4 w-4" />;
  if (theme.startsWith('catppuccin')) return <Palette className="h-4 w-4" />;
  return <Moon className="h-4 w-4" />;
}

export function AppearanceTab() {
  const {
    theme, setTheme,
    toggleThemes, setToggleThemes,
    dashboardBackground, setDashboardBackground,
    iconTheme, setIconTheme,
    faviconIcon, setFaviconIcon,
    sidebarIcon, setSidebarIcon,
    loginIcon, setLoginIcon,
  } = useThemeStore();

  const isRecommendedLookActive =
    theme === DEFAULT_THEME &&
    dashboardBackground === DEFAULT_DASHBOARD_BACKGROUND &&
    toggleThemes[0] === DEFAULT_TOGGLE_THEMES[0] &&
    toggleThemes[1] === DEFAULT_TOGGLE_THEMES[1] &&
    iconTheme === DEFAULT_ICON_THEME &&
    faviconIcon === DEFAULT_FAVICON_ICON &&
    sidebarIcon === DEFAULT_SIDEBAR_ICON &&
    loginIcon === DEFAULT_LOGIN_ICON;

  const applyRecommendedLook = useCallback(() => {
    setTheme(DEFAULT_THEME);
    setDashboardBackground(DEFAULT_DASHBOARD_BACKGROUND);
    setToggleThemes([...DEFAULT_TOGGLE_THEMES]);
    setIconTheme(DEFAULT_ICON_THEME);
    setFaviconIcon(DEFAULT_FAVICON_ICON);
    setSidebarIcon(DEFAULT_SIDEBAR_ICON);
    setLoginIcon(DEFAULT_LOGIN_ICON);
    toast.success('Applied recommended appearance preset');
  }, [setDashboardBackground, setIconTheme, setTheme, setToggleThemes, setFaviconIcon, setSidebarIcon, setLoginIcon]);

  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <Palette className="h-5 w-5" />
          <h2 className="text-lg font-semibold">Appearance</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Choose your preferred color theme for the dashboard.
        </p>
        <div className="mb-4 flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 p-3">
          <div>
            <p className="text-sm font-medium">Recommended Look</p>
            <p className="text-xs text-muted-foreground">
              Glass Light + Mesh Particles with Light/Dark glass toggle.
            </p>
          </div>
          <button
            onClick={applyRecommendedLook}
            disabled={isRecommendedLookActive}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isRecommendedLookActive ? 'Applied' : 'Apply'}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {themeOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => setTheme(option.value)}
              className={cn(
                'flex items-center gap-3 p-4 rounded-lg border text-left transition-colors',
                theme === option.value
                  ? 'border-primary bg-primary/10'
                  : 'border-border hover:border-primary/50 hover:bg-muted/50'
              )}
            >
              <div
                className={cn(
                  'flex items-center justify-center w-10 h-10 rounded-lg',
                  theme === option.value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
                )}
              >
                <ThemeIcon theme={option.value} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{option.label}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {option.description}
                </div>
              </div>
            </button>
          ))}
        </div>

        <div className="mt-6 border-t border-border pt-6">
          <h3 className="text-sm font-medium mb-1">Header Toggle</h3>
          <p className="text-sm text-muted-foreground mb-3">
            Choose the two themes the header pill switch toggles between.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Light side (Sun)</label>
              <ThemedSelect
                value={toggleThemes[0]}
                onValueChange={(v) => setToggleThemes([v as Theme, toggleThemes[1]])}
                options={themeOptions.filter((o) => o.value !== 'system').map((o) => ({ value: o.value, label: o.label }))}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Dark side (Moon)</label>
              <ThemedSelect
                value={toggleThemes[1]}
                onValueChange={(v) => setToggleThemes([toggleThemes[0], v as Theme])}
                options={themeOptions.filter((o) => o.value !== 'system').map((o) => ({ value: o.value, label: o.label }))}
              />
            </div>
          </div>
        </div>

        <div className="mt-6 border-t border-border pt-6">
          <h3 className="text-sm font-medium mb-1">Dashboard Background</h3>
          <p className="text-sm text-muted-foreground mb-3">
            Add an animated gradient background to the dashboard, similar to the login page.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {dashboardBackgroundOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => setDashboardBackground(option.value)}
                className={cn(
                  'flex items-center gap-3 p-3 rounded-lg border text-left transition-colors',
                  dashboardBackground === option.value
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:border-primary/50 hover:bg-muted/50'
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{option.label}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {option.description}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 border-t border-border pt-6">
          <h3 className="text-sm font-medium mb-1">Icon Style</h3>
          <p className="text-sm text-muted-foreground mb-3">
            Change the visual weight of icons across the dashboard.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {iconThemeOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => setIconTheme(option.value)}
                className={cn(
                  'flex items-center gap-3 p-3 rounded-lg border text-left transition-colors',
                  iconTheme === option.value
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:border-primary/50 hover:bg-muted/50'
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{option.label}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {option.description}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 border-t border-border pt-6">
          <h3 className="text-sm font-medium mb-1">Favicon Icon</h3>
          <p className="text-sm text-muted-foreground mb-3">
            Choose which icon appears in the browser tab.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {ICON_SETS.map((icon) => (
              <button
                key={icon.id}
                onClick={() => setFaviconIcon(icon.id)}
                className={cn(
                  'flex flex-col items-center gap-2 p-3 rounded-lg border text-center transition-colors',
                  faviconIcon === icon.id
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:border-primary/50 hover:bg-muted/50'
                )}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-green-500">
                  <svg viewBox={icon.viewBox} className="h-6 w-6">
                    {icon.paths.map((p, i) => (
                      <path
                        key={i}
                        d={p.d}
                        fill={p.fill === 'currentColor' ? '#fff' : (p.fill ?? 'none')}
                        stroke={p.stroke === 'currentColor' ? '#fff' : (p.stroke ?? 'none')}
                        strokeWidth={p.strokeWidth}
                        strokeLinecap={p.strokeLinecap}
                        strokeLinejoin={p.strokeLinejoin}
                      />
                    ))}
                  </svg>
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-medium truncate">{icon.label}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{icon.description}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 border-t border-border pt-6">
          <h3 className="text-sm font-medium mb-1">Sidebar Logo</h3>
          <p className="text-sm text-muted-foreground mb-3">
            Choose which icon appears in the sidebar brand area.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {ICON_SETS.map((icon) => (
              <button
                key={icon.id}
                onClick={() => setSidebarIcon(icon.id)}
                className={cn(
                  'flex flex-col items-center gap-2 p-3 rounded-lg border text-center transition-colors',
                  sidebarIcon === icon.id
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:border-primary/50 hover:bg-muted/50'
                )}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <svg viewBox={icon.viewBox} className="h-5 w-5 text-foreground">
                    {icon.paths.map((p, i) => (
                      <path
                        key={i}
                        d={p.d}
                        fill={p.fill ?? 'none'}
                        stroke={p.stroke ?? 'none'}
                        strokeWidth={p.strokeWidth}
                        strokeLinecap={p.strokeLinecap}
                        strokeLinejoin={p.strokeLinejoin}
                      />
                    ))}
                  </svg>
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-medium truncate">{icon.label}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{icon.description}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 border-t border-border pt-6">
          <h3 className="text-sm font-medium mb-1">Login Logo</h3>
          <p className="text-sm text-muted-foreground mb-3">
            Choose which icon appears on the login page with gradient animation.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {ICON_SETS.map((icon) => (
              <button
                key={icon.id}
                onClick={() => setLoginIcon(icon.id)}
                className={cn(
                  'flex flex-col items-center gap-2 p-3 rounded-lg border text-center transition-colors',
                  loginIcon === icon.id
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:border-primary/50 hover:bg-muted/50'
                )}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-card">
                  <svg viewBox={icon.viewBox} className="h-6 w-6">
                    <defs>
                      <linearGradient id={`login-preview-${icon.id}`} x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="oklch(72% 0.14 244)" />
                        <stop offset="100%" stopColor="oklch(78% 0.18 158)" />
                      </linearGradient>
                    </defs>
                    {icon.paths.map((p, i) => (
                      <path
                        key={i}
                        d={p.d}
                        fill={p.fill === 'currentColor' ? `url(#login-preview-${icon.id})` : (p.fill ?? 'none')}
                        stroke={p.stroke === 'currentColor' ? `url(#login-preview-${icon.id})` : (p.stroke ?? 'none')}
                        strokeWidth={p.strokeWidth}
                        strokeLinecap={p.strokeLinecap}
                        strokeLinejoin={p.strokeLinejoin}
                      />
                    ))}
                  </svg>
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-medium truncate">{icon.label}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{icon.description}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
