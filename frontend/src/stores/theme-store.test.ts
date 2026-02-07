import { describe, it, expect, beforeEach } from 'vitest';
import { useThemeStore, DEFAULT_TOGGLE_THEMES } from './theme-store';

describe('useThemeStore - dashboardBackground', () => {
  beforeEach(() => {
    useThemeStore.setState({ dashboardBackground: 'none' });
  });

  it('defaults to "none"', () => {
    const state = useThemeStore.getState();
    expect(state.dashboardBackground).toBe('none');
  });

  it('sets dashboard background to "gradient-mesh"', () => {
    const { setDashboardBackground } = useThemeStore.getState();
    setDashboardBackground('gradient-mesh');
    expect(useThemeStore.getState().dashboardBackground).toBe('gradient-mesh');
  });

  it('sets dashboard background to "gradient-mesh-particles"', () => {
    const { setDashboardBackground } = useThemeStore.getState();
    setDashboardBackground('gradient-mesh-particles');
    expect(useThemeStore.getState().dashboardBackground).toBe('gradient-mesh-particles');
  });

  it.each(['retro-70s', 'retro-arcade', 'retro-terminal', 'retro-vaporwave'] as const)(
    'sets dashboard background to "%s"',
    (bg) => {
      const { setDashboardBackground } = useThemeStore.getState();
      setDashboardBackground(bg);
      expect(useThemeStore.getState().dashboardBackground).toBe(bg);
    }
  );

  it('can toggle back to "none"', () => {
    const { setDashboardBackground } = useThemeStore.getState();
    setDashboardBackground('retro-arcade');
    setDashboardBackground('none');
    expect(useThemeStore.getState().dashboardBackground).toBe('none');
  });
});

describe('useThemeStore - retro themes', () => {
  beforeEach(() => {
    useThemeStore.setState({ theme: 'system' });
  });

  it.each(['retro-70s', 'retro-arcade', 'retro-terminal', 'retro-vaporwave'] as const)(
    'sets theme to "%s"',
    (theme) => {
      const { setTheme } = useThemeStore.getState();
      setTheme(theme);
      expect(useThemeStore.getState().theme).toBe(theme);
    }
  );

  it('resolves "retro-70s" as light theme', () => {
    useThemeStore.setState({ theme: 'retro-70s' });
    expect(useThemeStore.getState().resolvedTheme()).toBe('light');
  });

  it.each(['retro-arcade', 'retro-terminal', 'retro-vaporwave'] as const)(
    'resolves "%s" as dark theme',
    (theme) => {
      useThemeStore.setState({ theme });
      expect(useThemeStore.getState().resolvedTheme()).toBe('dark');
    }
  );
});

describe('useThemeStore - toggleThemes', () => {
  beforeEach(() => {
    useThemeStore.setState({
      theme: 'apple-light',
      toggleThemes: [...DEFAULT_TOGGLE_THEMES],
    });
  });

  it('defaults to DEFAULT_TOGGLE_THEMES', () => {
    expect(useThemeStore.getState().toggleThemes).toEqual(DEFAULT_TOGGLE_THEMES);
  });

  it('toggleTheme switches from first to second', () => {
    useThemeStore.setState({ theme: 'apple-light', toggleThemes: ['apple-light', 'apple-dark'] });
    useThemeStore.getState().toggleTheme();
    expect(useThemeStore.getState().theme).toBe('apple-dark');
  });

  it('toggleTheme switches from second to first', () => {
    useThemeStore.setState({ theme: 'apple-dark', toggleThemes: ['apple-light', 'apple-dark'] });
    useThemeStore.getState().toggleTheme();
    expect(useThemeStore.getState().theme).toBe('apple-light');
  });

  it('toggleTheme defaults to first when current is neither', () => {
    useThemeStore.setState({ theme: 'retro-arcade', toggleThemes: ['apple-light', 'apple-dark'] });
    useThemeStore.getState().toggleTheme();
    expect(useThemeStore.getState().theme).toBe('apple-light');
  });

  it('setToggleThemes replaces the pair', () => {
    useThemeStore.getState().setToggleThemes(['catppuccin-latte', 'catppuccin-mocha']);
    expect(useThemeStore.getState().toggleThemes).toEqual(['catppuccin-latte', 'catppuccin-mocha']);
  });
});
