import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme =
  | 'system'
  | 'light'
  | 'dark'
  | 'apple-light'
  | 'apple-dark'
  | 'retro'
  | 'catppuccin-latte'
  | 'catppuccin-frappe'
  | 'catppuccin-macchiato'
  | 'catppuccin-mocha';

export type DashboardBackground =
  | 'none'
  | 'gradient-mesh'
  | 'gradient-mesh-particles'
  | 'retro';

export const dashboardBackgroundOptions: { value: DashboardBackground; label: string; description: string }[] = [
  { value: 'none', label: 'None', description: 'Plain background' },
  { value: 'gradient-mesh', label: 'Gradient Mesh', description: 'Animated gradient background' },
  { value: 'gradient-mesh-particles', label: 'Mesh + Particles', description: 'Gradient with floating particles' },
  { value: 'retro', label: 'Retro', description: 'Warm 70s curved stripes from corners' },
];

export const themeOptions: { value: Theme; label: string; description: string }[] = [
  { value: 'system', label: 'System', description: 'Follow system preference' },
  { value: 'light', label: 'Light', description: 'Default light theme' },
  { value: 'dark', label: 'Dark', description: 'Default dark theme' },
  { value: 'apple-light', label: 'Glass Light', description: 'Futuristic frosted glass with gradients' },
  { value: 'apple-dark', label: 'Glass Dark', description: 'Deep space glassmorphism aesthetic' },
  { value: 'retro', label: 'Retro', description: 'Warm 70s cream, gold, teal & coral' },
  { value: 'catppuccin-latte', label: 'Catppuccin Latte', description: 'Warm light pastel theme' },
  { value: 'catppuccin-frappe', label: 'Catppuccin Frappé', description: 'Medium dark pastel theme' },
  { value: 'catppuccin-macchiato', label: 'Catppuccin Macchiato', description: 'Darker pastel theme' },
  { value: 'catppuccin-mocha', label: 'Catppuccin Mocha', description: 'Darkest pastel theme' },
];

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
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
      dashboardBackground: 'none',
      setDashboardBackground: (dashboardBackground) => set({ dashboardBackground }),
      resolvedTheme: () => {
        const { theme } = get();
        if (theme === 'system') {
          return window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light';
        }
        if (theme === 'light' || theme === 'catppuccin-latte' || theme === 'apple-light' || theme === 'retro') {
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
