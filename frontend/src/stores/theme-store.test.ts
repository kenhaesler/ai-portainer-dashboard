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

  it('can toggle back to "none"', () => {
    const { setDashboardBackground } = useThemeStore.getState();
    setDashboardBackground('gradient-mesh');
    setDashboardBackground('none');
    expect(useThemeStore.getState().dashboardBackground).toBe('none');
  });
});
