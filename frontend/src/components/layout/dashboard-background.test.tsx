import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DashboardBackground } from './dashboard-background';
import { useThemeStore } from '@/stores/theme-store';

vi.mock('framer-motion', () => ({
  useReducedMotion: vi.fn(() => false),
}));

import { useReducedMotion } from 'framer-motion';

const mockUseReducedMotion = vi.mocked(useReducedMotion);

describe('DashboardBackground', () => {
  beforeEach(() => {
    useThemeStore.setState({ dashboardBackground: 'none' });
    mockUseReducedMotion.mockReturnValue(false);
  });

  it('renders nothing when background is "none"', () => {
    useThemeStore.setState({ dashboardBackground: 'none' });
    const { container } = render(<DashboardBackground />);
    expect(container.innerHTML).toBe('');
  });

  it('renders gradient mesh when background is "gradient-mesh"', () => {
    useThemeStore.setState({ dashboardBackground: 'gradient-mesh' });
    render(<DashboardBackground />);
    expect(screen.getByTestId('dashboard-gradient')).toBeInTheDocument();
  });

  it('does not render particles when background is "gradient-mesh"', () => {
    useThemeStore.setState({ dashboardBackground: 'gradient-mesh' });
    const { container } = render(<DashboardBackground />);
    expect(container.querySelectorAll('.login-particle')).toHaveLength(0);
  });

  it('renders gradient mesh and particles when background is "gradient-mesh-particles"', () => {
    useThemeStore.setState({ dashboardBackground: 'gradient-mesh-particles' });
    render(<DashboardBackground />);
    expect(screen.getByTestId('dashboard-gradient')).toBeInTheDocument();
    const { container } = render(<DashboardBackground />);
    expect(container.querySelectorAll('.login-particle').length).toBeGreaterThan(0);
  });

  it('hides particles when reduced motion is preferred', () => {
    mockUseReducedMotion.mockReturnValue(true);
    useThemeStore.setState({ dashboardBackground: 'gradient-mesh-particles' });
    const { container } = render(<DashboardBackground />);
    expect(container.querySelectorAll('.login-particle')).toHaveLength(0);
  });

  it('sets aria-hidden on the background container', () => {
    useThemeStore.setState({ dashboardBackground: 'gradient-mesh' });
    const { container } = render(<DashboardBackground />);
    const wrapper = container.firstElementChild;
    expect(wrapper).toHaveAttribute('aria-hidden', 'true');
  });

  it('applies reduced opacity class to gradient mesh', () => {
    useThemeStore.setState({ dashboardBackground: 'gradient-mesh' });
    render(<DashboardBackground />);
    const gradient = screen.getByTestId('dashboard-gradient');
    expect(gradient.className).toContain('opacity-60');
  });

  it('renders retro background with corner stripes', () => {
    useThemeStore.setState({ dashboardBackground: 'retro' });
    render(<DashboardBackground />);
    expect(screen.getByTestId('retro-bg')).toBeInTheDocument();
  });

  it('retro background contains top-left and bottom-right stripe arcs', () => {
    useThemeStore.setState({ dashboardBackground: 'retro' });
    const { container } = render(<DashboardBackground />);
    expect(container.querySelector('.retro-stripes-tl')).toBeInTheDocument();
    expect(container.querySelector('.retro-stripes-br')).toBeInTheDocument();
  });

  it('does not render gradient mesh when retro background is selected', () => {
    useThemeStore.setState({ dashboardBackground: 'retro' });
    render(<DashboardBackground />);
    expect(screen.queryByTestId('dashboard-gradient')).not.toBeInTheDocument();
  });
});
