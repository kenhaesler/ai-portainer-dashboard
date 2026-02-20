import { describe, it, expect, beforeEach } from 'vitest';
import { useThemeStore, DEFAULT_TOGGLE_THEMES, DEFAULT_ICON_THEME } from './theme-store';

describe('useThemeStore', () => {
  beforeEach(() => {
    useThemeStore.setState({
      theme: 'system',
      dashboardBackground: 'none',
      toggleThemes: [...DEFAULT_TOGGLE_THEMES],
      iconTheme: DEFAULT_ICON_THEME,
    });
  });

  it('has correct defaults', () => {
    const state = useThemeStore.getState();
    expect(state.dashboardBackground).toBe('none');
    expect(state.toggleThemes).toEqual(DEFAULT_TOGGLE_THEMES);
    expect(state.iconTheme).toBe('default');
  });

  it('sets theme and resolves light vs dark correctly', () => {
    const { setTheme } = useThemeStore.getState();

    // Light theme
    setTheme('retro-70s');
    expect(useThemeStore.getState().theme).toBe('retro-70s');
    expect(useThemeStore.getState().resolvedTheme()).toBe('light');

    // Dark theme
    setTheme('retro-arcade');
    expect(useThemeStore.getState().theme).toBe('retro-arcade');
    expect(useThemeStore.getState().resolvedTheme()).toBe('dark');
  });

  it('sets dashboard background and toggles back to none', () => {
    const { setDashboardBackground } = useThemeStore.getState();

    setDashboardBackground('mesh-aurora');
    expect(useThemeStore.getState().dashboardBackground).toBe('mesh-aurora');

    setDashboardBackground('none');
    expect(useThemeStore.getState().dashboardBackground).toBe('none');
  });

  it('toggleTheme cycles between pair and defaults when current is neither', () => {
    // first -> second
    useThemeStore.setState({ theme: 'apple-light', toggleThemes: ['apple-light', 'apple-dark'] });
    useThemeStore.getState().toggleTheme();
    expect(useThemeStore.getState().theme).toBe('apple-dark');

    // second -> first
    useThemeStore.getState().toggleTheme();
    expect(useThemeStore.getState().theme).toBe('apple-light');

    // neither -> defaults to first
    useThemeStore.setState({ theme: 'retro-arcade' });
    useThemeStore.getState().toggleTheme();
    expect(useThemeStore.getState().theme).toBe('apple-light');
  });

  it('replaces toggleThemes pair', () => {
    useThemeStore.getState().setToggleThemes(['catppuccin-latte', 'catppuccin-mocha']);
    expect(useThemeStore.getState().toggleThemes).toEqual(['catppuccin-latte', 'catppuccin-mocha']);
  });

  it('sets iconTheme and toggles back to default', () => {
    useThemeStore.getState().setIconTheme('bold');
    expect(useThemeStore.getState().iconTheme).toBe('bold');

    useThemeStore.getState().setIconTheme('default');
    expect(useThemeStore.getState().iconTheme).toBe('default');
  });
});
