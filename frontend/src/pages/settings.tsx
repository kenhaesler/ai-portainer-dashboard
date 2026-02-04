import { useThemeStore, themeOptions, type Theme } from '@/stores/theme-store';
import { Palette, Monitor, Sun, Moon } from 'lucide-react';

function ThemeIcon({ theme }: { theme: Theme }) {
  if (theme === 'system') return <Monitor className="h-4 w-4" />;
  if (theme === 'light') return <Sun className="h-4 w-4" />;
  if (theme.startsWith('catppuccin')) return <Palette className="h-4 w-4" />;
  return <Moon className="h-4 w-4" />;
}

export default function SettingsPage() {
  const { theme, setTheme } = useThemeStore();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Environment, backup, monitoring, and cache configuration
        </p>
      </div>

      {/* Theme Settings */}
      <div className="rounded-lg border bg-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <Palette className="h-5 w-5" />
          <h2 className="text-xl font-semibold">Appearance</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Choose your preferred color theme for the dashboard.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {themeOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => setTheme(option.value)}
              className={`flex items-center gap-3 p-4 rounded-lg border text-left transition-colors ${
                theme === option.value
                  ? 'border-primary bg-primary/10'
                  : 'border-border hover:border-primary/50 hover:bg-muted/50'
              }`}
            >
              <div
                className={`flex items-center justify-center w-10 h-10 rounded-lg ${
                  theme === option.value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
                }`}
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
      </div>

      {/* Other Settings - Coming Soon */}
      <div className="rounded-lg border bg-card p-6">
        <h2 className="text-xl font-semibold mb-4">Other Settings</h2>
        <div className="text-center text-muted-foreground py-8">
          More settings coming soon
        </div>
      </div>
    </div>
  );
}
