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

  it('sets dashboard background to "retro"', () => {
    const { setDashboardBackground } = useThemeStore.getState();
    setDashboardBackground('retro');
    expect(useThemeStore.getState().dashboardBackground).toBe('retro');
  });

  it('can toggle back to "none"', () => {
    const { setDashboardBackground } = useThemeStore.getState();
    setDashboardBackground('gradient-mesh');
    setDashboardBackground('none');
    expect(useThemeStore.getState().dashboardBackground).toBe('none');
  });
});

describe('useThemeStore - theme', () => {
  beforeEach(() => {
    useThemeStore.setState({ theme: 'system' });
  });

  it('sets theme to "retro"', () => {
    const { setTheme } = useThemeStore.getState();
    setTheme('retro');
    expect(useThemeStore.getState().theme).toBe('retro');
  });

  it('resolves "retro" as light theme', () => {
    const { setTheme } = useThemeStore.getState();
    setTheme('retro');
    expect(useThemeStore.getState().resolvedTheme()).toBe('light');
  });
});
