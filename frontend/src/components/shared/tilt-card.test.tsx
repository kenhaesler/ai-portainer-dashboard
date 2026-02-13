import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TiltCard } from './tilt-card';

// Stub matchMedia for useReducedMotion
function stubMatchMedia(reduce = false) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)' ? reduce : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe('TiltCard', () => {
  beforeEach(() => {
    stubMatchMedia(false);
  });

  it('renders children', () => {
    render(
      <TiltCard>
        <p>Card content</p>
      </TiltCard>,
    );

    expect(screen.getByText('Card content')).toBeInTheDocument();
  });

  it('applies perspective style when tilt is enabled', () => {
    const { container } = render(
      <TiltCard>
        <p>Card content</p>
      </TiltCard>,
    );

    // The outer wrapper div has perspective
    const perspectiveDiv = container.firstChild as HTMLElement;
    expect(perspectiveDiv.style.perspective).toBe('1000px');
  });

  it('skips tilt effect when disabled', () => {
    const { container } = render(
      <TiltCard disabled>
        <p>Disabled tilt</p>
      </TiltCard>,
    );

    expect(screen.getByText('Disabled tilt')).toBeInTheDocument();
    // When disabled, it renders a plain div without perspective
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.perspective).toBe('');
  });

  it('skips tilt effect when disabled prop is true (equivalent to reduced motion)', () => {
    // When disabled (same code path as reduced motion), tilt-card testid is absent
    render(
      <TiltCard disabled>
        <p>Reduced motion content</p>
      </TiltCard>,
    );

    expect(screen.getByText('Reduced motion content')).toBeInTheDocument();
    // When tilt is disabled, the motion div with data-testid="tilt-card" is not rendered
    expect(screen.queryByTestId('tilt-card')).not.toBeInTheDocument();
  });
});
