import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ShimmerText } from './shimmer-text';

// Default: potatoMode = false
vi.mock('@/stores/ui-store', () => ({
  useUiStore: (selector: (s: { potatoMode: boolean }) => boolean) =>
    selector({ potatoMode: false }),
}));

describe('ShimmerText', () => {
  it('should render children text', () => {
    render(<ShimmerText>Loading...</ShimmerText>);

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('should have the shimmer animation class', () => {
    render(<ShimmerText>Thinking...</ShimmerText>);

    const el = screen.getByText('Thinking...');
    expect(el).toHaveClass('shimmer-text-animate');
  });

  it('should have gradient text classes', () => {
    render(<ShimmerText>Test</ShimmerText>);

    const el = screen.getByText('Test');
    expect(el).toHaveClass('bg-gradient-to-r');
    expect(el).toHaveClass('bg-clip-text');
    expect(el).toHaveClass('text-transparent');
  });

  it('should apply custom className', () => {
    render(<ShimmerText className="text-lg">Custom</ShimmerText>);

    const el = screen.getByText('Custom');
    expect(el).toHaveClass('text-lg');
  });

  it('should set backgroundSize inline style', () => {
    render(<ShimmerText>Styled</ShimmerText>);

    const el = screen.getByText('Styled');
    expect(el.style.backgroundSize).toBe('200% auto');
  });
});
