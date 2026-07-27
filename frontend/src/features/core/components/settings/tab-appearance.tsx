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
import { AppIconSection } from './app-icon-section';
import { ThemedSelect } from '@/shared/components/ui/themed-select';
import { cn } from '@/shared/lib/utils';
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
    toast.success('Applied the recommended look — theme, background and app icon reset');
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
              Glass Light + Mesh Particles, the Light/Dark glass toggle, and the Brain app icon
              on all three surfaces.
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

        <AppIconSection />
      </div>
    </div>
  );
}
