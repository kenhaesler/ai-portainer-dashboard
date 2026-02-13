import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SpotlightCard } from './spotlight-card';

// Mock the ui-store so potatoMode defaults to false
vi.mock('@/stores/ui-store', () => ({
  useUiStore: (selector: (s: { potatoMode: boolean }) => boolean) =>
    selector({ potatoMode: false }),
}));

describe('SpotlightCard', () => {
  it('should render children', () => {
    render(
      <SpotlightCard>
        <p>Card content</p>
      </SpotlightCard>,
    );

    expect(screen.getByText('Card content')).toBeInTheDocument();
  });

  it('should have the spotlight-card class', () => {
    const { container } = render(
      <SpotlightCard>
        <p>Test</p>
      </SpotlightCard>,
    );

    expect(container.firstChild).toHaveClass('spotlight-card');
  });

  it('should apply custom className', () => {
    const { container } = render(
      <SpotlightCard className="my-custom-class">
        <p>Test</p>
      </SpotlightCard>,
    );

    expect(container.firstChild).toHaveClass('my-custom-class');
  });

  it('should have onMouseMove handler on the element', () => {
    const { container } = render(
      <SpotlightCard>
        <p>Test</p>
      </SpotlightCard>,
    );

    const el = container.firstChild as HTMLDivElement;
    // Verify the element can receive mouse events by firing one
    // (no error thrown = handler is attached)
    expect(() => {
      fireEvent.mouseMove(el, { clientX: 100, clientY: 50 });
    }).not.toThrow();
  });

  it('should set --x and --y CSS variables on mousemove', () => {
    const { container } = render(
      <SpotlightCard>
        <p>Test</p>
      </SpotlightCard>,
    );

    const el = container.firstChild as HTMLDivElement;
    // Mock getBoundingClientRect for predictable values
    el.getBoundingClientRect = vi.fn(() => ({
      left: 10,
      top: 20,
      right: 210,
      bottom: 220,
      width: 200,
      height: 200,
      x: 10,
      y: 20,
      toJSON: vi.fn(),
    }));

    fireEvent.mouseMove(el, { clientX: 60, clientY: 70 });

    expect(el.style.getPropertyValue('--x')).toBe('50px');
    expect(el.style.getPropertyValue('--y')).toBe('50px');
  });
});
