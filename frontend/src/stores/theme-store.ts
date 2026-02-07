import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme =
  | 'system'
  | 'light'
  | 'dark'
  | 'apple-light'
  | 'apple-dark'
  | 'retro-70s'
  | 'retro-arcade'
  | 'retro-terminal'
  | 'retro-vaporwave'
  | 'catppuccin-latte'
  | 'catppuccin-frappe'
  | 'catppuccin-macchiato'
  | 'catppuccin-mocha';

export type DashboardBackground =
  | 'none'
  | 'gradient-mesh'
  | 'gradient-mesh-particles'
  | 'retro-70s'
  | 'retro-arcade'
  | 'retro-terminal'
  | 'retro-vaporwave';

export const dashboardBackgroundOptions: { value: DashboardBackground; label: string; description: string }[] = [
  { value: 'none', label: 'None', description: 'Plain background' },
  { value: 'gradient-mesh', label: 'Gradient Mesh', description: 'Animated gradient background' },
  { value: 'gradient-mesh-particles', label: 'Mesh + Particles', description: 'Gradient with floating particles' },
  { value: 'retro-70s', label: 'Retro 70s', description: 'Warm flowing wave stripes' },
  { value: 'retro-arcade', label: 'Retro Arcade', description: 'Neon grid on dark purple' },
  { value: 'retro-terminal', label: 'Retro Terminal', description: 'Green phosphor CRT scanlines' },
  { value: 'retro-vaporwave', label: 'Retro Vaporwave', description: 'Pastel neon gradient mesh' },
];

export const themeOptions: { value: Theme; label: string; description: string }[] = [
  { value: 'system', label: 'System', description: 'Follow system preference' },
  { value: 'light', label: 'Light', description: 'Default light theme' },
  { value: 'dark', label: 'Dark', description: 'Default dark theme' },
  { value: 'apple-light', label: 'Glass Light', description: 'Futuristic frosted glass with gradients' },
  { value: 'apple-dark', label: 'Glass Dark', description: 'Deep space glassmorphism aesthetic' },
  { value: 'retro-70s', label: 'Retro 70s', description: 'Warm cream, gold, teal & coral' },
  { value: 'retro-arcade', label: 'Retro Arcade', description: 'Dark neon magenta & cyan' },
  { value: 'retro-terminal', label: 'Retro Terminal', description: 'Green phosphor on black' },
  { value: 'retro-vaporwave', label: 'Retro Vaporwave', description: 'Deep purple with pastel neons' },
  { value: 'catppuccin-latte', label: 'Catppuccin Latte', description: 'Warm light pastel theme' },
  { value: 'catppuccin-frappe', label: 'Catppuccin Frappé', description: 'Medium dark pastel theme' },
  { value: 'catppuccin-macchiato', label: 'Catppuccin Macchiato', description: 'Darker pastel theme' },
  { value: 'catppuccin-mocha', label: 'Catppuccin Mocha', description: 'Darkest pastel theme' },
];

export const DEFAULT_ENABLED_THEMES: Theme[] = ['apple-light', 'apple-dark'];

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  enabledThemes: Theme[];
  setEnabledThemes: (themes: Theme[]) => void;
  toggleEnabledTheme: (theme: Theme) => void;
  cycleTheme: () => void;
  dashboardBackground: DashboardBackground;
  setDashboardBackground: (bg: DashboardBackground) => void;
  resolvedTheme: () => 'dark' | 'light';
  themeClass: () => string;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'system',
      setTheme: (theme) => set({ theme }),
      enabledThemes: DEFAULT_ENABLED_THEMES as Theme[],
      setEnabledThemes: (enabledThemes) => set({ enabledThemes }),
      toggleEnabledTheme: (theme) => {
        const { enabledThemes } = get();
        if (enabledThemes.includes(theme)) {
          // Don't allow removing the last enabled theme
          if (enabledThemes.length > 1) {
            set({ enabledThemes: enabledThemes.filter((t) => t !== theme) });
          }
        } else {
          set({ enabledThemes: [...enabledThemes, theme] });
        }
      },
      cycleTheme: () => {
        const { theme, enabledThemes } = get();
        if (enabledThemes.length === 0) return;
        const currentIndex = enabledThemes.indexOf(theme);
        const nextIndex = (currentIndex + 1) % enabledThemes.length;
        set({ theme: enabledThemes[nextIndex] });
      },
      dashboardBackground: 'none',
      setDashboardBackground: (dashboardBackground) => set({ dashboardBackground }),
      resolvedTheme: () => {
        const { theme } = get();
        if (theme === 'system') {
          return window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light';
        }
        if (theme === 'light' || theme === 'catppuccin-latte' || theme === 'apple-light' || theme === 'retro-70s') {
          return 'light';
        }
        return 'dark';
      },
      themeClass: () => {
        const { theme } = get();
        if (theme === 'system') {
          return window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light';
        }
        return theme;
      },
    }),
    { name: 'theme-preference' }
  )
);
