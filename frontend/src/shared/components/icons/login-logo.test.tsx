import { describe, it, expect, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useThemeStore } from '@/stores/theme-store';
import { LoginLogo } from './login-logo';

describe('LoginLogo', () => {
  beforeEach(() => {
    act(() => useThemeStore.setState({ loginIcon: 'brain' }));
  });

  it('renders an SVG with correct aria-label', () => {
    render(<LoginLogo reducedMotion={false} />);
    const svg = screen.getByRole('img', { name: 'Brain logo' });
    expect(svg).toBeInTheDocument();
  });

  it('applies login-logo-path class when animations enabled', () => {
    const { container } = render(<LoginLogo reducedMotion={false} />);
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(path.classList.contains('login-logo-path')).toBe(true);
    }
  });

  it('applies opacity-100 class when reduced motion', () => {
    const { container } = render(<LoginLogo reducedMotion={true} />);
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(path.classList.contains('opacity-100')).toBe(true);
      expect(path.classList.contains('login-logo-path')).toBe(false);
    }
  });

  it('includes gradient defs', () => {
    const { container } = render(<LoginLogo reducedMotion={false} />);
    const gradient = container.querySelector('linearGradient#brainStroke');
    expect(gradient).toBeInTheDocument();
  });

  it('sets staggered --path-delay on each path', () => {
    const { container } = render(<LoginLogo reducedMotion={false} />);
    const paths = container.querySelectorAll('path');
    const delays = Array.from(paths).map(
      (p) => p.style.getPropertyValue('--path-delay')
    );
    expect(delays[0]).toBe('0ms');
    if (paths.length > 1) {
      expect(delays[1]).toBe('80ms');
    }
  });

  it('switches icon when store changes', () => {
    const { rerender } = render(<LoginLogo reducedMotion={false} />);
    act(() => useThemeStore.setState({ loginIcon: 'eye-ai' }));
    rerender(<LoginLogo reducedMotion={false} />);
    const svg = screen.getByRole('img', { name: 'AI Eye logo' });
    expect(svg).toBeInTheDocument();
  });

  it('sets pathLength on all paths', () => {
    const { container } = render(<LoginLogo reducedMotion={false} />);
    const paths = container.querySelectorAll('path');
    for (const path of paths) {
      expect(path.getAttribute('pathLength')).toBe('140');
    }
  });
});
