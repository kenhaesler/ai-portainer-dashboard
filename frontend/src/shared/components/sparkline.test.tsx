import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Sparkline } from './sparkline';

describe('Sparkline', () => {
  it('should render an SVG element', () => {
    const { container } = render(
      <Sparkline data={[10, 20, 15, 25]} />,
    );

    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('should render nothing for empty data', () => {
    const { container } = render(<Sparkline data={[]} />);

    const svg = container.querySelector('svg');
    expect(svg).toBeNull();
  });

  it('should render nothing for single data point', () => {
    const { container } = render(<Sparkline data={[42]} />);

    const svg = container.querySelector('svg');
    expect(svg).toBeNull();
  });

  it('should render 2 path elements (line + fill)', () => {
    const { container } = render(
      <Sparkline data={[5, 10, 8, 12, 7]} />,
    );

    const paths = container.querySelectorAll('path');
    expect(paths).toHaveLength(2);
  });

  it('should handle flat data (all same values)', () => {
    const { container } = render(
      <Sparkline data={[5, 5, 5, 5]} />,
    );

    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();

    const paths = container.querySelectorAll('path');
    expect(paths).toHaveLength(2);
  });

  it('should use custom width and height', () => {
    const { container } = render(
      <Sparkline data={[1, 2, 3]} width={120} height={40} />,
    );

    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('viewBox', '0 0 120 40');
    expect(svg).toHaveAttribute('width', '120');
    expect(svg).toHaveAttribute('height', '40');
  });

  it('should use custom color for stroke', () => {
    const { container } = render(
      <Sparkline data={[1, 2, 3]} color="#ff0000" />,
    );

    const paths = container.querySelectorAll('path');
    // Second path is the line (stroke path)
    const linePath = paths[1];
    expect(linePath).toHaveAttribute('stroke', '#ff0000');
  });

  it('should apply className to the SVG', () => {
    const { container } = render(
      <Sparkline data={[1, 2, 3]} className="my-sparkline" />,
    );

    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('my-sparkline');
  });
});
