import { useEffect } from 'react';
import { useThemeStore } from '@/stores/theme-store';

const ALL_THEME_CLASSES = [
  'light',
  'dark',
  'apple-light',
  'apple-dark',
  'retro-70s',
  'retro-arcade',
  'retro-terminal',
  'retro-vaporwave',
  'catppuccin-latte',
  'catppuccin-frappe',
  'catppuccin-macchiato',
  'catppuccin-mocha',
];

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { theme, themeClass, iconTheme } = useThemeStore();

  useEffect(() => {
    const root = document.documentElement;
    const currentClass = themeClass();

    // Remove all theme classes
    ALL_THEME_CLASSES.forEach((cls) => root.classList.remove(cls));

    // Add the current theme class
    root.classList.add(currentClass);

    // For dark themes, also add 'dark' class for Tailwind dark: variants
    if (
      currentClass === 'apple-dark' ||
      currentClass === 'retro-arcade' ||
      currentClass === 'retro-terminal' ||
      currentClass === 'retro-vaporwave' ||
      currentClass === 'catppuccin-frappe' ||
      currentClass === 'catppuccin-macchiato' ||
      currentClass === 'catppuccin-mocha'
    ) {
      root.classList.add('dark');
    }
  }, [theme, themeClass]);

  useEffect(() => {
    const root = document.documentElement;
    if (iconTheme === 'default') {
      root.removeAttribute('data-icon-theme');
    } else {
      root.setAttribute('data-icon-theme', iconTheme);
    }
  }, [iconTheme]);

  useEffect(() => {
    if (theme !== 'system') return;

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      const root = document.documentElement;
      ALL_THEME_CLASSES.forEach((cls) => root.classList.remove(cls));
      root.classList.add(mq.matches ? 'dark' : 'light');
    };

    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  return <>{children}</>;
}
