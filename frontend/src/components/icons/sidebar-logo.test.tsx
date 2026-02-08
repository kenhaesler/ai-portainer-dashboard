import { describe, it, expect, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useThemeStore } from '@/stores/theme-store';
import { SidebarLogo } from './sidebar-logo';
import { ICON_SET_MAP } from './icon-sets';

describe('SidebarLogo', () => {
  beforeEach(() => {
    act(() => useThemeStore.setState({ sidebarIcon: 'brain' }));
  });

  it('renders an SVG with role="img"', () => {
    render(<SidebarLogo />);
    const svg = screen.getByRole('img');
    expect(svg).toBeInTheDocument();
    expect(svg.tagName).toBe('svg');
  });

  it('renders the brain icon by default', () => {
    render(<SidebarLogo />);
    const svg = screen.getByRole('img', { name: 'Brain logo' });
    expect(svg).toBeInTheDocument();
  });

  it('switches icon when store changes', () => {
    const { rerender } = render(<SidebarLogo />);
    act(() => useThemeStore.setState({ sidebarIcon: 'lighthouse' }));
    rerender(<SidebarLogo />);
    const svg = screen.getByRole('img', { name: 'Lighthouse logo' });
    expect(svg).toBeInTheDocument();
  });

  it('renders correct number of paths for each icon', () => {
    for (const icon of Object.values(ICON_SET_MAP)) {
      act(() => useThemeStore.setState({ sidebarIcon: icon.id }));
      const { container } = render(<SidebarLogo />);
      const paths = container.querySelectorAll('path');
      expect(paths.length).toBe(icon.paths.length);
    }
  });
});
