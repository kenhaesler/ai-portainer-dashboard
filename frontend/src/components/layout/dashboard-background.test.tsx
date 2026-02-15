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

  it.each([
    'mesh-aurora',
    'mesh-ocean',
    'mesh-sunset',
    'mesh-nebula',
    'mesh-emerald',
    'mesh-glacier',
    'mesh-emberstorm',
    'mesh-noctis',
    'mesh-cotton-candy',
    'mesh-chaos',
  ] as const)(
    'renders gradient mesh variant for "%s" without particles',
    (bg) => {
      useThemeStore.setState({ dashboardBackground: bg });
      const { container } = render(<DashboardBackground />);
      expect(screen.getByTestId('dashboard-gradient')).toBeInTheDocument();
      expect(container.querySelectorAll('.login-particle')).toHaveLength(0);
    }
  );

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

  it.each(['retro-70s', 'retro-arcade', 'retro-terminal', 'retro-vaporwave'] as const)(
    'renders retro background for "%s"',
    (bg) => {
      useThemeStore.setState({ dashboardBackground: bg });
      render(<DashboardBackground />);
      expect(screen.getByTestId('retro-bg')).toBeInTheDocument();
    }
  );

  it('does not render gradient mesh when retro background is selected', () => {
    useThemeStore.setState({ dashboardBackground: 'retro-70s' });
    render(<DashboardBackground />);
    expect(screen.queryByTestId('dashboard-gradient')).not.toBeInTheDocument();
  });

  it('retro-70s contains wave stripe elements', () => {
    useThemeStore.setState({ dashboardBackground: 'retro-70s' });
    const { container } = render(<DashboardBackground />);
    expect(container.querySelector('.retro-70s-top')).toBeInTheDocument();
    expect(container.querySelector('.retro-70s-bottom')).toBeInTheDocument();
  });

  it('retro-arcade contains glow element', () => {
    useThemeStore.setState({ dashboardBackground: 'retro-arcade' });
    const { container } = render(<DashboardBackground />);
    expect(container.querySelector('.retro-arcade-glow')).toBeInTheDocument();
  });

  it('retro-terminal contains vignette element', () => {
    useThemeStore.setState({ dashboardBackground: 'retro-terminal' });
    const { container } = render(<DashboardBackground />);
    expect(container.querySelector('.retro-terminal-vignette')).toBeInTheDocument();
  });
});
