import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme =
  | 'system'
  | 'apple-light'
  | 'apple-dark'
  | 'nordic-frost'
  | 'sandstone-dusk'
  | 'obsidian-ink'
  | 'forest-night'
  | 'hyperpop-chaos'
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
  | 'mesh-aurora'
  | 'mesh-ocean'
  | 'mesh-sunset'
  | 'mesh-nebula'
  | 'mesh-emerald'
  | 'mesh-glacier'
  | 'mesh-emberstorm'
  | 'mesh-noctis'
  | 'mesh-cotton-candy'
  | 'mesh-chaos'
  | 'retro-70s'
  | 'retro-arcade'
  | 'retro-terminal'
  | 'retro-vaporwave';

export const dashboardBackgroundOptions: { value: DashboardBackground; label: string; description: string }[] = [
  { value: 'none', label: 'None', description: 'Plain background' },
  { value: 'gradient-mesh', label: 'Mesh Classic', description: 'Balanced animated gradient mesh' },
  { value: 'gradient-mesh-particles', label: 'Mesh + Particles', description: 'Classic mesh with floating particles' },
  { value: 'mesh-aurora', label: 'Mesh Aurora', description: 'Teal-violet cinematic glow' },
  { value: 'mesh-ocean', label: 'Mesh Ocean', description: 'Blue-cyan depth with cool contrast' },
  { value: 'mesh-sunset', label: 'Mesh Sunset', description: 'Amber-rose warm premium blend' },
  { value: 'mesh-nebula', label: 'Mesh Nebula', description: 'Indigo-magenta cosmic gradient' },
  { value: 'mesh-emerald', label: 'Mesh Emerald', description: 'Green-mint glass-friendly tone' },
  { value: 'mesh-glacier', label: 'Mesh Glacier', description: 'Icy blues with crisp highlights' },
  { value: 'mesh-emberstorm', label: 'Mesh Emberstorm', description: 'Molten orange-red storm energy' },
  { value: 'mesh-noctis', label: 'Mesh Noctis', description: 'Dark steel blue cinematic depth' },
  { value: 'mesh-cotton-candy', label: 'Mesh Cotton Candy', description: 'Playful pink-cyan dreamy blend' },
  { value: 'mesh-chaos', label: 'Mesh Chaos', description: 'Wild neon spectrum (go crazy mode)' },
  { value: 'retro-70s', label: 'Retro 70s', description: 'Warm flowing wave stripes' },
  { value: 'retro-arcade', label: 'Retro Arcade', description: 'Neon grid on dark purple' },
  { value: 'retro-terminal', label: 'Retro Terminal', description: 'Green phosphor CRT scanlines' },
  { value: 'retro-vaporwave', label: 'Retro Vaporwave', description: 'Pastel neon gradient mesh' },
];

export const themeOptions: { value: Theme; label: string; description: string }[] = [
  { value: 'system', label: 'System', description: 'Follow system preference' },
  { value: 'apple-light', label: 'Glass Light', description: 'Futuristic frosted glass with gradients' },
  { value: 'apple-dark', label: 'Glass Dark', description: 'Deep space glassmorphism aesthetic' },
  { value: 'nordic-frost', label: 'Nordic Frost', description: 'Cool airy light theme with icy accents' },
  { value: 'sandstone-dusk', label: 'Sandstone Dusk', description: 'Warm editorial light palette' },
  { value: 'obsidian-ink', label: 'Obsidian Ink', description: 'Deep ink dark theme with cobalt accents' },
  { value: 'forest-night', label: 'Forest Night', description: 'Dark botanical palette with mint glow' },
  { value: 'hyperpop-chaos', label: 'Hyperpop Chaos', description: 'Maximal neon chaos (wild mode)' },
  { value: 'retro-70s', label: 'Retro 70s', description: 'Warm cream, gold, teal & coral' },
  { value: 'retro-arcade', label: 'Retro Arcade', description: 'Dark neon magenta & cyan' },
  { value: 'retro-terminal', label: 'Retro Terminal', description: 'Green phosphor on black' },
  { value: 'retro-vaporwave', label: 'Retro Vaporwave', description: 'Deep purple with pastel neons' },
  { value: 'catppuccin-latte', label: 'Catppuccin Latte', description: 'Warm light pastel theme' },
  { value: 'catppuccin-frappe', label: 'Catppuccin Frappé', description: 'Medium dark pastel theme' },
  { value: 'catppuccin-macchiato', label: 'Catppuccin Macchiato', description: 'Darker pastel theme' },
  { value: 'catppuccin-mocha', label: 'Catppuccin Mocha', description: 'Darkest pastel theme' },
];

export type IconTheme = 'default' | 'light' | 'bold' | 'duotone';

export const iconThemeOptions: { value: IconTheme; label: string; description: string }[] = [
  { value: 'default', label: 'Default', description: 'Balanced stroke weight (standard)' },
  { value: 'light', label: 'Light', description: 'Thin elegant lines' },
  { value: 'bold', label: 'Bold', description: 'Thick strokes for high contrast' },
  { value: 'duotone', label: 'Duotone', description: 'Soft fill with outline' },
];

export const DEFAULT_TOGGLE_THEMES: [Theme, Theme] = ['apple-light', 'apple-dark'];
export const DEFAULT_THEME: Theme = 'apple-light';
export const DEFAULT_DASHBOARD_BACKGROUND: DashboardBackground = 'gradient-mesh-particles';
export const DEFAULT_ICON_THEME: IconTheme = 'default';

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleThemes: [Theme, Theme];
  setToggleThemes: (themes: [Theme, Theme]) => void;
  toggleTheme: () => void;
  dashboardBackground: DashboardBackground;
  setDashboardBackground: (bg: DashboardBackground) => void;
  iconTheme: IconTheme;
  setIconTheme: (theme: IconTheme) => void;
  resolvedTheme: () => 'dark' | 'light';
  themeClass: () => string;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: DEFAULT_THEME,
      setTheme: (theme) => set({ theme }),
      toggleThemes: DEFAULT_TOGGLE_THEMES,
      setToggleThemes: (toggleThemes) => set({ toggleThemes }),
      toggleTheme: () => {
        const { theme, toggleThemes } = get();
        const next = theme === toggleThemes[0] ? toggleThemes[1] : toggleThemes[0];
        set({ theme: next });
      },
      dashboardBackground: DEFAULT_DASHBOARD_BACKGROUND,
      setDashboardBackground: (dashboardBackground) => set({ dashboardBackground }),
      iconTheme: DEFAULT_ICON_THEME,
      setIconTheme: (iconTheme) => set({ iconTheme }),
      resolvedTheme: () => {
        const { theme } = get();
        if (theme === 'system') {
          return window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light';
        }
        if (
          theme === 'catppuccin-latte' ||
          theme === 'apple-light' ||
          theme === 'retro-70s' ||
          theme === 'nordic-frost' ||
          theme === 'sandstone-dusk'
        ) {
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
