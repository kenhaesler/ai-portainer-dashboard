import { describe, it, expect, beforeEach } from 'vitest';
import { useThemeStore } from './theme-store';

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
