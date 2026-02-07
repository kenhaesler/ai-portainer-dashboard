import { describe, it, expect, beforeEach } from 'vitest';
import { useThemeStore, DEFAULT_ENABLED_THEMES } from './theme-store';

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

describe('useThemeStore - enabledThemes & cycleTheme', () => {
  beforeEach(() => {
    useThemeStore.setState({
      theme: 'apple-light',
      enabledThemes: [...DEFAULT_ENABLED_THEMES],
    });
  });

  it('defaults to DEFAULT_ENABLED_THEMES', () => {
    expect(useThemeStore.getState().enabledThemes).toEqual(DEFAULT_ENABLED_THEMES);
  });

  it('toggleEnabledTheme adds a theme', () => {
    useThemeStore.getState().toggleEnabledTheme('dark');
    expect(useThemeStore.getState().enabledThemes).toContain('dark');
  });

  it('toggleEnabledTheme removes a theme', () => {
    useThemeStore.getState().toggleEnabledTheme('apple-light');
    expect(useThemeStore.getState().enabledThemes).not.toContain('apple-light');
  });

  it('does not remove the last enabled theme', () => {
    useThemeStore.setState({ enabledThemes: ['apple-dark'] });
    useThemeStore.getState().toggleEnabledTheme('apple-dark');
    expect(useThemeStore.getState().enabledThemes).toEqual(['apple-dark']);
  });

  it('cycleTheme advances to the next enabled theme', () => {
    useThemeStore.setState({ theme: 'apple-light', enabledThemes: ['apple-light', 'apple-dark'] });
    useThemeStore.getState().cycleTheme();
    expect(useThemeStore.getState().theme).toBe('apple-dark');
  });

  it('cycleTheme wraps around to the first enabled theme', () => {
    useThemeStore.setState({ theme: 'apple-dark', enabledThemes: ['apple-light', 'apple-dark'] });
    useThemeStore.getState().cycleTheme();
    expect(useThemeStore.getState().theme).toBe('apple-light');
  });

  it('cycleTheme picks the first enabled theme when current is not in the list', () => {
    useThemeStore.setState({ theme: 'dark', enabledThemes: ['apple-light', 'apple-dark'] });
    useThemeStore.getState().cycleTheme();
    expect(useThemeStore.getState().theme).toBe('apple-light');
  });

  it('setEnabledThemes replaces the list', () => {
    useThemeStore.getState().setEnabledThemes(['dark', 'light']);
    expect(useThemeStore.getState().enabledThemes).toEqual(['dark', 'light']);
  });
});
