import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { KpiSparkline } from './kpi-sparkline';

describe('KpiSparkline', () => {
  it('should render an SVG element with correct dimensions', () => {
    const { container } = render(
      <KpiSparkline values={[10, 20, 15, 25, 30]} />,
    );

    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('width', '60');
    expect(svg).toHaveAttribute('height', '20');
  });

  it('should render nothing when fewer than 2 data points', () => {
    const { container } = render(<KpiSparkline values={[10]} />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('should render nothing when empty array', () => {
    const { container } = render(<KpiSparkline values={[]} />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('should render a line path and an area path', () => {
    const { container } = render(
      <KpiSparkline values={[10, 20, 15, 25]} />,
    );

    const paths = container.querySelectorAll('path');
    expect(paths).toHaveLength(2); // area + line
  });

  it('should include a gradient definition', () => {
    const { container } = render(
      <KpiSparkline values={[5, 10, 8, 12]} />,
    );

    const gradient = container.querySelector('linearGradient');
    expect(gradient).toBeInTheDocument();
  });

  it('should accept custom dimensions', () => {
    const { container } = render(
      <KpiSparkline values={[1, 2, 3]} width={100} height={40} />,
    );

    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '100');
    expect(svg).toHaveAttribute('height', '40');
  });

  it('should apply custom className', () => {
    const { container } = render(
      <KpiSparkline values={[1, 2, 3]} className="my-sparkline" />,
    );

    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('my-sparkline');
  });

  it('should have aria-hidden for accessibility', () => {
    const { container } = render(
      <KpiSparkline values={[1, 2, 3]} />,
    );

    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('should handle flat data (all same values)', () => {
    const { container } = render(
      <KpiSparkline values={[5, 5, 5, 5]} />,
    );

    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    // Should still render without errors even though range is 0
    const paths = container.querySelectorAll('path');
    expect(paths).toHaveLength(2);
  });
});
